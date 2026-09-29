CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;

SELECT extensions.plan(12);

-- Synthetic fixtures only. The transaction is always rolled back.
-- User A studies in UTC+14 and user B in UTC-12, 26 hours apart, so their
-- local dates always differ whatever time the test runs.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'a5000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'streak-tz-a@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"streak_tz_a_41c2","display_name":"Streak A"}'::jsonb,
    now(), now()
  ),
  (
    'a5000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'streak-tz-b@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"streak_tz_b_41c2","display_name":"Streak B"}'::jsonb,
    now(), now()
  );

INSERT INTO public.decks (id, user_id, name) VALUES
  ('a5100000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'TZ deck A'),
  ('a5100000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002', 'TZ deck B');

INSERT INTO public.cards (id, deck_id, user_id, term, definition) VALUES
  (
    'a5200000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000001',
    'a5000000-0000-4000-8000-000000000001', 'hello', 'привет'
  ),
  (
    'a5200000-0000-4000-8000-000000000002', 'a5100000-0000-4000-8000-000000000002',
    'a5000000-0000-4000-8000-000000000002', 'hello', 'привет'
  );

INSERT INTO public.user_roles (user_id, role)
VALUES ('a5000000-0000-4000-8000-000000000002', 'admin');

-- Anonymous callers cannot set a time zone.
SET LOCAL ROLE anon;
SELECT extensions.throws_matching(
  $test$ SELECT public.set_my_time_zone('UTC') $test$,
  'permission denied',
  'anon cannot call set_my_time_zone'
);
RESET ROLE;

-- ===== User A =====
SELECT set_config('request.jwt.claim.sub', 'a5000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT extensions.throws_matching(
  $test$ SELECT public.set_my_time_zone('Mars/Olympus_Mons') $test$,
  'Unknown time zone',
  'unknown time zone names are rejected'
);
SELECT extensions.throws_matching(
  $test$ UPDATE public.profile_private SET time_zone = 'UTC' $test$,
  'permission denied',
  'time_zone cannot be written directly'
);
SELECT extensions.is(
  public.set_my_time_zone('Pacific/Kiritimati'),
  'Pacific/Kiritimati',
  'a known IANA name is accepted'
);

SELECT extensions.lives_ok($test$
  SELECT * FROM public.record_study_answer_v2(
    'a5300000-0000-4000-8000-000000000001',
    (
      SELECT q.question_id FROM public.issue_study_question(
        'a5400000-0000-4000-8000-000000000001',
        (
          SELECT s.session_id FROM public.start_study_session(
            'a5500000-0000-4000-8000-000000000001',
            'a5100000-0000-4000-8000-000000000001',
            'study'
          ) AS s
        ),
        'a5200000-0000-4000-8000-000000000001',
        'term_to_definition'
      ) AS q
    ),
    NULL, NULL, TRUE, 1200
  )
$test$, 'user A records a self-reported answer');

SELECT extensions.is(
  (SELECT day FROM public.streak_days WHERE user_id = auth.uid()),
  (clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::DATE,
  'user A streak day is the local date in Pacific/Kiritimati'
);
SELECT extensions.is(
  (SELECT last_active_date FROM public.profile_private WHERE user_id = auth.uid()),
  (clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::DATE,
  'user A last_active_date uses the same local date'
);
SELECT extensions.is(
  public.has_role('a5000000-0000-4000-8000-000000000002', 'admin'),
  FALSE,
  'has_role does not reveal another user''s admin role'
);
RESET ROLE;

-- ===== User B =====
SELECT set_config('request.jwt.claim.sub', 'a5000000-0000-4000-8000-000000000002', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a5000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT public.set_my_time_zone('Etc/GMT+12');
SELECT extensions.lives_ok($test$
  SELECT * FROM public.record_study_answer_v2(
    'a5300000-0000-4000-8000-000000000002',
    (
      SELECT q.question_id FROM public.issue_study_question(
        'a5400000-0000-4000-8000-000000000002',
        (
          SELECT s.session_id FROM public.start_study_session(
            'a5500000-0000-4000-8000-000000000002',
            'a5100000-0000-4000-8000-000000000002',
            'study'
          ) AS s
        ),
        'a5200000-0000-4000-8000-000000000002',
        'term_to_definition'
      ) AS q
    ),
    NULL, NULL, FALSE, 900
  )
$test$, 'user B records a wrong self-reported answer');

SELECT extensions.is(
  (SELECT day FROM public.streak_days WHERE user_id = auth.uid()),
  (clock_timestamp() AT TIME ZONE 'Etc/GMT+12')::DATE,
  'user B streak day is the local date in UTC-12'
);
SELECT extensions.is(
  public.has_role(auth.uid(), 'admin'),
  TRUE,
  'has_role still answers for the caller'
);
RESET ROLE;

SELECT extensions.isnt(
  (SELECT day FROM public.streak_days WHERE user_id = 'a5000000-0000-4000-8000-000000000001'),
  (SELECT day FROM public.streak_days WHERE user_id = 'a5000000-0000-4000-8000-000000000002'),
  'the same moment is recorded on different local dates for UTC+14 and UTC-12'
);

SELECT * FROM extensions.finish();

ROLLBACK;
