CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;

SELECT extensions.no_plan();

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'a1000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'deletion-a@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"deletion_a","display_name":"Deletion A"}'::jsonb,
    now(), now()
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'deletion-b@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"deletion_b","display_name":"Deletion B"}'::jsonb,
    now(), now()
  );

INSERT INTO public.decks (id, user_id, name, visibility, published_at)
VALUES
  (
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'Deletion owner deck', 'private', NULL
  ),
  (
    'b2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000002',
    'Other user deck', 'public', now()
  );

INSERT INTO public.cards (id, deck_id, user_id, term, definition, position)
VALUES (
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'delete', 'удалять', 0
);

INSERT INTO public.collections (id, user_id, name)
VALUES (
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Deletion collection'
);
INSERT INTO public.collection_decks (collection_id, deck_id, user_id, position)
VALUES (
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  0
);
INSERT INTO public.friendships (requester_id, addressee_id)
VALUES (
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000002'
);
INSERT INTO public.deck_likes (deck_id, user_id)
VALUES (
  'b2000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001'
);
INSERT INTO private.content_creation_requests (
  user_id, operation, idempotency_key, request_hash, result, completed_at
)
VALUES (
  'a1000000-0000-4000-8000-000000000001',
  'create_deck_with_cards',
  'a5000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  '{"deckId":"a2000000-0000-4000-8000-000000000001"}'::jsonb,
  now()
);
INSERT INTO private.user_default_collections (user_id, collection_id)
VALUES (
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001'
);
INSERT INTO public.ai_usage_events (
  request_id, user_id, endpoint, request_class, request_units, idempotency_key,
  request_hash, status, input_size, output_size, latency_ms, started_at,
  expires_at, completed_at
)
VALUES (
  'a6000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'getTranslations', 'light', 1,
  'a7000000-0000-4000-8000-000000000001', repeat('b', 64), 'succeeded',
  10, 10, 1, now(), now() + interval '1 minute', now()
);

SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'private.account_deletion_jobs'::regclass),
  'deletion jobs have RLS enabled'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'private.account_deletion_jobs', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'private.account_deletion_jobs', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'private.account_deletion_jobs', 'UPDATE'),
  'browser roles cannot read or mutate deletion jobs'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'public.request_account_deletion()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.request_account_deletion()', 'EXECUTE'),
  'only authenticated users can request account deletion'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'public.claim_account_deletion_job(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.finalize_account_deletion_database(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.claim_account_deletion_job(uuid)', 'EXECUTE'),
  'job transitions are service-role only'
);
SELECT extensions.is(
  (
    SELECT pronargs
    FROM pg_proc
    WHERE oid = 'public.request_account_deletion()'::regprocedure
  ),
  0::SMALLINT,
  'deletion request accepts no client-supplied user ID'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema IN ('public', 'private')
      AND column_info.column_name IN (
        'user_id', 'requester_id', 'addressee_id',
        'creator_id', 'follower_id', 'reporter_id'
      )
      AND NOT (
        column_info.table_schema = 'private'
        AND column_info.table_name = 'account_deletion_jobs'
      )
      AND position(
        format('%I.%I', column_info.table_schema, column_info.table_name)
        IN pg_get_functiondef(
          'private.account_deletion_residual_count(uuid)'::regprocedure
        )
      ) = 0
  ),
  'residual verification covers every current user-linked application table'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_info
    JOIN pg_class AS child_table ON child_table.oid = constraint_info.conrelid
    JOIN pg_namespace AS child_schema ON child_schema.oid = child_table.relnamespace
    JOIN pg_class AS parent_table ON parent_table.oid = constraint_info.confrelid
    JOIN pg_namespace AS parent_schema ON parent_schema.oid = parent_table.relnamespace
    WHERE constraint_info.contype = 'f'
      AND child_schema.nspname IN ('public', 'private')
      AND parent_schema.nspname = 'auth'
      AND parent_table.relname = 'users'
      AND constraint_info.confdeltype <> 'c'
  ),
  'all direct application foreign keys to Auth users delete with cascade'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT extensions.throws_matching(
  'SELECT * FROM public.request_account_deletion()',
  'permission denied for function request_account_deletion',
  'anon cannot request account deletion'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT set_config(
  'test.account_deletion_job_id',
  (SELECT job_id::TEXT FROM public.request_account_deletion()),
  true
);
SELECT extensions.is(
  (SELECT job_id::TEXT FROM public.request_account_deletion()),
  current_setting('test.account_deletion_job_id'),
  'repeated requests return the same deletion job'
);
SELECT extensions.ok(
  public.is_account_deletion_pending(),
  'request marks the current account pending deletion'
);
SELECT extensions.throws_matching(
  $$UPDATE public.profiles SET display_name = 'blocked' WHERE user_id = auth.uid()$$,
  'ACCOUNT_DELETION_ALREADY_IN_PROGRESS',
  'profile mutation is blocked after deletion starts'
);
SELECT extensions.throws_matching(
  $$SELECT * FROM public.create_deck_with_cards(
    'Blocked deck', '', NULL, 'en', 'ru',
    '[{"term":"blocked","definition":"blocked","position":0}]'::jsonb,
    NULL, FALSE, 'a8000000-0000-4000-8000-000000000001'
  )$$,
  'CREATE_DECK_FAILED',
  'atomic deck creation is blocked with its existing safe public error'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.decks WHERE name = 'Blocked deck'),
  0::BIGINT,
  'blocked atomic creation writes no deck'
);
SELECT extensions.throws_matching(
  'SELECT count(*) FROM private.account_deletion_jobs',
  'permission denied',
  'the owner cannot read the private job directly'
);
RESET ROLE;

