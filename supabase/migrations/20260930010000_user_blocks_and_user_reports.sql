BEGIN;

-- App Store Guideline 1.2 (user-generated content): users must be able to
-- block abusive users and report them, and the developer must act on reports.
--
-- 1. user_blocks: a user hides everything published by the users they block.
-- 2. user_reports: a user reports another user (creator profile, username,
--    avatar); admins review the queue next to deck and collection reports.
-- 3. The public deck and collection read policies skip owners the caller has
--    blocked, so every marketplace query (search, home, creator page, deck
--    page) hides them without application changes.
-- 4. Neither side of a block can send the other a friend request.

-- 1. Blocks ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks (blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_blocks FROM anon, authenticated;
GRANT SELECT, DELETE ON public.user_blocks TO authenticated;
GRANT INSERT (blocker_id, blocked_id) ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;

DROP POLICY IF EXISTS "Users view own blocks" ON public.user_blocks;
CREATE POLICY "Users view own blocks" ON public.user_blocks
  FOR SELECT TO authenticated USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Users block others" ON public.user_blocks;
CREATE POLICY "Users block others" ON public.user_blocks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = blocker_id AND blocked_id <> blocker_id);

DROP POLICY IF EXISTS "Users unblock others" ON public.user_blocks;
CREATE POLICY "Users unblock others" ON public.user_blocks
  FOR DELETE TO authenticated USING (auth.uid() = blocker_id);

CREATE OR REPLACE FUNCTION public.is_blocked_by_me(_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND _owner_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE b.blocker_id = auth.uid() AND b.blocked_id = _owner_id
    );
$$;

COMMENT ON FUNCTION public.is_blocked_by_me(UUID) IS
  'True when the caller (auth.uid()) has blocked the given user. Used by marketplace read policies.';

REVOKE ALL ON FUNCTION public.is_blocked_by_me(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_blocked_by_me(UUID) TO anon, authenticated;

-- 2. User reports ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  status public.report_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT user_reports_not_self CHECK (reported_user_id <> reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_user_reports_status ON public.user_reports (status, created_at DESC);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_reports FROM anon, authenticated;
GRANT SELECT ON public.user_reports TO authenticated;
GRANT INSERT (reported_user_id, reporter_id, reason) ON public.user_reports TO authenticated;
GRANT UPDATE (status, reviewed_at) ON public.user_reports TO authenticated;
GRANT ALL ON public.user_reports TO service_role;

DROP POLICY IF EXISTS "Users report users" ON public.user_reports;
CREATE POLICY "Users report users" ON public.user_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id AND reported_user_id <> reporter_id);

DROP POLICY IF EXISTS "Admins view user reports" ON public.user_reports;
CREATE POLICY "Admins view user reports" ON public.user_reports
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update user reports" ON public.user_reports;
CREATE POLICY "Admins update user reports" ON public.user_reports
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Hide blocked owners from marketplace reads ----------------------------

DROP POLICY IF EXISTS "Public can view public marketplace decks" ON public.decks;
CREATE POLICY "Public can view public marketplace decks"
  ON public.decks FOR SELECT TO anon, authenticated
  USING (visibility = 'public' AND hidden_at IS NULL AND NOT public.is_blocked_by_me(user_id));

DROP POLICY IF EXISTS "Authenticated can view unlisted deck links" ON public.decks;
CREATE POLICY "Authenticated can view unlisted deck links"
  ON public.decks FOR SELECT TO authenticated
  USING (
    visibility IN ('public', 'unlisted')
    AND hidden_at IS NULL
    AND NOT public.is_blocked_by_me(user_id)
  );

DROP POLICY IF EXISTS "Public can view public marketplace collections" ON public.collections;
CREATE POLICY "Public can view public marketplace collections"
  ON public.collections FOR SELECT TO anon, authenticated
  USING (visibility = 'public' AND hidden_at IS NULL AND NOT public.is_blocked_by_me(user_id));

DROP POLICY IF EXISTS "Authenticated can view unlisted collection links" ON public.collections;
CREATE POLICY "Authenticated can view unlisted collection links"
  ON public.collections FOR SELECT TO authenticated
  USING (
    visibility IN ('public', 'unlisted')
    AND hidden_at IS NULL
    AND NOT public.is_blocked_by_me(user_id)
  );

-- 4. No friend requests between users when either has blocked the other ----

CREATE OR REPLACE FUNCTION public.is_block_between(_user_a UUID, _user_b UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = _user_a AND b.blocked_id = _user_b)
       OR (b.blocker_id = _user_b AND b.blocked_id = _user_a)
  );
$$;

REVOKE ALL ON FUNCTION public.is_block_between(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_block_between(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "Users send friend requests" ON public.friendships;
CREATE POLICY "Users send friend requests"
  ON public.friendships FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = requester_id
    AND requester_id <> addressee_id
    AND status = 'pending'
    AND NOT public.is_block_between(requester_id, addressee_id)
  );

COMMIT;
