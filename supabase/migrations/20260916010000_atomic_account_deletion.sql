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
    'capability_drain_pending',
    'database_verification_pending',
    'completed',
    'failed_retryable',
    'failed_terminal'
  )),
  resume_step TEXT NOT NULL DEFAULT 'storage_cleanup' CHECK (resume_step IN (
    'storage_cleanup',
    'auth_deletion',
    'capability_drain',
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
      'PROVIDER_RESIDUAL',
      'WORKFLOW_TIMEOUT',
      'ATTEMPT_LIMIT_REACHED'
    )
  ),
  next_retry_at TIMESTAMPTZ,
  capability_drain_started_at TIMESTAMPTZ,
  capability_drain_until TIMESTAMPTZ,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  retention_until TIMESTAMPTZ,
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK (
    (capability_drain_started_at IS NULL AND capability_drain_until IS NULL
      AND resume_step IN ('storage_cleanup', 'auth_deletion'))
    OR
    (capability_drain_started_at IS NOT NULL AND capability_drain_until IS NOT NULL
      AND capability_drain_until = capability_drain_started_at + INTERVAL '25 hours'
      AND resume_step IN ('capability_drain', 'database_verification', 'done'))
  ),
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
  'Only verified completed jobs expire after 30 days. Unresolved jobs never auto-purge; terminal recovery requires an audited operator decision.';
COMMENT ON COLUMN private.account_deletion_jobs.capability_drain_until IS
  'DB-clock deadline after verified Auth absence: 25 hours covers documented signed upload (2h), TUS and S3 multipart (24h) windows. Requires bounded in-flight writes, no unrestricted S3 keys, and provider lifetime attestation; see docs/account-deletion.md.';

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

  -- Drain already-admitted metadata transactions before publishing the fence.
  -- Separate from the unchanged collection lock namespace 52017002.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT, 52017003));

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
  WHERE job.user_ref_hash = private.account_deletion_user_hash(auth.uid())
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

  v_now := clock_timestamp();

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

  -- Waiting is not an attempt. No lease, write or provider call is needed.
  IF v_job.resume_step = 'capability_drain' AND v_job.capability_drain_until > v_now THEN
    v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_job.capability_drain_until - v_now)))::INTEGER);
    RETURN QUERY SELECT
      v_job.id, v_job.user_id, 'capability_drain_pending'::TEXT, v_job.resume_step,
      NULL::UUID, NULL::TIMESTAMPTZ, v_job.attempt_count, FALSE, v_retry;
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
        retention_until = NULL,
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
        WHEN 'capability_drain' THEN 'database_verification_pending'
        WHEN 'database_verification' THEN 'database_verification_pending'
      END,
      resume_step = CASE WHEN v_job.resume_step = 'capability_drain'
        THEN 'database_verification' ELSE v_job.resume_step END,
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
    AND job.lease_expires_at > clock_timestamp()
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
RETURNS TABLE (job_status TEXT, resume_step TEXT, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
DECLARE
  v_status TEXT;
  v_job private.account_deletion_jobs%ROWTYPE;
  v_now TIMESTAMPTZ;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    (p_expected_step = 'storage_cleanup' AND p_next_step = 'auth_deletion')
    OR (p_expected_step = 'auth_deletion' AND p_next_step = 'capability_drain')
  ) OR p_storage_files_deleted < 0 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_FAILED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_job FROM private.account_deletion_jobs AS job
  WHERE job.id = p_job_id AND job.lease_token = p_lease_token
    AND job.resume_step = p_expected_step
  FOR UPDATE;
  v_now := clock_timestamp();
  IF NOT FOUND OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;
  IF p_next_step = 'capability_drain'
    AND EXISTS (SELECT 1 FROM auth.users WHERE id = v_job.user_id) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_AUTH_STILL_PRESENT' USING ERRCODE = 'P0001';
  END IF;

  v_status := CASE p_next_step
    WHEN 'auth_deletion' THEN 'auth_deletion_pending'
    WHEN 'capability_drain' THEN 'capability_drain_pending'
  END;

  UPDATE private.account_deletion_jobs AS job
  SET status = v_status,
      resume_step = p_next_step,
      storage_files_deleted = job.storage_files_deleted + p_storage_files_deleted,
      last_error_code = NULL,
      next_retry_at = NULL,
      capability_drain_started_at = CASE WHEN p_next_step = 'capability_drain' THEN v_now ELSE NULL END,
      capability_drain_until = CASE WHEN p_next_step = 'capability_drain' THEN v_now + INTERVAL '25 hours' ELSE NULL END,
      -- A successful handoff is not a failure. Reserve the final verification
      -- attempt even if Auth deletion succeeded on the last allowed attempt.
      attempt_count = CASE WHEN p_next_step = 'capability_drain'
        THEN GREATEST(0, job.attempt_count - 1) ELSE job.attempt_count END,
      lease_token = CASE WHEN p_next_step = 'capability_drain' THEN NULL ELSE job.lease_token END,
      lease_expires_at = CASE WHEN p_next_step = 'capability_drain' THEN NULL ELSE v_now + INTERVAL '10 minutes' END,
      updated_at = v_now
  WHERE job.id = p_job_id
    AND job.lease_token = p_lease_token
    AND job.lease_expires_at > clock_timestamp()
    AND job.resume_step = p_expected_step;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT v_status, p_next_step,
    CASE WHEN p_next_step = 'capability_drain' THEN 90000 ELSE 0 END;
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
    'STORAGE_TEMPORARY', 'AUTH_TEMPORARY', 'DATABASE_TEMPORARY', 'PROVIDER_RESIDUAL', 'WORKFLOW_TIMEOUT'
  ]) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_FAILED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_job
  FROM private.account_deletion_jobs AS job
  WHERE job.id = p_job_id
    AND job.lease_token = p_lease_token
    AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;

  v_retryable := p_retryable AND v_job.attempt_count < v_job.max_attempts;
  v_status := CASE WHEN v_retryable THEN 'failed_retryable' ELSE 'failed_terminal' END;

  UPDATE private.account_deletion_jobs AS job
  SET status = v_status,
      last_error_code = CASE
        WHEN p_error_code = 'PROVIDER_RESIDUAL' OR v_retryable THEN p_error_code
        ELSE 'ATTEMPT_LIMIT_REACHED'
      END,
      lease_token = NULL,
      lease_expires_at = NULL,
      next_retry_at = CASE
        WHEN v_retryable AND p_error_code = 'PROVIDER_RESIDUAL' THEN clock_timestamp() + INTERVAL '1 hour'
        WHEN v_retryable THEN clock_timestamp() + make_interval(secs => LEAST(60, 5 * v_job.attempt_count))
        ELSE NULL
      END,
      retention_until = NULL,
      updated_at = clock_timestamp()
  WHERE job.id = v_job.id;

  RETURN v_status;
