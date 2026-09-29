BEGIN;

-- 1. Streak days in the learner's time zone.
--
-- Streak days were stored as UTC dates while the app shows and counts them in
-- the browser's local date, so a learner east of UTC who studied after local
-- midnight but before UTC midnight had that day credited to the previous day,
-- and the streak broke. The browser now reports its IANA time zone and the
-- answer recorder stores the learner's local date.

ALTER TABLE public.profile_private
  ADD COLUMN IF NOT EXISTS time_zone TEXT;

COMMENT ON COLUMN public.profile_private.time_zone IS
  'IANA time zone reported by the learner''s browser. Streak days are recorded as dates in this zone (UTC when unset). Written only by set_my_time_zone().';

CREATE OR REPLACE FUNCTION public.set_my_time_zone(p_time_zone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_time_zone IS NULL
    OR length(p_time_zone) > 64
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names tz WHERE tz.name = p_time_zone)
  THEN
    RAISE EXCEPTION 'Unknown time zone' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.profile_private (user_id, time_zone, updated_at)
  VALUES (v_user_id, p_time_zone, now())
  ON CONFLICT (user_id) DO UPDATE SET
    time_zone = EXCLUDED.time_zone,
    updated_at = EXCLUDED.updated_at
  WHERE public.profile_private.time_zone IS DISTINCT FROM EXCLUDED.time_zone;

  RETURN p_time_zone;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_time_zone(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_time_zone(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_my_time_zone(TEXT) IS
  'Stores the caller''s IANA time zone for streak days. Rejects names Postgres does not know.';

-- Same body as the aggregate updater created in 20260729180000 (renamed to
-- private.apply_study_answer_result in 20260729233000); only the streak day
-- and last_active_date now use the learner's time zone.
CREATE OR REPLACE FUNCTION private.apply_study_answer_result(
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
  v_day DATE;
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

  -- Streak days follow the learner's own calendar day. time_zone is only
  -- written by set_my_time_zone(), which accepts known IANA names.
  SELECT (v_now AT TIME ZONE COALESCE(pp.time_zone, 'UTC'))::DATE
  INTO v_day
  FROM public.profile_private pp
  WHERE pp.user_id = v_user_id;
  v_day := COALESCE(v_day, (v_now AT TIME ZONE 'UTC')::DATE);

  INSERT INTO public.streak_days (user_id, day)
  VALUES (v_user_id, v_day)
  ON CONFLICT (user_id, day) DO NOTHING;

  INSERT INTO public.profile_private (
    user_id, streak_days, last_active_date, total_xp, updated_at
  ) VALUES (
    v_user_id,
    (SELECT count(*)::INTEGER FROM public.streak_days sd WHERE sd.user_id = v_user_id),
    v_day,
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


COMMENT ON FUNCTION private.apply_study_answer_result(
  UUID, UUID, UUID, BOOLEAN, INTEGER, TEXT
) IS 'Internal aggregate updater. Only server-verifying SECURITY DEFINER RPCs may call it.';

-- 2. has_role only answers for the caller.
--
-- has_role is granted to authenticated so RLS policies can call it, but it
-- accepted any user id, which let any signed-in user find out who the admins
-- and moderators are. Every policy passes auth.uid(), so other ids now
-- simply return false.

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
    AND _user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

COMMENT ON FUNCTION public.has_role(UUID, app_role) IS
  'True when the caller (auth.uid()) holds the role. Returns false for any other user id.';

COMMIT;
