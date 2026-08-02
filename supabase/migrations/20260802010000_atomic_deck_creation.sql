BEGIN;

-- Deck creation is one logical write. These private tables make retries and
-- default-collection selection deterministic without exposing control data to clients.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE private.content_creation_requests (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (
    operation IN ('create_deck_with_cards', 'duplicate_public_deck', 'duplicate_public_collection')
  ),
  idempotency_key UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, operation, idempotency_key),
  CHECK ((result IS NULL) = (completed_at IS NULL))
);

CREATE TABLE private.user_default_collections (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_default_collections_owner_fkey
    FOREIGN KEY (collection_id, user_id)
    REFERENCES public.collections(id, user_id) ON DELETE CASCADE
);

ALTER TABLE private.content_creation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.user_default_collections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.content_creation_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.user_default_collections FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE private.content_creation_requests IS
  'Server-owned idempotency records for atomic content creation; payloads are stored only as SHA-256 hashes.';
COMMENT ON TABLE private.user_default_collections IS
  'One designated default collection per user. Historical duplicate names are not modified.';

CREATE OR REPLACE FUNCTION private.content_request_hash(p_payload JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT encode(extensions.digest(convert_to(p_payload::TEXT, 'UTF8'), 'sha256'), 'hex');
$function$;

CREATE OR REPLACE FUNCTION private.claim_content_creation(
  p_user_id UUID,
  p_operation TEXT,
  p_idempotency_key UUID,
  p_request_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  v_inserted INTEGER;
  v_existing private.content_creation_requests%ROWTYPE;
BEGIN
  INSERT INTO private.content_creation_requests (
    user_id, operation, idempotency_key, request_hash
  ) VALUES (
    p_user_id, p_operation, p_idempotency_key, p_request_hash
  )
  ON CONFLICT (user_id, operation, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN
    RETURN NULL;
  END IF;

  SELECT request.* INTO v_existing
  FROM private.content_creation_requests AS request
  WHERE request.user_id = p_user_id
    AND request.operation = p_operation
    AND request.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  IF v_existing.result IS NULL THEN
    RAISE EXCEPTION 'CREATE_DECK_FAILED' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_existing.result;
END;
$function$;

CREATE OR REPLACE FUNCTION private.complete_content_creation(
  p_user_id UUID,
  p_operation TEXT,
  p_idempotency_key UUID,
  p_result JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE private.content_creation_requests AS request
  SET result = p_result,
      completed_at = clock_timestamp()
  WHERE request.user_id = p_user_id
    AND request.operation = p_operation
    AND request.idempotency_key = p_idempotency_key
    AND request.result IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'CREATE_DECK_FAILED' USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.get_or_create_default_collection(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  v_collection_id UUID;
BEGIN
  -- Serialize default selection for one user. This avoids duplicate defaults
  -- without rewriting historical rows that share the display name.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 52017001));

  SELECT mapping.collection_id INTO v_collection_id
  FROM private.user_default_collections AS mapping
  JOIN public.collections AS collection
    ON collection.id = mapping.collection_id
   AND collection.user_id = mapping.user_id
  WHERE mapping.user_id = p_user_id;

  IF v_collection_id IS NOT NULL THEN
    RETURN v_collection_id;
  END IF;

  SELECT collection.id INTO v_collection_id
  FROM public.collections AS collection
  WHERE collection.user_id = p_user_id
    AND collection.name = 'My collection'
  ORDER BY collection.created_at, collection.id
  LIMIT 1;

  IF v_collection_id IS NULL THEN
    INSERT INTO public.collections (user_id, name, description)
    VALUES (p_user_id, 'My collection', '')
    RETURNING id INTO v_collection_id;
  END IF;

  INSERT INTO private.user_default_collections (user_id, collection_id)
  VALUES (p_user_id, v_collection_id)
  ON CONFLICT (user_id) DO UPDATE
    SET collection_id = EXCLUDED.collection_id;

  RETURN v_collection_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.content_request_hash(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.claim_content_creation(UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.complete_content_creation(UUID, TEXT, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.get_or_create_default_collection(UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_deck_with_cards(
  p_name TEXT,
  p_description TEXT,
  p_cover_color TEXT,
  p_target_language TEXT,
  p_definition_language TEXT,
  p_cards JSONB,
  p_collection_id UUID,
  p_use_default_collection BOOLEAN,
  p_idempotency_key UUID
)
RETURNS TABLE (
  deck_id UUID,
  card_ids UUID[],
  collection_id UUID,
  duplicate BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_name TEXT;
  v_description TEXT;
  v_card JSONB;
  v_term TEXT;
  v_definition TEXT;
  v_position INTEGER;
  v_index INTEGER := 0;
  v_card_count INTEGER;
  v_deck_id UUID;
  v_card_id UUID;
  v_card_ids UUID[] := ARRAY[]::UUID[];
  v_collection_id UUID;
  v_request_hash TEXT;
  v_replay JSONB;
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_DECK' USING ERRCODE = 'P0001';
  END IF;

  v_name := btrim(p_name);
  v_description := btrim(COALESCE(p_description, ''));
  IF p_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 120
     OR char_length(v_description) > 300
     OR p_cover_color IS NOT NULL
        AND p_cover_color <> ALL (ARRAY['rose', 'amber', 'emerald', 'sky', 'violet', 'slate'])
     OR p_target_language IS NULL
        OR p_target_language <> ALL (ARRAY['en', 'es', 'fr', 'de', 'zh-CN', 'ja', 'ko', 'ru', 'pt', 'it'])
     OR p_definition_language IS NULL
        OR p_definition_language <> ALL (ARRAY['en', 'es', 'fr', 'de', 'zh-CN', 'ja', 'ko', 'ru', 'pt', 'it'])
     OR p_target_language = p_definition_language
     OR p_use_default_collection IS NULL
     OR (p_collection_id IS NOT NULL AND p_use_default_collection) THEN
    RAISE EXCEPTION 'INVALID_DECK' USING ERRCODE = 'P0001';
  END IF;

  IF p_cards IS NULL OR jsonb_typeof(p_cards) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_CARD' USING ERRCODE = 'P0001';
  END IF;
  v_card_count := jsonb_array_length(p_cards);
  IF v_card_count = 0 THEN
    RAISE EXCEPTION 'INVALID_CARD' USING ERRCODE = 'P0001';
  END IF;
  IF v_card_count > 100 THEN
    RAISE EXCEPTION 'TOO_MANY_CARDS' USING ERRCODE = 'P0001';
  END IF;

  FOR v_card IN SELECT value FROM jsonb_array_elements(p_cards)
  LOOP
    IF jsonb_typeof(v_card) <> 'object'
       OR (v_card - 'term' - 'definition' - 'position') <> '{}'::JSONB
       OR NOT (v_card ?& ARRAY['term', 'definition', 'position'])
       OR jsonb_typeof(v_card -> 'term') <> 'string'
       OR jsonb_typeof(v_card -> 'definition') <> 'string'
       OR jsonb_typeof(v_card -> 'position') <> 'number'
       OR (v_card ->> 'position') !~ '^[0-9]{1,5}$' THEN
      RAISE EXCEPTION 'INVALID_CARD' USING ERRCODE = 'P0001';
    END IF;

    v_term := btrim(v_card ->> 'term');
    v_definition := btrim(v_card ->> 'definition');
    v_position := (v_card ->> 'position')::INTEGER;
    IF char_length(v_term) NOT BETWEEN 1 AND 160
       OR char_length(v_definition) NOT BETWEEN 1 AND 300
       OR v_position <> v_index
       OR v_position > 10000 THEN
      RAISE EXCEPTION 'INVALID_CARD' USING ERRCODE = 'P0001';
    END IF;
    v_index := v_index + 1;
  END LOOP;

  v_request_hash := private.content_request_hash(jsonb_build_object(
    'name', v_name,
    'description', v_description,
    'coverColor', p_cover_color,
    'targetLanguage', p_target_language,
    'definitionLanguage', p_definition_language,
    'cards', p_cards,
    'collectionId', COALESCE(p_collection_id::TEXT, ''),
    'useDefaultCollection', p_use_default_collection
  ));
  v_replay := private.claim_content_creation(
    v_user_id, 'create_deck_with_cards', p_idempotency_key, v_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'deckId')::UUID,
      ARRAY(SELECT jsonb_array_elements_text(v_replay -> 'cardIds'))::UUID[],
      NULLIF(v_replay ->> 'collectionId', '')::UUID,
      TRUE;
    RETURN;
  END IF;

  IF p_collection_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.collections AS collection WHERE collection.id = p_collection_id
    ) THEN
      RAISE EXCEPTION 'COLLECTION_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.collections AS collection
      WHERE collection.id = p_collection_id AND collection.user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'COLLECTION_ACCESS_DENIED' USING ERRCODE = 'P0001';
    END IF;
    v_collection_id := p_collection_id;
  ELSIF p_use_default_collection THEN
    v_collection_id := private.get_or_create_default_collection(v_user_id);
  END IF;

  INSERT INTO public.decks (
    user_id, name, description, cover_color, target_language, definition_language,
    visibility, category, keywords, published_at
  ) VALUES (
    v_user_id, v_name, v_description, p_cover_color, p_target_language,
    p_definition_language, 'private', 'General English', ARRAY[]::TEXT[], NULL
  ) RETURNING id INTO v_deck_id;

  v_index := 0;
  FOR v_card IN SELECT value FROM jsonb_array_elements(p_cards)
  LOOP
    INSERT INTO public.cards (deck_id, user_id, term, definition, position)
    VALUES (
      v_deck_id,
      v_user_id,
      btrim(v_card ->> 'term'),
      btrim(v_card ->> 'definition'),
      v_index
    )
    RETURNING id INTO v_card_id;
    v_card_ids := array_append(v_card_ids, v_card_id);
    v_index := v_index + 1;
  END LOOP;

  IF v_collection_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_collection_id::TEXT, 52017002));
    INSERT INTO public.collection_decks (collection_id, deck_id, user_id, position)
    SELECT v_collection_id, v_deck_id, v_user_id, COALESCE(max(link.position), -1) + 1
    FROM public.collection_decks AS link
    WHERE link.collection_id = v_collection_id;
  END IF;

  v_result := jsonb_build_object(
    'deckId', v_deck_id,
    'cardIds', to_jsonb(v_card_ids),
    'collectionId', COALESCE(v_collection_id::TEXT, '')
  );
  PERFORM private.complete_content_creation(
    v_user_id, 'create_deck_with_cards', p_idempotency_key, v_result
  );

  RETURN QUERY SELECT v_deck_id, v_card_ids, v_collection_id, FALSE;
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = ANY (ARRAY[
      'UNAUTHENTICATED', 'INVALID_DECK', 'INVALID_CARD', 'TOO_MANY_CARDS',
      'COLLECTION_NOT_FOUND', 'COLLECTION_ACCESS_DENIED',
      'IDEMPOTENCY_CONFLICT', 'CREATE_DECK_FAILED'
    ]) THEN
      RAISE;
    END IF;
    RAISE EXCEPTION 'CREATE_DECK_FAILED' USING ERRCODE = 'P0001';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'CREATE_DECK_FAILED' USING ERRCODE = 'P0001';
END;
$function$;

-- Copy operations have distinct semantics, but use the same transaction and
-- idempotency contract so retries cannot leave partial libraries.
CREATE OR REPLACE FUNCTION public.duplicate_public_deck_atomic(
  p_source_deck_id UUID,
  p_idempotency_key UUID
)
RETURNS TABLE (deck_id UUID, card_ids UUID[], duplicate BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_source public.decks%ROWTYPE;
  v_card RECORD;
  v_deck_id UUID;
  v_card_id UUID;
  v_card_ids UUID[] := ARRAY[]::UUID[];
  v_request_hash TEXT;
  v_replay JSONB;
  v_result JSONB;
  v_position INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF p_source_deck_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_DECK' USING ERRCODE = 'P0001';
  END IF;

  v_request_hash := private.content_request_hash(
    jsonb_build_object('sourceDeckId', p_source_deck_id)
  );
  v_replay := private.claim_content_creation(
    v_user_id, 'duplicate_public_deck', p_idempotency_key, v_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'deckId')::UUID,
      ARRAY(SELECT jsonb_array_elements_text(v_replay -> 'cardIds'))::UUID[],
      TRUE;
    RETURN;
  END IF;

  SELECT source.* INTO v_source
  FROM public.decks AS source
  WHERE source.id = p_source_deck_id
    AND source.visibility IN ('public', 'unlisted')
    AND source.hidden_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECK_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.decks (
    user_id, name, description, target_language, definition_language,
    category, keywords, source_deck_id, visibility
  ) VALUES (
    v_user_id,
    btrim(left(v_source.name, 113)) || ' (copy)',
    v_source.description,
    v_source.target_language,
    v_source.definition_language,
    v_source.category,
    v_source.keywords,
    v_source.id,
    'private'
  ) RETURNING id INTO v_deck_id;

  FOR v_card IN
    SELECT source_card.term, source_card.definition, source_card.position
    FROM public.cards AS source_card
    WHERE source_card.deck_id = v_source.id
    ORDER BY source_card.position, source_card.id
  LOOP
    INSERT INTO public.cards (deck_id, user_id, term, definition, position)
    VALUES (v_deck_id, v_user_id, v_card.term, v_card.definition, v_position)
    RETURNING id INTO v_card_id;
    v_card_ids := array_append(v_card_ids, v_card_id);
    v_position := v_position + 1;
  END LOOP;

  UPDATE public.decks
  SET copy_count = copy_count + 1,
      learner_count = learner_count + 1
  WHERE id = v_source.id;

  v_result := jsonb_build_object('deckId', v_deck_id, 'cardIds', to_jsonb(v_card_ids));
  PERFORM private.complete_content_creation(
    v_user_id, 'duplicate_public_deck', p_idempotency_key, v_result
  );
  RETURN QUERY SELECT v_deck_id, v_card_ids, FALSE;
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = ANY (ARRAY[
      'UNAUTHENTICATED', 'INVALID_DECK', 'DECK_NOT_FOUND',
      'IDEMPOTENCY_CONFLICT', 'CREATE_DECK_FAILED'
    ]) THEN
      RAISE;
    END IF;
    RAISE EXCEPTION 'CREATE_DECK_FAILED' USING ERRCODE = 'P0001';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'CREATE_DECK_FAILED' USING ERRCODE = 'P0001';
END;
$function$;

CREATE OR REPLACE FUNCTION public.duplicate_public_collection_atomic(
  p_source_collection_id UUID,
  p_idempotency_key UUID
)
RETURNS TABLE (collection_id UUID, deck_ids UUID[], duplicate BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_source public.collections%ROWTYPE;
  v_source_deck RECORD;
  v_source_card RECORD;
  v_collection_id UUID;
  v_deck_id UUID;
  v_deck_ids UUID[] := ARRAY[]::UUID[];
  v_request_hash TEXT;
  v_replay JSONB;
  v_result JSONB;
  v_position INTEGER := 0;
  v_card_position INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF p_source_collection_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_DECK' USING ERRCODE = 'P0001';
  END IF;

  v_request_hash := private.content_request_hash(
    jsonb_build_object('sourceCollectionId', p_source_collection_id)
  );
  v_replay := private.claim_content_creation(
    v_user_id, 'duplicate_public_collection', p_idempotency_key, v_request_hash
  );
  IF v_replay IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_replay ->> 'collectionId')::UUID,
      ARRAY(SELECT jsonb_array_elements_text(v_replay -> 'deckIds'))::UUID[],
      TRUE;
    RETURN;
  END IF;

  SELECT source.* INTO v_source
  FROM public.collections AS source
  WHERE source.id = p_source_collection_id
    AND source.visibility IN ('public', 'unlisted')
    AND source.hidden_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.collections (
    user_id, name, description, keywords, source_collection_id, visibility
  ) VALUES (
    v_user_id,
    btrim(left(v_source.name, 113)) || ' (copy)',
    v_source.description,
    v_source.keywords,
    v_source.id,
    'private'
  ) RETURNING id INTO v_collection_id;

  FOR v_source_deck IN
    SELECT deck.*
    FROM public.collection_decks AS link
    JOIN public.decks AS deck ON deck.id = link.deck_id
    WHERE link.collection_id = v_source.id
      AND deck.visibility IN ('public', 'unlisted')
      AND deck.hidden_at IS NULL
    ORDER BY link.position, link.id
  LOOP
    v_card_position := 0;
    INSERT INTO public.decks (
      user_id, name, description, target_language, definition_language,
      category, keywords, source_deck_id, visibility
    ) VALUES (
      v_user_id,
      btrim(left(v_source_deck.name, 113)) || ' (copy)',
      v_source_deck.description,
      v_source_deck.target_language,
      v_source_deck.definition_language,
      v_source_deck.category,
      v_source_deck.keywords,
      v_source_deck.id,
      'private'
    ) RETURNING id INTO v_deck_id;

    FOR v_source_card IN
      SELECT card.term, card.definition, card.position
      FROM public.cards AS card
      WHERE card.deck_id = v_source_deck.id
      ORDER BY card.position, card.id
    LOOP
      INSERT INTO public.cards (deck_id, user_id, term, definition, position)
      VALUES (
        v_deck_id, v_user_id, v_source_card.term, v_source_card.definition,
        v_card_position
      );
      v_card_position := v_card_position + 1;
    END LOOP;

    INSERT INTO public.collection_decks (collection_id, deck_id, user_id, position)
    VALUES (v_collection_id, v_deck_id, v_user_id, v_position);
    v_deck_ids := array_append(v_deck_ids, v_deck_id);
    v_position := v_position + 1;

    UPDATE public.decks
    SET copy_count = copy_count + 1,
        learner_count = learner_count + 1
    WHERE id = v_source_deck.id;
  END LOOP;

  UPDATE public.collections
  SET copy_count = copy_count + 1,
      learner_count = learner_count + 1
  WHERE id = v_source.id;

  v_result := jsonb_build_object(
    'collectionId', v_collection_id,
    'deckIds', to_jsonb(v_deck_ids)
  );
  PERFORM private.complete_content_creation(
    v_user_id, 'duplicate_public_collection', p_idempotency_key, v_result
  );
  RETURN QUERY SELECT v_collection_id, v_deck_ids, FALSE;
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = ANY (ARRAY[
      'UNAUTHENTICATED', 'INVALID_DECK', 'COLLECTION_NOT_FOUND',
      'IDEMPOTENCY_CONFLICT', 'CREATE_DECK_FAILED'
    ]) THEN
      RAISE;
    END IF;
    RAISE EXCEPTION 'CREATE_DECK_FAILED' USING ERRCODE = 'P0001';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'CREATE_DECK_FAILED' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.create_deck_with_cards(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, BOOLEAN, UUID
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duplicate_public_deck_atomic(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duplicate_public_collection_atomic(UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_deck_with_cards(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, BOOLEAN, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_public_deck_atomic(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_public_collection_atomic(UUID, UUID)
  TO authenticated;

COMMENT ON FUNCTION public.create_deck_with_cards(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, BOOLEAN, UUID
) IS 'Atomically creates one owned deck, 1-100 cards, and an optional owned collection link.';
COMMENT ON FUNCTION public.duplicate_public_deck_atomic(UUID, UUID) IS
  'Atomically copies one visible marketplace deck and all of its cards for auth.uid().';
COMMENT ON FUNCTION public.duplicate_public_collection_atomic(UUID, UUID) IS
  'Atomically copies a visible marketplace collection and every visible linked deck for auth.uid().';

COMMIT;
