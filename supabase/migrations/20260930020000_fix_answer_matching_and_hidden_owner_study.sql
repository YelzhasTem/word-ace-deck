BEGIN;

-- 1. Typed-answer checking (Type and Recall modes).
--
-- The expected answer was only compared piece by piece after splitting on
-- , / ; so an exact answer that contains a comma ("Hello, how are you?") was
-- marked wrong. "(to) run" did not accept "run". The typo tolerance also
-- allowed one edit on answers of up to 4 characters, which accepted a
-- different word for short words, CJK/Hangul text and numbers (猫 for 犬,
-- she for he, 8 for 7).
--
-- Now: the whole expected answer is tried first, then each , / ; variant,
-- each also without parenthesised parts. Short answers, CJK/Hangul text and
-- anything with digits must match exactly; longer words keep the same typo
-- tolerance as before.

CREATE OR REPLACE FUNCTION public.is_study_answer_correct(
  _submitted TEXT,
  _expected TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, extensions, public
AS $$
DECLARE
  v_submitted TEXT := public.normalize_study_answer(_submitted);
  v_candidates TEXT[];
  v_raw TEXT;
  v_variant TEXT;
  v_tolerance INTEGER;
BEGIN
  IF v_submitted = '' THEN
    RETURN false;
  END IF;

  v_candidates := ARRAY[_expected, regexp_replace(_expected, '\([^)]*\)', ' ', 'g')]
    || regexp_split_to_array(_expected, '[,/;]');

  FOREACH v_raw IN ARRAY v_candidates || ARRAY(
    SELECT regexp_replace(part, '\([^)]*\)', ' ', 'g')
    FROM unnest(regexp_split_to_array(_expected, '[,/;]')) AS part
  )
  LOOP
    v_variant := public.normalize_study_answer(v_raw);
    IF v_variant = '' THEN
      CONTINUE;
    END IF;
    IF v_variant = v_submitted THEN
      RETURN true;
    END IF;

    IF v_variant ~ '[0-9]'
       OR v_submitted ~ '[0-9]'
       OR v_variant ~ '[぀-ヿ㐀-䶿一-鿿가-힯ᄀ-ᇿ豈-﫿]'
    THEN
      CONTINUE;
    END IF;

    v_tolerance := CASE
      WHEN length(v_variant) <= 4 THEN 0
      WHEN length(v_variant) <= 8 THEN 2
      ELSE 3
    END;
    -- fuzzystrmatch limits each levenshtein input to 255 characters. Exact
    -- matching above remains available for longer phrases.
    IF v_tolerance > 0
       AND length(v_variant) <= 255
       AND length(v_submitted) <= 255
       AND extensions.levenshtein(v_variant, v_submitted) <= v_tolerance THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_study_answer_correct(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- 2. Owners can always study their own decks.
--
-- Hiding a reported public deck set hidden_at on the owner's own deck, and
-- can_study_deck required hidden_at IS NULL for everyone, so every study mode
-- failed for the owner. Hidden decks stay unavailable to everyone else.

CREATE OR REPLACE FUNCTION public.can_study_deck(_deck_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.decks d
    WHERE d.id = _deck_id
      AND (
        d.user_id = auth.uid()
        OR (d.hidden_at IS NULL AND d.visibility::TEXT IN ('public', 'unlisted'))
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_study_deck(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_study_deck(UUID) TO authenticated;

COMMIT;
