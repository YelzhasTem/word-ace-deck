BEGIN;

-- Phase 1 of the study-integrity rollout. This migration adds a trusted write
-- path while retaining the legacy table grants required by the currently
-- deployed frontend. A later migration revokes those grants after deployment.

DO $$
DECLARE
  invalid_progress BIGINT;
  invalid_events BIGINT;
  invalid_speed_runs BIGINT;
  invalid_recall BIGINT;
  invalid_private_stats BIGINT;
  mismatched_relations BIGINT;
BEGIN
  SELECT count(*) INTO invalid_progress
  FROM public.card_progress
  WHERE correct_count < 0
     OR wrong_count < 0
     OR mastery < 0 OR mastery > 1
     OR stage < 0 OR stage > 4
     OR COALESCE(avg_ms, 0) < 0
     OR COALESCE(total_ms, 0) < 0
     OR COALESCE(samples, 0) < 0
     OR slow_misses < 0
     OR (avg_ms IS NOT NULL AND total_ms IS NOT NULL AND total_ms < avg_ms)
     OR (due_at IS NOT NULL AND last_seen_at IS NOT NULL AND due_at < last_seen_at);

  SELECT count(*) INTO invalid_events
  FROM public.study_events
  WHERE COALESCE(response_ms, 0) < 0
     OR mode NOT IN ('study', 'type', 'reverse', 'speed', 'recall', 'assoc');

  SELECT count(*) INTO invalid_speed_runs
  FROM public.speed_runs
  WHERE duration NOT IN (30, 60, 120)
     OR score < 0
     OR accuracy < 0 OR accuracy > 100
     OR COALESCE(max_combo, 0) < 0;

  SELECT count(*) INTO invalid_recall
  FROM public.delayed_recall_entries
  WHERE score < 0 OR score > 100
     OR stage_idx < 0 OR stage_idx > 4
     OR interval_idx < 0 OR interval_idx > 5
     OR correct_count < 0
     OR wrong_count < 0
     OR due_at < created_at
     OR (last_review_at IS NOT NULL AND last_review_at < created_at)
     OR (last_review_at IS NOT NULL AND due_at < last_review_at);

  SELECT count(*) INTO invalid_private_stats
  FROM public.profile_private
  WHERE streak_days < 0 OR total_xp < 0;

  SELECT
    (SELECT count(*)
       FROM public.card_progress p
      WHERE p.card_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.cards c
          WHERE c.id = p.card_id AND c.deck_id = p.deck_id
        ))
    +
    (SELECT count(*)
       FROM public.study_events e
      WHERE e.card_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.cards c
          WHERE c.id = e.card_id AND c.deck_id = e.deck_id
        ))
    +
    (SELECT count(*)
       FROM public.delayed_recall_entries r
      WHERE NOT EXISTS (
        SELECT 1 FROM public.cards c
        WHERE c.id = r.card_id AND c.deck_id = r.deck_id
      ))
  INTO mismatched_relations;

  RAISE NOTICE
    'Study integrity audit: progress=%, events=%, speed=%, recall=%, private=%, relation_mismatch=%',
    invalid_progress,
    invalid_events,
    invalid_speed_runs,
    invalid_recall,
    invalid_private_stats,
    mismatched_relations;

  IF invalid_progress + invalid_events + invalid_speed_runs + invalid_recall
       + invalid_private_stats + mismatched_relations > 0 THEN
    RAISE EXCEPTION
      'Study integrity migration stopped: existing invalid rows require an explicit normalization plan';
  END IF;
END;
$$;

