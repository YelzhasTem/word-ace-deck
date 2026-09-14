BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Block concurrent writes for the entire ACL/trigger/backfill cutover. A timeout
-- rolls back everything. Reads may briefly wait for the following table DDL.
LOCK TABLE public.decks, public.collections, public.deck_likes,
  public.deck_ratings, public.deck_saves, public.deck_reports,
  public.collection_likes, public.collection_ratings, public.collection_saves,
  public.collection_reports, public.creator_follows IN ACCESS EXCLUSIVE MODE;

-- Only these timestamp triggers are suspended, inside the locked transaction,
-- so repairing derived values does not republish or reorder existing content.
ALTER TABLE public.decks DISABLE TRIGGER update_decks_updated_at;
ALTER TABLE public.collections DISABLE TRIGGER update_collections_updated_at;

WITH likes AS (
  SELECT deck_id, count(*) AS total FROM public.deck_likes GROUP BY deck_id
), ratings AS (
  SELECT deck_id, count(*) AS total, sum(rating) AS score
  FROM public.deck_ratings GROUP BY deck_id
), totals AS (
  SELECT d.id, coalesce(l.total, 0)::integer AS likes,
    coalesce(r.total, 0)::integer AS ratings, coalesce(r.score, 0)::integer AS score
  FROM public.decks d LEFT JOIN likes l ON l.deck_id = d.id
  LEFT JOIN ratings r ON r.deck_id = d.id
)
UPDATE public.decks d SET like_count = t.likes, rating_count = t.ratings, rating_sum = t.score
FROM totals t WHERE d.id = t.id
  AND (d.like_count, d.rating_count, d.rating_sum) IS DISTINCT FROM (t.likes, t.ratings, t.score);

WITH likes AS (
  SELECT collection_id, count(*) AS total FROM public.collection_likes GROUP BY collection_id
), ratings AS (
  SELECT collection_id, count(*) AS total, sum(rating) AS score
  FROM public.collection_ratings GROUP BY collection_id
), totals AS (
  SELECT c.id, coalesce(l.total, 0)::integer AS likes,
    coalesce(r.total, 0)::integer AS ratings, coalesce(r.score, 0)::integer AS score
  FROM public.collections c LEFT JOIN likes l ON l.collection_id = c.id
  LEFT JOIN ratings r ON r.collection_id = c.id
)
UPDATE public.collections c SET like_count = t.likes, rating_count = t.ratings, rating_sum = t.score
FROM totals t WHERE c.id = t.id
  AND (c.like_count, c.rating_count, c.rating_sum) IS DISTINCT FROM (t.likes, t.ratings, t.score);

ALTER TABLE public.decks ENABLE TRIGGER update_decks_updated_at;
ALTER TABLE public.collections ENABLE TRIGGER update_collections_updated_at;

-- Do not reinterpret cumulative copy/learner/view totals as counts of surviving
-- copies or saves. Their historical values require a separate audited decision.

DO $acl$
DECLARE
  target text;
  columns text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'decks', 'collections', 'deck_likes', 'deck_ratings', 'deck_saves',
    'deck_reports', 'collection_likes', 'collection_ratings', 'collection_saves',
    'collection_reports', 'creator_follows'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', target);
    -- Table-level REVOKE alone does not remove existing column ACLs.
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO columns
    FROM pg_attribute WHERE attrelid = format('public.%I', target)::regclass
      AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated', columns, target);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', target);
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', target);
  END LOOP;
END;
$acl$;

GRANT SELECT ON public.decks, public.collections TO anon;
GRANT DELETE ON public.decks, public.collections, public.deck_likes, public.deck_saves,
  public.collection_likes, public.collection_saves, public.creator_follows TO authenticated;

-- Ordinary creation starts private. Publishing is an explicit owner UPDATE;
-- trusted atomic creation/copy RPCs retain their existing private defaults.
GRANT INSERT (user_id, name, description, cover_color, target_language,
  definition_language, category, keywords) ON public.decks TO authenticated;
