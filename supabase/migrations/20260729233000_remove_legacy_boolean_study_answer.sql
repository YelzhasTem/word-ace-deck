BEGIN;

-- Phase 3 runs only after the canonical server-verifying frontend is live.
-- Preserve the existing aggregate algorithm as an internal implementation,
-- but remove its trusted boolean signature from the exposed public schema.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.record_study_answer(UUID, UUID, UUID, BOOLEAN, INTEGER, TEXT)
  SET SCHEMA private;
ALTER FUNCTION private.record_study_answer(UUID, UUID, UUID, BOOLEAN, INTEGER, TEXT)
  RENAME TO apply_study_answer_result;

REVOKE ALL ON FUNCTION private.apply_study_answer_result(
  UUID, UUID, UUID, BOOLEAN, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;

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
  FROM private.apply_study_answer_result(
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

REVOKE EXECUTE ON FUNCTION public.record_study_answer_v2(
  UUID, UUID, TEXT, UUID, BOOLEAN, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_study_answer_v2(
  UUID, UUID, TEXT, UUID, BOOLEAN, INTEGER
) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure(
    'public.record_study_answer(uuid,uuid,uuid,boolean,integer,text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy public boolean study-answer signature still exists';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'private.apply_study_answer_result(uuid,uuid,uuid,boolean,integer,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated still has access to the internal boolean function';
  END IF;
END;
$$;

COMMENT ON FUNCTION private.apply_study_answer_result(
  UUID, UUID, UUID, BOOLEAN, INTEGER, TEXT
) IS 'Internal aggregate updater. Only server-verifying SECURITY DEFINER RPCs may call it.';

COMMIT;