CREATE TABLE public.study_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  client_session_key UUID NOT NULL,
  completion_key UUID,
  mode TEXT NOT NULL,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT study_sessions_mode_check
    CHECK (mode IN ('study', 'type', 'reverse', 'speed', 'recall', 'assoc')),
  CONSTRAINT study_sessions_duration_check
    CHECK (
      (mode = 'speed' AND duration_seconds IN (30, 60, 120))
      OR (mode <> 'speed' AND duration_seconds IS NULL)
    ),
  CONSTRAINT study_sessions_status_check
    CHECK (status IN ('active', 'completed', 'abandoned')),
  CONSTRAINT study_sessions_completion_check
    CHECK (
      (status = 'active' AND completed_at IS NULL AND completion_key IS NULL)
      OR (status = 'completed' AND completed_at IS NOT NULL AND completion_key IS NOT NULL)
      OR (status = 'abandoned' AND completed_at IS NOT NULL)
    ),
  CONSTRAINT study_sessions_time_check
    CHECK (completed_at IS NULL OR completed_at >= started_at),
  UNIQUE (user_id, client_session_key)
);

CREATE UNIQUE INDEX study_sessions_user_completion_key_idx
  ON public.study_sessions(user_id, completion_key)
  WHERE completion_key IS NOT NULL;

CREATE INDEX study_sessions_user_deck_started_idx
  ON public.study_sessions(user_id, deck_id, started_at DESC);

ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own study sessions"
  ON public.study_sessions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL PRIVILEGES ON TABLE public.study_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.study_sessions TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.study_sessions TO service_role;

ALTER TABLE public.study_events
  ADD COLUMN session_id UUID,
  ADD COLUMN idempotency_key UUID;

ALTER TABLE public.speed_runs
  ADD COLUMN session_id UUID;

