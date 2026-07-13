ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS definition_language TEXT;

UPDATE public.decks
SET definition_language = CASE
  WHEN target_language = 'en' THEN 'ru'
  ELSE 'en'
END
WHERE definition_language IS NULL;

ALTER TABLE public.decks
  ALTER COLUMN definition_language SET DEFAULT 'ru',
  ALTER COLUMN definition_language SET NOT NULL;

ALTER TABLE public.decks
  DROP CONSTRAINT IF EXISTS decks_definition_language_value;

ALTER TABLE public.decks
  ADD CONSTRAINT decks_definition_language_value
  CHECK (
    definition_language IN ('en', 'es', 'fr', 'de', 'zh-CN', 'ja', 'ko', 'ru', 'pt', 'it')
  );

ALTER TABLE public.decks
  DROP CONSTRAINT IF EXISTS decks_language_pair_different;

ALTER TABLE public.decks
  ADD CONSTRAINT decks_language_pair_different
  CHECK (target_language <> definition_language);
