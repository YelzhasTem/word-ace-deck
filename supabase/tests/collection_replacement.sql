CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
BEGIN;
SELECT extensions.no_plan();

INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
VALUES
  ('a7100000-0000-4000-8000-000000000001', 'replace-a@example.invalid', '{"username":"replace_sql_a"}', now(), now()),
  ('a7100000-0000-4000-8000-000000000002', 'replace-b@example.invalid', '{"username":"replace_sql_b"}', now(), now());
INSERT INTO public.collections (id, user_id, name) VALUES
  ('a7200000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'Replacement A'),
  ('a7200000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000002', 'Replacement B');
INSERT INTO public.decks (id, user_id, name) VALUES
  ('a7300000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'Old'),
  ('a7300000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000001', 'New first'),
  ('a7300000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000001', 'New last'),
  ('a7300000-0000-4000-8000-000000000004', 'a7100000-0000-4000-8000-000000000002', 'Foreign');
INSERT INTO public.collection_decks (collection_id, deck_id, user_id, position) VALUES
  ('a7200000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 0),
  ('a7200000-0000-4000-8000-000000000002', 'a7300000-0000-4000-8000-000000000004', 'a7100000-0000-4000-8000-000000000002', 0);

CREATE TEMP TABLE original_links AS SELECT * FROM public.collection_decks
WHERE collection_id IN ('a7200000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000002');
GRANT SELECT ON original_links TO authenticated;

SELECT extensions.ok(NOT has_function_privilege('anon',
  'public.replace_collection_decks_atomic(uuid,uuid[])', 'EXECUTE'), 'anon cannot execute replacement');
SELECT extensions.ok(has_function_privilege('authenticated',
  'public.replace_collection_decks_atomic(uuid,uuid[])', 'EXECUTE'), 'authenticated can execute replacement');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
  WHERE p.oid = 'public.replace_collection_decks_atomic(uuid,uuid[])'::regprocedure AND a.grantee = 0
), 'PUBLIC has no execute grant');
SELECT extensions.ok((SELECT NOT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog']
  FROM pg_proc WHERE oid = 'public.replace_collection_decks_atomic(uuid,uuid[])'::regprocedure),
  'invoker RPC retains RLS and fixes search_path');
SELECT extensions.is((SELECT count(*) FROM pg_class WHERE oid IN (
  'public.collections'::regclass, 'public.decks'::regclass, 'public.collection_decks'::regclass
) AND relrowsecurity), 3::bigint, 'RLS stays enabled');
SELECT extensions.is((SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.collection_decks'::regclass
  AND conname IN ('collection_decks_collection_owner_fkey', 'collection_decks_deck_owner_fkey')
  AND convalidated), 2::bigint, 'both validated ownership FKs retained');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT extensions.throws_ok($$SELECT public.replace_collection_decks_atomic(
  'a7200000-0000-4000-8000-000000000001', ARRAY[]::uuid[])$$,
  'P0001', 'UNAUTHENTICATED', 'role alone is not authentication');
SELECT set_config('request.jwt.claim.sub', 'a7100000-0000-4000-8000-000000000001', true);

SELECT extensions.throws_ok(format('SELECT public.replace_collection_decks_atomic(%L, %s)',
  'a7200000-0000-4000-8000-000000000001', input), 'P0001', error_code, label)
FROM (VALUES
  ('NULL::uuid[]', 'INVALID_DECK_IDS', 'reject null array'),
  ('ARRAY[NULL]::uuid[]', 'INVALID_DECK_IDS', 'reject null element'),
  ($$ARRAY[['a7300000-0000-4000-8000-000000000002','a7300000-0000-4000-8000-000000000003']]::uuid[]$$,
    'INVALID_DECK_IDS', 'reject multidimensional arrays'),
  ($$ARRAY['a7300000-0000-4000-8000-000000000002','a7300000-0000-4000-8000-000000000002']::uuid[]$$,
    'DUPLICATE_DECK_IDS', 'reject duplicate IDs'),
  ($$ARRAY['a7300000-0000-4000-8000-000000000002','a7300000-0000-4000-8000-000000000004']::uuid[]$$,
    'DECK_NOT_AVAILABLE', 'reject foreign deck'),
  ($$ARRAY['a7300000-0000-4000-8000-000000000002','a7300000-0000-4000-8000-000000000099']::uuid[]$$,
    'DECK_NOT_AVAILABLE', 'reject missing last deck'),
  ($$array_fill('a7300000-0000-4000-8000-000000000002'::uuid, ARRAY[501])$$,
    'TOO_MANY_DECKS', 'reject more than existing 500 limit')
) AS cases(input, error_code, label);

SELECT extensions.results_eq(
  $$SELECT * FROM public.collection_decks WHERE collection_id = 'a7200000-0000-4000-8000-000000000001' ORDER BY id$$,
  $$SELECT * FROM original_links WHERE collection_id = 'a7200000-0000-4000-8000-000000000001' ORDER BY id$$,
  'all invalid replacements preserve original rows, IDs, positions and timestamps');

SELECT extensions.throws_ok($$SELECT public.replace_collection_decks_atomic(
  'a7200000-0000-4000-8000-000000000002', ARRAY[]::uuid[])$$,
  'P0001', 'COLLECTION_NOT_AVAILABLE', 'cannot clear another user collection');
SELECT extensions.throws_ok($$SELECT public.replace_collection_decks_atomic(
  'a7200000-0000-4000-8000-000000000099', ARRAY[]::uuid[])$$,
  'P0001', 'COLLECTION_NOT_AVAILABLE', 'missing and foreign collection share safe error');

RESET ROLE;
CREATE FUNCTION pg_temp.fail_last_replacement_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.collection_id = 'a7200000-0000-4000-8000-000000000001' AND NEW.position = 1 THEN
    RAISE EXCEPTION 'synthetic internal constraint details' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_fail_last_replacement_link BEFORE INSERT ON public.collection_decks
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_last_replacement_link();
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.replace_collection_decks_atomic(
  'a7200000-0000-4000-8000-000000000001',
  ARRAY['a7300000-0000-4000-8000-000000000002','a7300000-0000-4000-8000-000000000003']::uuid[])$$,
  'P0001', 'REPLACE_COLLECTION_DECKS_FAILED', 'late insert failure is sanitized and rolls back deletion');
