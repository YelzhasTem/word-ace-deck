ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS cover_color TEXT;

ALTER TABLE public.decks
  DROP CONSTRAINT IF EXISTS decks_cover_color_value;

ALTER TABLE public.decks
  ADD CONSTRAINT decks_cover_color_value
  CHECK (
    cover_color IS NULL
    OR cover_color IN ('rose', 'amber', 'emerald', 'sky', 'violet', 'slate')
  );
