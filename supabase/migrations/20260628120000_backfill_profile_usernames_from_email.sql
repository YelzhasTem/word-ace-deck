-- Existing accounts created before username signup should use email-derived usernames.
-- The helper functions come from 20260619090000_add_profile_usernames.sql.

DROP TABLE IF EXISTS email_username_backfill_targets;

CREATE TEMP TABLE email_username_backfill_targets AS
SELECT
  p.id,
  p.user_id,
  p.email
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.user_id
WHERE p.email IS NOT NULL
  AND trim(p.email) <> ''
  AND position('@' IN p.email) > 1
  AND p.created_at < TIMESTAMPTZ '2026-06-19 12:19:16+00'
  AND NULLIF(trim(u.raw_user_meta_data->>'username'), '') IS NULL;

DO $$
DECLARE
  target RECORD;
  temporary_username TEXT;
  email_username TEXT;
BEGIN
  -- Move targeted rows to unique temporary usernames first so old generated
  -- names do not block another user from getting their email-based name.
  FOR target IN
    SELECT *
    FROM email_username_backfill_targets
    ORDER BY user_id
  LOOP
    temporary_username := public.make_unique_username(
      'm_' || substr(replace(target.user_id::TEXT, '-', ''), 1, 22),
      target.user_id
    );

    UPDATE public.profiles
    SET username = temporary_username
    WHERE id = target.id;
  END LOOP;

  FOR target IN
    SELECT *
    FROM email_username_backfill_targets
    ORDER BY lower(email), user_id
  LOOP
    email_username := public.make_unique_username(split_part(target.email, '@', 1), target.user_id);

    UPDATE public.profiles
    SET username = email_username
    WHERE id = target.id;
  END LOOP;
END;
$$;

DROP TABLE IF EXISTS email_username_backfill_targets;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_requested_username TEXT := NULLIF(trim(NEW.raw_user_meta_data->>'username'), '');
  requested_username TEXT;
  profile_username TEXT;
BEGIN
  IF raw_requested_username IS NOT NULL THEN
    requested_username := public.normalize_username(raw_requested_username, '');
    IF EXISTS (SELECT 1 FROM public.profiles WHERE username = requested_username) THEN
      RAISE EXCEPTION 'Username is already taken';
    END IF;
    profile_username := requested_username;
  ELSE
    profile_username := public.make_unique_username(
      COALESCE(
        split_part(NEW.email, '@', 1),
        NEW.raw_user_meta_data->>'preferred_username',
        NEW.raw_user_meta_data->>'user_name',
        NEW.raw_user_meta_data->>'display_name',
        NEW.raw_user_meta_data->>'full_name',
        'user'
      ),
      NEW.id
    );
  END IF;

  INSERT INTO public.profiles (user_id, email, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    profile_username,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', profile_username),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;
