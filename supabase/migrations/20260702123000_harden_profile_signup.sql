-- Prevent profile creation from turning signup into a generic Auth 500.
-- The UI checks username availability first; this trigger still needs to be
-- defensive for races, stale clients, and existing deployments.

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
    profile_username := public.make_unique_username(requested_username, NEW.id);
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
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    email = EXCLUDED.email,
    display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
    avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url),
    updated_at = now();

  RETURN NEW;
END;
$$;
