BEGIN;

-- Security hardening from the 2026-09-30 audit. Nothing here changes what a
-- normal user sees; it closes ways to read or write other people's data
-- through the public API.

-- 1. Block checks answer only for the caller ------------------------------
--
-- is_block_between(a, b) was callable by anyone, even signed out (Supabase's
-- default privileges grant anon EXECUTE by name, which REVOKE ... FROM PUBLIC
-- does not remove), so anyone could learn who blocked whom. The friend
-- request policy always passes the caller as one side, so it keeps working.

CREATE OR REPLACE FUNCTION public.is_block_between(_user_a UUID, _user_b UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IN (_user_a, _user_b)
    AND EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_id = _user_a AND b.blocked_id = _user_b)
         OR (b.blocker_id = _user_b AND b.blocked_id = _user_a)
    );
$$;

REVOKE ALL ON FUNCTION public.is_block_between(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_block_between(UUID, UUID) TO authenticated;

-- 2. A blocked user's pending request can no longer be accepted -----------

DROP POLICY IF EXISTS "Users accept incoming friend requests" ON public.friendships;
CREATE POLICY "Users accept incoming friend requests"
  ON public.friendships FOR UPDATE TO authenticated
  USING (auth.uid() = addressee_id)
  WITH CHECK (
    auth.uid() = addressee_id
    AND status = 'accepted'
    AND NOT public.is_block_between(requester_id, addressee_id)
  );

-- 3. Friend search treats % and _ as plain characters and skips blocks ----
--
-- The query went into ILIKE unescaped, so "__" matched every user and the
-- whole user list could be paged through. Blocked users (either direction)
-- were also returned.

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
      lower(trim(COALESCE(_query, ''))) AS raw_q,
      replace(replace(replace(lower(trim(COALESCE(_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') AS q,
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
    AND char_length(input.raw_q) >= 2
    AND (
      p.username ILIKE '%' || input.q || '%'
      OR COALESCE(p.display_name, '') ILIKE '%' || input.q || '%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p.user_id)
         OR (b.blocker_id = p.user_id AND b.blocked_id = auth.uid())
    )
  ORDER BY
    CASE WHEN p.username ILIKE input.q || '%' THEN 0 ELSE 1 END,
    p.username
  LIMIT (SELECT lim FROM input);
$$;

REVOKE ALL ON FUNCTION public.search_friend_profiles(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_friend_profiles(TEXT, INTEGER) TO authenticated;

-- 4. Avatar folder listing ------------------------------------------------
--
-- Anyone could list the avatars bucket and collect every user's id. The
-- bucket is public, so avatar images still load by URL without any SELECT
-- policy; owners keep read access to their own folder for upserts.

DROP POLICY IF EXISTS "Avatar images are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own avatar objects" ON storage.objects;
CREATE POLICY "Users can read their own avatar objects"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. Avatar URLs must be web links ---------------------------------------
--
-- avatar_url is shown as an image to other users. Only http(s) links of a
-- sane length are accepted from now on (NOT VALID leaves existing rows alone).

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_url_web_link;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_url_web_link
  CHECK (
    avatar_url IS NULL
    OR (avatar_url ~* '^https?://[^[:space:]]+$' AND char_length(avatar_url) <= 2048)
  ) NOT VALID;

-- 6. Leftover table privileges -------------------------------------------
--
-- Default privileges left anon/authenticated with TRUNCATE, TRIGGER and
-- REFERENCES (TRUNCATE ignores RLS) and user_roles with write grants that
-- only RLS was blocking. The app only ever reads its own role.

REVOKE TRUNCATE, TRIGGER, REFERENCES
  ON public.user_roles, public.friendships, public.card_associations,
     public.collection_decks, public.deck_learning_settings
  FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated;
REVOKE ALL ON public.user_roles FROM anon;

COMMIT;
