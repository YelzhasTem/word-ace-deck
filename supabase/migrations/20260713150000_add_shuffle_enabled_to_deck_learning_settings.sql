ALTER TABLE public.deck_learning_settings
  ADD COLUMN IF NOT EXISTS shuffle_enabled BOOLEAN NOT NULL DEFAULT false;
