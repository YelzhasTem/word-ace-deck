BEGIN;

-- public.profiles is a public identity directory. Private account state belongs
-- in an owner-only table, while email remains canonical in auth.users only.
CREATE TABLE IF NOT EXISTS public.profile_private (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  native_language TEXT NOT NULL DEFAULT 'ru',
  target_language TEXT NOT NULL DEFAULT 'en',
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_active_date DATE,
  total_xp INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_private ENABLE ROW LEVEL SECURITY;

-- Refuse to discard the only copy of an email from an orphaned profile. A
-- normal profile has a matching auth.users row, where the canonical email stays.
DO $$
DECLARE
  orphan_count BIGINT := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'email'
  ) THEN
    EXECUTE $query$
      SELECT count(*)
      FROM public.profiles p
      LEFT JOIN auth.users u ON u.id = p.user_id
      WHERE p.email IS NOT NULL
        AND u.id IS NULL
    $query$
    INTO orphan_count;

    IF orphan_count > 0 THEN
      RAISE EXCEPTION
        'Refusing to remove profiles.email: % profile rows have no matching auth.users row',
        orphan_count;
    END IF;
  END IF;
END;
$$;

-- Preserve legacy account settings before removing them from the public row.
-- ON CONFLICT keeps an already-created private row authoritative.
DO $$
BEGIN
  IF (
    SELECT count(*) = 5
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name IN (
        'native_language',
        'target_language',
        'streak_days',
        'last_active_date',
        'total_xp'
      )
  ) THEN
    EXECUTE $migration$
      INSERT INTO public.profile_private (
        user_id,
        native_language,
        target_language,
        streak_days,
        last_active_date,
        total_xp,
        created_at,
        updated_at
      )
      SELECT
        p.user_id,
        COALESCE(p.native_language, 'ru'),
        COALESCE(p.target_language, 'en'),
        COALESCE(p.streak_days, 0),
        p.last_active_date,
        COALESCE(p.total_xp, 0),
        p.created_at,
        p.updated_at
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.user_id
      ON CONFLICT (user_id) DO NOTHING
    $migration$;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS update_profile_private_updated_at ON public.profile_private;
CREATE TRIGGER update_profile_private_updated_at
  BEFORE UPDATE ON public.profile_private
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Signup creates a public identity and an empty private settings row. The email
-- is used by Supabase Auth only and is never copied into the public schema.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  raw_requested_username TEXT := NULLIF(trim(NEW.raw_user_meta_data->>'username'), '');
  requested_username TEXT;
  profile_username TEXT;
BEGIN
  IF raw_requested_username IS NOT NULL THEN
    requested_username := public.normalize_username(raw_requested_username, '');
    profile_username := public.make_unique_username(requested_username, NEW.id);
  ELSE
    profile_username := public.make_unique_username(
      COALESCE(
        NEW.raw_user_meta_data->>'preferred_username',
        NEW.raw_user_meta_data->>'user_name',
        NEW.raw_user_meta_data->>'display_name',
        NEW.raw_user_meta_data->>'full_name',
        'user_' || substr(replace(NEW.id::TEXT, '-', ''), 1, 12)
      ),
      NEW.id
    );
  END IF;

  INSERT INTO public.profiles (user_id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    profile_username,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      profile_username
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
    avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url),
    updated_at = now();

  INSERT INTO public.profile_private (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- PostgreSQL tracks view dependencies on a column. PL/pgSQL bodies are checked
-- separately because their column references are resolved at execution time.
DO $$
DECLARE
  email_attnum SMALLINT;
  dependent_objects TEXT;
  dependent_routines TEXT;
BEGIN
  SELECT attnum
  INTO email_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.profiles'::regclass
    AND attname = 'email'
    AND NOT attisdropped;

  IF email_attnum IS NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(
    DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid),
    ', '
  )
  INTO dependent_objects
  FROM pg_depend d
  WHERE d.refobjid = 'public.profiles'::regclass
    AND d.refobjsubid = email_attnum
    AND d.deptype <> 'i';

  IF dependent_objects IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to remove profiles.email; dependent database objects remain: %',
      dependent_objects;
  END IF;

  SELECT string_agg(format('%I.%I', n.nspname, p.proname), ', ')
  INTO dependent_routines
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND pg_get_functiondef(p.oid) ILIKE '%profiles%'
    AND pg_get_functiondef(p.oid) ILIKE '%email%';

  IF dependent_routines IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to remove profiles.email; routine definitions still reference it: %',
      dependent_routines;
  END IF;
END;
$$;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS native_language,
  DROP COLUMN IF EXISTS target_language,
  DROP COLUMN IF EXISTS streak_days,
  DROP COLUMN IF EXISTS last_active_date,
  DROP COLUMN IF EXISTS total_xp;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies should not depend on the caller having direct privileges on the
-- marketplace tables. This helper reveals only whether a profile is public.
CREATE OR REPLACE FUNCTION public.is_public_profile(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.decks d
      WHERE d.user_id = _user_id
        AND d.visibility = 'public'
        AND d.hidden_at IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM public.collections c
      WHERE c.user_id = _user_id
        AND c.visibility = 'public'
        AND c.hidden_at IS NULL
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_public_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_public_profile(UUID) TO anon, authenticated;

-- Replace every prior profiles policy so production cannot retain an old broad
-- SELECT policy created outside the current migration history.
DO $$
DECLARE
  policy_name TEXT;
BEGIN
  FOR policy_name IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', policy_name);
  END LOOP;
END;
$$;

CREATE POLICY "Users read their own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Public reads marketplace creator profiles"
  ON public.profiles FOR SELECT TO anon, authenticated
  USING (public.is_public_profile(user_id));

CREATE POLICY "Users insert their own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Table RLS limits rows; column grants prevent clients from changing identity
-- keys, timestamps, and other system-owned fields in an allowed row.
REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  user_id,
  username,
  display_name,
  avatar_url,
  created_at,
  updated_at
) ON public.profiles TO anon, authenticated;
GRANT INSERT (
  user_id,
  username,
  display_name,
  avatar_url
) ON public.profiles TO authenticated;
GRANT UPDATE (
  username,
  display_name,
  avatar_url
) ON public.profiles TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.profiles TO service_role;

-- Private account settings are owner-only. anon receives no table privilege;
-- authenticated receives DML privileges, with every operation constrained by RLS.
DO $$
DECLARE
  policy_name TEXT;
BEGIN
  FOR policy_name IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profile_private'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profile_private', policy_name);
  END LOOP;
END;
$$;

CREATE POLICY "Users read their own private profile data"
  ON public.profile_private FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users insert their own private profile data"
  ON public.profile_private FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users update their own private profile data"
  ON public.profile_private FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users delete their own private profile data"
  ON public.profile_private FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL PRIVILEGES ON TABLE public.profile_private FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profile_private TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.profile_private TO service_role;

-- Friend RPCs intentionally expose only public identity fields. Remove the
-- default PUBLIC execute privilege from SECURITY DEFINER functions.
REVOKE EXECUTE ON FUNCTION public.list_friendships() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_friend_profiles(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_friendships() TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_friend_profiles(TEXT, INTEGER) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_username_available(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.make_unique_username(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.profiles IS
  'Public Memora identities only. Email is stored exclusively in Supabase Auth.';
COMMENT ON TABLE public.profile_private IS
  'Owner-only account settings protected by RLS; never contains email.';

COMMIT;
