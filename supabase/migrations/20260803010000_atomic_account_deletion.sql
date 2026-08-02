BEGIN;

-- Auth and Storage cannot participate in a PostgreSQL transaction. This durable
-- job survives Auth deletion and lets the server resume each external step.
CREATE TABLE private.account_deletion_jobs (
  id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id UUID,
  user_ref_hash TEXT NOT NULL UNIQUE
    CHECK (user_ref_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested',
    'storage_cleanup_pending',
    'auth_deletion_pending',
    'database_verification_pending',
    'completed',
    'failed_retryable',
    'failed_terminal'
  )),
  resume_step TEXT NOT NULL DEFAULT 'storage_cleanup' CHECK (resume_step IN (
    'storage_cleanup',
    'auth_deletion',
    'database_verification',
    'done'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 8),
  max_attempts INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 8),
  storage_files_deleted INTEGER NOT NULL DEFAULT 0 CHECK (storage_files_deleted >= 0),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'STORAGE_TEMPORARY',
      'AUTH_TEMPORARY',
      'DATABASE_TEMPORARY',
      'WORKFLOW_TIMEOUT',
      'ATTEMPT_LIMIT_REACHED'
    )
  ),
  next_retry_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  retention_until TIMESTAMPTZ,
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK (
    (status = 'completed'
      AND resume_step = 'done'
      AND user_id IS NULL
      AND completed_at IS NOT NULL
      AND retention_until IS NOT NULL)
    OR
    (status <> 'completed'
      AND resume_step <> 'done'
      AND user_id IS NOT NULL
      AND completed_at IS NULL)
  )
);

CREATE INDEX account_deletion_jobs_retry_idx
  ON private.account_deletion_jobs (next_retry_at)
  WHERE status = 'failed_retryable';

CREATE INDEX account_deletion_jobs_retention_idx
  ON private.account_deletion_jobs (retention_until)
  WHERE retention_until IS NOT NULL;

ALTER TABLE private.account_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.account_deletion_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE private.account_deletion_jobs TO service_role;

COMMENT ON TABLE private.account_deletion_jobs IS
  'Server-owned, resumable account deletion jobs. user_id is transient and cleared on completion; no email, username, token, content, or Storage path is stored.';
COMMENT ON COLUMN private.account_deletion_jobs.user_ref_hash IS
  'One-way SHA-256 reference derived from the random Auth UUID for idempotency and short-lived operational audit.';
COMMENT ON COLUMN private.account_deletion_jobs.retention_until IS
  'Completed jobs are retained for 30 days and terminal jobs for 90 days, then removed by the service-only purge function.';