END;
$function$;

-- Provider metadata is READ ONLY. Include parts by their own identity/key and
-- transitively through their parent upload, even when parts.owner_id is NULL.
CREATE FUNCTION private.account_deletion_provider_residual_count(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    (SELECT count(*) FROM storage.objects
      WHERE bucket_id = 'avatars'
        AND (owner_id = p_user_id::TEXT OR name LIKE p_user_id::TEXT || '/%'))
    + (SELECT count(*) FROM storage.s3_multipart_uploads
      WHERE bucket_id = 'avatars'
        AND (owner_id = p_user_id::TEXT OR key LIKE p_user_id::TEXT || '/%'))
    + (SELECT count(*) FROM storage.s3_multipart_uploads_parts AS part
      WHERE (part.bucket_id = 'avatars'
        AND (part.owner_id = p_user_id::TEXT OR part.key LIKE p_user_id::TEXT || '/%'))
        OR EXISTS (
          SELECT 1 FROM storage.s3_multipart_uploads AS upload
          WHERE upload.id = part.upload_id AND upload.bucket_id = 'avatars'
            AND (upload.owner_id = p_user_id::TEXT OR upload.key LIKE p_user_id::TEXT || '/%')
        ));
$function$;
REVOKE ALL ON FUNCTION private.account_deletion_provider_residual_count(UUID) FROM PUBLIC, anon, authenticated;

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
    + (SELECT count(*) FROM private.marketplace_view_receipts WHERE user_id = p_user_id)
    + private.account_deletion_provider_residual_count(p_user_id);
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

  IF NOT FOUND OR v_job.user_id IS NULL OR v_job.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;
  v_user_id := v_job.user_id;

  IF v_job.capability_drain_until IS NULL OR v_job.capability_drain_until > clock_timestamp() THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_DRAIN_PENDING' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_AUTH_STILL_PRESENT' USING ERRCODE = 'P0001';
  END IF;
  IF private.account_deletion_provider_residual_count(v_user_id) <> 0 THEN
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
  DELETE FROM private.marketplace_view_receipts WHERE user_id = v_user_id;
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
  WHERE job.status = 'completed'
    AND job.user_id IS NULL
    AND job.completed_at IS NOT NULL
    AND job.resume_step = 'done'
    AND job.retention_until IS NOT NULL
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

  FOREACH v_table IN ARRAY ARRAY['content_creation_requests', 'user_default_collections', 'marketplace_view_receipts']
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

-- LOCAL DEFENSE IN DEPTH: hosted rollout remains blocked until Supabase confirms
-- this fence's transaction, finalization and provider-cleanup guarantees.
-- A timed drain alone is not an equivalent fence for unbounded in-flight writes.
CREATE FUNCTION private.fence_account_avatar_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user UUID;
  v_identities TEXT[];
BEGIN
  IF NEW.bucket_id <> 'avatars' THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_STORAGE_FENCED' USING ERRCODE = 'P0001';
  END IF;
  v_identities := ARRAY[NEW.owner_id, split_part(NEW.name, '/', 1)];
  IF TG_OP = 'UPDATE' THEN
    v_identities := v_identities || ARRAY[OLD.owner_id, split_part(OLD.name, '/', 1)];
  END IF;
  FOR v_user IN
    SELECT DISTINCT candidate::UUID FROM unnest(v_identities) AS candidate
    WHERE candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY candidate::UUID
  LOOP
    PERFORM pg_advisory_xact_lock_shared(hashtextextended(v_user::TEXT, 52017003));
    -- VOLATILE + READ COMMITTED refreshes the snapshot after the shared lock.
    -- Elevated finalizers have no trustworthy auth.uid(); inspect stored identity.
    IF private.account_deletion_is_pending(v_user)
       OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_STORAGE_FENCED' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.fence_account_avatar_write() FROM PUBLIC, anon, authenticated;
-- Storage canUpload() probes INSERT/UPSERT in a transaction it always rolls
-- back, including before AbortMultipartUpload and TUS termination. A deferred
-- constraint ignores these non-writes, but rejects every real metadata COMMIT.
-- No role, token, request header or cleanup exemption bypasses the fence.
CREATE CONSTRAINT TRIGGER account_deletion_avatar_fence
  AFTER INSERT OR UPDATE ON storage.objects
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.fence_account_avatar_write();

-- Read provider metadata only; all blob deletions continue through Storage API.
-- Repeated first-page deletion is a durable cursor: nested names and legacy
-- owner-matched objects outside the canonical prefix cannot be skipped.
CREATE FUNCTION public.list_account_deletion_avatars(p_job_id UUID, p_lease_token UUID)
RETURNS TABLE (name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT job.user_id INTO v_user FROM private.account_deletion_jobs AS job
  WHERE job.id = p_job_id AND job.lease_token = p_lease_token
    AND job.lease_expires_at > clock_timestamp()
    AND job.status NOT IN ('completed', 'failed_terminal');
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY SELECT objects.name FROM storage.objects AS objects
  WHERE objects.bucket_id = 'avatars'
    AND (objects.owner_id = v_user::TEXT OR objects.name LIKE v_user::TEXT || '/%')
  ORDER BY objects.name LIMIT 100;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_account_deletion_avatars(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_deletion_avatars(UUID, UUID) TO service_role;

-- Operator visibility only: bounded keyset pages, no user identity or paths.
-- Include failed/backoff jobs, due drain jobs and expired worker leases.
CREATE FUNCTION public.list_account_deletion_attention(
  p_after_job_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  job_id UUID, job_status TEXT, resume_step TEXT, attempt_count INTEGER,
  next_retry_at TIMESTAMPTZ, age_seconds BIGINT, last_error_code TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_INVALID_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY SELECT job.id, job.status, job.resume_step, job.attempt_count,
    job.next_retry_at, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM
      (statement_timestamp() - job.requested_at))))::BIGINT, job.last_error_code
  FROM private.account_deletion_jobs AS job
  WHERE job.status <> 'completed'
    AND (p_after_job_id IS NULL OR job.id > p_after_job_id)
    AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= statement_timestamp())
    AND (job.status IN ('failed_retryable', 'failed_terminal')
      OR job.capability_drain_until IS NULL OR job.capability_drain_until <= statement_timestamp())
  ORDER BY job.id LIMIT p_limit;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_account_deletion_attention(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_deletion_attention(UUID, INTEGER) TO service_role;

-- Avatar writes are also blocked for fresh requests at the RLS boundary.
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