GRANT UPDATE (name, description, cover_color, target_language,
  definition_language, visibility, category, keywords) ON public.decks TO authenticated;
GRANT INSERT (user_id, name, description, keywords) ON public.collections TO authenticated;
GRANT UPDATE (name, description, visibility, keywords) ON public.collections TO authenticated;
GRANT INSERT (deck_id, user_id) ON public.deck_likes, public.deck_saves TO authenticated;
GRANT INSERT (collection_id, user_id) ON public.collection_likes, public.collection_saves TO authenticated;
GRANT INSERT (deck_id, user_id, rating) ON public.deck_ratings TO authenticated;
GRANT INSERT (collection_id, user_id, rating) ON public.collection_ratings TO authenticated;
-- PostgREST upsert includes unchanged conflict keys in its UPDATE target list.
-- The identity trigger below permits those no-ops, not actual key changes.
GRANT UPDATE (deck_id, user_id, rating) ON public.deck_ratings TO authenticated;
GRANT UPDATE (collection_id, user_id, rating) ON public.collection_ratings TO authenticated;
GRANT INSERT (deck_id, reporter_id, reason) ON public.deck_reports TO authenticated;
GRANT INSERT (collection_id, reporter_id, reason) ON public.collection_reports TO authenticated;
GRANT INSERT (creator_id, follower_id) ON public.creator_follows TO authenticated;

ALTER POLICY "Users update own decks" ON public.decks
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY "Users update own collections" ON public.collections
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Admins hide reported decks" ON public.decks;
DROP POLICY IF EXISTS "Admins hide reported collections" ON public.collections;
DROP POLICY IF EXISTS "Admins update reports" ON public.deck_reports;
DROP POLICY IF EXISTS "Admins update collection reports" ON public.collection_reports;

ALTER POLICY "Users like decks" ON public.deck_likes WITH CHECK (
  (SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.decks d
    WHERE d.id = deck_id AND d.visibility IN ('public', 'unlisted') AND d.hidden_at IS NULL));
ALTER POLICY "Users save decks" ON public.deck_saves WITH CHECK (
  (SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.decks d
    WHERE d.id = deck_id AND d.visibility IN ('public', 'unlisted') AND d.hidden_at IS NULL));
ALTER POLICY "Users rate decks" ON public.deck_ratings WITH CHECK (
  (SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.decks d
    WHERE d.id = deck_id AND d.visibility IN ('public', 'unlisted') AND d.hidden_at IS NULL));
ALTER POLICY "Users update own ratings" ON public.deck_ratings
  USING ((SELECT auth.uid()) = user_id) WITH CHECK (
    (SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.decks d
      WHERE d.id = deck_id AND d.visibility IN ('public', 'unlisted') AND d.hidden_at IS NULL));
ALTER POLICY "Users like collections" ON public.collection_likes WITH CHECK (
  (SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.collections c
    WHERE c.id = collection_id AND c.visibility IN ('public', 'unlisted') AND c.hidden_at IS NULL));
ALTER POLICY "Users save collections" ON public.collection_saves WITH CHECK (
  (SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.collections c
    WHERE c.id = collection_id AND c.visibility IN ('public', 'unlisted') AND c.hidden_at IS NULL));
ALTER POLICY "Users rate collections" ON public.collection_ratings WITH CHECK (
  (SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.collections c
    WHERE c.id = collection_id AND c.visibility IN ('public', 'unlisted') AND c.hidden_at IS NULL));
ALTER POLICY "Users update own collection ratings" ON public.collection_ratings
  USING ((SELECT auth.uid()) = user_id) WITH CHECK (
    (SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.collections c
      WHERE c.id = collection_id AND c.visibility IN ('public', 'unlisted') AND c.hidden_at IS NULL));

