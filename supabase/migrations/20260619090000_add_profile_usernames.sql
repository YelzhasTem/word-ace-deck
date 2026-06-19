ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

CREATE OR REPLACE FUNCTION public.normalize_username(_value TEXT, _fallback TEXT DEFAULT 'user')
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  base TEXT;
BEGIN
  base := lower(
    regexp_replace(
      COALESCE(NULLIF(trim(_value), ''), NULLIF(trim(_fallback), ''), 'user'),
      '[^a-zA-Z0-9_]+',
      '_',
      'g'
    )
  );
  base := regexp_replace(base, '_+', '_', 'g');
  base := trim(both '_' from base);

  IF char_length(base) < 3 THEN
    base := 'user_' || substr(md5(COALESCE(_value, '') || COALESCE(_fallback, '')), 1, 6);
  END IF;

  RETURN left(base, 24);
END;
$$;

CREATE OR REPLACE FUNCTION public.make_unique_username(_base TEXT, _user_id UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized TEXT := public.normalize_username(_base, 'user');
  candidate TEXT;
  suffix INTEGER := 0;
  base_length INTEGER;
BEGIN
  LOOP
    IF suffix = 0 THEN
      candidate := normalized;
    ELSE
      base_length := greatest(1, 24 - char_length('_' || suffix::TEXT));
      candidate := left(normalized, base_length) || '_' || suffix::TEXT;
    END IF;

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE lower(username) = lower(candidate)
        AND (_user_id IS NULL OR user_id <> _user_id)
    );

    suffix := suffix + 1;
  END LOOP;

  RETURN candidate;
END;
$$;

UPDATE public.profiles
SET username = public.make_unique_username(
  COALESCE(username, display_name, split_part(email, '@', 1), 'user'),
  user_id
)
WHERE username IS NULL OR username = '';

ALTER TABLE public.profiles
  ALTER COLUMN username SET NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format
  CHECK (username ~ '^[a-z0-9_]{3,24}$');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key
  ON public.profiles (username);

CREATE OR REPLACE FUNCTION public.is_username_available(_username TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _username ~ '^[a-z0-9_]{3,24}$'
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE username = _username
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO anon, authenticated;

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
        NEW.raw_user_meta_data->>'preferred_username',
        NEW.raw_user_meta_data->>'user_name',
        NEW.raw_user_meta_data->>'display_name',
        NEW.raw_user_meta_data->>'full_name',
        split_part(NEW.email, '@', 1),
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
