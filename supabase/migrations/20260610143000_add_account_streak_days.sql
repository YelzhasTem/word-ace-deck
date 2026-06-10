CREATE TABLE IF NOT EXISTS public.streak_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.streak_days TO authenticated;
GRANT ALL ON public.streak_days TO service_role;

ALTER TABLE public.streak_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own streak days" ON public.streak_days;
CREATE POLICY "Users view own streak days"
  ON public.streak_days FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own streak days" ON public.streak_days;
CREATE POLICY "Users insert own streak days"
  ON public.streak_days FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own streak days" ON public.streak_days;
CREATE POLICY "Users update own streak days"
  ON public.streak_days FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own streak days" ON public.streak_days;
CREATE POLICY "Users delete own streak days"
  ON public.streak_days FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_streak_days_user_day ON public.streak_days(user_id, day DESC);
