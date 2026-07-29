BEGIN;

-- Phase 1 of the server-verification rollout. The deployed frontend still
-- uses the legacy boolean RPC, so this migration adds a parallel safe API.
-- The legacy signature is removed only after the new frontend is live.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;

ALTER TABLE public.study_sessions
  DROP CONSTRAINT study_sessions_mode_check,
  DROP CONSTRAINT study_sessions_duration_check;
ALTER TABLE public.study_sessions
  ADD CONSTRAINT study_sessions_mode_check
    CHECK (mode IN ('study', 'type', 'reverse', 'speed', 'recall', 'assoc', 'deep')),
  ADD CONSTRAINT study_sessions_duration_check
    CHECK (
      (mode = 'speed' AND duration_seconds IN (30, 60, 120))
      OR (mode <> 'speed' AND duration_seconds IS NULL)
    );

ALTER TABLE public.study_events DROP CONSTRAINT study_events_mode_check;
ALTER TABLE public.study_events
  ADD CONSTRAINT study_events_mode_check
    CHECK (mode IN ('study', 'type', 'reverse', 'speed', 'recall', 'assoc', 'deep'));

CREATE TABLE public.study_session_cards (
  session_id UUID NOT NULL REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  card_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  term_snapshot TEXT NOT NULL,
  definition_snapshot TEXT NOT NULL,
  card_updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, card_id),
  CONSTRAINT study_session_cards_content_check
    CHECK (length(btrim(term_snapshot)) > 0 AND length(btrim(definition_snapshot)) > 0)
);

CREATE TABLE public.study_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  card_id UUID NOT NULL,
  client_question_key UUID NOT NULL,
  direction TEXT NOT NULL,
  answer_kind TEXT NOT NULL,
  verification_type TEXT NOT NULL,
  progress_key TEXT NOT NULL,
  prompt_snapshot TEXT NOT NULL,
  expected_answer_snapshot TEXT NOT NULL,
  card_updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  CONSTRAINT study_questions_session_card_fkey
    FOREIGN KEY (session_id, card_id)
    REFERENCES public.study_session_cards(session_id, card_id)
    ON DELETE CASCADE,
  CONSTRAINT study_questions_direction_check
    CHECK (direction IN ('term_to_definition', 'definition_to_term')),
  CONSTRAINT study_questions_answer_kind_check
    CHECK (answer_kind IN ('text', 'multiple_choice', 'self_reported')),
  CONSTRAINT study_questions_verification_check
    CHECK (
      (answer_kind IN ('text', 'multiple_choice') AND verification_type = 'server_verified')
      OR (answer_kind = 'self_reported' AND verification_type = 'self_reported')
    ),
  CONSTRAINT study_questions_content_check
    CHECK (
      length(btrim(prompt_snapshot)) > 0
      AND length(btrim(expected_answer_snapshot)) > 0
    ),
  CONSTRAINT study_questions_answered_at_check
    CHECK (answered_at IS NULL OR answered_at >= created_at),
  UNIQUE (user_id, client_question_key),
  UNIQUE (id, session_id),
  UNIQUE (id, card_id)
);

CREATE TABLE public.study_question_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.study_questions(id) ON DELETE CASCADE,
  option_card_id UUID NOT NULL,
  option_text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  position SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT study_question_options_position_check CHECK (position BETWEEN 0 AND 3),
  CONSTRAINT study_question_options_text_check CHECK (length(btrim(option_text)) > 0),
  UNIQUE (question_id, id),
  UNIQUE (question_id, position)
);

CREATE UNIQUE INDEX study_question_options_one_correct_idx
  ON public.study_question_options(question_id)
  WHERE is_correct;

ALTER TABLE public.study_session_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_question_options ENABLE ROW LEVEL SECURITY;

-- These tables contain expected answers. Browser roles receive no table
-- privileges and no RLS read policy; access is only through narrow RPCs.
REVOKE ALL PRIVILEGES ON TABLE public.study_session_cards FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.study_questions FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.study_question_options FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.study_session_cards TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.study_questions TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.study_question_options TO service_role;

ALTER TABLE public.study_events
  ADD COLUMN question_id UUID,
  ADD COLUMN verification_type TEXT NOT NULL DEFAULT 'legacy_client_reported',
  ADD COLUMN submitted_answer TEXT,
  ADD COLUMN selected_option_id UUID;

