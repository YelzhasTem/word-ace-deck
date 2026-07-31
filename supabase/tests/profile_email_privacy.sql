CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;

SELECT extensions.plan(1);

-- Synthetic fixtures only. The transaction is always rolled back.
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'security-a@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"sec_a_7291c3","display_name":"Security User A"}'::jsonb,
    now(),
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'security-b@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"sec_b_7291c3","display_name":"Security User B"}'::jsonb,
    now(),
    now()
  );

INSERT INTO public.decks (
  id,
  user_id,
  name,
  visibility,
  target_language,
  definition_language,
  published_at
)
VALUES (
  '30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000002',
  'Synthetic security test deck',
  'public',
  'en',
  'ru',
  now()
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

DO $$
DECLARE
  public_profile JSONB;
BEGIN
  SELECT to_jsonb(p)
  INTO public_profile
  FROM public.profiles p
  WHERE p.user_id = '20000000-0000-4000-8000-000000000002';

  IF public_profile IS NULL THEN
    RAISE EXCEPTION 'anon could not read the synthetic public creator profile';
  END IF;

  IF public_profile ? 'email' THEN
    RAISE EXCEPTION 'anon received an email field from profiles';
  END IF;

  IF public_profile - ARRAY[
    'id',
    'user_id',
    'username',
    'display_name',
    'avatar_url',
    'created_at',
    'updated_at'
  ] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'anon received an unexpected profiles field';
  END IF;

  BEGIN
    EXECUTE 'SELECT email FROM public.profiles LIMIT 1';
    RAISE EXCEPTION 'anon explicitly selected profiles.email';
  EXCEPTION
    WHEN undefined_column OR insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM 1 FROM public.profile_private;
    RAISE EXCEPTION 'anon has access to profile_private';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

DO $$
DECLARE
  affected_rows INTEGER;
  public_profile JSONB;
  friend_result JSONB;
BEGIN
  SELECT to_jsonb(p)
  INTO public_profile
  FROM public.profiles p
  WHERE p.user_id = '20000000-0000-4000-8000-000000000002';

  IF public_profile IS NULL OR public_profile ? 'email' THEN
    RAISE EXCEPTION 'user A did not receive a safe public profile for user B';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profile_private
    WHERE user_id = '20000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'user A can read user B private data';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profile_private
    WHERE user_id = '10000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'user A cannot read own private data';
  END IF;

  UPDATE public.profiles
  SET display_name = 'Forbidden update'
  WHERE user_id = '20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'user A updated user B profile';
  END IF;

  UPDATE public.profile_private
  SET native_language = native_language
  WHERE user_id = '10000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'user A cannot update own private data';
  END IF;

  UPDATE public.profile_private
  SET native_language = native_language
  WHERE user_id = '20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'user A updated user B private data';
  END IF;

  BEGIN
    EXECUTE 'SELECT email FROM public.profiles LIMIT 1';
    RAISE EXCEPTION 'user A explicitly selected profiles.email';
  EXCEPTION
    WHEN undefined_column OR insufficient_privilege THEN NULL;
  END;

  BEGIN
    EXECUTE $sql$
      UPDATE public.profiles
      SET created_at = created_at
      WHERE user_id = '10000000-0000-4000-8000-000000000001'
    $sql$;
    RAISE EXCEPTION 'user A updated a system-owned profile column';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  SELECT to_jsonb(r)
  INTO friend_result
  FROM public.search_friend_profiles('sec_b', 12) r
  WHERE r.user_id = '20000000-0000-4000-8000-000000000002';

  IF friend_result IS NULL OR friend_result ? 'email' THEN
    RAISE EXCEPTION 'friend search did not return a safe public identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.decks
    WHERE id = '30000000-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'user A cannot read user B public marketplace deck';
  END IF;
END;
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

DO $$
DECLARE
  affected_rows INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profile_private
    WHERE user_id = '10000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'user B can read user A private data';
  END IF;

  UPDATE public.profiles
  SET display_name = 'Forbidden update'
  WHERE user_id = '10000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'user B updated user A profile';
  END IF;

  UPDATE public.profile_private
  SET target_language = target_language
  WHERE user_id = '20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'user B cannot update own private data';
  END IF;
END;
$$;

RESET ROLE;

SELECT extensions.pass('profile privacy checks completed');
SELECT * FROM extensions.finish();

ROLLBACK;
