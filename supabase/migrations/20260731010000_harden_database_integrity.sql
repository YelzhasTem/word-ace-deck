BEGIN;

-- This migration adds database-level invariants already enforced by Memora's
-- server validators and verified against production with aggregate-only checks.
-- It does not rewrite or delete existing user data.

CREATE OR REPLACE FUNCTION private.marketplace_keywords_are_valid(value TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT cardinality(value) <= 12
    AND array_position(value, NULL) IS NULL
    AND COALESCE(
      (
        SELECT bool_and(char_length(btrim(keyword)) BETWEEN 1 AND 40)
        FROM unnest(value) AS keyword
      ),
      TRUE
    );
$function$;

COMMENT ON FUNCTION private.marketplace_keywords_are_valid(TEXT[]) IS
  'Pure validator used by marketplace keyword CHECK constraints; it reads no data.';

REVOKE ALL ON FUNCTION private.marketplace_keywords_are_valid(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.marketplace_keywords_are_valid(TEXT[])
  TO authenticated, service_role;

-- Public marketplace RLS policies already exist. Make their read privileges
-- reproducible instead of relying on historical Supabase default grants.
GRANT SELECT ON TABLE
  public.decks,
  public.cards,
  public.collections,
  public.collection_decks
TO anon;

-- Parent keys used by ownership-preserving foreign keys.
ALTER TABLE public.collections
  ADD CONSTRAINT collections_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE public.study_sessions
  ADD CONSTRAINT study_sessions_id_user_id_key UNIQUE (id, user_id),
  ADD CONSTRAINT study_sessions_id_user_id_deck_id_key UNIQUE (id, user_id, deck_id);

-- Historical production rows include deleted/imported Auth owners. These two
-- NOT VALID constraints protect every new write without deleting those rows.
-- They can be validated after a separately approved ownership cleanup.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_id_auth_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.decks
  ADD CONSTRAINT decks_user_id_auth_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

-- All remaining owner references were verified clean and are validated below.
ALTER TABLE public.collections
  ADD CONSTRAINT collections_user_id_auth_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.deck_likes
  ADD CONSTRAINT deck_likes_user_id_auth_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.deck_saves
  ADD CONSTRAINT deck_saves_user_id_auth_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.deck_ratings
  ADD CONSTRAINT deck_ratings_user_id_auth_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.deck_reports
  ADD CONSTRAINT deck_reports_reporter_id_auth_fkey
  FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.collection_likes
  ADD CONSTRAINT collection_likes_user_id_auth_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.collection_saves
  ADD CONSTRAINT collection_saves_user_id_auth_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.collection_ratings
  ADD CONSTRAINT collection_ratings_user_id_auth_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.collection_reports
  ADD CONSTRAINT collection_reports_reporter_id_auth_fkey
  FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.creator_follows
  ADD CONSTRAINT creator_follows_creator_id_profile_fkey
  FOREIGN KEY (creator_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT creator_follows_follower_id_profile_fkey
  FOREIGN KEY (follower_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.collection_decks
  ADD CONSTRAINT collection_decks_collection_owner_fkey
  FOREIGN KEY (collection_id, user_id)
  REFERENCES public.collections(id, user_id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT collection_decks_deck_owner_fkey
  FOREIGN KEY (deck_id, user_id)
  REFERENCES public.decks(id, user_id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.study_session_cards
  ADD CONSTRAINT study_session_cards_session_owner_fkey
  FOREIGN KEY (session_id, user_id, deck_id)
  REFERENCES public.study_sessions(id, user_id, deck_id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.study_questions
  ADD CONSTRAINT study_questions_session_owner_fkey
  FOREIGN KEY (session_id, user_id)
  REFERENCES public.study_sessions(id, user_id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.study_events
  ADD CONSTRAINT study_events_session_owner_fkey
  FOREIGN KEY (session_id, user_id, deck_id)
  REFERENCES public.study_sessions(id, user_id, deck_id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.speed_runs
  ADD CONSTRAINT speed_runs_session_owner_fkey
  FOREIGN KEY (session_id, user_id, deck_id)
  REFERENCES public.study_sessions(id, user_id, deck_id) ON DELETE CASCADE NOT VALID;

-- Text, array, counter, state, and timestamp invariants mirror current server
-- validation. Constraints are added NOT VALID first to minimize blocking, then
-- validated after all definitions are installed.
ALTER TABLE public.decks
  ADD CONSTRAINT decks_name_shape_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120) NOT VALID,
  ADD CONSTRAINT decks_description_length_check
    CHECK (char_length(description) <= 300) NOT VALID,
  ADD CONSTRAINT decks_keywords_shape_check
    CHECK (private.marketplace_keywords_are_valid(keywords)) NOT VALID,
  ADD CONSTRAINT decks_counters_check
    CHECK (
      learner_count >= 0 AND like_count >= 0 AND rating_sum >= 0
      AND rating_count >= 0 AND view_count >= 0 AND copy_count >= 0
      AND rating_sum::BIGINT <= rating_count::BIGINT * 5
      AND (rating_count <> 0 OR rating_sum = 0)
    ) NOT VALID,
  ADD CONSTRAINT decks_source_not_self_check
    CHECK (source_deck_id IS NULL OR source_deck_id <> id) NOT VALID,
  ADD CONSTRAINT decks_publication_shape_check
    CHECK ((visibility = 'public') = (published_at IS NOT NULL)) NOT VALID,
  ADD CONSTRAINT decks_updated_at_check
    CHECK (updated_at >= created_at) NOT VALID;

ALTER TABLE public.collections
  ADD CONSTRAINT collections_name_shape_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120) NOT VALID,
  ADD CONSTRAINT collections_description_length_check
    CHECK (char_length(description) <= 300) NOT VALID,
  ADD CONSTRAINT collections_keywords_shape_check
    CHECK (private.marketplace_keywords_are_valid(keywords)) NOT VALID,
  ADD CONSTRAINT collections_counters_check
    CHECK (
      learner_count >= 0 AND like_count >= 0 AND rating_sum >= 0
      AND rating_count >= 0 AND view_count >= 0 AND copy_count >= 0
      AND rating_sum::BIGINT <= rating_count::BIGINT * 5
      AND (rating_count <> 0 OR rating_sum = 0)
    ) NOT VALID,
  ADD CONSTRAINT collections_source_not_self_check
    CHECK (source_collection_id IS NULL OR source_collection_id <> id) NOT VALID,
  ADD CONSTRAINT collections_publication_shape_check
    CHECK ((visibility = 'public') = (published_at IS NOT NULL)) NOT VALID,
  ADD CONSTRAINT collections_updated_at_check
    CHECK (updated_at >= created_at) NOT VALID;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_term_shape_check
    CHECK (char_length(btrim(term)) BETWEEN 1 AND 160) NOT VALID,
  ADD CONSTRAINT cards_definition_shape_check
    CHECK (char_length(btrim(definition)) BETWEEN 1 AND 300) NOT VALID,
  ADD CONSTRAINT cards_position_check
    CHECK (position BETWEEN 0 AND 10000) NOT VALID,
  ADD CONSTRAINT cards_updated_at_check
    CHECK (updated_at >= created_at) NOT VALID;

ALTER TABLE public.collection_decks
  ADD CONSTRAINT collection_decks_position_check
    CHECK (position >= 0) NOT VALID;

ALTER TABLE public.card_associations
  ADD CONSTRAINT card_associations_text_check
    CHECK (char_length(btrim(text)) > 0) NOT VALID;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_public_text_check
    CHECK (
      (display_name IS NULL OR char_length(btrim(display_name)) > 0)
      AND (avatar_url IS NULL OR char_length(btrim(avatar_url)) > 0)
    ) NOT VALID,
  ADD CONSTRAINT profiles_updated_at_check
    CHECK (updated_at >= created_at) NOT VALID;

ALTER TABLE public.profile_private
  ADD CONSTRAINT profile_private_languages_check
    CHECK (
      native_language = ANY (ARRAY['en', 'es', 'fr', 'de', 'zh-CN', 'ja', 'ko', 'ru', 'pt', 'it'])
      AND target_language = ANY (ARRAY['en', 'es', 'fr', 'de', 'zh-CN', 'ja', 'ko', 'ru', 'pt', 'it'])
    ) NOT VALID,
  ADD CONSTRAINT profile_private_updated_at_check
    CHECK (updated_at >= created_at) NOT VALID;

ALTER TABLE public.deck_reports
  ADD CONSTRAINT deck_reports_reason_check
    CHECK (char_length(btrim(reason)) BETWEEN 3 AND 400) NOT VALID,
  ADD CONSTRAINT deck_reports_review_state_check
    CHECK (
      (status = 'pending' AND reviewed_at IS NULL)
      OR (status <> 'pending' AND reviewed_at IS NOT NULL)
    ) NOT VALID;

ALTER TABLE public.collection_reports
  ADD CONSTRAINT collection_reports_reason_check
    CHECK (char_length(btrim(reason)) BETWEEN 3 AND 400) NOT VALID,
  ADD CONSTRAINT collection_reports_review_state_check
    CHECK (
      (status = 'pending' AND reviewed_at IS NULL)
      OR (status <> 'pending' AND reviewed_at IS NOT NULL)
    ) NOT VALID;

ALTER TABLE public.deck_ratings
  ADD CONSTRAINT deck_ratings_updated_at_check
    CHECK (updated_at >= created_at) NOT VALID;

ALTER TABLE public.collection_ratings
  ADD CONSTRAINT collection_ratings_updated_at_check
    CHECK (updated_at >= created_at) NOT VALID;

ALTER TABLE public.friendships
  ADD CONSTRAINT friendships_updated_at_check
    CHECK (updated_at >= created_at) NOT VALID;

ALTER TABLE public.ai_endpoint_policies
  ADD CONSTRAINT ai_endpoint_policies_endpoint_shape_check
    CHECK (char_length(btrim(endpoint)) BETWEEN 1 AND 80) NOT VALID;

ALTER TABLE public.ai_rate_limit_rollups
  ADD CONSTRAINT ai_rate_limit_rollups_time_check
    CHECK (last_seen_at >= bucket_start) NOT VALID;

ALTER TABLE public.ai_usage_events
  ADD CONSTRAINT ai_usage_events_time_check
    CHECK (
      expires_at > started_at
      AND (completed_at IS NULL OR completed_at >= started_at)
    ) NOT VALID,
  ADD CONSTRAINT ai_usage_events_completion_shape_check
    CHECK (
      (status = 'active' AND completed_at IS NULL)
      OR (status <> 'active' AND completed_at IS NOT NULL)
    ) NOT VALID;

ALTER TABLE public.card_progress
  ADD CONSTRAINT card_progress_card_key_check
    CHECK (char_length(btrim(card_key)) > 0) NOT VALID,
  ADD CONSTRAINT card_progress_attempt_totals_check
    CHECK (
      slow_misses <= correct_count + wrong_count
      AND (samples IS NULL OR samples <= correct_count + wrong_count)
    ) NOT VALID,
  ADD CONSTRAINT card_progress_timing_shape_check
    CHECK (
      (samples IS NULL AND avg_ms IS NULL AND total_ms IS NULL)
      OR (samples > 0 AND avg_ms IS NOT NULL AND total_ms IS NOT NULL)
    ) NOT VALID;

ALTER TABLE public.study_events
  ADD CONSTRAINT study_events_card_key_check
    CHECK (char_length(btrim(card_key)) > 0) NOT VALID;

ALTER TABLE public.study_questions
  ADD CONSTRAINT study_questions_progress_key_check
    CHECK (char_length(btrim(progress_key)) > 0) NOT VALID;

ALTER TABLE public.study_sessions
  ADD CONSTRAINT study_sessions_updated_at_check
    CHECK (updated_at >= created_at) NOT VALID;

-- Validate every clean relationship and CHECK constraint. The two documented
-- Auth-owner foreign keys above intentionally remain NOT VALID.
ALTER TABLE public.collections VALIDATE CONSTRAINT collections_user_id_auth_fkey;
ALTER TABLE public.deck_likes VALIDATE CONSTRAINT deck_likes_user_id_auth_fkey;
ALTER TABLE public.deck_saves VALIDATE CONSTRAINT deck_saves_user_id_auth_fkey;
ALTER TABLE public.deck_ratings VALIDATE CONSTRAINT deck_ratings_user_id_auth_fkey;
ALTER TABLE public.deck_reports VALIDATE CONSTRAINT deck_reports_reporter_id_auth_fkey;
ALTER TABLE public.collection_likes VALIDATE CONSTRAINT collection_likes_user_id_auth_fkey;
ALTER TABLE public.collection_saves VALIDATE CONSTRAINT collection_saves_user_id_auth_fkey;
ALTER TABLE public.collection_ratings VALIDATE CONSTRAINT collection_ratings_user_id_auth_fkey;
ALTER TABLE public.collection_reports VALIDATE CONSTRAINT collection_reports_reporter_id_auth_fkey;
ALTER TABLE public.creator_follows VALIDATE CONSTRAINT creator_follows_creator_id_profile_fkey;
ALTER TABLE public.creator_follows VALIDATE CONSTRAINT creator_follows_follower_id_profile_fkey;
ALTER TABLE public.collection_decks VALIDATE CONSTRAINT collection_decks_collection_owner_fkey;
ALTER TABLE public.collection_decks VALIDATE CONSTRAINT collection_decks_deck_owner_fkey;
ALTER TABLE public.study_session_cards VALIDATE CONSTRAINT study_session_cards_session_owner_fkey;
ALTER TABLE public.study_questions VALIDATE CONSTRAINT study_questions_session_owner_fkey;
ALTER TABLE public.study_events VALIDATE CONSTRAINT study_events_session_owner_fkey;
ALTER TABLE public.speed_runs VALIDATE CONSTRAINT speed_runs_session_owner_fkey;

ALTER TABLE public.decks VALIDATE CONSTRAINT decks_name_shape_check;
ALTER TABLE public.decks VALIDATE CONSTRAINT decks_description_length_check;
ALTER TABLE public.decks VALIDATE CONSTRAINT decks_keywords_shape_check;
ALTER TABLE public.decks VALIDATE CONSTRAINT decks_counters_check;
ALTER TABLE public.decks VALIDATE CONSTRAINT decks_source_not_self_check;
ALTER TABLE public.decks VALIDATE CONSTRAINT decks_publication_shape_check;
ALTER TABLE public.decks VALIDATE CONSTRAINT decks_updated_at_check;
ALTER TABLE public.collections VALIDATE CONSTRAINT collections_name_shape_check;
ALTER TABLE public.collections VALIDATE CONSTRAINT collections_description_length_check;
ALTER TABLE public.collections VALIDATE CONSTRAINT collections_keywords_shape_check;
ALTER TABLE public.collections VALIDATE CONSTRAINT collections_counters_check;
ALTER TABLE public.collections VALIDATE CONSTRAINT collections_source_not_self_check;
ALTER TABLE public.collections VALIDATE CONSTRAINT collections_publication_shape_check;
ALTER TABLE public.collections VALIDATE CONSTRAINT collections_updated_at_check;
ALTER TABLE public.cards VALIDATE CONSTRAINT cards_term_shape_check;
ALTER TABLE public.cards VALIDATE CONSTRAINT cards_definition_shape_check;
ALTER TABLE public.cards VALIDATE CONSTRAINT cards_position_check;
ALTER TABLE public.cards VALIDATE CONSTRAINT cards_updated_at_check;
ALTER TABLE public.collection_decks VALIDATE CONSTRAINT collection_decks_position_check;
ALTER TABLE public.card_associations VALIDATE CONSTRAINT card_associations_text_check;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_public_text_check;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_updated_at_check;
ALTER TABLE public.profile_private VALIDATE CONSTRAINT profile_private_languages_check;
ALTER TABLE public.profile_private VALIDATE CONSTRAINT profile_private_updated_at_check;
ALTER TABLE public.deck_reports VALIDATE CONSTRAINT deck_reports_reason_check;
ALTER TABLE public.deck_reports VALIDATE CONSTRAINT deck_reports_review_state_check;
ALTER TABLE public.collection_reports VALIDATE CONSTRAINT collection_reports_reason_check;
ALTER TABLE public.collection_reports VALIDATE CONSTRAINT collection_reports_review_state_check;
ALTER TABLE public.deck_ratings VALIDATE CONSTRAINT deck_ratings_updated_at_check;
ALTER TABLE public.collection_ratings VALIDATE CONSTRAINT collection_ratings_updated_at_check;
ALTER TABLE public.friendships VALIDATE CONSTRAINT friendships_updated_at_check;
ALTER TABLE public.ai_endpoint_policies VALIDATE CONSTRAINT ai_endpoint_policies_endpoint_shape_check;
ALTER TABLE public.ai_rate_limit_rollups VALIDATE CONSTRAINT ai_rate_limit_rollups_time_check;
ALTER TABLE public.ai_usage_events VALIDATE CONSTRAINT ai_usage_events_time_check;
ALTER TABLE public.ai_usage_events VALIDATE CONSTRAINT ai_usage_events_completion_shape_check;
ALTER TABLE public.card_progress VALIDATE CONSTRAINT card_progress_card_key_check;
ALTER TABLE public.card_progress VALIDATE CONSTRAINT card_progress_attempt_totals_check;
ALTER TABLE public.card_progress VALIDATE CONSTRAINT card_progress_timing_shape_check;
ALTER TABLE public.study_events VALIDATE CONSTRAINT study_events_card_key_check;
ALTER TABLE public.study_questions VALIDATE CONSTRAINT study_questions_progress_key_check;
ALTER TABLE public.study_sessions VALIDATE CONSTRAINT study_sessions_updated_at_check;

COMMIT;