ALTER TABLE public.study_events
  ADD CONSTRAINT study_events_question_id_fkey
    FOREIGN KEY (question_id) REFERENCES public.study_questions(id) ON DELETE CASCADE,
  ADD CONSTRAINT study_events_question_session_fkey
    FOREIGN KEY (question_id, session_id)
    REFERENCES public.study_questions(id, session_id),
  ADD CONSTRAINT study_events_question_card_fkey
    FOREIGN KEY (question_id, card_id)
    REFERENCES public.study_questions(id, card_id),
  ADD CONSTRAINT study_events_selected_option_fkey
    FOREIGN KEY (question_id, selected_option_id)
    REFERENCES public.study_question_options(question_id, id),
  ADD CONSTRAINT study_events_verification_type_check
    CHECK (
      verification_type IN ('legacy_client_reported', 'server_verified', 'self_reported')
    ),
  ADD CONSTRAINT study_events_submission_shape_check
    CHECK (
      (verification_type = 'legacy_client_reported'
        AND question_id IS NULL
        AND submitted_answer IS NULL
        AND selected_option_id IS NULL)
      OR
      (verification_type = 'server_verified'
        AND question_id IS NOT NULL
        AND ((submitted_answer IS NOT NULL) <> (selected_option_id IS NOT NULL)))
      OR
      (verification_type = 'self_reported'
        AND question_id IS NOT NULL
        AND submitted_answer IS NULL
        AND selected_option_id IS NULL)
    );

