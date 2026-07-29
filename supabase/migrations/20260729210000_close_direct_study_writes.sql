BEGIN;

-- Final rollout phase: the RPC frontend is deployed, so derived study data is
-- now read-only to browser roles. SECURITY DEFINER RPCs remain the only write
-- path and derive user identity from auth.uid().
ALTER TABLE public.card_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speed_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delayed_recall_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.last_studied_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'card_progress',
        'study_events',
        'speed_runs',
        'delayed_recall_entries',
        'streak_days',
        'last_studied_decks',
        'study_sessions'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END;
$$;

CREATE POLICY "Users read own card progress"
  ON public.card_progress FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users read own study events"
  ON public.study_events FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users read own speed runs"
  ON public.speed_runs FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users read own delayed recall entries"
  ON public.delayed_recall_entries FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users read own streak days"
  ON public.streak_days FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users read own last studied decks"
  ON public.last_studied_decks FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users read own study sessions"
  ON public.study_sessions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL PRIVILEGES ON TABLE public.card_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.study_events FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.speed_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.delayed_recall_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.streak_days FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.last_studied_decks FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.study_sessions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.card_progress TO authenticated;
GRANT SELECT ON TABLE public.study_events TO authenticated;
GRANT SELECT ON TABLE public.speed_runs TO authenticated;
GRANT SELECT ON TABLE public.delayed_recall_entries TO authenticated;
GRANT SELECT ON TABLE public.streak_days TO authenticated;
GRANT SELECT ON TABLE public.last_studied_decks TO authenticated;
GRANT SELECT ON TABLE public.study_sessions TO authenticated;

GRANT ALL PRIVILEGES ON TABLE public.card_progress TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.study_events TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.speed_runs TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.delayed_recall_entries TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.streak_days TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.last_studied_decks TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.study_sessions TO service_role;

-- Private profile preferences remain editable, but learning aggregates are
-- server-owned columns. Users cannot delete and recreate the row to reset or
-- manufacture statistics.
DROP POLICY IF EXISTS "Users insert their own private profile data"
  ON public.profile_private;
DROP POLICY IF EXISTS "Users delete their own private profile data"
  ON public.profile_private;

REVOKE ALL PRIVILEGES ON TABLE public.profile_private FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profile_private TO authenticated;
GRANT UPDATE (native_language, target_language, username_privacy_review_needed)
  ON TABLE public.profile_private TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.profile_private TO service_role;

-- A card and its deck must have the same owner. This also prevents a user from
-- injecting a card into another user's deck and then studying that relation.
DO $$
DECLARE
  mismatched_card_owners BIGINT;
BEGIN
  SELECT count(*) INTO mismatched_card_owners
  FROM public.cards c
  JOIN public.decks d ON d.id = c.deck_id
  WHERE c.user_id <> d.user_id;

  RAISE NOTICE 'Study integrity card/deck owner audit: mismatches=%', mismatched_card_owners;
  IF mismatched_card_owners > 0 THEN
    RAISE EXCEPTION
      'Study integrity lock stopped: card/deck owner mismatches require an explicit repair plan';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.decks'::regclass
      AND conname = 'decks_id_user_id_key'
  ) THEN
    ALTER TABLE public.decks
      ADD CONSTRAINT decks_id_user_id_key UNIQUE (id, user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cards'::regclass
      AND conname = 'cards_deck_owner_fkey'
  ) THEN
    ALTER TABLE public.cards
      ADD CONSTRAINT cards_deck_owner_fkey
      FOREIGN KEY (deck_id, user_id)
      REFERENCES public.decks(id, user_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.cards VALIDATE CONSTRAINT cards_deck_owner_fkey;

DROP POLICY IF EXISTS "Users insert own cards" ON public.cards;
DROP POLICY IF EXISTS "Users update own cards" ON public.cards;
CREATE POLICY "Users insert cards into own decks"
  ON public.cards FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = cards.user_id
    AND EXISTS (
      SELECT 1 FROM public.decks d
      WHERE d.id = cards.deck_id
        AND d.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY "Users update cards in own decks"
  ON public.cards FOR UPDATE TO authenticated
  USING (
    (SELECT auth.uid()) = cards.user_id
    AND EXISTS (
      SELECT 1 FROM public.decks d
      WHERE d.id = cards.deck_id
        AND d.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) = cards.user_id
    AND EXISTS (
      SELECT 1 FROM public.decks d
      WHERE d.id = cards.deck_id
        AND d.user_id = (SELECT auth.uid())
    )
  );

REVOKE ALL PRIVILEGES ON TABLE public.cards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cards TO anon, authenticated;
GRANT DELETE ON TABLE public.cards TO authenticated;
GRANT INSERT (deck_id, user_id, term, definition, position)
  ON TABLE public.cards TO authenticated;
GRANT UPDATE (term, definition, position)
  ON TABLE public.cards TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.cards TO service_role;

COMMENT ON TABLE public.study_events IS
  'Append-only server-created study answers. authenticated can read own rows but cannot write directly.';
COMMENT ON COLUMN public.profile_private.streak_days IS
  'Server-owned aggregate updated only by trusted study RPCs.';
COMMENT ON COLUMN public.profile_private.last_active_date IS
  'Server-owned activity date updated only by trusted study RPCs.';
COMMENT ON COLUMN public.profile_private.total_xp IS
  'Reserved server-owned aggregate; currently no XP award algorithm is active.';

COMMIT;
