BEGIN;
SELECT extensions.no_plan();
INSERT INTO auth.users (id, raw_user_meta_data) VALUES
  ('dd100000-0000-4000-8000-000000000001', '{"username":"stage31_drain"}'),
  ('dd100000-0000-4000-8000-000000000002', '{"username":"stage31_other"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"dd100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
CREATE TEMP TABLE stage3_job AS SELECT * FROM public.request_account_deletion();
RESET ROLE;
GRANT SELECT ON stage3_job TO service_role;
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid='storage.objects'::regclass
  AND tgname='account_deletion_avatar_fence'), 'metadata fence retained pending provider support confirmation');
SELECT extensions.ok(to_regprocedure('private.fence_account_avatar_write()') IS NOT NULL, 'metadata fence checks elevated finalizers');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
CREATE TEMP TABLE stage3_claim AS SELECT * FROM public.claim_account_deletion_job((SELECT job_id FROM stage3_job));
RESET ROLE;
GRANT ALL ON stage3_claim TO service_role;
UPDATE private.account_deletion_jobs SET lease_expires_at=now()-interval '1 minute'
WHERE id=(SELECT job_id FROM stage3_job);
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(format('SELECT public.renew_account_deletion_lease(%L,%L)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim)),
  'P0001', 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS', 'expired lease cannot renew itself');
SELECT extensions.throws_ok(format('SELECT public.fail_account_deletion_job(%L,%L,%L,true)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim), 'WORKFLOW_TIMEOUT'),
  'P0001', 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS', 'expired worker cannot change failure state');
SELECT extensions.ok((SELECT claimed FROM public.claim_account_deletion_job((SELECT job_id FROM stage3_job))),
  'worker B takes over expired lease');
SELECT extensions.throws_ok(format('SELECT public.advance_account_deletion_job(%L,%L,%L,%L,0)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim), 'storage_cleanup', 'auth_deletion'),
  'P0001', 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS', 'worker A cannot advance after takeover');
SELECT extensions.throws_ok(format('SELECT public.finalize_account_deletion_database(%L,%L)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim)),
  'P0001', 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS', 'worker A cannot finalize after takeover');
RESET ROLE;
UPDATE stage3_claim SET lease_token=(SELECT lease_token FROM private.account_deletion_jobs WHERE id=job_id);
SET LOCAL ROLE service_role;
SELECT * FROM public.advance_account_deletion_job(
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim), 'storage_cleanup','auth_deletion',0);
SELECT extensions.throws_ok(format('SELECT public.advance_account_deletion_job(%L,%L,%L,%L,0)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim), 'auth_deletion','capability_drain'),
  'P0001','ACCOUNT_DELETION_AUTH_STILL_PRESENT','cannot start drain until Auth absence is verified');
RESET ROLE;
DELETE FROM auth.users WHERE id='dd100000-0000-4000-8000-000000000001';
UPDATE private.account_deletion_jobs SET lease_expires_at=now()-interval '1 second'
WHERE id=(SELECT job_id FROM stage3_job);
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(format('SELECT public.advance_account_deletion_job(%L,%L,%L,%L,0)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim), 'auth_deletion','capability_drain'),
  'P0001','ACCOUNT_DELETION_ALREADY_IN_PROGRESS','lease expiry at drain transition cannot advance');
TRUNCATE stage3_claim;
INSERT INTO stage3_claim SELECT * FROM public.claim_account_deletion_job((SELECT job_id FROM stage3_job));
SELECT extensions.is((SELECT job_status FROM public.advance_account_deletion_job(
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim), 'auth_deletion','capability_drain',0)),
  'capability_drain_pending','Auth already absent resumes into durable drain');
SELECT extensions.throws_ok(format('SELECT public.finalize_account_deletion_database(%L,%L)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim)),
  'P0001','ACCOUNT_DELETION_ALREADY_IN_PROGRESS','old lease cannot finalize during drain');
RESET ROLE;
SELECT extensions.ok((SELECT capability_drain_until=capability_drain_started_at+interval '25 hours'
  AND lease_token IS NULL AND lease_expires_at IS NULL FROM private.account_deletion_jobs
  WHERE id=(SELECT job_id FROM stage3_job)), '25-hour DB-clock deadline persists and releases lease');
CREATE TEMP TABLE attempts_before AS SELECT attempt_count FROM private.account_deletion_jobs WHERE id=(SELECT job_id FROM stage3_job);
SET LOCAL ROLE service_role;
SELECT extensions.ok((SELECT NOT claimed AND retry_after_seconds > 89990
  FROM public.claim_account_deletion_job((SELECT job_id FROM stage3_job))), 'early resume waits without lease');
DO $do$ BEGIN
  FOR i IN 1..20 LOOP PERFORM public.claim_account_deletion_job((SELECT job_id FROM stage3_job)); END LOOP;
END $do$;
RESET ROLE;
SELECT extensions.is((SELECT attempt_count FROM private.account_deletion_jobs WHERE id=(SELECT job_id FROM stage3_job)),
  (SELECT attempt_count FROM attempts_before), '20 early resumes consume no attempts');
-- LOCAL fault injection: even a mistakenly advanced step cannot bypass time.
UPDATE private.account_deletion_jobs SET resume_step='database_verification',status='database_verification_pending',
  lease_token=(SELECT lease_token FROM stage3_claim),lease_expires_at=now()+interval '10 minutes'
WHERE id=(SELECT job_id FROM stage3_job);
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(format('SELECT public.finalize_account_deletion_database(%L,%L)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim)),
  'P0001','ACCOUNT_DELETION_DRAIN_PENDING','finalizer independently enforces the future deadline');
RESET ROLE;
UPDATE private.account_deletion_jobs SET resume_step='capability_drain',status='capability_drain_pending',
  lease_token=NULL,lease_expires_at=NULL WHERE id=(SELECT job_id FROM stage3_job);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"dd100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT extensions.throws_ok($sql$INSERT INTO storage.objects(bucket_id,name)
  VALUES ('avatars','dd100000-0000-4000-8000-000000000001/fresh.png')$sql$,
  '42501', 'new row violates row-level security policy for table "objects"', 'supported RLS blocks fresh uploads with stale JWT');
RESET ROLE;

SELECT extensions.ok((SELECT tgdeferrable AND tginitdeferred FROM pg_trigger
  WHERE tgrelid='storage.objects'::regclass AND tgname='account_deletion_avatar_fence'),
  'finalization fence is deferred to commit, permission rollback probes are allowed');
SAVEPOINT permission_probe;
INSERT INTO storage.objects(bucket_id,name) VALUES ('avatars','dd100000-0000-4000-8000-000000000001/probe.png');
ROLLBACK TO SAVEPOINT permission_probe;
SELECT extensions.lives_ok('SET CONSTRAINTS storage.account_deletion_avatar_fence IMMEDIATE',
  'rolled-back provider permission probe cannot poison abort');
SET CONSTRAINTS storage.account_deletion_avatar_fence DEFERRED;
SELECT extensions.throws_ok($sql$DO $do$ BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES ('avatars','dd100000-0000-4000-8000-000000000001/late.png');
  SET CONSTRAINTS storage.account_deletion_avatar_fence IMMEDIATE;
END $do$$sql$, 'P0001','ACCOUNT_DELETION_STORAGE_FENCED','real elevated metadata cannot commit after Auth deletion');

-- Synthetic LOCAL provider metadata, transaction rolled back. Application SQL
-- only reads these managed tables. Actual AbortMultipartUpload is tested via API.
INSERT INTO storage.s3_multipart_uploads(id, bucket_id, key, version, upload_signature, owner_id) VALUES
  ('stage31-parent','avatars','legacy/parts.png','v1','fixture','dd100000-0000-4000-8000-000000000001'),
  ('stage31-other','avatars','dd100000-0000-4000-8000-000000000002/other.png','v2','fixture','dd100000-0000-4000-8000-000000000002');
INSERT INTO storage.s3_multipart_uploads_parts(upload_id,bucket_id,key,version,part_number,size,etag,owner_id) VALUES
  ('stage31-parent','avatars','legacy/parts.png','v1',1,8,'fixture',NULL);
SELECT extensions.is(private.account_deletion_provider_residual_count('dd100000-0000-4000-8000-000000000001'),
  2::bigint,'multipart plus ownerless part counted transitively; unrelated parent excluded');
SELECT extensions.is(private.account_deletion_residual_count('dd100000-0000-4000-8000-000000000001'),
  2::bigint,'full residual inventory includes provider multipart records');
UPDATE private.account_deletion_jobs SET capability_drain_started_at=now()-interval '25 hours',
  capability_drain_until=now() WHERE id=(SELECT job_id FROM stage3_job);
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
TRUNCATE stage3_claim;
INSERT INTO stage3_claim SELECT * FROM public.claim_account_deletion_job((SELECT job_id FROM stage3_job));
SELECT extensions.ok((SELECT claimed AND resume_step='database_verification' FROM stage3_claim),
  'elapsed drain advances exactly one worker to verification');
SELECT extensions.ok((SELECT NOT claimed FROM public.claim_account_deletion_job((SELECT job_id FROM stage3_job))),
  'concurrent verification worker cannot acquire lease');
SELECT extensions.throws_ok(format('SELECT public.finalize_account_deletion_database(%L,%L)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim)),
  'P0001','ACCOUNT_DELETION_STORAGE_NOT_EMPTY','multipart prevents completion after drain');
SELECT extensions.is(public.fail_account_deletion_job(
  (SELECT job_id FROM stage3_claim),(SELECT lease_token FROM stage3_claim),'PROVIDER_RESIDUAL',true),
  'failed_retryable','provider residual has a safe retryable state');
RESET ROLE;
SELECT extensions.ok((SELECT user_id IS NOT NULL AND retention_until IS NULL
  AND last_error_code='PROVIDER_RESIDUAL' AND next_retry_at > now()+interval '59 minutes'
  FROM private.account_deletion_jobs WHERE id=(SELECT job_id FROM stage3_job)),
  'provider residual preserves identity/tombstone and uses bounded one-hour backoff');

-- Test terminal state is retained, cannot silently restart, and audited LOCAL
-- operator recovery preserves the elapsed deadline (no production bypass RPC).
UPDATE private.account_deletion_jobs SET status='failed_terminal', attempt_count=8,
  lease_token=NULL,lease_expires_at=NULL,retention_until=now()-interval '1 day'
WHERE id=(SELECT job_id FROM stage3_job);
SET LOCAL ROLE service_role;
SELECT extensions.ok((SELECT NOT claimed AND job_status='failed_terminal'
  FROM public.claim_account_deletion_job((SELECT job_id FROM stage3_job))), 'terminal jobs require operator recovery');
SELECT public.purge_expired_account_deletion_jobs();
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM private.account_deletion_jobs WHERE id=(SELECT job_id FROM stage3_job)),
  1::bigint,'terminal jobs never purge even with legacy expiry');
UPDATE private.account_deletion_jobs SET status='failed_retryable',attempt_count=0,
  next_retry_at=NULL,retention_until=NULL WHERE id=(SELECT job_id FROM stage3_job);
SELECT extensions.ok((SELECT capability_drain_until <= now() FROM private.account_deletion_jobs
  WHERE id=(SELECT job_id FROM stage3_job)), 'operator recovery retains durable drain deadline');

INSERT INTO private.account_deletion_jobs(user_id,user_ref_hash,status,resume_step,attempt_count)
VALUES ('dd200000-0000-4000-8000-000000000001',
  private.account_deletion_user_hash('dd200000-0000-4000-8000-000000000001'),
  'failed_retryable','auth_deletion',7);
CREATE TEMP TABLE final_attempt_job AS SELECT id AS job_id FROM private.account_deletion_jobs
WHERE user_id='dd200000-0000-4000-8000-000000000001';
GRANT SELECT ON final_attempt_job TO service_role;
SET LOCAL ROLE service_role;
TRUNCATE stage3_claim;
INSERT INTO stage3_claim SELECT * FROM public.claim_account_deletion_job((SELECT job_id FROM final_attempt_job));
SELECT extensions.is((SELECT attempt_count FROM stage3_claim),8,'last allowed real work attempt can acquire');
SELECT extensions.is((SELECT job_status FROM public.advance_account_deletion_job(
  (SELECT job_id FROM stage3_claim),(SELECT lease_token FROM stage3_claim),'auth_deletion','capability_drain',0)),
  'capability_drain_pending','last successful Auth attempt enters drain without exhaustion');
RESET ROLE;
SELECT extensions.is((SELECT attempt_count FROM private.account_deletion_jobs WHERE id=(SELECT job_id FROM final_attempt_job)),
  7,'successful handoff refunds one attempt for final verification');
UPDATE private.account_deletion_jobs SET capability_drain_started_at=now()-interval '25 hours',
  capability_drain_until=now() WHERE id=(SELECT job_id FROM final_attempt_job);
SET LOCAL ROLE service_role;
TRUNCATE stage3_claim;
INSERT INTO stage3_claim SELECT * FROM public.claim_account_deletion_job((SELECT job_id FROM final_attempt_job));
SELECT extensions.is((SELECT job_status FROM public.finalize_account_deletion_database(
  (SELECT job_id FROM stage3_claim),(SELECT lease_token FROM stage3_claim))),
  'completed','clean expired drain can complete on final work attempt');
RESET ROLE;

SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'private.account_deletion_provider_residual_count(uuid)','EXECUTE'), 'provider inventory is not a public API');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'private'::regnamespace)
  AND proname LIKE '%account_deletion%'
  AND prosrc ~* '(DELETE FROM|UPDATE|INSERT INTO)\s+storage\.(objects|s3_multipart_uploads)'),
  'account deletion never modifies managed Storage metadata');
SELECT extensions.ok(NOT has_function_privilege('anon',
  'public.list_account_deletion_attention(uuid,integer)','EXECUTE'), 'anon cannot inspect operator jobs');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'public.list_account_deletion_attention(uuid,integer)','EXECUTE'), 'users cannot inspect operator jobs');
SELECT extensions.ok(has_function_privilege('service_role',
  'public.list_account_deletion_attention(uuid,integer)','EXECUTE'), 'server can inspect operator jobs');
CREATE TEMP TABLE operator_before AS SELECT jsonb_agg(to_jsonb(job) ORDER BY id) AS snapshot
FROM private.account_deletion_jobs AS job;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT extensions.is((SELECT count(*) FROM public.list_account_deletion_attention(NULL,1)),
  1::bigint,'operator listing is bounded');
SELECT extensions.ok((SELECT last_error_code='PROVIDER_RESIDUAL' AND age_seconds>=0
  FROM public.list_account_deletion_attention() WHERE job_id=(SELECT job_id FROM stage3_job)),
  'operator sees safe residual code and age');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.list_account_deletion_attention()
  WHERE job_id=(SELECT job_id FROM final_attempt_job)), 'completed job needs no attention');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.list_account_deletion_attention(
  (SELECT job_id FROM stage3_job)) WHERE job_id <= (SELECT job_id FROM stage3_job)),
  'operator listing uses exclusive keyset cursor');
SELECT extensions.throws_ok('SELECT public.list_account_deletion_attention(NULL,101)',
  'P0001','ACCOUNT_DELETION_INVALID_LIMIT','operator cannot request unbounded inventory');
SELECT extensions.ok((SELECT NOT (to_jsonb(row) ?| ARRAY['user_id','user_ref_hash','lease_token','email','name'])
  FROM public.list_account_deletion_attention(NULL,1) row), 'operator fields exclude personal identifiers and lease');
RESET ROLE;
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(job) ORDER BY id) FROM private.account_deletion_jobs job),
  (SELECT snapshot FROM operator_before), 'operator reads do not claim resume or modify jobs');
SELECT * FROM extensions.finish();
ROLLBACK;
