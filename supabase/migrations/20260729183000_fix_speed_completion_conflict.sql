BEGIN;

-- The function returns a column named session_id, so a named ON CONFLICT
-- target is ambiguous to PL/pgSQL. The table has only generated primary keys
-- and one session unique index on this insert path; target-free conflict
-- handling preserves completion idempotency without a name collision.
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
    ON CONFLICT DO NOTHING
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

REVOKE EXECUTE ON FUNCTION public.complete_study_session(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_study_session(UUID, UUID)
  TO authenticated;

COMMIT;
