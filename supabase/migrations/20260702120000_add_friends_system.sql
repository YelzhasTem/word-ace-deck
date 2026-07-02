CREATE TABLE IF NOT EXISTS public.friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT friendships_no_self CHECK (requester_id <> addressee_id),
  CONSTRAINT friendships_status_check CHECK (status IN ('pending', 'accepted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS friendships_unique_pair
  ON public.friendships (
    (CASE WHEN requester_id < addressee_id THEN requester_id ELSE addressee_id END),
    (CASE WHEN requester_id < addressee_id THEN addressee_id ELSE requester_id END)
  );

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON public.friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_updated_at ON public.friendships(updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO authenticated;
GRANT ALL ON public.friendships TO service_role;

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own friendships" ON public.friendships;
CREATE POLICY "Users view own friendships"
  ON public.friendships FOR SELECT TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

DROP POLICY IF EXISTS "Users send friend requests" ON public.friendships;
CREATE POLICY "Users send friend requests"
  ON public.friendships FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = requester_id
    AND requester_id <> addressee_id
    AND status = 'pending'
  );

DROP POLICY IF EXISTS "Users accept incoming friend requests" ON public.friendships;
CREATE POLICY "Users accept incoming friend requests"
  ON public.friendships FOR UPDATE TO authenticated
  USING (auth.uid() = addressee_id)
  WITH CHECK (auth.uid() = addressee_id AND status = 'accepted');

DROP POLICY IF EXISTS "Users delete own friendships" ON public.friendships;
CREATE POLICY "Users delete own friendships"
  ON public.friendships FOR DELETE TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

DROP TRIGGER IF EXISTS update_friendships_updated_at ON public.friendships;
CREATE TRIGGER update_friendships_updated_at
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_friendship_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.requester_id <> OLD.requester_id OR NEW.addressee_id <> OLD.addressee_id THEN
    RAISE EXCEPTION 'Friendship users cannot be changed';
  END IF;

  IF OLD.status <> NEW.status AND NOT (OLD.status = 'pending' AND NEW.status = 'accepted') THEN
    RAISE EXCEPTION 'Invalid friendship status change';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_friendship_update ON public.friendships;
CREATE TRIGGER validate_friendship_update
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.validate_friendship_update();

CREATE OR REPLACE FUNCTION public.list_friendships()
RETURNS TABLE (
  friendship_id UUID,
  status TEXT,
  relationship TEXT,
  user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.id AS friendship_id,
    f.status,
    CASE
      WHEN f.status = 'accepted' THEN 'friends'
      WHEN f.requester_id = auth.uid() THEN 'outgoing'
      ELSE 'incoming'
    END AS relationship,
    p.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    f.created_at,
    f.updated_at
  FROM public.friendships f
  JOIN public.profiles p
    ON p.user_id = CASE
      WHEN f.requester_id = auth.uid() THEN f.addressee_id
      ELSE f.requester_id
    END
  WHERE auth.uid() IS NOT NULL
    AND (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())
  ORDER BY
    CASE
      WHEN f.status = 'pending' AND f.addressee_id = auth.uid() THEN 0
      WHEN f.status = 'pending' THEN 1
      ELSE 2
    END,
    f.updated_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.search_friend_profiles(_query TEXT, _limit INTEGER DEFAULT 12)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  friendship_id UUID,
  status TEXT,
  relationship TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH input AS (
    SELECT
      lower(trim(COALESCE(_query, ''))) AS q,
      LEAST(GREATEST(COALESCE(_limit, 12), 1), 20) AS lim
  )
  SELECT
    p.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    f.id AS friendship_id,
    f.status,
    CASE
      WHEN f.id IS NULL THEN 'none'
      WHEN f.status = 'accepted' THEN 'friends'
      WHEN f.requester_id = auth.uid() THEN 'outgoing'
      ELSE 'incoming'
    END AS relationship
  FROM input
  JOIN public.profiles p ON true
  LEFT JOIN public.friendships f
    ON (
      (f.requester_id = auth.uid() AND f.addressee_id = p.user_id)
      OR (f.requester_id = p.user_id AND f.addressee_id = auth.uid())
    )
  WHERE auth.uid() IS NOT NULL
    AND p.user_id <> auth.uid()
    AND char_length(input.q) >= 2
    AND (
      p.username ILIKE input.q || '%'
      OR p.username ILIKE '%' || input.q || '%'
      OR COALESCE(p.display_name, '') ILIKE '%' || input.q || '%'
    )
  ORDER BY
    CASE WHEN p.username ILIKE input.q || '%' THEN 0 ELSE 1 END,
    p.username
  LIMIT (SELECT lim FROM input);
$$;

GRANT EXECUTE ON FUNCTION public.list_friendships() TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_friend_profiles(TEXT, INTEGER) TO authenticated;