ALTER TABLE public.study_events
  ADD CONSTRAINT study_events_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.speed_runs
  ADD CONSTRAINT speed_runs_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX study_events_user_idempotency_key_idx
  ON public.study_events(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX speed_runs_session_id_idx
  ON public.speed_runs(session_id)
  WHERE session_id IS NOT NULL;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_deck_id_id_key UNIQUE (deck_id, id);

ALTER TABLE public.card_progress
  ADD CONSTRAINT card_progress_deck_card_fkey
  FOREIGN KEY (deck_id, card_id)
  REFERENCES public.cards(deck_id, id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.study_events
  ADD CONSTRAINT study_events_deck_card_fkey
  FOREIGN KEY (deck_id, card_id)
  REFERENCES public.cards(deck_id, id)
  ON DELETE SET NULL (card_id)
  NOT VALID;

ALTER TABLE public.delayed_recall_entries
  ADD CONSTRAINT delayed_recall_entries_deck_card_fkey
  FOREIGN KEY (deck_id, card_id)
  REFERENCES public.cards(deck_id, id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.card_progress VALIDATE CONSTRAINT card_progress_deck_card_fkey;
ALTER TABLE public.study_events VALIDATE CONSTRAINT study_events_deck_card_fkey;
ALTER TABLE public.delayed_recall_entries VALIDATE CONSTRAINT delayed_recall_entries_deck_card_fkey;

ALTER TABLE public.card_progress
  ADD CONSTRAINT card_progress_counts_check
    CHECK (correct_count >= 0 AND wrong_count >= 0 AND slow_misses >= 0),
  ADD CONSTRAINT card_progress_mastery_check CHECK (mastery >= 0 AND mastery <= 1),
  ADD CONSTRAINT card_progress_stage_check CHECK (stage BETWEEN 0 AND 4),
  ADD CONSTRAINT card_progress_timings_check
    CHECK (
      (avg_ms IS NULL OR avg_ms >= 0)
      AND (total_ms IS NULL OR total_ms >= 0)
      AND (samples IS NULL OR samples >= 0)
      AND (avg_ms IS NULL OR total_ms IS NULL OR total_ms >= avg_ms)
    ),
  ADD CONSTRAINT card_progress_due_check
    CHECK (due_at IS NULL OR last_seen_at IS NULL OR due_at >= last_seen_at);

ALTER TABLE public.study_events
  ADD CONSTRAINT study_events_response_ms_check
    CHECK (response_ms IS NULL OR response_ms >= 0),
  ADD CONSTRAINT study_events_mode_check
    CHECK (mode IN ('study', 'type', 'reverse', 'speed', 'recall', 'assoc'));

ALTER TABLE public.speed_runs
  ADD CONSTRAINT speed_runs_duration_check CHECK (duration IN (30, 60, 120)),
  ADD CONSTRAINT speed_runs_score_check CHECK (score >= 0),
  ADD CONSTRAINT speed_runs_accuracy_check CHECK (accuracy BETWEEN 0 AND 100),
  ADD CONSTRAINT speed_runs_combo_check CHECK (max_combo IS NULL OR max_combo >= 0);

ALTER TABLE public.delayed_recall_entries
  ADD CONSTRAINT delayed_recall_score_check CHECK (score BETWEEN 0 AND 100),
  ADD CONSTRAINT delayed_recall_stage_check CHECK (stage_idx BETWEEN 0 AND 4),
  ADD CONSTRAINT delayed_recall_interval_check CHECK (interval_idx BETWEEN 0 AND 5),
  ADD CONSTRAINT delayed_recall_counts_check
    CHECK (correct_count >= 0 AND wrong_count >= 0),
  ADD CONSTRAINT delayed_recall_dates_check
    CHECK (
      due_at >= created_at
      AND (last_review_at IS NULL OR last_review_at >= created_at)
      AND (last_review_at IS NULL OR due_at >= last_review_at)
    );

ALTER TABLE public.profile_private
  ADD CONSTRAINT profile_private_learning_totals_check
    CHECK (streak_days >= 0 AND total_xp >= 0);

CREATE OR REPLACE FUNCTION public.can_study_deck(_deck_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.decks d
    WHERE d.id = _deck_id
      AND d.hidden_at IS NULL
      AND (
        d.user_id = auth.uid()
        OR d.visibility::TEXT IN ('public', 'unlisted')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_study_card(_card_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cards c
    WHERE c.id = _card_id
      AND public.can_study_deck(c.deck_id)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_study_deck(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_study_card(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_study_deck(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_study_card(UUID) TO authenticated;

DROP POLICY IF EXISTS "Users manage own deck learning settings" ON public.deck_learning_settings;
CREATE POLICY "Users read accessible deck learning settings"
  ON public.deck_learning_settings FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND public.can_study_deck(deck_id)
  );
CREATE POLICY "Users insert accessible deck learning settings"
  ON public.deck_learning_settings FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.can_study_deck(deck_id)
  );
CREATE POLICY "Users update accessible deck learning settings"
  ON public.deck_learning_settings FOR UPDATE TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND public.can_study_deck(deck_id)
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.can_study_deck(deck_id)
  );
CREATE POLICY "Users delete accessible deck learning settings"
  ON public.deck_learning_settings FOR DELETE TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND public.can_study_deck(deck_id)
  );

DROP POLICY IF EXISTS "Users manage own card associations" ON public.card_associations;
CREATE POLICY "Users read accessible card associations"
  ON public.card_associations FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND public.can_study_card(card_id)
  );
CREATE POLICY "Users insert accessible card associations"
  ON public.card_associations FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.can_study_card(card_id)
  );
CREATE POLICY "Users update accessible card associations"
  ON public.card_associations FOR UPDATE TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND public.can_study_card(card_id)
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.can_study_card(card_id)
  );
CREATE POLICY "Users delete accessible card associations"
  ON public.card_associations FOR DELETE TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND public.can_study_card(card_id)
  );

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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_client_session_key IS NULL THEN
    RAISE EXCEPTION 'client_session_key is required' USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('study', 'type', 'reverse', 'speed', 'recall', 'assoc') THEN
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
  END IF;

  RETURN QUERY SELECT v_session.id, v_session.status, v_session.started_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_study_answer(
  p_idempotency_key UUID,
  p_session_id UUID,
  p_card_id UUID,
  p_result BOOLEAN,
  p_response_ms INTEGER DEFAULT NULL,
  p_progress_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  event_id UUID,
  duplicate BOOLEAN,
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
  v_session public.study_sessions%ROWTYPE;
  v_existing_event public.study_events%ROWTYPE;
  v_progress public.card_progress%ROWTYPE;
  v_recall public.delayed_recall_entries%ROWTYPE;
  v_event_id UUID;
  v_card_key TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_slow BOOLEAN;
  v_mastery NUMERIC(5,4);
  v_stage INTEGER;
  v_due_at TIMESTAMPTZ;
  v_correct_count INTEGER;
  v_wrong_count INTEGER;
  v_avg_ms INTEGER;
  v_total_ms INTEGER;
  v_samples INTEGER;
  v_slow_misses INTEGER;
  v_recall_score INTEGER;
  v_recall_stage INTEGER;
  v_recall_interval INTEGER;
  v_recall_due TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR p_session_id IS NULL OR p_card_id IS NULL OR p_result IS NULL THEN
    RAISE EXCEPTION 'Missing required study answer parameter' USING ERRCODE = '22023';
  END IF;
  IF p_response_ms IS NOT NULL AND p_response_ms < 0 THEN
    RAISE EXCEPTION 'response_ms must be nonnegative' USING ERRCODE = '22023';
  END IF;

  SELECT s.* INTO v_session
  FROM public.study_sessions s
  WHERE s.id = p_session_id
    AND s.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Study session not found' USING ERRCODE = '42501';
  END IF;
  IF v_session.status <> 'active' THEN
    RAISE EXCEPTION 'Study session is not active' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.cards c
    WHERE c.id = p_card_id
      AND c.deck_id = v_session.deck_id
      AND public.can_study_deck(c.deck_id)
  ) THEN
    RAISE EXCEPTION 'Card does not belong to the accessible session deck'
      USING ERRCODE = '42501';
  END IF;

  v_card_key := COALESCE(NULLIF(btrim(p_progress_key), ''), p_card_id::TEXT);
  IF v_card_key NOT IN (p_card_id::TEXT, p_card_id::TEXT || ':rev') THEN
    RAISE EXCEPTION 'Invalid progress key for card' USING ERRCODE = '22023';
  END IF;

  SELECT e.* INTO v_existing_event
  FROM public.study_events e
  WHERE e.user_id = v_user_id
    AND e.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_event.session_id <> p_session_id
       OR v_existing_event.card_id <> p_card_id
       OR v_existing_event.correct <> p_result
       OR v_existing_event.response_ms IS DISTINCT FROM p_response_ms
       OR v_existing_event.card_key <> v_card_key THEN
      RAISE EXCEPTION 'Idempotency key was already used with a different answer'
        USING ERRCODE = '23505';
    END IF;

    SELECT p.* INTO v_progress
    FROM public.card_progress p
    WHERE p.user_id = v_user_id
      AND p.deck_id = v_session.deck_id
      AND p.card_key = v_card_key;

    SELECT r.* INTO v_recall
    FROM public.delayed_recall_entries r
    WHERE r.user_id = v_user_id
      AND r.deck_id = v_session.deck_id
      AND r.card_id = p_card_id;

    RETURN QUERY SELECT
      v_existing_event.id,
      true,
      v_progress.correct_count,
      v_progress.wrong_count,
      v_progress.mastery,
      v_progress.stage,
      v_progress.due_at,
      v_progress.avg_ms,
      v_progress.total_ms,
      v_progress.samples,
      v_progress.slow_misses,
      v_recall.score,
      v_recall.stage_idx,
      v_recall.interval_idx,
      v_recall.due_at,
      v_recall.correct_count,
      v_recall.wrong_count;
    RETURN;
  END IF;

  INSERT INTO public.study_events (
    user_id,
    deck_id,
    card_key,
    card_id,
    mode,
    correct,
    response_ms,
    answered_at,
    session_id,
    idempotency_key
  ) VALUES (
    v_user_id,
    v_session.deck_id,
    v_card_key,
    p_card_id,
    v_session.mode,
    p_result,
    p_response_ms,
    v_now,
    v_session.id,
    p_idempotency_key
  )
  ON CONFLICT (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT e.* INTO v_existing_event
    FROM public.study_events e
    WHERE e.user_id = v_user_id
      AND e.idempotency_key = p_idempotency_key;

    IF v_existing_event.session_id <> p_session_id
       OR v_existing_event.card_id <> p_card_id
       OR v_existing_event.correct <> p_result
       OR v_existing_event.response_ms IS DISTINCT FROM p_response_ms
       OR v_existing_event.card_key <> v_card_key THEN
      RAISE EXCEPTION 'Idempotency key was already used with a different answer'
        USING ERRCODE = '23505';
    END IF;

    SELECT p.* INTO v_progress
    FROM public.card_progress p
    WHERE p.user_id = v_user_id
      AND p.deck_id = v_session.deck_id
      AND p.card_key = v_card_key;

    SELECT r.* INTO v_recall
    FROM public.delayed_recall_entries r
    WHERE r.user_id = v_user_id
      AND r.deck_id = v_session.deck_id
      AND r.card_id = p_card_id;

    RETURN QUERY SELECT
      v_existing_event.id,
      true,
      v_progress.correct_count,
      v_progress.wrong_count,
      v_progress.mastery,
      v_progress.stage,
      v_progress.due_at,
      v_progress.avg_ms,
      v_progress.total_ms,
      v_progress.samples,
      v_progress.slow_misses,
      v_recall.score,
      v_recall.stage_idx,
      v_recall.interval_idx,
      v_recall.due_at,
      v_recall.correct_count,
      v_recall.wrong_count;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::TEXT || ':' || v_session.deck_id::TEXT || ':' || v_card_key, 0)
  );

  SELECT p.* INTO v_progress
  FROM public.card_progress p
  WHERE p.user_id = v_user_id
    AND p.deck_id = v_session.deck_id
    AND p.card_key = v_card_key
  FOR UPDATE;

  v_slow := p_response_ms IS NOT NULL AND p_response_ms > 8000;
  v_correct_count := COALESCE(v_progress.correct_count, 0) + CASE WHEN p_result THEN 1 ELSE 0 END;
  v_wrong_count := COALESCE(v_progress.wrong_count, 0) + CASE WHEN p_result THEN 0 ELSE 1 END;
  v_mastery := CASE
    WHEN p_result THEN LEAST(1, COALESCE(v_progress.mastery, 0) + CASE WHEN v_slow THEN 0.12 ELSE 0.25 END)
    ELSE GREATEST(0, COALESCE(v_progress.mastery, 0) - 0.2)
  END;
  v_stage := CASE
    WHEN v_mastery >= 0.95 THEN 4
    WHEN v_mastery >= 0.75 THEN 3
    WHEN v_mastery >= 0.45 THEN 2
    WHEN v_mastery > 0 THEN 1
    ELSE 0
  END;
  v_due_at := v_now + CASE
    WHEN NOT p_result OR v_stage = 0 THEN INTERVAL '10 minutes'
    WHEN v_stage = 1 THEN INTERVAL '8 hours'
    WHEN v_stage = 2 THEN INTERVAL '2 days'
    WHEN v_stage = 3 THEN INTERVAL '7 days'
    ELSE INTERVAL '21 days'
  END;

  IF p_response_ms IS NOT NULL AND p_response_ms > 0 THEN
    v_avg_ms := round(COALESCE(v_progress.avg_ms, p_response_ms) * 0.7 + p_response_ms * 0.3);
    v_total_ms := COALESCE(v_progress.total_ms, 0) + p_response_ms;
    v_samples := COALESCE(v_progress.samples, 0) + 1;
  ELSE
    v_avg_ms := v_progress.avg_ms;
    v_total_ms := v_progress.total_ms;
    v_samples := v_progress.samples;
  END IF;
  v_slow_misses := COALESCE(v_progress.slow_misses, 0)
    + CASE WHEN NOT p_result OR v_slow THEN 1 ELSE 0 END;

  INSERT INTO public.card_progress (
    user_id, deck_id, card_key, card_id, correct_count, wrong_count,
    mastery, stage, due_at, avg_ms, total_ms, samples, slow_misses,
    last_seen_at, updated_at
  ) VALUES (
    v_user_id, v_session.deck_id, v_card_key, p_card_id, v_correct_count, v_wrong_count,
    v_mastery, v_stage, v_due_at, v_avg_ms, v_total_ms, v_samples, v_slow_misses,
    v_now, v_now
  )
  ON CONFLICT (user_id, deck_id, card_key) DO UPDATE SET
    card_id = EXCLUDED.card_id,
    correct_count = EXCLUDED.correct_count,
    wrong_count = EXCLUDED.wrong_count,
    mastery = EXCLUDED.mastery,
    stage = EXCLUDED.stage,
    due_at = EXCLUDED.due_at,
    avg_ms = EXCLUDED.avg_ms,
    total_ms = EXCLUDED.total_ms,
    samples = EXCLUDED.samples,
    slow_misses = EXCLUDED.slow_misses,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_progress;

  IF v_session.mode = 'recall' THEN
    SELECT r.* INTO v_recall
    FROM public.delayed_recall_entries r
    WHERE r.user_id = v_user_id
      AND r.deck_id = v_session.deck_id
      AND r.card_id = p_card_id
    FOR UPDATE;

    v_recall_score := CASE
      WHEN p_result THEN LEAST(100, COALESCE(v_recall.score, 0) + 15)
      ELSE GREATEST(0, COALESCE(v_recall.score, 0) - 20)
    END;
    v_recall_interval := CASE
      WHEN p_result THEN LEAST(5, COALESCE(v_recall.interval_idx, 0) + 1)
      ELSE 0
    END;
    v_recall_stage := CASE
      WHEN v_recall_score >= 90 THEN 4
      WHEN v_recall_score >= 70 THEN 3
      WHEN v_recall_score >= 45 THEN 2
      WHEN v_recall_score > 0 THEN 1
      ELSE 0
    END;
    v_recall_due := v_now + CASE v_recall_interval
      WHEN 0 THEN INTERVAL '10 minutes'
      WHEN 1 THEN INTERVAL '1 day'
      WHEN 2 THEN INTERVAL '3 days'
      WHEN 3 THEN INTERVAL '7 days'
      WHEN 4 THEN INTERVAL '14 days'
      ELSE INTERVAL '30 days'
    END;

    INSERT INTO public.delayed_recall_entries (
      user_id, deck_id, card_id, score, stage_idx, interval_idx, due_at,
      correct_count, wrong_count, created_at, last_review_at
    ) VALUES (
      v_user_id, v_session.deck_id, p_card_id, v_recall_score, v_recall_stage,
      v_recall_interval, v_recall_due,
      COALESCE(v_recall.correct_count, 0) + CASE WHEN p_result THEN 1 ELSE 0 END,
      COALESCE(v_recall.wrong_count, 0) + CASE WHEN p_result THEN 0 ELSE 1 END,
      COALESCE(v_recall.created_at, v_now),
      v_now
    )
    ON CONFLICT (user_id, deck_id, card_id) DO UPDATE SET
      score = EXCLUDED.score,
      stage_idx = EXCLUDED.stage_idx,
      interval_idx = EXCLUDED.interval_idx,
      due_at = EXCLUDED.due_at,
      correct_count = EXCLUDED.correct_count,
      wrong_count = EXCLUDED.wrong_count,
      last_review_at = EXCLUDED.last_review_at
    RETURNING * INTO v_recall;
  END IF;

  INSERT INTO public.streak_days (user_id, day)
  VALUES (v_user_id, (v_now AT TIME ZONE 'UTC')::DATE)
  ON CONFLICT (user_id, day) DO NOTHING;

  INSERT INTO public.profile_private (
    user_id, streak_days, last_active_date, total_xp, updated_at
  ) VALUES (
    v_user_id,
    (SELECT count(*)::INTEGER FROM public.streak_days sd WHERE sd.user_id = v_user_id),
    (v_now AT TIME ZONE 'UTC')::DATE,
    0,
    v_now
  )
  ON CONFLICT (user_id) DO UPDATE SET
    streak_days = EXCLUDED.streak_days,
    last_active_date = EXCLUDED.last_active_date,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO public.last_studied_decks (user_id, deck_id, last_studied_at)
  VALUES (v_user_id, v_session.deck_id, v_now)
  ON CONFLICT (user_id, deck_id) DO UPDATE SET last_studied_at = EXCLUDED.last_studied_at;

  RETURN QUERY SELECT
    v_event_id,
    false,
    v_progress.correct_count,
    v_progress.wrong_count,
    v_progress.mastery,
    v_progress.stage,
    v_progress.due_at,
    v_progress.avg_ms,
    v_progress.total_ms,
    v_progress.samples,
    v_progress.slow_misses,
    v_recall.score,
    v_recall.stage_idx,
    v_recall.interval_idx,
    v_recall.due_at,
    v_recall.correct_count,
    v_recall.wrong_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_study_session(
  p_session_id UUID,
  p_completion_key UUID
)
RETURNS TABLE (
  session_id UUID,
  session_status TEXT,
  completed_at TIMESTAMPTZ,
  score INTEGER,
  accuracy INTEGER,
  max_combo INTEGER,
  answer_count INTEGER,
  duplicate BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_session public.study_sessions%ROWTYPE;
  v_event RECORD;
  v_completed_at TIMESTAMPTZ := clock_timestamp();
  v_score INTEGER := 0;
  v_combo INTEGER := 0;
  v_max_combo INTEGER := 0;
  v_correct INTEGER := 0;
  v_count INTEGER := 0;
  v_accuracy INTEGER := 0;
  v_existing_speed public.speed_runs%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_session_id IS NULL OR p_completion_key IS NULL THEN
    RAISE EXCEPTION 'session_id and completion_key are required' USING ERRCODE = '22023';
  END IF;

  SELECT s.* INTO v_session
  FROM public.study_sessions s
  WHERE s.id = p_session_id
    AND s.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Study session not found' USING ERRCODE = '42501';
  END IF;

  IF v_session.status = 'completed' THEN
    IF v_session.completion_key <> p_completion_key THEN
      RAISE EXCEPTION 'Study session was already completed' USING ERRCODE = '55000';
    END IF;
    SELECT r.* INTO v_existing_speed
    FROM public.speed_runs r
    WHERE r.session_id = v_session.id;
    RETURN QUERY SELECT
      v_session.id,
      v_session.status,
      v_session.completed_at,
      v_existing_speed.score,
      v_existing_speed.accuracy,
      v_existing_speed.max_combo,
      (SELECT count(*)::INTEGER FROM public.study_events e WHERE e.session_id = v_session.id),
      true;
    RETURN;
  END IF;

  IF v_session.status <> 'active' THEN
    RAISE EXCEPTION 'Study session cannot be completed' USING ERRCODE = '55000';
  END IF;

  FOR v_event IN
    SELECT e.correct
    FROM public.study_events e
    WHERE e.session_id = v_session.id
    ORDER BY e.answered_at, e.id
  LOOP
    v_count := v_count + 1;
    IF v_event.correct THEN
      v_correct := v_correct + 1;
      v_combo := v_combo + 1;
      v_max_combo := GREATEST(v_max_combo, v_combo);
      v_score := v_score + round(100 * (1 + LEAST(v_combo, 10) * 0.1));
    ELSE
      v_combo := 0;
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Cannot complete an empty study session' USING ERRCODE = '22023';
  END IF;
  v_accuracy := round(v_correct * 100.0 / v_count);

  UPDATE public.study_sessions s
  SET status = 'completed',
      completion_key = p_completion_key,
      completed_at = v_completed_at,
      updated_at = v_completed_at
  WHERE s.id = v_session.id
  RETURNING * INTO v_session;

  IF v_session.mode = 'speed' THEN
    INSERT INTO public.speed_runs (
      user_id, deck_id, duration, score, accuracy, max_combo, created_at, session_id
    ) VALUES (
      v_user_id, v_session.deck_id, v_session.duration_seconds,
      v_score, v_accuracy, v_max_combo, v_completed_at, v_session.id
    )
    ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO NOTHING
    RETURNING * INTO v_existing_speed;
  END IF;

  RETURN QUERY SELECT
    v_session.id,
    v_session.status,
    v_session.completed_at,
    CASE WHEN v_session.mode = 'speed' THEN v_score ELSE NULL END,
    CASE WHEN v_session.mode = 'speed' THEN v_accuracy ELSE NULL END,
    CASE WHEN v_session.mode = 'speed' THEN v_max_combo ELSE NULL END,
    v_count,
    false;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_deck_studied(p_deck_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_user_id IS NULL OR NOT public.can_study_deck(p_deck_id) THEN
    RAISE EXCEPTION 'Deck is not available for study' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.last_studied_decks (user_id, deck_id, last_studied_at)
  VALUES (v_user_id, p_deck_id, v_now)
  ON CONFLICT (user_id, deck_id) DO UPDATE SET last_studied_at = EXCLUDED.last_studied_at;
  RETURN v_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_recall_card(p_card_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_deck_id UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT c.deck_id INTO v_deck_id
  FROM public.cards c
  WHERE c.id = p_card_id
    AND public.can_study_deck(c.deck_id);

  IF v_deck_id IS NULL THEN
    RAISE EXCEPTION 'Card is not available for recall' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.deck_learning_settings s
    WHERE s.user_id = v_user_id
      AND s.deck_id = v_deck_id
      AND s.delayed_recall_enabled
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.delayed_recall_entries (
    user_id, deck_id, card_id, score, stage_idx, interval_idx,
    due_at, correct_count, wrong_count, created_at
  ) VALUES (
    v_user_id, v_deck_id, p_card_id, 0, 0, 0,
    v_now + INTERVAL '10 minutes', 0, 0, v_now
  )
  ON CONFLICT (user_id, deck_id, card_id) DO NOTHING;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_card_known(p_card_id UUID, p_known BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_known IS NULL THEN
    RAISE EXCEPTION 'Invalid known-state request' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cards c
  SET known = p_known
  WHERE c.id = p_card_id
    AND c.user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card is not owned by the current user' USING ERRCODE = '42501';
  END IF;
  RETURN p_known;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_deck_known(p_deck_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.decks d WHERE d.id = p_deck_id AND d.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Deck is not owned by the current user' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cards c
  SET known = false
  WHERE c.deck_id = p_deck_id
    AND c.user_id = v_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_study_session(UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_study_answer(UUID, UUID, UUID, BOOLEAN, INTEGER, TEXT)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_study_session(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_deck_studied(UUID)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.schedule_recall_card(UUID)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_card_known(UUID, BOOLEAN)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reset_deck_known(UUID)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.start_study_session(UUID, UUID, TEXT, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_study_answer(UUID, UUID, UUID, BOOLEAN, INTEGER, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_study_session(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_deck_studied(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_recall_card(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_card_known(UUID, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_deck_known(UUID)
  TO authenticated;

-- Existing clients never need to mutate or remove historical events. Direct
-- INSERT remains temporarily for compatibility until the frontend rollout.
REVOKE UPDATE, DELETE ON TABLE public.study_events FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.study_sessions IS
  'Server-controlled study sessions. Clients may read their own rows but write only through RPC.';
COMMENT ON COLUMN public.study_events.idempotency_key IS
  'Client-generated retry key; unique per user for trusted RPC-created events.';
COMMENT ON COLUMN public.profile_private.total_xp IS
  'Reserved server-owned aggregate. No XP award algorithm existed at the integrity migration date.';
COMMENT ON COLUMN public.cards.known IS
  'Subjective owner-controlled learning marker; it is not trusted mastery.';

COMMIT;
