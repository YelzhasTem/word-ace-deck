BEGIN;

CREATE FUNCTION public.replace_collection_decks_atomic(
  p_collection_id uuid,
  p_deck_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_count integer;
  v_owned_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF p_deck_ids IS NULL OR COALESCE(array_ndims(p_deck_ids), 1) <> 1 THEN
    RAISE EXCEPTION 'INVALID_DECK_IDS' USING ERRCODE = 'P0001';
  END IF;
  v_count := cardinality(p_deck_ids);
  -- Preserve the existing collection editor's 500-deck request limit.
  IF v_count > 500 THEN
    RAISE EXCEPTION 'TOO_MANY_DECKS' USING ERRCODE = 'P0001';
  END IF;
  IF array_position(p_deck_ids, NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_DECK_IDS' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(DISTINCT supplied.id) FROM unnest(p_deck_ids) AS supplied(id)) <> v_count THEN
    RAISE EXCEPTION 'DUPLICATE_DECK_IDS' USING ERRCODE = 'P0001';
  END IF;

  -- Do not expose whether another user's collection exists or lock their rows.
  IF NOT EXISTS (
    SELECT 1 FROM public.collections AS collection
    WHERE collection.id = p_collection_id AND collection.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'COLLECTION_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- Same namespace/order as create_deck_with_cards: acquire this before any
  -- parent row lock, so an atomic append and replacement cannot deadlock.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_collection_id::text, 52017002));
  PERFORM 1 FROM public.collections AS collection
    WHERE collection.id = p_collection_id AND collection.user_id = v_user_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTION_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  -- Pin owned deck identities until commit, in deterministic order. RLS remains
  -- active; even visible public decks owned by someone else are not eligible.
  PERFORM deck.id FROM public.decks AS deck
    WHERE deck.id = ANY(p_deck_ids) AND deck.user_id = v_user_id
    ORDER BY deck.id FOR KEY SHARE;
  GET DIAGNOSTICS v_owned_count = ROW_COUNT;
  IF v_owned_count <> v_count THEN
    RAISE EXCEPTION 'DECK_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.collection_decks AS link
    WHERE link.collection_id = p_collection_id AND link.user_id = v_user_id;
  INSERT INTO public.collection_decks (collection_id, deck_id, user_id, position)
    SELECT p_collection_id, supplied.id, v_user_id, (supplied.ordinality - 1)::integer
    FROM unnest(p_deck_ids) WITH ORDINALITY AS supplied(id, ordinality);
  RETURN v_count;
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = ANY(ARRAY[
      'UNAUTHENTICATED', 'INVALID_DECK_IDS', 'TOO_MANY_DECKS',
      'DUPLICATE_DECK_IDS', 'COLLECTION_NOT_AVAILABLE', 'DECK_NOT_AVAILABLE'
    ]) THEN
      RAISE;
    END IF;
    RAISE EXCEPTION 'REPLACE_COLLECTION_DECKS_FAILED' USING ERRCODE = 'P0001';
  WHEN OTHERS THEN
    -- Re-raising rolls back DELETE and every INSERT, including late constraint
    -- failures. Never serialize raw database details or return partial success.
    RAISE EXCEPTION 'REPLACE_COLLECTION_DECKS_FAILED' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_collection_decks_atomic(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_collection_decks_atomic(uuid, uuid[]) TO authenticated;
COMMENT ON FUNCTION public.replace_collection_decks_atomic(uuid, uuid[]) IS
  'Replace own collection membership in one transaction; serializes with atomic deck creation. Invoker RLS and validated owner FKs remain enforced. Returns link count.';

COMMIT;
