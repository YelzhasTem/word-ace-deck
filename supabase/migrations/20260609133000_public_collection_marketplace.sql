ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS visibility public.deck_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS keywords TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_collection_id UUID REFERENCES public.collections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS learner_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_sum INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS copy_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.collection_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.collection_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.collection_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.collection_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status public.report_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

GRANT SELECT, INSERT, DELETE ON public.collection_likes TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.collection_saves TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.collection_ratings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.collection_reports TO authenticated;
GRANT SELECT ON public.collection_likes, public.collection_saves, public.collection_ratings, public.collection_reports TO anon;
GRANT ALL ON public.collection_likes, public.collection_saves, public.collection_ratings, public.collection_reports TO service_role;

ALTER TABLE public.collection_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view public marketplace collections"
  ON public.collections FOR SELECT TO anon, authenticated
  USING (visibility = 'public' AND hidden_at IS NULL);

CREATE POLICY "Authenticated can view unlisted collection links"
  ON public.collections FOR SELECT TO authenticated
  USING (visibility IN ('public', 'unlisted') AND hidden_at IS NULL);

CREATE POLICY "Public can view public marketplace collection links"
  ON public.collection_decks FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.collections c
      WHERE c.id = collection_decks.collection_id
        AND c.visibility = 'public'
        AND c.hidden_at IS NULL
    )
  );

CREATE POLICY "Authenticated can view unlisted collection links"
  ON public.collection_decks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.collections c
      WHERE c.id = collection_decks.collection_id
        AND c.visibility IN ('public', 'unlisted')
        AND c.hidden_at IS NULL
    )
  );

CREATE POLICY "Users view collection likes" ON public.collection_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users like collections" ON public.collection_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users unlike collections" ON public.collection_likes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users view collection saves" ON public.collection_saves FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users save collections" ON public.collection_saves FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users unsave collections" ON public.collection_saves FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users view collection ratings" ON public.collection_ratings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users rate collections" ON public.collection_ratings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own collection ratings" ON public.collection_ratings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users report collections" ON public.collection_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "Admins view collection reports" ON public.collection_reports FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update collection reports" ON public.collection_reports FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins hide reported collections" ON public.collections FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_collections_marketplace ON public.collections (visibility, hidden_at, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_keywords ON public.collections USING GIN (keywords);
CREATE INDEX IF NOT EXISTS idx_collections_popularity ON public.collections (learner_count DESC, like_count DESC);
CREATE INDEX IF NOT EXISTS idx_collection_likes_collection_id ON public.collection_likes(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_saves_user_id ON public.collection_saves(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_reports_status ON public.collection_reports(status, created_at DESC);

DROP TRIGGER IF EXISTS update_collection_ratings_updated_at ON public.collection_ratings;
CREATE TRIGGER update_collection_ratings_updated_at
  BEFORE UPDATE ON public.collection_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