SELECT extensions.results_eq(
  $$SELECT * FROM public.collection_decks WHERE collection_id = 'a7200000-0000-4000-8000-000000000001' ORDER BY id$$,
  $$SELECT * FROM original_links WHERE collection_id = 'a7200000-0000-4000-8000-000000000001' ORDER BY id$$,
  'original membership survives failure after first replacement insert');
RESET ROLE;
DROP TRIGGER test_fail_last_replacement_link ON public.collection_decks;
SET LOCAL ROLE authenticated;

SELECT extensions.is(public.replace_collection_decks_atomic('a7200000-0000-4000-8000-000000000001',
  '[5:6]={a7300000-0000-4000-8000-000000000003,a7300000-0000-4000-8000-000000000002}'::uuid[]),
  2, 'nonstandard array lower bound still generates zero-based positions');
SELECT extensions.results_eq(
  $$SELECT deck_id, position FROM public.collection_decks WHERE collection_id = 'a7200000-0000-4000-8000-000000000001' ORDER BY position$$,
  $$VALUES ('a7300000-0000-4000-8000-000000000003'::uuid,0), ('a7300000-0000-4000-8000-000000000002'::uuid,1)$$,
  'exact requested set and order');
SELECT extensions.is(public.replace_collection_decks_atomic('a7200000-0000-4000-8000-000000000001', ARRAY[]::uuid[]),
  0, 'empty array atomically clears');
SELECT extensions.is((SELECT count(*) FROM public.collection_decks
  WHERE collection_id = 'a7200000-0000-4000-8000-000000000001'), 0::bigint, 'no links after clear');
RESET ROLE;
SELECT extensions.results_eq(
  $$SELECT * FROM public.collection_decks WHERE collection_id = 'a7200000-0000-4000-8000-000000000002' ORDER BY id$$,
  $$SELECT * FROM original_links WHERE collection_id = 'a7200000-0000-4000-8000-000000000002' ORDER BY id$$,
  'other user membership unchanged throughout');
SELECT * FROM extensions.finish();
ROLLBACK;