CREATE OR REPLACE FUNCTION private.account_deletion_user_hash(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT encode(
    extensions.digest(convert_to('memora-account-deletion:' || p_user_id::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION private.account_deletion_is_pending(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM private.account_deletion_jobs AS job
    WHERE job.user_ref_hash = private.account_deletion_user_hash(p_user_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_account_deletion_pending()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
  SELECT private.account_deletion_is_pending(auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS TABLE (
  job_id UUID,
  job_status TEXT,
  attempt_count INTEGER,
  next_retry_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_hash TEXT;
  v_job private.account_deletion_jobs%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  v_hash := private.account_deletion_user_hash(v_user_id);

  INSERT INTO private.account_deletion_jobs (user_id, user_ref_hash)
  VALUES (v_user_id, v_hash)
  ON CONFLICT (user_ref_hash) DO NOTHING;

  SELECT *
  INTO v_job
  FROM private.account_deletion_jobs AS job
  WHERE job.user_ref_hash = v_hash
  FOR UPDATE;

  IF v_job.status = 'completed' AND v_job.user_id IS NULL THEN
    RETURN QUERY SELECT v_job.id, v_job.status, v_job.attempt_count, v_job.next_retry_at;
    RETURN;
  ELSIF v_job.user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'ACCOUNT_ALREADY_DELETED' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT v_job.id, v_job.status, v_job.attempt_count, v_job.next_retry_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_account_deletion_status()
RETURNS TABLE (
  job_id UUID,
  job_status TEXT,
  attempt_count INTEGER,
  next_retry_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
  SELECT job.id, job.status, job.attempt_count, job.next_retry_at
  FROM private.account_deletion_jobs AS job
  WHERE job.user_id = auth.uid()
    AND auth.uid() IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.claim_account_deletion_job(p_job_id UUID)
RETURNS TABLE (
  job_id UUID,
  user_id UUID,
  job_status TEXT,
  resume_step TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER,
  claimed BOOLEAN,
  retry_after_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
DECLARE
  v_job private.account_deletion_jobs%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_lease UUID;
  v_retry INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job
  FROM private.account_deletion_jobs AS job
  WHERE job.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_FAILED' USING ERRCODE = 'P0001';
  END IF;

  IF v_job.status IN ('completed', 'failed_terminal') THEN
    RETURN QUERY SELECT
      v_job.id, v_job.user_id, v_job.status, v_job.resume_step,
      NULL::UUID, NULL::TIMESTAMPTZ, v_job.attempt_count, FALSE, 0;
    RETURN;
  END IF;

  IF v_job.lease_expires_at IS NOT NULL AND v_job.lease_expires_at > v_now THEN
    v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_job.lease_expires_at - v_now)))::INTEGER);
    RETURN QUERY SELECT
      v_job.id, v_job.user_id, v_job.status, v_job.resume_step,
      NULL::UUID, v_job.lease_expires_at, v_job.attempt_count, FALSE, v_retry;
    RETURN;
  END IF;

  IF v_job.next_retry_at IS NOT NULL AND v_job.next_retry_at > v_now THEN
    v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_job.next_retry_at - v_now)))::INTEGER);
    RETURN QUERY SELECT
      v_job.id, v_job.user_id, v_job.status, v_job.resume_step,
      NULL::UUID, NULL::TIMESTAMPTZ, v_job.attempt_count, FALSE, v_retry;
    RETURN;
  END IF;

  IF v_job.attempt_count >= v_job.max_attempts THEN
    UPDATE private.account_deletion_jobs AS job
    SET status = 'failed_terminal',
        last_error_code = 'ATTEMPT_LIMIT_REACHED',
        lease_token = NULL,
        lease_expires_at = NULL,
        next_retry_at = NULL,
        retention_until = v_now + INTERVAL '90 days',
        updated_at = v_now
    WHERE job.id = v_job.id
    RETURNING * INTO v_job;

    RETURN QUERY SELECT
      v_job.id, v_job.user_id, v_job.status, v_job.resume_step,
      NULL::UUID, NULL::TIMESTAMPTZ, v_job.attempt_count, FALSE, 0;
    RETURN;
  END IF;

  v_lease := extensions.gen_random_uuid();
  UPDATE private.account_deletion_jobs AS job
  SET status = CASE v_job.resume_step
        WHEN 'storage_cleanup' THEN 'storage_cleanup_pending'
        WHEN 'auth_deletion' THEN 'auth_deletion_pending'
        WHEN 'database_verification' THEN 'database_verification_pending'
      END,
      attempt_count = v_job.attempt_count + 1,
      lease_token = v_lease,
      lease_expires_at = v_now + INTERVAL '10 minutes',
      last_error_code = NULL,
      next_retry_at = NULL,
      updated_at = v_now
  WHERE job.id = v_job.id
  RETURNING * INTO v_job;

  RETURN QUERY SELECT
    v_job.id, v_job.user_id, v_job.status, v_job.resume_step,
    v_job.lease_token, v_job.lease_expires_at, v_job.attempt_count, TRUE, 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.renew_account_deletion_lease(
  p_job_id UUID,
  p_lease_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE private.account_deletion_jobs AS job
  SET lease_expires_at = clock_timestamp() + INTERVAL '10 minutes',
      updated_at = clock_timestamp()
  WHERE job.id = p_job_id
    AND job.lease_token = p_lease_token
    AND job.status NOT IN ('completed', 'failed_terminal');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.advance_account_deletion_job(
  p_job_id UUID,
  p_lease_token UUID,
  p_expected_step TEXT,
  p_next_step TEXT,
  p_storage_files_deleted INTEGER DEFAULT 0
)
RETURNS TABLE (job_status TEXT, resume_step TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
DECLARE
  v_status TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    (p_expected_step = 'storage_cleanup' AND p_next_step = 'auth_deletion')
    OR (p_expected_step = 'auth_deletion' AND p_next_step = 'database_verification')
  ) OR p_storage_files_deleted < 0 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_FAILED' USING ERRCODE = 'P0001';
  END IF;

  v_status := CASE p_next_step
    WHEN 'auth_deletion' THEN 'auth_deletion_pending'
    WHEN 'database_verification' THEN 'database_verification_pending'
  END;

  UPDATE private.account_deletion_jobs AS job
  SET status = v_status,
      resume_step = p_next_step,
      storage_files_deleted = job.storage_files_deleted + p_storage_files_deleted,
      last_error_code = NULL,
      next_retry_at = NULL,
      lease_expires_at = clock_timestamp() + INTERVAL '10 minutes',
      updated_at = clock_timestamp()
  WHERE job.id = p_job_id
    AND job.lease_token = p_lease_token
    AND job.lease_expires_at > clock_timestamp()
    AND job.resume_step = p_expected_step;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT v_status, p_next_step;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_account_deletion_job(
  p_job_id UUID,
  p_lease_token UUID,
  p_error_code TEXT,
  p_retryable BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
DECLARE
  v_job private.account_deletion_jobs%ROWTYPE;
  v_retryable BOOLEAN;
  v_status TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_error_code IS NULL OR p_error_code <> ALL (ARRAY[
    'STORAGE_TEMPORARY', 'AUTH_TEMPORARY', 'DATABASE_TEMPORARY', 'WORKFLOW_TIMEOUT'
  ]) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_FAILED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_job
  FROM private.account_deletion_jobs AS job
  WHERE job.id = p_job_id
    AND job.lease_token = p_lease_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;

  v_retryable := p_retryable AND v_job.attempt_count < v_job.max_attempts;
  v_status := CASE WHEN v_retryable THEN 'failed_retryable' ELSE 'failed_terminal' END;

  UPDATE private.account_deletion_jobs AS job
  SET status = v_status,
      last_error_code = CASE
        WHEN v_retryable THEN p_error_code
        ELSE 'ATTEMPT_LIMIT_REACHED'
      END,
      lease_token = NULL,
      lease_expires_at = NULL,
      next_retry_at = CASE
        WHEN v_retryable THEN clock_timestamp() + make_interval(secs => LEAST(60, 5 * v_job.attempt_count))
        ELSE NULL
      END,
      retention_until = CASE
        WHEN v_retryable THEN NULL
        ELSE clock_timestamp() + INTERVAL '90 days'
      END,
      updated_at = clock_timestamp()
  WHERE job.id = v_job.id;

  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION private.account_deletion_residual_count(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, storage, auth
AS $function$
  SELECT
    (SELECT count(*) FROM auth.users WHERE id = p_user_id)
    + (SELECT count(*) FROM public.profiles WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.profile_private WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.user_roles WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.decks WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.cards WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.collections WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.collection_decks WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.friendships WHERE requester_id = p_user_id OR addressee_id = p_user_id)
    + (SELECT count(*) FROM public.creator_follows WHERE creator_id = p_user_id OR follower_id = p_user_id)
    + (SELECT count(*) FROM public.deck_likes WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.deck_saves WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.deck_ratings WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.deck_reports WHERE reporter_id = p_user_id)
    + (SELECT count(*) FROM public.collection_likes WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.collection_saves WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.collection_ratings WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.collection_reports WHERE reporter_id = p_user_id)
    + (SELECT count(*) FROM public.card_progress WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.card_associations WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.deck_learning_settings WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.delayed_recall_entries WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.last_studied_decks WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.streak_days WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.study_sessions WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.study_session_cards WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.study_questions WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.study_events WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.speed_runs WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.ai_usage_events WHERE user_id = p_user_id)
    + (SELECT count(*) FROM public.ai_rate_limit_rollups WHERE user_id = p_user_id)
    + (SELECT count(*) FROM private.content_creation_requests WHERE user_id = p_user_id)
    + (SELECT count(*) FROM private.user_default_collections WHERE user_id = p_user_id)
    + (SELECT count(*) FROM storage.objects
       WHERE bucket_id = 'avatars'
         AND (owner_id = p_user_id::TEXT OR name LIKE p_user_id::TEXT || '/%'));
$function$;

CREATE OR REPLACE FUNCTION public.finalize_account_deletion_database(
  p_job_id UUID,
  p_lease_token UUID
)
RETURNS TABLE (job_status TEXT, removed_rows BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, storage, auth
AS $function$
DECLARE
  v_job private.account_deletion_jobs%ROWTYPE;
  v_user_id UUID;
  v_before BIGINT;
  v_remaining BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job
  FROM private.account_deletion_jobs AS job
  WHERE job.id = p_job_id
    AND job.lease_token = p_lease_token
    AND job.lease_expires_at > clock_timestamp()
    AND job.resume_step = 'database_verification'
  FOR UPDATE;

  IF NOT FOUND OR v_job.user_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;
  v_user_id := v_job.user_id;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_AUTH_STILL_PRESENT' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'avatars'
      AND (owner_id = v_user_id::TEXT OR name LIKE v_user_id::TEXT || '/%')
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_STORAGE_NOT_EMPTY' USING ERRCODE = 'P0001';
  END IF;

  v_before := private.account_deletion_residual_count(v_user_id);

  -- These statements are a transactional repair path. In the normal path the
  -- Auth deletion has already removed the rows through ON DELETE CASCADE.
  DELETE FROM public.study_events WHERE user_id = v_user_id;
  DELETE FROM public.speed_runs WHERE user_id = v_user_id;
  DELETE FROM public.study_questions WHERE user_id = v_user_id;
  DELETE FROM public.study_session_cards WHERE user_id = v_user_id;
  DELETE FROM public.study_sessions WHERE user_id = v_user_id;
  DELETE FROM public.delayed_recall_entries WHERE user_id = v_user_id;
  DELETE FROM public.card_progress WHERE user_id = v_user_id;
  DELETE FROM public.card_associations WHERE user_id = v_user_id;
  DELETE FROM public.deck_learning_settings WHERE user_id = v_user_id;
  DELETE FROM public.last_studied_decks WHERE user_id = v_user_id;
  DELETE FROM public.streak_days WHERE user_id = v_user_id;

  DELETE FROM public.deck_likes WHERE user_id = v_user_id;
  DELETE FROM public.deck_saves WHERE user_id = v_user_id;
  DELETE FROM public.deck_ratings WHERE user_id = v_user_id;
  DELETE FROM public.deck_reports WHERE reporter_id = v_user_id;
  DELETE FROM public.collection_likes WHERE user_id = v_user_id;
  DELETE FROM public.collection_saves WHERE user_id = v_user_id;
  DELETE FROM public.collection_ratings WHERE user_id = v_user_id;
  DELETE FROM public.collection_reports WHERE reporter_id = v_user_id;
  DELETE FROM public.friendships WHERE requester_id = v_user_id OR addressee_id = v_user_id;
  DELETE FROM public.creator_follows WHERE creator_id = v_user_id OR follower_id = v_user_id;

  DELETE FROM private.user_default_collections WHERE user_id = v_user_id;
  DELETE FROM private.content_creation_requests WHERE user_id = v_user_id;
  DELETE FROM public.collection_decks WHERE user_id = v_user_id;
  DELETE FROM public.cards WHERE user_id = v_user_id;
  DELETE FROM public.collections WHERE user_id = v_user_id;
  DELETE FROM public.decks WHERE user_id = v_user_id;
  DELETE FROM public.ai_rate_limit_rollups WHERE user_id = v_user_id;
  DELETE FROM public.ai_usage_events WHERE user_id = v_user_id;
  DELETE FROM public.profile_private WHERE user_id = v_user_id;
  DELETE FROM public.user_roles WHERE user_id = v_user_id;
  DELETE FROM public.profiles WHERE user_id = v_user_id;

  v_remaining := private.account_deletion_residual_count(v_user_id);
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_RETRYABLE' USING ERRCODE = 'P0001';
  END IF;

  UPDATE private.account_deletion_jobs AS job
  SET user_id = NULL,
      status = 'completed',
      resume_step = 'done',
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      next_retry_at = NULL,
      completed_at = clock_timestamp(),
      retention_until = clock_timestamp() + INTERVAL '30 days',
      updated_at = clock_timestamp()
  WHERE job.id = v_job.id;

  RETURN QUERY SELECT 'completed'::TEXT, v_before;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_expired_account_deletion_jobs()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
DECLARE
  v_count BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM private.account_deletion_jobs AS job
  WHERE job.retention_until IS NOT NULL
    AND job.retention_until <= clock_timestamp();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Direct browser writes and authenticated RPC writes are rejected as soon as
-- a deletion job exists. The retained hash also blocks a previously issued JWT
-- after Auth deletion; service-role repair and Auth cascades have no auth.uid().
CREATE OR REPLACE FUNCTION private.reject_mutation_during_account_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
BEGIN
  IF private.account_deletion_is_pending(auth.uid()) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$function$;

DO $block$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'profiles', 'profile_private', 'user_roles', 'decks', 'cards', 'collections',
    'collection_decks', 'friendships', 'creator_follows', 'deck_likes', 'deck_saves',
    'deck_ratings', 'deck_reports', 'collection_likes', 'collection_saves',
    'collection_ratings', 'collection_reports', 'card_progress', 'card_associations',
    'deck_learning_settings', 'delayed_recall_entries', 'last_studied_decks',
    'streak_days', 'study_sessions', 'study_session_cards', 'study_questions',
    'study_question_options', 'study_events', 'speed_runs'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS block_pending_account_mutation ON public.%I',
      v_table
    );
    EXECUTE format(
      'CREATE TRIGGER block_pending_account_mutation '
      'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION private.reject_mutation_during_account_deletion()',
      v_table
    );
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY['content_creation_requests', 'user_default_collections']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS block_pending_account_mutation ON private.%I',
      v_table
    );
    EXECUTE format(
      'CREATE TRIGGER block_pending_account_mutation '
      'BEFORE INSERT OR UPDATE OR DELETE ON private.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION private.reject_mutation_during_account_deletion()',
      v_table
    );
  END LOOP;
END;
$block$;

-- Avatar writes are blocked at the Storage boundary as well as in application code.
DROP POLICY IF EXISTS "Users can upload their own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatars" ON storage.objects;

CREATE POLICY "Users can upload their own avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
    AND NOT public.is_account_deletion_pending()
  );

CREATE POLICY "Users can update their own avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
    AND NOT public.is_account_deletion_pending()
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
    AND NOT public.is_account_deletion_pending()
  );

CREATE POLICY "Users can delete their own avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
    AND NOT public.is_account_deletion_pending()
  );

REVOKE ALL ON FUNCTION private.account_deletion_user_hash(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.account_deletion_is_pending(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.account_deletion_residual_count(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.reject_mutation_during_account_deletion() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.is_account_deletion_pending() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_account_deletion_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_account_deletion_job(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_account_deletion_lease(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_account_deletion_job(UUID, UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_account_deletion_job(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_account_deletion_database(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_account_deletion_jobs() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_account_deletion_pending() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_account_deletion_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_deletion_job(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_account_deletion_lease(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_account_deletion_job(UUID, UUID, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_account_deletion_job(UUID, UUID, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_account_deletion_database(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_account_deletion_jobs() TO service_role;

COMMIT;