-- Another user is not globally blocked and cannot select or alter A's job.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT extensions.lives_ok(
  $$UPDATE public.profiles SET display_name = 'Deletion B active' WHERE user_id = auth.uid()$$,
  'unrelated users can still mutate their own data'
);
SELECT extensions.throws_matching(
  'SELECT count(*) FROM private.account_deletion_jobs',
  'permission denied',
  'another user cannot inspect A deletion job'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT set_config(
  'test.account_deletion_lease',
  (
    SELECT lease_token::TEXT
    FROM public.claim_account_deletion_job(
      current_setting('test.account_deletion_job_id')::UUID
    )
    WHERE claimed
  ),
  true
);
SELECT extensions.ok(
  current_setting('test.account_deletion_lease')::UUID IS NOT NULL,
  'the first worker acquires a durable lease'
);
SELECT extensions.ok(
  NOT (
    SELECT claimed
    FROM public.claim_account_deletion_job(
      current_setting('test.account_deletion_job_id')::UUID
    )
  ),
  'a concurrent worker cannot acquire the active job'
);
SELECT extensions.lives_ok(
  format(
    'SELECT public.renew_account_deletion_lease(%L::uuid, %L::uuid)',
    current_setting('test.account_deletion_job_id'),
    current_setting('test.account_deletion_lease')
  ),
  'the active worker can renew its lease'
);
SELECT extensions.lives_ok(
  format(
    'SELECT * FROM public.advance_account_deletion_job(%L::uuid, %L::uuid, %L, %L, 0)',
    current_setting('test.account_deletion_job_id'),
    current_setting('test.account_deletion_lease'),
    'storage_cleanup',
    'auth_deletion'
  ),
  'the job advances from Storage to Auth deletion'
);
SELECT extensions.is(
  public.fail_account_deletion_job(
    current_setting('test.account_deletion_job_id')::UUID,
    current_setting('test.account_deletion_lease')::UUID,
    'AUTH_TEMPORARY',
    TRUE
  ),
  'failed_retryable',
  'an Auth Admin failure leaves a retryable job'
);
RESET ROLE;

SELECT extensions.ok(
  EXISTS (SELECT 1 FROM auth.users WHERE id = 'a1000000-0000-4000-8000-000000000001')
    AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = 'a1000000-0000-4000-8000-000000000001'),
  'retryable Auth failure does not claim that the account was deleted'
);
UPDATE private.account_deletion_jobs
SET next_retry_at = clock_timestamp() - interval '1 second'
WHERE id = current_setting('test.account_deletion_job_id')::UUID;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config(
  'test.account_deletion_lease',
  (
    SELECT lease_token::TEXT
    FROM public.claim_account_deletion_job(
      current_setting('test.account_deletion_job_id')::UUID
    )
    WHERE claimed
  ),
  true
);
RESET ROLE;

