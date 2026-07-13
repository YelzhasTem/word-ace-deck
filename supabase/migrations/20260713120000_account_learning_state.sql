CREATE TABLE IF NOT EXISTS public.card_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  card_key TEXT NOT NULL,
  card_id UUID REFERENCES public.cards(id) ON DELETE CASCADE,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  mastery NUMERIC(5,4) NOT NULL DEFAULT 0,
  stage INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ,
  avg_ms INTEGER,
  total_ms INTEGER,
  samples INTEGER,
  slow_misses INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, deck_id, card_key)
);

CREATE TABLE IF NOT EXISTS public.study_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  card_key TEXT NOT NULL,
  card_id UUID REFERENCES public.cards(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'study',
  correct BOOLEAN NOT NULL,
  response_ms INTEGER,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.speed_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  duration INTEGER NOT NULL,
  score INTEGER NOT NULL,
  accuracy INTEGER NOT NULL,
  max_combo INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.card_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('ai', 'user')),
  favorite BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.deck_learning_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  delayed_recall_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, deck_id)
);

CREATE TABLE IF NOT EXISTS public.delayed_recall_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  stage_idx INTEGER NOT NULL DEFAULT 0,
  interval_idx INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ NOT NULL,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_review_at TIMESTAMPTZ,
  UNIQUE (user_id, deck_id, card_id)
);

CREATE TABLE IF NOT EXISTS public.last_studied_decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  last_studied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, deck_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_progress TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speed_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_associations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deck_learning_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delayed_recall_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.last_studied_decks TO authenticated;

GRANT ALL ON public.card_progress TO service_role;
GRANT ALL ON public.study_events TO service_role;
GRANT ALL ON public.speed_runs TO service_role;
GRANT ALL ON public.card_associations TO service_role;
GRANT ALL ON public.deck_learning_settings TO service_role;
GRANT ALL ON public.delayed_recall_entries TO service_role;
GRANT ALL ON public.last_studied_decks TO service_role;

ALTER TABLE public.card_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speed_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_associations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deck_learning_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delayed_recall_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.last_studied_decks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own card progress" ON public.card_progress;
CREATE POLICY "Users manage own card progress"
  ON public.card_progress FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own study events" ON public.study_events;
CREATE POLICY "Users manage own study events"
  ON public.study_events FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own speed runs" ON public.speed_runs;
CREATE POLICY "Users manage own speed runs"
  ON public.speed_runs FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own card associations" ON public.card_associations;
CREATE POLICY "Users manage own card associations"
  ON public.card_associations FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own deck learning settings" ON public.deck_learning_settings;
CREATE POLICY "Users manage own deck learning settings"
  ON public.deck_learning_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own delayed recall entries" ON public.delayed_recall_entries;
CREATE POLICY "Users manage own delayed recall entries"
  ON public.delayed_recall_entries FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own last studied decks" ON public.last_studied_decks;
CREATE POLICY "Users manage own last studied decks"
  ON public.last_studied_decks FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_card_progress_user_deck ON public.card_progress(user_id, deck_id);
CREATE INDEX IF NOT EXISTS idx_study_events_user_deck_answered ON public.study_events(user_id, deck_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_speed_runs_user_deck_score ON public.speed_runs(user_id, deck_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_card_associations_user_card ON public.card_associations(user_id, card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deck_learning_settings_user_deck ON public.deck_learning_settings(user_id, deck_id);
CREATE INDEX IF NOT EXISTS idx_delayed_recall_due ON public.delayed_recall_entries(user_id, due_at);
CREATE INDEX IF NOT EXISTS idx_last_studied_user_time ON public.last_studied_decks(user_id, last_studied_at DESC);