CREATE OR REPLACE FUNCTION private.set_marketplace_publication_time()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  -- Preserve the existing explicit-publish behavior, including republishing an
  -- already public item. Unrelated metadata/counter updates do not run this trigger.
  NEW.published_at := CASE WHEN NEW.visibility = 'public' THEN statement_timestamp() ELSE NULL END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.set_marketplace_publication_time() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER set_deck_publication_time BEFORE UPDATE OF visibility ON public.decks
  FOR EACH ROW EXECUTE FUNCTION private.set_marketplace_publication_time();
CREATE TRIGGER set_collection_publication_time BEFORE UPDATE OF visibility ON public.collections
  FOR EACH ROW EXECUTE FUNCTION private.set_marketplace_publication_time();

CREATE OR REPLACE FUNCTION private.touch_marketplace_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  -- Previously client-writable timestamps can be ahead of the clock. Preserve
  -- the timestamp CHECK while keeping legitimate aggregate/rating writes usable.
  NEW.updated_at := greatest(OLD.updated_at, NEW.created_at, statement_timestamp());
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.touch_marketplace_updated_at() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER update_decks_updated_at BEFORE UPDATE ON public.decks
  FOR EACH ROW EXECUTE FUNCTION private.touch_marketplace_updated_at();
CREATE OR REPLACE TRIGGER update_collections_updated_at BEFORE UPDATE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION private.touch_marketplace_updated_at();
CREATE OR REPLACE TRIGGER update_deck_ratings_updated_at BEFORE UPDATE ON public.deck_ratings
  FOR EACH ROW EXECUTE FUNCTION private.touch_marketplace_updated_at();
CREATE OR REPLACE TRIGGER update_collection_ratings_updated_at BEFORE UPDATE ON public.collection_ratings
  FOR EACH ROW EXECUTE FUNCTION private.touch_marketplace_updated_at();

CREATE OR REPLACE FUNCTION private.keep_marketplace_rating_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR (to_jsonb(NEW) -> TG_ARGV[0]) IS DISTINCT FROM (to_jsonb(OLD) -> TG_ARGV[0]) THEN
    RAISE EXCEPTION 'MARKETPLACE_IDENTITY_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.keep_marketplace_rating_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER keep_deck_rating_identity BEFORE UPDATE ON public.deck_ratings
  FOR EACH ROW EXECUTE FUNCTION private.keep_marketplace_rating_identity('deck_id');
CREATE TRIGGER keep_collection_rating_identity BEFORE UPDATE ON public.collection_ratings
  FOR EACH ROW EXECUTE FUNCTION private.keep_marketplace_rating_identity('collection_id');

CREATE OR REPLACE FUNCTION private.maintain_marketplace_aggregates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  parent_id uuid;
  likes_delta integer := 0;
  ratings_delta integer := 0;
  score_delta integer := 0;
  event_row jsonb;
BEGIN
  -- Child privileges/RLS authorize the event. This trigger also has to run for
  -- trusted FK cleanup without a user JWT. It accepts no caller-controlled SQL.
  IF TG_OP = 'DELETE' THEN event_row := to_jsonb(OLD); ELSE event_row := to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME IN ('deck_likes', 'collection_likes') THEN
    likes_delta := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE -1 END;
  ELSIF TG_TABLE_NAME IN ('deck_ratings', 'collection_ratings') THEN
    IF TG_OP = 'INSERT' THEN ratings_delta := 1; score_delta := NEW.rating;
    ELSIF TG_OP = 'DELETE' THEN ratings_delta := -1; score_delta := -OLD.rating;
    ELSE score_delta := NEW.rating - OLD.rating;
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_MARKETPLACE_TRIGGER';
  END IF;
  IF likes_delta = 0 AND ratings_delta = 0 AND score_delta = 0 THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME IN ('deck_likes', 'deck_ratings') THEN
    parent_id := (event_row ->> 'deck_id')::uuid;
    UPDATE public.decks SET like_count = like_count + likes_delta,
      rating_count = rating_count + ratings_delta, rating_sum = rating_sum + score_delta
    WHERE id = parent_id;
  ELSE
    parent_id := (event_row ->> 'collection_id')::uuid;
    UPDATE public.collections SET like_count = like_count + likes_delta,
      rating_count = rating_count + ratings_delta, rating_sum = rating_sum + score_delta
    WHERE id = parent_id;
  END IF;
  -- An already deleted parent during FK cascade legitimately affects zero rows.
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.maintain_marketplace_aggregates() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER maintain_deck_likes AFTER INSERT OR DELETE ON public.deck_likes
  FOR EACH ROW EXECUTE FUNCTION private.maintain_marketplace_aggregates();
