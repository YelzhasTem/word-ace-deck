
CREATE TABLE public.collections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collections TO authenticated;
GRANT ALL ON public.collections TO service_role;

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own collections" ON public.collections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own collections" ON public.collections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own collections" ON public.collections FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own collections" ON public.collections FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_collections_updated_at
BEFORE UPDATE ON public.collections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.collection_decks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_id, deck_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_decks TO authenticated;
GRANT ALL ON public.collection_decks TO service_role;

ALTER TABLE public.collection_decks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own collection_decks" ON public.collection_decks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own collection_decks" ON public.collection_decks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own collection_decks" ON public.collection_decks FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own collection_decks" ON public.collection_decks FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_collection_decks_collection ON public.collection_decks(collection_id);
CREATE INDEX idx_collection_decks_user ON public.collection_decks(user_id);