-- Simulate a successful trusted Auth Admin deletion. The job intentionally has
-- no FK to auth.users and therefore remains available for the final step.
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DELETE FROM auth.users WHERE id = 'a1000000-0000-4000-8000-000000000001';

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM private.account_deletion_jobs
    WHERE id = current_setting('test.account_deletion_job_id')::UUID
  ),
  'the deletion job survives Auth user deletion'
);

SET LOCAL ROLE service_role;
SELECT extensions.lives_ok(
  format(
    'SELECT * FROM public.advance_account_deletion_job(%L::uuid, %L::uuid, %L, %L, 0)',
    current_setting('test.account_deletion_job_id'),
    current_setting('test.account_deletion_lease'),
    'auth_deletion',
    'database_verification'
  ),
  'the surviving job advances to database verification'
);
RESET ROLE;

-- Create synthetic legacy leftovers with FK triggers disabled. The finalizer
-- must remove them together in one transaction rather than report completion.
SET LOCAL session_replication_role = replica;
INSERT INTO public.profiles (user_id, username, display_name)
VALUES ('a1000000-0000-4000-8000-000000000001', 'legacy_delete_a', 'Legacy residue');
INSERT INTO public.decks (id, user_id, name)
VALUES (
  'a9000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Legacy residual deck'
);
INSERT INTO public.cards (deck_id, user_id, term, definition, position)
VALUES (
  'a9000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'legacy', 'остаток', 0
);
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE service_role;
SELECT extensions.ok(
  (
    SELECT removed_rows >= 3
    FROM public.finalize_account_deletion_database(
      current_setting('test.account_deletion_job_id')::UUID,
      current_setting('test.account_deletion_lease')::UUID
    )
  ),
  'database finalization transaction repairs synthetic legacy leftovers'
);
RESET ROLE;

SELECT extensions.is(
  (
    SELECT status
    FROM private.account_deletion_jobs
    WHERE id = current_setting('test.account_deletion_job_id')::UUID
  ),
  'completed',
  'job is completed only after verification succeeds'
);
SELECT extensions.is(
  (
    SELECT user_id
    FROM private.account_deletion_jobs
    WHERE id = current_setting('test.account_deletion_job_id')::UUID
  ),
  NULL::UUID,
  'transient user ID is cleared from a completed job'
);
SELECT extensions.ok(
  (
    SELECT completed_at IS NOT NULL
      AND retention_until BETWEEN completed_at + interval '29 days'
                              AND completed_at + interval '31 days'
    FROM private.account_deletion_jobs
    WHERE id = current_setting('test.account_deletion_job_id')::UUID
  ),
  'completed job has the documented 30-day retention window'
);
SELECT extensions.is(
  private.account_deletion_residual_count('a1000000-0000-4000-8000-000000000001'),
  0::BIGINT,
  'completed deletion has no Auth, database, private, or avatar residue'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM auth.users WHERE id = 'b1000000-0000-4000-8000-000000000002')
    AND EXISTS (SELECT 1 FROM public.decks WHERE id = 'b2000000-0000-4000-8000-000000000002'),
  'another user and their content are untouched'
);

-- A signed access token can outlive the deleted Auth row. The retained job
-- hash is therefore also a short-lived deletion tombstone.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT extensions.ok(
  public.is_account_deletion_pending(),
  'a previously issued JWT remains blocked after completed Auth deletion'
);
SELECT extensions.is(
  (SELECT job_id::TEXT FROM public.request_account_deletion()),
  current_setting('test.account_deletion_job_id'),
  'a stale retry after completion returns the same completed job'
);
SELECT extensions.throws_matching(
  $$UPDATE public.profiles SET display_name = 'stale token' WHERE user_id = auth.uid()$$,
  'ACCOUNT_DELETION_ALREADY_IN_PROGRESS',
  'a stale JWT cannot recreate or mutate application data'
);
RESET ROLE;

SELECT * FROM extensions.finish();
ROLLBACK;