CREATE UNIQUE INDEX study_events_question_id_idx
  ON public.study_events(question_id)
  WHERE question_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.normalize_study_answer(_value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          normalize(lower(_value), NFD),
          U&'[\0300-\036F]',
          '',
          'g'
        ),
        '[.,!?;:"''`()\[\]]',
        '',
        'g'
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_study_answer_correct(
  _submitted TEXT,
  _expected TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, extensions, public
AS $$
DECLARE
  v_submitted TEXT := public.normalize_study_answer(_submitted);
  v_variant_raw TEXT;
  v_variant TEXT;
  v_tolerance INTEGER;
BEGIN
  IF v_submitted = '' THEN
    RETURN false;
  END IF;

  FOREACH v_variant_raw IN ARRAY regexp_split_to_array(_expected, '[,/;]')
  LOOP
    v_variant := public.normalize_study_answer(v_variant_raw);
    IF v_variant = '' THEN
      CONTINUE;
    END IF;
    IF v_variant = v_submitted THEN
      RETURN true;
    END IF;
    v_tolerance := CASE
      WHEN length(v_variant) <= 4 THEN 1
      WHEN length(v_variant) <= 8 THEN 2
      ELSE 3
    END;
    -- fuzzystrmatch limits each levenshtein input to 255 characters. Exact
    -- matching above remains available for longer phrases.
    IF length(v_variant) <= 255
       AND length(v_submitted) <= 255
       AND extensions.levenshtein(v_variant, v_submitted) <= v_tolerance THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_study_answer(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_study_answer_correct(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_study_session(
  p_client_session_key UUID,
  p_deck_id UUID,
  p_mode TEXT,
  p_duration_seconds INTEGER DEFAULT NULL
)
RETURNS TABLE (
  session_id UUID,
  session_status TEXT,
  session_started_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_session public.study_sessions%ROWTYPE;
  v_created BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_client_session_key IS NULL THEN
    RAISE EXCEPTION 'client_session_key is required' USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('study', 'type', 'reverse', 'speed', 'recall', 'assoc', 'deep') THEN
    RAISE EXCEPTION 'Unsupported study mode' USING ERRCODE = '22023';
  END IF;
  IF (p_mode = 'speed' AND p_duration_seconds NOT IN (30, 60, 120))
     OR (p_mode <> 'speed' AND p_duration_seconds IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid session duration' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_study_deck(p_deck_id) THEN
    RAISE EXCEPTION 'Deck is not available for study' USING ERRCODE = '42501';
  END IF;

  SELECT s.* INTO v_session
  FROM public.study_sessions s
  WHERE s.user_id = v_user_id
    AND s.client_session_key = p_client_session_key;

  IF FOUND THEN
    IF v_session.deck_id <> p_deck_id
       OR v_session.mode <> p_mode
       OR v_session.duration_seconds IS DISTINCT FROM p_duration_seconds THEN
      RAISE EXCEPTION 'Session key was already used with different parameters'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.study_sessions (
      user_id, deck_id, client_session_key, mode, duration_seconds
    ) VALUES (
      v_user_id, p_deck_id, p_client_session_key, p_mode, p_duration_seconds
    )
    RETURNING * INTO v_session;
    v_created := true;
  END IF;

  IF v_created THEN
    INSERT INTO public.study_session_cards (
      session_id,
      card_id,
      user_id,
      deck_id,
      term_snapshot,
      definition_snapshot,
      card_updated_at
    )
    SELECT
      v_session.id,
      c.id,
      v_user_id,
      c.deck_id,
      c.term,
      c.definition,
      c.updated_at
    FROM public.cards c
    WHERE c.deck_id = v_session.deck_id;
  END IF;

  RETURN QUERY SELECT v_session.id, v_session.status, v_session.started_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_study_question(
  p_client_question_key UUID,
  p_session_id UUID,
  p_card_id UUID,
  p_direction TEXT
)
RETURNS TABLE (
  question_id UUID,
  question_card_id UUID,
  prompt_text TEXT,
  answer_kind TEXT,
  verification_type TEXT,
  question_direction TEXT,
  card_version TIMESTAMPTZ,
  options JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_session public.study_sessions%ROWTYPE;
  v_snapshot public.study_session_cards%ROWTYPE;
  v_question public.study_questions%ROWTYPE;
  v_answer_kind TEXT;
  v_verification_type TEXT;
  v_prompt TEXT;
  v_expected TEXT;
  v_progress_key TEXT;
  v_option_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_client_question_key IS NULL OR p_session_id IS NULL OR p_card_id IS NULL THEN
    RAISE EXCEPTION 'Missing required question parameter' USING ERRCODE = '22023';
  END IF;
  IF p_direction NOT IN ('term_to_definition', 'definition_to_term') THEN
    RAISE EXCEPTION 'Invalid study direction' USING ERRCODE = '22023';
  END IF;

  SELECT s.* INTO v_session
  FROM public.study_sessions s
  WHERE s.id = p_session_id
    AND s.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_session.status <> 'active' THEN
    RAISE EXCEPTION 'Active study session not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_study_deck(v_session.deck_id) THEN
    RAISE EXCEPTION 'Deck is no longer available for study' USING ERRCODE = '42501';
  END IF;

  SELECT sc.* INTO v_snapshot
  FROM public.study_session_cards sc
  WHERE sc.session_id = v_session.id
    AND sc.card_id = p_card_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.cards c
    WHERE c.id = p_card_id AND c.deck_id = v_session.deck_id
  ) THEN
    RAISE EXCEPTION 'Card is not part of the active session snapshot'
      USING ERRCODE = '42501';
  END IF;

  v_answer_kind := CASE
    WHEN v_session.mode IN ('type', 'recall') THEN 'text'
    WHEN v_session.mode IN ('speed', 'deep') THEN 'multiple_choice'
    ELSE 'self_reported'
  END;
  v_verification_type := CASE
    WHEN v_answer_kind = 'self_reported' THEN 'self_reported'
    ELSE 'server_verified'
  END;
  v_prompt := CASE
    WHEN p_direction = 'term_to_definition' THEN v_snapshot.term_snapshot
    ELSE v_snapshot.definition_snapshot
  END;
  v_expected := CASE
    WHEN p_direction = 'term_to_definition' THEN v_snapshot.definition_snapshot
    ELSE v_snapshot.term_snapshot
  END;
  v_progress_key := CASE
    WHEN v_session.mode = 'reverse' AND p_direction = 'definition_to_term'
      THEN p_card_id::TEXT || ':rev'
    ELSE p_card_id::TEXT
  END;

  SELECT q.* INTO v_question
  FROM public.study_questions q
  WHERE q.user_id = v_user_id
    AND q.client_question_key = p_client_question_key;

  IF FOUND THEN
    IF v_question.session_id <> p_session_id
       OR v_question.card_id <> p_card_id
       OR v_question.direction <> p_direction THEN
      RAISE EXCEPTION 'Question key was already used with different parameters'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.study_questions (
      user_id,
      session_id,
      card_id,
      client_question_key,
      direction,
      answer_kind,
      verification_type,
      progress_key,
      prompt_snapshot,
      expected_answer_snapshot,
      card_updated_at
    ) VALUES (
      v_user_id,
      v_session.id,
      p_card_id,
      p_client_question_key,
      p_direction,
      v_answer_kind,
      v_verification_type,
      v_progress_key,
      v_prompt,
      v_expected,
      v_snapshot.card_updated_at
    )
    RETURNING * INTO v_question;

    IF v_answer_kind = 'multiple_choice' THEN
      WITH candidate_values AS (
        SELECT
          sc.card_id,
          CASE
            WHEN p_direction = 'term_to_definition' THEN sc.definition_snapshot
            ELSE sc.term_snapshot
          END AS option_text
        FROM public.study_session_cards sc
        WHERE sc.session_id = v_session.id
          AND sc.card_id <> p_card_id
      ),
      distinct_candidates AS (
        SELECT min(card_id::TEXT)::UUID AS card_id, min(option_text) AS option_text
        FROM candidate_values
        WHERE length(btrim(option_text)) > 0
          AND public.normalize_study_answer(option_text)
            <> public.normalize_study_answer(v_expected)
        GROUP BY public.normalize_study_answer(option_text)
        ORDER BY random()
        LIMIT 3
      ),
      all_options AS (
        SELECT p_card_id AS card_id, v_expected AS option_text, true AS is_correct
        UNION ALL
        SELECT card_id, option_text, false FROM distinct_candidates
      ),
      positioned_options AS (
        SELECT
          card_id,
          option_text,
          is_correct,
          (row_number() OVER (ORDER BY random()) - 1)::SMALLINT AS position
        FROM all_options
      )
      INSERT INTO public.study_question_options (
        question_id, option_card_id, option_text, is_correct, position
      )
      SELECT v_question.id, card_id, option_text, is_correct, position
      FROM positioned_options;

      SELECT count(*) INTO v_option_count
      FROM public.study_question_options o
      WHERE o.question_id = v_question.id;
      IF v_option_count < 2 THEN
        RAISE EXCEPTION 'Multiple-choice question needs at least two distinct answers'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_question.id,
    v_question.card_id,
    v_question.prompt_snapshot,
    v_question.answer_kind,
    v_question.verification_type,
    v_question.direction,
    v_question.card_updated_at,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('id', o.id, 'text', o.option_text)
          ORDER BY o.position
        )
        FROM public.study_question_options o
        WHERE o.question_id = v_question.id
      ),
      '[]'::JSONB
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_study_answer_v2(
  p_idempotency_key UUID,
  p_question_id UUID,
  p_submitted_answer TEXT DEFAULT NULL,
  p_selected_option_id UUID DEFAULT NULL,
  p_self_reported_result BOOLEAN DEFAULT NULL,
  p_response_ms INTEGER DEFAULT NULL
)
RETURNS TABLE (
  event_id UUID,
  duplicate BOOLEAN,
  correct BOOLEAN,
  verification_type TEXT,
  expected_answer TEXT,
  correct_option_id UUID,
  correct_count INTEGER,
  wrong_count INTEGER,
  mastery NUMERIC,
  stage INTEGER,
  due_at TIMESTAMPTZ,
  avg_ms INTEGER,
  total_ms INTEGER,
  samples INTEGER,
  slow_misses INTEGER,
  recall_score INTEGER,
  recall_stage_idx INTEGER,
  recall_interval_idx INTEGER,
  recall_due_at TIMESTAMPTZ,
  recall_correct_count INTEGER,
  recall_wrong_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_question public.study_questions%ROWTYPE;
  v_option public.study_question_options%ROWTYPE;
  v_existing_event public.study_events%ROWTYPE;
  v_apply RECORD;
  v_correct BOOLEAN;
  v_correct_option_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR p_question_id IS NULL THEN
    RAISE EXCEPTION 'idempotency_key and question_id are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_response_ms IS NOT NULL AND p_response_ms < 0 THEN
    RAISE EXCEPTION 'response_ms must be nonnegative' USING ERRCODE = '22023';
  END IF;

  SELECT q.* INTO v_question
  FROM public.study_questions q
  JOIN public.study_sessions s ON s.id = q.session_id
  WHERE q.id = p_question_id
    AND q.user_id = v_user_id
    AND s.user_id = v_user_id
    AND s.status = 'active'
  FOR UPDATE OF q;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active study question not found' USING ERRCODE = '42501';
  END IF;

  SELECT e.* INTO v_existing_event
  FROM public.study_events e
  WHERE e.question_id = v_question.id;
  IF FOUND AND v_existing_event.idempotency_key <> p_idempotency_key THEN
    RAISE EXCEPTION 'Study question was already answered' USING ERRCODE = '55000';
  END IF;

  IF v_question.answer_kind = 'text' THEN
    IF p_submitted_answer IS NULL
       OR length(p_submitted_answer) > 500
       OR p_selected_option_id IS NOT NULL
       OR p_self_reported_result IS NOT NULL THEN
      RAISE EXCEPTION 'Text question requires only submitted_answer'
        USING ERRCODE = '22023';
    END IF;
    v_correct := public.is_study_answer_correct(
      p_submitted_answer,
      v_question.expected_answer_snapshot
    );
  ELSIF v_question.answer_kind = 'multiple_choice' THEN
    IF p_selected_option_id IS NULL
       OR p_submitted_answer IS NOT NULL
       OR p_self_reported_result IS NOT NULL THEN
      RAISE EXCEPTION 'Multiple-choice question requires only selected_option_id'
        USING ERRCODE = '22023';
    END IF;
    SELECT o.* INTO v_option
    FROM public.study_question_options o
    WHERE o.id = p_selected_option_id
      AND o.question_id = v_question.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected option was not issued for this question'
        USING ERRCODE = '22023';
    END IF;
    v_correct := v_option.is_correct;
    SELECT o.id INTO v_correct_option_id
    FROM public.study_question_options o
    WHERE o.question_id = v_question.id
      AND o.is_correct;
  ELSE
    IF p_self_reported_result IS NULL
       OR p_submitted_answer IS NOT NULL
       OR p_selected_option_id IS NOT NULL THEN
      RAISE EXCEPTION 'Self-reported question requires only self_reported_result'
        USING ERRCODE = '22023';
    END IF;
    v_correct := p_self_reported_result;
  END IF;

  IF v_existing_event.id IS NOT NULL AND (
    v_existing_event.correct <> v_correct
    OR v_existing_event.response_ms IS DISTINCT FROM p_response_ms
    OR v_existing_event.submitted_answer IS DISTINCT FROM
      CASE WHEN v_question.answer_kind = 'text' THEN p_submitted_answer ELSE NULL END
    OR v_existing_event.selected_option_id IS DISTINCT FROM
      CASE
        WHEN v_question.answer_kind = 'multiple_choice' THEN p_selected_option_id
        ELSE NULL
      END
  ) THEN
    RAISE EXCEPTION 'Idempotency key was already used with a different answer'
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_apply
  FROM public.record_study_answer(
    p_idempotency_key,
    v_question.session_id,
    v_question.card_id,
    v_correct,
    p_response_ms,
    v_question.progress_key
  );

  UPDATE public.study_events e
  SET question_id = v_question.id,
      verification_type = v_question.verification_type,
      submitted_answer = CASE
        WHEN v_question.answer_kind = 'text' THEN p_submitted_answer
        ELSE NULL
      END,
      selected_option_id = CASE
        WHEN v_question.answer_kind = 'multiple_choice' THEN p_selected_option_id
        ELSE NULL
      END
  WHERE e.id = v_apply.event_id
    AND (e.question_id IS NULL OR e.question_id = v_question.id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Study event could not be bound to its question'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.study_questions q
  SET answered_at = COALESCE(q.answered_at, clock_timestamp())
  WHERE q.id = v_question.id;

  RETURN QUERY SELECT
    v_apply.event_id,
    v_apply.duplicate,
    v_correct,
    v_question.verification_type,
    CASE
      WHEN v_question.verification_type = 'server_verified'
        THEN v_question.expected_answer_snapshot
      ELSE NULL
    END,
    v_correct_option_id,
    v_apply.correct_count,
    v_apply.wrong_count,
    v_apply.mastery,
    v_apply.stage,
    v_apply.due_at,
    v_apply.avg_ms,
    v_apply.total_ms,
    v_apply.samples,
    v_apply.slow_misses,
    v_apply.recall_score,
    v_apply.recall_stage_idx,
    v_apply.recall_interval_idx,
    v_apply.recall_due_at,
    v_apply.recall_correct_count,
    v_apply.recall_wrong_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_study_session(UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.issue_study_question(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_study_answer_v2(UUID, UUID, TEXT, UUID, BOOLEAN, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_study_session(UUID, UUID, TEXT, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_study_question(UUID, UUID, UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_study_answer_v2(UUID, UUID, TEXT, UUID, BOOLEAN, INTEGER)
  TO authenticated;

COMMENT ON TABLE public.study_session_cards IS
  'Private card snapshots captured when a study session starts; never readable by browser roles.';
COMMENT ON TABLE public.study_questions IS
  'Server-issued questions with private expected-answer snapshots and server-selected verification type.';
COMMENT ON TABLE public.study_question_options IS
  'Private server-issued multiple-choice options. Correctness is never returned before an attempt.';
COMMENT ON COLUMN public.study_events.verification_type IS
  'legacy_client_reported for historical transition rows, server_verified for objective answers, or self_reported for subjective modes.';

COMMIT;
