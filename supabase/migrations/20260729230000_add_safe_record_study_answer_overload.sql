BEGIN;

-- Phase 2 of the rollout: expose the server-verifying contract under the
-- canonical API name while the deployed v2 frontend and legacy boolean
-- frontend remain compatible. The boolean overload is removed after deploy.
CREATE OR REPLACE FUNCTION public.record_study_answer(
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
LANGUAGE SQL
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT *
  FROM public.record_study_answer_v2(
    p_idempotency_key,
    p_question_id,
    p_submitted_answer,
    p_selected_option_id,
    p_self_reported_result,
    p_response_ms
  );
$$;

REVOKE EXECUTE ON FUNCTION public.record_study_answer(UUID, UUID, TEXT, UUID, BOOLEAN, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_study_answer(UUID, UUID, TEXT, UUID, BOOLEAN, INTEGER)
  TO authenticated;

COMMENT ON FUNCTION public.record_study_answer(UUID, UUID, TEXT, UUID, BOOLEAN, INTEGER) IS
  'Canonical server-verifying answer API. Objective modes accept raw text or an issued option ID; subjective modes accept self_reported_result.';

COMMIT;
