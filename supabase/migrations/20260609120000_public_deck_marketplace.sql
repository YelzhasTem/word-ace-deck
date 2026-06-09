CREATE TYPE public.deck_visibility AS ENUM ('private', 'unlisted', 'public');
CREATE TYPE public.deck_category AS ENUM (
  'General English',
  'Travel',
  'Business',
  'Academic',
  'IELTS',
  'TOEFL',
  'Technology',
  'Programming',
  'Medical',
  'Custom'
);
CREATE TYPE public.report_status AS ENUM ('pending', 'reviewed', 'dismissed', 'hidden');

ALTER TABLE public.decks
  ADD COLUMN visibility public.deck_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN category public.deck_category NOT NULL DEFAULT 'General English',
  ADD COLUMN keywords TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN source_deck_id UUID REFERENCES public.decks(id) ON DELETE SET NULL,
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN learner_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN rating_sum INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN copy_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN hidden_at TIMESTAMPTZ;

CREATE TABLE public.deck_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deck_id, user_id)
);

CREATE TABLE public.deck_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deck_id, user_id)
);

CREATE TABLE public.deck_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deck_id, user_id)
);

CREATE TABLE public.deck_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status public.report_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE public.creator_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL,
  follower_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (creator_id, follower_id),
  CHECK (creator_id <> follower_id)
);

GRANT SELECT, INSERT, DELETE ON public.deck_likes TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.deck_saves TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.deck_ratings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.deck_reports TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.creator_follows TO authenticated;
GRANT SELECT ON public.deck_likes, public.deck_saves, public.deck_ratings, public.deck_reports, public.creator_follows TO anon;
GRANT ALL ON public.deck_likes, public.deck_saves, public.deck_ratings, public.deck_reports, public.creator_follows TO service_role;

ALTER TABLE public.deck_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deck_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deck_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deck_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view public marketplace decks"
  ON public.decks FOR SELECT TO anon, authenticated
  USING (visibility = 'public' AND hidden_at IS NULL);

CREATE POLICY "Authenticated can view unlisted deck links"
  ON public.decks FOR SELECT TO authenticated
  USING (visibility IN ('public', 'unlisted') AND hidden_at IS NULL);

CREATE POLICY "Public can view public marketplace cards"
  ON public.cards FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.decks d
      WHERE d.id = cards.deck_id
        AND d.visibility = 'public'
        AND d.hidden_at IS NULL
    )
  );

CREATE POLICY "Authenticated can view unlisted deck cards"
  ON public.cards FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.decks d
      WHERE d.id = cards.deck_id
        AND d.visibility IN ('public', 'unlisted')
        AND d.hidden_at IS NULL
    )
  );

CREATE POLICY "Public can view creator profiles"
  ON public.profiles FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.decks d
      WHERE d.user_id = profiles.user_id
        AND d.visibility = 'public'
        AND d.hidden_at IS NULL
    )
  );

CREATE POLICY "Users view deck likes" ON public.deck_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users like decks" ON public.deck_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users unlike decks" ON public.deck_likes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users view deck saves" ON public.deck_saves FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users save decks" ON public.deck_saves FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users unsave decks" ON public.deck_saves FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users view ratings" ON public.deck_ratings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users rate decks" ON public.deck_ratings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own ratings" ON public.deck_ratings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users report decks" ON public.deck_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "Admins view reports" ON public.deck_reports FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update reports" ON public.deck_reports FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins hide reported decks" ON public.decks FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users view follows" ON public.creator_follows FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users follow creators" ON public.creator_follows FOR INSERT TO authenticated WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Users unfollow creators" ON public.creator_follows FOR DELETE TO authenticated USING (auth.uid() = follower_id);

CREATE INDEX idx_decks_marketplace ON public.decks (visibility, hidden_at, published_at DESC);
CREATE INDEX idx_decks_category ON public.decks (category);
CREATE INDEX idx_decks_keywords ON public.decks USING GIN (keywords);
CREATE INDEX idx_decks_popularity ON public.decks (learner_count DESC, like_count DESC);
CREATE INDEX idx_deck_likes_deck_id ON public.deck_likes(deck_id);
CREATE INDEX idx_deck_saves_user_id ON public.deck_saves(user_id);
CREATE INDEX idx_deck_reports_status ON public.deck_reports(status, created_at DESC);
CREATE INDEX idx_creator_follows_creator_id ON public.creator_follows(creator_id);

CREATE TRIGGER update_deck_ratings_updated_at
  BEFORE UPDATE ON public.deck_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