CREATE TRIGGER maintain_collection_likes AFTER INSERT OR DELETE ON public.collection_likes
  FOR EACH ROW EXECUTE FUNCTION private.maintain_marketplace_aggregates();
CREATE TRIGGER maintain_deck_ratings AFTER INSERT OR UPDATE OR DELETE ON public.deck_ratings
  FOR EACH ROW EXECUTE FUNCTION private.maintain_marketplace_aggregates();
CREATE TRIGGER maintain_collection_ratings AFTER INSERT OR UPDATE OR DELETE ON public.collection_ratings
  FOR EACH ROW EXECUTE FUNCTION private.maintain_marketplace_aggregates();

-- At most one receipt per actor/resource, not an ever-growing per-day event log.
-- Only the latest accepted UTC date is retained. Auth/resource deletion cascades.
CREATE TABLE private.marketplace_view_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_id uuid REFERENCES public.decks(id) ON DELETE CASCADE,
  collection_id uuid REFERENCES public.collections(id) ON DELETE CASCADE,
  viewed_on date NOT NULL,
  CONSTRAINT marketplace_view_receipt_one_resource CHECK (num_nonnulls(deck_id, collection_id) = 1)
);
CREATE UNIQUE INDEX marketplace_deck_view_actor ON private.marketplace_view_receipts(user_id, deck_id)
  WHERE deck_id IS NOT NULL;
CREATE UNIQUE INDEX marketplace_collection_view_actor ON private.marketplace_view_receipts(user_id, collection_id)
  WHERE collection_id IS NOT NULL;
