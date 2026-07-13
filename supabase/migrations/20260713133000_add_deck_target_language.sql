ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS target_language TEXT NOT NULL DEFAULT 'en';

ALTER TABLE public.decks
  DROP CONSTRAINT IF EXISTS decks_target_language_value;

ALTER TABLE public.decks
  ADD CONSTRAINT decks_target_language_value
  CHECK (
    target_language IN ('en', 'es', 'fr', 'de', 'zh-CN', 'ja', 'ko', 'ru', 'pt', 'it')
  );
