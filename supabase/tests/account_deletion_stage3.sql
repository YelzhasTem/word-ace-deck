BEGIN;
SELECT extensions.no_plan();
INSERT INTO auth.users (id, raw_user_meta_data)
VALUES ('dd100000-0000-4000-8000-000000000001', '{"username":"stage3_fence"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"dd100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
CREATE TEMP TABLE stage3_job AS SELECT * FROM public.request_account_deletion();
RESET ROLE;
GRANT SELECT ON stage3_job TO service_role;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
CREATE TEMP TABLE stage3_claim AS SELECT * FROM public.claim_account_deletion_job((SELECT job_id FROM stage3_job));
RESET ROLE;
GRANT SELECT ON stage3_claim TO service_role;
UPDATE private.account_deletion_jobs SET lease_expires_at = now() - interval '1 minute'
WHERE id = (SELECT job_id FROM stage3_job);
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(format('SELECT public.renew_account_deletion_lease(%L,%L)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim)),
  'P0001', 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS', 'expired lease cannot renew itself');
SELECT extensions.throws_ok(format('SELECT public.fail_account_deletion_job(%L,%L,%L,true)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim), 'WORKFLOW_TIMEOUT'),
  'P0001', 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS', 'expired worker cannot change failure state');
SELECT extensions.ok((SELECT claimed FROM public.claim_account_deletion_job((SELECT job_id FROM stage3_job))),
  'worker B can take over expired lease');
SELECT extensions.throws_ok(format('SELECT public.renew_account_deletion_lease(%L,%L)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim)),
  'P0001', 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS', 'worker A cannot renew after takeover');
SELECT extensions.throws_ok(format('SELECT public.advance_account_deletion_job(%L,%L,%L,%L,0)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim), 'storage_cleanup', 'auth_deletion'),
  'P0001', 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS', 'worker A cannot advance after takeover');
SELECT extensions.throws_ok(format('SELECT public.finalize_account_deletion_database(%L,%L)',
  (SELECT job_id FROM stage3_claim), (SELECT lease_token FROM stage3_claim)),
  'P0001', 'ACCOUNT_DELETION_ALREADY_IN_PROGRESS', 'worker A cannot finalize after takeover');
RESET ROLE;
SELECT extensions.throws_ok($sql$INSERT INTO storage.objects(bucket_id,name,owner_id)
  VALUES ('avatars','dd100000-0000-4000-8000-000000000001/late.png','dd100000-0000-4000-8000-000000000001')$sql$,
  'P0001', 'ACCOUNT_DELETION_STORAGE_FENCED', 'elevated late upload metadata is fenced');
SELECT extensions.throws_ok($sql$INSERT INTO storage.objects(bucket_id,name,owner_id)
  VALUES ('avatars','legacy/late.png','dd100000-0000-4000-8000-000000000001')$sql$,
  'P0001', 'ACCOUNT_DELETION_STORAGE_FENCED', 'owner outside canonical prefix is fenced');
UPDATE private.account_deletion_jobs SET status='failed_terminal', lease_token=NULL, lease_expires_at=NULL,
  retention_until=now()-interval '1 day' WHERE id=(SELECT job_id FROM stage3_job);
SET LOCAL ROLE service_role;
SELECT public.purge_expired_account_deletion_jobs();
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM private.account_deletion_jobs WHERE id=(SELECT job_id FROM stage3_job)),
  1::bigint, 'expired terminal job with Auth present must be retained');
DELETE FROM auth.users WHERE id='dd100000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT public.purge_expired_account_deletion_jobs();
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM private.account_deletion_jobs WHERE id=(SELECT job_id FROM stage3_job)),
  1::bigint, 'unverified terminal job after Auth deletion must be retained');
UPDATE private.account_deletion_jobs SET user_id=NULL,status='completed',resume_step='done',
  completed_at=now(),retention_until=now()+interval '30 days' WHERE id=(SELECT job_id FROM stage3_job);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"dd100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT extensions.is((SELECT job_status FROM public.get_my_account_deletion_status()), 'completed',
  'completed status uses pseudonymous hash without plaintext user retention');
RESET ROLE;
SELECT extensions.throws_ok($sql$INSERT INTO storage.objects(bucket_id,name)
  VALUES ('avatars','dd100000-0000-4000-8000-000000000001/after-completion.png')$sql$,
  'P0001', 'ACCOUNT_DELETION_STORAGE_FENCED', 'completed job cannot acquire late metadata');
UPDATE private.account_deletion_jobs SET retention_until=now()-interval '1 day' WHERE id=(SELECT job_id FROM stage3_job);
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.purge_expired_account_deletion_jobs();
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM private.account_deletion_jobs WHERE id=(SELECT job_id FROM stage3_job)),
  0::bigint, 'only verified completed expired job is purged');
SELECT extensions.throws_ok($sql$INSERT INTO storage.objects(bucket_id,name)
  VALUES ('avatars','dd100000-0000-4000-8000-000000000001/after-purge.png')$sql$,
  'P0001', 'ACCOUNT_DELETION_STORAGE_FENCED', 'missing Auth identity fences uploads even after tombstone purge');
INSERT INTO auth.users(id, raw_user_meta_data) VALUES
  ('dd200000-0000-4000-8000-000000000001','{"username":"exhaust_before"}'),
  ('dd200000-0000-4000-8000-000000000002','{"username":"exhaust_after"}');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
  ('avatars','dd200000-0000-4000-8000-000000000002/remaining.png','dd200000-0000-4000-8000-000000000002');
INSERT INTO private.account_deletion_jobs(user_id,user_ref_hash,max_attempts,resume_step)
SELECT id, private.account_deletion_user_hash(id), 1, 'database_verification'
FROM auth.users WHERE id IN ('dd200000-0000-4000-8000-000000000001','dd200000-0000-4000-8000-000000000002');
DELETE FROM auth.users WHERE id='dd200000-0000-4000-8000-000000000002';
CREATE TEMP TABLE exhausted_jobs AS SELECT id FROM private.account_deletion_jobs
WHERE user_id IN ('dd200000-0000-4000-8000-000000000001','dd200000-0000-4000-8000-000000000002');
GRANT SELECT ON exhausted_jobs TO service_role;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE exhausted_claims AS SELECT claimed.* FROM exhausted_jobs job
CROSS JOIN LATERAL public.claim_account_deletion_job(job.id) claimed;
SELECT extensions.is(public.fail_account_deletion_job(job_id,lease_token,'DATABASE_TEMPORARY',true),
  'failed_terminal', 'attempt exhaustion records terminal state without false success') FROM exhausted_claims;
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM private.account_deletion_jobs WHERE id IN (SELECT job_id FROM exhausted_claims)
  AND retention_until IS NULL), 2::bigint, 'exhausted jobs have no automatic retention deadline');
UPDATE private.account_deletion_jobs SET retention_until=now()-interval '100 days' WHERE id IN (SELECT job_id FROM exhausted_claims);
SET LOCAL ROLE service_role;
SELECT public.purge_expired_account_deletion_jobs();
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM private.account_deletion_jobs WHERE id IN (SELECT job_id FROM exhausted_claims)),
  2::bigint, 'exhaustion before and after Auth deletion survives purge even with expired legacy retention');
SELECT extensions.ok(private.account_deletion_residual_count('dd200000-0000-4000-8000-000000000001')>0
  AND private.account_deletion_residual_count('dd200000-0000-4000-8000-000000000002')>0,
  'terminal records remain while Auth or residual Storage needs recovery');
SELECT * FROM extensions.finish();
ROLLBACK;