CREATE INDEX marketplace_view_deck ON private.marketplace_view_receipts(deck_id) WHERE deck_id IS NOT NULL;
CREATE INDEX marketplace_view_collection ON private.marketplace_view_receipts(collection_id) WHERE collection_id IS NOT NULL;
ALTER TABLE private.marketplace_view_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.marketplace_view_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.marketplace_view_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.record_marketplace_view(p_resource_type text, p_resource_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  actor uuid := auth.uid();
  today date := (statement_timestamp() AT TIME ZONE 'UTC')::date;
  total integer;
  claimed integer;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501'; END IF;
  IF p_resource_type IS NULL OR p_resource_type NOT IN ('deck', 'collection') OR p_resource_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_MARKETPLACE_REQUEST' USING ERRCODE = '22023';
  END IF;
  IF p_resource_type = 'deck' THEN
    SELECT d.view_count INTO total FROM public.decks d WHERE d.id = p_resource_id
      AND d.visibility IN ('public', 'unlisted') AND d.hidden_at IS NULL FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MARKETPLACE_ACCESS_DENIED' USING ERRCODE = '42501'; END IF;
    INSERT INTO private.marketplace_view_receipts(user_id, deck_id, viewed_on)
      VALUES (actor, p_resource_id, today)
      ON CONFLICT (user_id, deck_id) WHERE deck_id IS NOT NULL DO UPDATE
      SET viewed_on = EXCLUDED.viewed_on
      WHERE private.marketplace_view_receipts.viewed_on < EXCLUDED.viewed_on;
    GET DIAGNOSTICS claimed = ROW_COUNT;
    IF claimed = 1 THEN
      UPDATE public.decks SET view_count = view_count + 1 WHERE id = p_resource_id RETURNING view_count INTO total;
    END IF;
  ELSE
    SELECT c.view_count INTO total FROM public.collections c WHERE c.id = p_resource_id
      AND c.visibility IN ('public', 'unlisted') AND c.hidden_at IS NULL FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MARKETPLACE_ACCESS_DENIED' USING ERRCODE = '42501'; END IF;
    INSERT INTO private.marketplace_view_receipts(user_id, collection_id, viewed_on)
      VALUES (actor, p_resource_id, today)
      ON CONFLICT (user_id, collection_id) WHERE collection_id IS NOT NULL DO UPDATE
      SET viewed_on = EXCLUDED.viewed_on
      WHERE private.marketplace_view_receipts.viewed_on < EXCLUDED.viewed_on;
    GET DIAGNOSTICS claimed = ROW_COUNT;
    IF claimed = 1 THEN
      UPDATE public.collections SET view_count = view_count + 1 WHERE id = p_resource_id RETURNING view_count INTO total;
    END IF;
  END IF;
  RETURN total;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_marketplace_view(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_marketplace_view(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.moderate_marketplace_report(
  p_resource_type text, p_report_id uuid, p_action text
)
RETURNS TABLE(resource_id uuid, report_id uuid, status public.report_status, hidden_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  actor uuid := auth.uid();
  target uuid;
  current_status public.report_status;
  wanted_status public.report_status;
  hidden_time timestamptz;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = actor AND r.role = 'admin') THEN
    RAISE EXCEPTION 'MODERATION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_resource_type IS NULL OR p_resource_type NOT IN ('deck', 'collection')
    OR p_action IS NULL OR p_action NOT IN ('hide', 'dismiss') OR p_report_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_MARKETPLACE_REQUEST' USING ERRCODE = '22023';
  END IF;
  wanted_status := CASE WHEN p_action = 'hide' THEN 'hidden'::public.report_status ELSE 'dismissed'::public.report_status END;
  IF p_resource_type = 'deck' THEN
    SELECT r.deck_id INTO target FROM public.deck_reports r WHERE r.id = p_report_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    -- Parent before report: same order as deletion/cascade, never a caller-supplied target.
    SELECT d.hidden_at INTO hidden_time FROM public.decks d WHERE d.id = target FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    SELECT r.status INTO current_status FROM public.deck_reports r
      WHERE r.id = p_report_id AND r.deck_id = target FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  ELSE
    SELECT r.collection_id INTO target FROM public.collection_reports r WHERE r.id = p_report_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    SELECT c.hidden_at INTO hidden_time FROM public.collections c WHERE c.id = target FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    SELECT r.status INTO current_status FROM public.collection_reports r
      WHERE r.id = p_report_id AND r.collection_id = target FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  END IF;
  IF current_status <> 'pending' AND current_status <> wanted_status THEN
    RAISE EXCEPTION 'MODERATION_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF current_status = 'pending' THEN
    IF p_action = 'hide' AND hidden_time IS NULL THEN
      hidden_time := statement_timestamp();
      IF p_resource_type = 'deck' THEN
        UPDATE public.decks d SET hidden_at = hidden_time WHERE d.id = target;
      ELSE
        UPDATE public.collections c SET hidden_at = hidden_time WHERE c.id = target;
      END IF;
    END IF;
    IF p_resource_type = 'deck' THEN
      UPDATE public.deck_reports r SET status = wanted_status, reviewed_at = statement_timestamp() WHERE r.id = p_report_id;
    ELSE
      UPDATE public.collection_reports r SET status = wanted_status, reviewed_at = statement_timestamp() WHERE r.id = p_report_id;
    END IF;
  END IF;
  RETURN QUERY SELECT target, p_report_id, wanted_status, hidden_time;
END;
$function$;
REVOKE ALL ON FUNCTION public.moderate_marketplace_report(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_marketplace_report(text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.duplicate_public_deck_atomic(
  p_source_deck_id UUID,
  p_idempotency_key UUID
)
RETURNS TABLE (deck_id UUID, card_ids UUID[], duplicate BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_source JSONB;
  v_card JSONB;
  v_card_count INTEGER;
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

  SELECT jsonb_build_object(
    'id', source.id,
    'name', source.name,
    'description', source.description,
    'targetLanguage', source.target_language,
    'definitionLanguage', source.definition_language,
    'category', source.category,
    'keywords', to_jsonb(source.keywords),
    'cards', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'term', source_card.term,
        'definition', source_card.definition,
        'position', source_card.position
      ) ORDER BY source_card.position, source_card.id), '[]'::JSONB)
      FROM public.cards AS source_card
      WHERE source_card.deck_id = source.id
    )
  ) INTO v_source
  FROM public.decks AS source
  WHERE source.id = p_source_deck_id
    AND source.visibility IN ('public', 'unlisted')
    AND source.hidden_at IS NULL
  FOR NO KEY UPDATE OF source;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DECK_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  v_card_count := jsonb_array_length(v_source -> 'cards');
  IF v_card_count > 100 THEN
    RAISE EXCEPTION 'TOO_MANY_CARDS' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.decks (
    user_id, name, description, target_language, definition_language,
    category, keywords, source_deck_id, visibility
  ) VALUES (
    v_user_id,
    btrim(left(v_source ->> 'name', 113)) || ' (copy)',
    v_source ->> 'description',
    v_source ->> 'targetLanguage',
    v_source ->> 'definitionLanguage',
    (v_source ->> 'category')::public.deck_category,
    ARRAY(SELECT jsonb_array_elements_text(v_source -> 'keywords')),
    (v_source ->> 'id')::UUID,
    'private'
  ) RETURNING id INTO v_deck_id;

  FOR v_card IN
    SELECT value FROM jsonb_array_elements(v_source -> 'cards')
  LOOP
    INSERT INTO public.cards (deck_id, user_id, term, definition, position)
    VALUES (
      v_deck_id, v_user_id, v_card ->> 'term', v_card ->> 'definition', v_position
    )
    RETURNING id INTO v_card_id;
    v_card_ids := array_append(v_card_ids, v_card_id);
    v_position := v_position + 1;
  END LOOP;

  UPDATE public.decks
  SET copy_count = copy_count + 1,
      learner_count = learner_count + 1
  WHERE id = (v_source ->> 'id')::UUID;

  v_result := jsonb_build_object('deckId', v_deck_id, 'cardIds', to_jsonb(v_card_ids));
  PERFORM private.complete_content_creation(
    v_user_id, 'duplicate_public_deck', p_idempotency_key, v_result
  );
  RETURN QUERY SELECT v_deck_id, v_card_ids, FALSE;
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = ANY (ARRAY[
      'UNAUTHENTICATED', 'INVALID_DECK', 'DECK_NOT_FOUND',
      'TOO_MANY_CARDS', 'IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_RESULT_GONE',
      'CREATE_DECK_FAILED'
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
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_source JSONB;
  v_source_deck JSONB;
  v_source_card JSONB;
  v_deck_count INTEGER;
  v_total_card_count INTEGER;
  v_largest_deck_card_count INTEGER;
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

  -- Lock the collection first, preventing new FK links while we lock source
  -- decks in ID order. Presentation order remains the existing link order.
  PERFORM c.id FROM public.collections c
  WHERE c.id = p_source_collection_id
    AND c.visibility IN ('public', 'unlisted') AND c.hidden_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  PERFORM d.id FROM public.decks d
  JOIN public.collection_decks link ON link.deck_id = d.id
  WHERE link.collection_id = p_source_collection_id
    AND d.visibility IN ('public', 'unlisted') AND d.hidden_at IS NULL
  ORDER BY d.id FOR NO KEY UPDATE OF d;

  SELECT jsonb_build_object(
    'id', source.id,
    'name', source.name,
    'description', source.description,
    'keywords', to_jsonb(source.keywords),
    'decks', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', deck.id,
        'name', deck.name,
        'description', deck.description,
        'targetLanguage', deck.target_language,
        'definitionLanguage', deck.definition_language,
        'category', deck.category,
        'keywords', to_jsonb(deck.keywords),
        'cards', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'term', card.term,
            'definition', card.definition,
            'position', card.position
          ) ORDER BY card.position, card.id), '[]'::JSONB)
          FROM public.cards AS card
          WHERE card.deck_id = deck.id
        )
      ) ORDER BY link.position, link.id), '[]'::JSONB)
      FROM public.collection_decks AS link
      JOIN public.decks AS deck ON deck.id = link.deck_id
      WHERE link.collection_id = source.id
        AND deck.visibility IN ('public', 'unlisted')
        AND deck.hidden_at IS NULL
    )
  ) INTO v_source
  FROM public.collections AS source
  WHERE source.id = p_source_collection_id
    AND source.visibility IN ('public', 'unlisted')
    AND source.hidden_at IS NULL
  FOR UPDATE OF source;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Collection copies are intentionally bounded independently of the normal
  -- 1-100 card creation contract to keep one transaction predictable.
  v_deck_count := jsonb_array_length(v_source -> 'decks');
  IF v_deck_count > 25 THEN
    RAISE EXCEPTION 'TOO_MANY_DECKS' USING ERRCODE = 'P0001';
  END IF;
  SELECT
    COALESCE(sum(jsonb_array_length(source_deck.value -> 'cards')), 0),
    COALESCE(max(jsonb_array_length(source_deck.value -> 'cards')), 0)
  INTO v_total_card_count, v_largest_deck_card_count
  FROM jsonb_array_elements(v_source -> 'decks') AS source_deck(value);
  IF v_largest_deck_card_count > 100 OR v_total_card_count > 2500 THEN
    RAISE EXCEPTION 'TOO_MANY_CARDS' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.collections (
    user_id, name, description, keywords, source_collection_id, visibility
  ) VALUES (
    v_user_id,
    btrim(left(v_source ->> 'name', 113)) || ' (copy)',
    v_source ->> 'description',
    ARRAY(SELECT jsonb_array_elements_text(v_source -> 'keywords')),
    (v_source ->> 'id')::UUID,
    'private'
  ) RETURNING id INTO v_collection_id;

  FOR v_source_deck IN
    SELECT value FROM jsonb_array_elements(v_source -> 'decks')
  LOOP
    v_card_position := 0;
    INSERT INTO public.decks (
      user_id, name, description, target_language, definition_language,
      category, keywords, source_deck_id, visibility
    ) VALUES (
      v_user_id,
      btrim(left(v_source_deck ->> 'name', 113)) || ' (copy)',
      v_source_deck ->> 'description',
      v_source_deck ->> 'targetLanguage',
      v_source_deck ->> 'definitionLanguage',
      (v_source_deck ->> 'category')::public.deck_category,
      ARRAY(SELECT jsonb_array_elements_text(v_source_deck -> 'keywords')),
      (v_source_deck ->> 'id')::UUID,
      'private'
    ) RETURNING id INTO v_deck_id;

    FOR v_source_card IN
      SELECT value FROM jsonb_array_elements(v_source_deck -> 'cards')
    LOOP
      INSERT INTO public.cards (deck_id, user_id, term, definition, position)
      VALUES (
        v_deck_id, v_user_id, v_source_card ->> 'term', v_source_card ->> 'definition',
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
    WHERE id = (v_source_deck ->> 'id')::UUID;
  END LOOP;

  UPDATE public.collections
  SET copy_count = copy_count + 1,
      learner_count = learner_count + 1
  WHERE id = (v_source ->> 'id')::UUID;

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
      'TOO_MANY_DECKS', 'TOO_MANY_CARDS', 'IDEMPOTENCY_CONFLICT',
      'IDEMPOTENCY_RESULT_GONE', 'CREATE_DECK_FAILED'
    ]) THEN
      RAISE;
    END IF;
    RAISE EXCEPTION 'CREATE_DECK_FAILED' USING ERRCODE = 'P0001';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'CREATE_DECK_FAILED' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.duplicate_public_deck_atomic(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duplicate_public_collection_atomic(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_public_deck_atomic(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_public_collection_atomic(uuid, uuid) TO authenticated;

COMMIT;
