CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;

SELECT extensions.no_plan();

-- Synthetic users are created inside a transaction and rolled back at the end.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    '81000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'integrity-a@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"integrity_a","display_name":"Integrity A"}'::jsonb,
    now(), now()
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'integrity-b@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"integrity_b","display_name":"Integrity B"}'::jsonb,
    now(), now()
  );

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_user_id_auth_fkey' AND NOT convalidated
  ),
  'historical profile owner FK is enforced for new rows without validating legacy rows'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'decks_user_id_auth_fkey' AND NOT convalidated
  ),
  'historical deck owner FK is enforced for new rows without validating legacy rows'
);

SELECT extensions.ok(
  private.marketplace_keywords_are_valid(
    array_fill(repeat('k', 40), ARRAY[12])
  ),
  'keyword validator accepts the documented upper boundary'
);

SELECT extensions.ok(
  NOT private.marketplace_keywords_are_valid(array_fill('k'::TEXT, ARRAY[13])),
  'keyword validator rejects more than twelve values'
);

SELECT extensions.ok(
  NOT private.marketplace_keywords_are_valid(ARRAY['valid', '   ']),
  'keyword validator rejects blank values'
);

SELECT extensions.lives_ok($test$
  INSERT INTO public.decks (
    id, user_id, name, description, keywords, learner_count, like_count,
    rating_sum, rating_count, view_count, copy_count
  ) VALUES (
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    repeat('n', 120), repeat('d', 300), array_fill(repeat('k', 40), ARRAY[12]),
    0, 0, 5, 1, 0, 0
  )
$test$, 'deck accepts validated text, array, and counter boundaries');

SELECT extensions.lives_ok($test$
  INSERT INTO public.decks (id, user_id, name, visibility, published_at)
  VALUES (
    '83000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000002',
    'Owner B public deck', 'public', now()
  )
$test$, 'ordinary public deck remains valid');

SELECT extensions.lives_ok($test$
  INSERT INTO public.decks (id, user_id, name, visibility, published_at)
  VALUES (
    '83000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000001',
    'Public deck', 'public', now()
  )
$test$, 'public deck with publication timestamp remains valid');

SELECT extensions.throws_matching($test$
  INSERT INTO public.decks (user_id, name)
  VALUES ('81000000-0000-4000-8000-000000000001', '   ')
$test$, '.*', 'blank deck name is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.decks (user_id, name)
  VALUES ('81000000-0000-4000-8000-000000000001', repeat('n', 121))
$test$, '.*', 'overlong deck name is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.decks (user_id, name, description)
  VALUES ('81000000-0000-4000-8000-000000000001', 'Deck', repeat('d', 301))
$test$, '.*', 'overlong deck description is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.decks (user_id, name, keywords)
  VALUES (
    '81000000-0000-4000-8000-000000000001', 'Deck',
    array_fill('keyword'::TEXT, ARRAY[13])
  )
$test$, '.*', 'oversized keyword array is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.decks (user_id, name, keywords)
  VALUES ('81000000-0000-4000-8000-000000000001', 'Deck', ARRAY['valid', ''])
$test$, '.*', 'empty keyword is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.decks (user_id, name, learner_count)
  VALUES ('81000000-0000-4000-8000-000000000001', 'Deck', -1)
$test$, '.*', 'negative marketplace counter is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.decks (user_id, name, rating_sum, rating_count)
  VALUES ('81000000-0000-4000-8000-000000000001', 'Deck', 6, 1)
$test$, '.*', 'impossible rating aggregate is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.decks (user_id, name, visibility)
  VALUES ('81000000-0000-4000-8000-000000000001', 'Deck', 'public')
$test$, '.*', 'public deck without publication timestamp is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.decks (user_id, name, visibility, published_at)
  VALUES ('81000000-0000-4000-8000-000000000001', 'Deck', 'private', now())
$test$, '.*', 'private deck with publication timestamp is rejected');

SELECT extensions.throws_matching($test$
  UPDATE public.decks
  SET source_deck_id = id
  WHERE id = '83000000-0000-4000-8000-000000000001'
$test$, '.*', 'deck cannot identify itself as its source');

SELECT extensions.throws_matching($test$
  INSERT INTO public.decks (user_id, name)
  VALUES ('8f000000-0000-4000-8000-000000000099', 'Missing Auth owner')
$test$, '.*', 'new deck cannot reference a missing Auth user');

SELECT extensions.throws_matching($test$
  INSERT INTO public.profiles (user_id, username)
  VALUES ('8f000000-0000-4000-8000-000000000099', 'missing_auth')
$test$, '.*', 'new profile cannot reference a missing Auth user');

SELECT extensions.lives_ok($test$
  INSERT INTO public.cards (id, deck_id, user_id, term, definition, position)
  VALUES (
    '84000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    repeat('t', 160), repeat('d', 300), 10000
  )
$test$, 'card accepts validated text and position boundaries');

SELECT extensions.lives_ok($test$
  INSERT INTO public.cards (id, deck_id, user_id, term, definition)
  VALUES (
    '84000000-0000-4000-8000-000000000002',
    '83000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000002',
    'Owner B term', 'Owner B definition'
  )
$test$, 'ordinary card remains valid');

SELECT extensions.throws_matching($test$
  INSERT INTO public.cards (deck_id, user_id, term, definition)
  VALUES (
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', ' ', 'definition'
  )
$test$, '.*', 'blank card term is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.cards (deck_id, user_id, term, definition)
  VALUES (
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', repeat('t', 161), 'definition'
  )
$test$, '.*', 'overlong card term is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.cards (deck_id, user_id, term, definition)
  VALUES (
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', 'term', '   '
  )
$test$, '.*', 'blank card definition is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.cards (deck_id, user_id, term, definition, position)
  VALUES (
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', 'term', 'definition', -1
  )
$test$, '.*', 'negative card position is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.cards (deck_id, user_id, term, definition, position)
  VALUES (
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', 'term', 'definition', 10001
  )
$test$, '.*', 'card position above the server limit is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.cards (deck_id, user_id, term, definition)
  VALUES (
    '83000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000002', 'term', 'definition'
  )
$test$, '.*', 'card cannot be assigned to another user owner');

SELECT extensions.lives_ok($test$
  INSERT INTO public.collections (id, user_id, name, description, keywords)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    repeat('c', 120), repeat('d', 300), array_fill(repeat('k', 40), ARRAY[12])
  )
$test$, 'collection accepts validated boundaries');

SELECT extensions.lives_ok($test$
  INSERT INTO public.collections (id, user_id, name)
  VALUES (
    '85000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000002', 'Owner B collection'
  )
$test$, 'ordinary collection remains valid');

SELECT extensions.throws_matching($test$
  INSERT INTO public.collections (user_id, name)
  VALUES ('8f000000-0000-4000-8000-000000000099', 'Missing Auth owner')
$test$, '.*', 'collection cannot reference a missing Auth user');

SELECT extensions.lives_ok($test$
  INSERT INTO public.collection_decks (collection_id, deck_id, user_id, position)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', 0
  )
$test$, 'same-owner collection link remains valid');

SELECT extensions.throws_matching($test$
  INSERT INTO public.collection_decks (collection_id, deck_id, user_id, position)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001', 1
  )
$test$, '.*', 'collection cannot link a deck owned by another user');

SELECT extensions.throws_matching($test$
  INSERT INTO public.collection_decks (collection_id, deck_id, user_id, position)
  VALUES (
    '85000000-0000-4000-8000-000000000002',
    '83000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000002', -1
  )
$test$, '.*', 'negative collection position is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.collection_decks (collection_id, deck_id, user_id, position)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', 2
  )
$test$, '.*', 'duplicate collection/deck link is rejected');

SELECT extensions.lives_ok($test$
  INSERT INTO public.deck_likes (deck_id, user_id)
  VALUES (
    '83000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000001'
  )
$test$, 'valid marketplace action remains valid');

SELECT extensions.throws_matching($test$
  INSERT INTO public.deck_likes (deck_id, user_id)
  VALUES (
    '83000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000001'
  )
$test$, '.*', 'duplicate marketplace action is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.deck_likes (deck_id, user_id)
  VALUES (
    '83000000-0000-4000-8000-000000000003',
    '8f000000-0000-4000-8000-000000000099'
  )
$test$, '.*', 'marketplace action cannot reference a missing Auth user');

SELECT extensions.lives_ok($test$
  INSERT INTO public.deck_ratings (deck_id, user_id, rating)
  VALUES (
    '83000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000001', 1
  )
$test$, 'rating accepts its minimum boundary');

SELECT extensions.throws_matching($test$
  INSERT INTO public.deck_ratings (deck_id, user_id, rating)
  VALUES (
    '83000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000001', 5
  )
$test$, '.*', 'duplicate rating is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.deck_ratings (deck_id, user_id, rating)
  VALUES (
    '83000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000002', 0
  )
$test$, '.*', 'rating below its minimum is rejected');

SELECT extensions.lives_ok($test$
  INSERT INTO public.deck_reports (deck_id, reporter_id, reason)
  VALUES (
    '83000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000001', 'valid reason'
  )
$test$, 'pending report with a valid reason remains valid');

SELECT extensions.throws_matching($test$
  INSERT INTO public.deck_reports (deck_id, reporter_id, reason)
  VALUES (
    '83000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000002', 'no'
  )
$test$, '.*', 'short report reason is rejected');

SELECT extensions.lives_ok($test$
  INSERT INTO public.collection_reports (collection_id, reporter_id, reason)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', '  abc  '
  )
$test$, 'collection report accepts exactly three trimmed characters');

SELECT extensions.lives_ok($test$
  INSERT INTO public.collection_reports (collection_id, reporter_id, reason)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', 'ordinary report reason'
  )
$test$, 'collection report accepts an ordinary reason');

SELECT extensions.lives_ok($test$
  INSERT INTO public.collection_reports (collection_id, reporter_id, reason)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', repeat('界', 400)
  )
$test$, 'collection report accepts exactly four hundred Unicode characters');

SELECT extensions.lives_ok($test$
  INSERT INTO public.collection_reports (collection_id, reporter_id, reason)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', '理由です'
  )
$test$, 'collection report accepts ordinary Unicode text');

SELECT extensions.throws_matching($test$
  INSERT INTO public.collection_reports (collection_id, reporter_id, reason)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', ''
  )
$test$, '.*', 'empty collection report reason is rejected by a direct insert');

SELECT extensions.throws_matching($test$
  INSERT INTO public.collection_reports (collection_id, reporter_id, reason)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', '   '
  )
$test$, '.*', 'blank collection report reason is rejected by a direct insert');

SELECT extensions.throws_matching($test$
  INSERT INTO public.collection_reports (collection_id, reporter_id, reason)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', 'x'
  )
$test$, '.*', 'one-character collection report reason is rejected by a direct insert');

SELECT extensions.throws_matching($test$
  INSERT INTO public.collection_reports (collection_id, reporter_id, reason)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', 'no'
  )
$test$, '.*', 'two-character collection report reason is rejected by a direct insert');

SELECT extensions.throws_matching($test$
  INSERT INTO public.collection_reports (collection_id, reporter_id, reason)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', repeat('x', 401)
  )
$test$, '.*', 'overlong collection report reason is rejected by a direct insert');

SELECT extensions.throws_matching($test$
  INSERT INTO public.collection_reports (collection_id, reporter_id, reason)
  VALUES (
    '85000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', NULL
  )
$test$, '.*', 'null collection report reason is rejected by a direct insert');

SELECT extensions.throws_matching($test$
  INSERT INTO public.deck_reports (deck_id, reporter_id, reason, reviewed_at)
  VALUES (
    '83000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000002', 'valid reason', now()
  )
$test$, '.*', 'pending report cannot have a review timestamp');

SELECT extensions.throws_matching($test$
  INSERT INTO public.collection_reports (
    collection_id, reporter_id, reason, status
  ) VALUES (
    '85000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000002', 'valid reason', 'dismissed'
  )
$test$, '.*', 'reviewed report requires a review timestamp');

SELECT extensions.throws_matching($test$
  INSERT INTO public.card_associations (user_id, card_id, text)
  VALUES (
    '81000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', '  '
  )
$test$, '.*', 'blank card association is rejected');

SELECT extensions.lives_ok($test$
  INSERT INTO public.card_associations (user_id, card_id, text)
  VALUES (
    '81000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000002', 'personal note on a public card'
  )
$test$, 'a learner can associate a public card owned by another author');

SELECT extensions.throws_matching($test$
  UPDATE public.profiles
  SET display_name = '   '
  WHERE user_id = '81000000-0000-4000-8000-000000000001'
$test$, '.*', 'blank optional public profile text is rejected');

SELECT extensions.throws_matching($test$
  UPDATE public.profile_private
  SET native_language = 'xx'
  WHERE user_id = '81000000-0000-4000-8000-000000000001'
$test$, '.*', 'unsupported private profile language is rejected');

SELECT extensions.lives_ok($test$
  INSERT INTO public.friendships (requester_id, addressee_id)
  VALUES (
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000002'
  )
$test$, 'ordinary pending friendship remains valid');

SELECT extensions.throws_matching($test$
  INSERT INTO public.friendships (requester_id, addressee_id)
  VALUES (
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001'
  )
$test$, '.*', 'self-friendship is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.card_progress (
    user_id, deck_id, card_id, card_key, mastery
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', 'nan', 'NaN'::numeric
  )
$test$, '.*', 'numeric NaN mastery is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.card_progress (
    user_id, deck_id, card_id, card_key, mastery
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', 'positive-infinity', 'Infinity'::numeric
  )
$test$, '.*', 'numeric positive infinity mastery is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.card_progress (
    user_id, deck_id, card_id, card_key, mastery
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', 'negative-infinity', '-Infinity'::numeric
  )
$test$, '.*', 'numeric negative infinity mastery is rejected');

SELECT extensions.lives_ok($test$
  INSERT INTO public.card_progress (
    user_id, deck_id, card_id, card_key, correct_count, wrong_count,
    mastery, stage, samples, avg_ms, total_ms, slow_misses
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', 'valid-progress', 1, 0,
    1, 4, 1, 0, 0, 1
  )
$test$, 'valid mastery and study-stage upper boundaries remain valid');

SELECT extensions.throws_matching($test$
  INSERT INTO public.card_progress (
    user_id, deck_id, card_key, stage
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001', 'invalid-stage', 5
  )
$test$, '.*', 'study stage above its maximum is rejected');

SELECT extensions.lives_ok($test$
  INSERT INTO public.card_progress (user_id, deck_id, card_key)
  VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001', 'nullable-card-progress'
  )
$test$, 'initial progress accepts zero counters, zero mastery, and a null card reference');

SELECT extensions.throws_matching($test$
  INSERT INTO public.card_progress (
    user_id, deck_id, card_key, correct_count, slow_misses
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001', 'slow-miss-overflow', 1, 2
  )
$test$, '.*', 'slow misses cannot exceed total attempts');

SELECT extensions.throws_matching($test$
  INSERT INTO public.card_progress (
    user_id, deck_id, card_key, correct_count, samples, avg_ms, total_ms
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001', 'sample-overflow', 1, 2, 10, 20
  )
$test$, '.*', 'timing samples cannot exceed total attempts');

SELECT extensions.throws_matching($test$
  INSERT INTO public.card_progress (
    user_id, deck_id, card_key, avg_ms
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001', 'partial-timing', 10
  )
$test$, '.*', 'partial timing aggregate is rejected');

SELECT extensions.lives_ok($test$
  INSERT INTO public.card_progress (
    user_id, deck_id, card_id, card_key
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000002',
    '84000000-0000-4000-8000-000000000002', 'public-deck-progress'
  )
$test$, 'a learner can keep progress for another author public deck');

SELECT extensions.throws_matching($test$
  INSERT INTO public.card_progress (
    user_id, deck_id, card_id, card_key
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', 'valid-progress'
  )
$test$, '.*', 'duplicate card progress key is rejected');

SELECT extensions.lives_ok($test$
  INSERT INTO public.study_sessions (
    id, user_id, deck_id, client_session_key, mode
  ) VALUES (
    '86000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000011', 'study'
  )
$test$, 'same-owner study session remains valid');

SELECT extensions.lives_ok($test$
  INSERT INTO public.study_sessions (
    user_id, deck_id, client_session_key, mode
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000002',
    '86000000-0000-4000-8000-000000000012', 'study'
  )
$test$, 'a learner can start a session for another author public deck');

SELECT extensions.throws_matching($test$
  INSERT INTO public.study_sessions (
    user_id, deck_id, client_session_key, completion_key, mode,
    status, started_at, completed_at
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000013',
    '86000000-0000-4000-8000-000000000014', 'study', 'completed',
    now(), now() - interval '1 second'
  )
$test$, '.*', 'study session completion cannot predate its start');

SELECT extensions.lives_ok($test$
  INSERT INTO public.study_session_cards (
    session_id, card_id, user_id, deck_id, term_snapshot,
    definition_snapshot, card_updated_at
  ) VALUES (
    '86000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    'term snapshot', 'definition snapshot', now()
  )
$test$, 'same-owner study session snapshot remains valid');

SELECT extensions.throws_matching($test$
  INSERT INTO public.study_session_cards (
    session_id, card_id, user_id, deck_id, term_snapshot,
    definition_snapshot, card_updated_at
  ) VALUES (
    '86000000-0000-4000-8000-000000000001', gen_random_uuid(),
    '82000000-0000-4000-8000-000000000002',
    '83000000-0000-4000-8000-000000000001',
    'term snapshot', 'definition snapshot', now()
  )
$test$, '.*', 'study snapshot owner must match its session');

SELECT extensions.lives_ok($test$
  INSERT INTO public.study_events (
    user_id, deck_id, card_id, card_key, mode, correct, idempotency_key
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', 'event-card', 'study', TRUE,
    '86000000-0000-4000-8000-000000000021'
  )
$test$, 'valid legacy study event remains valid');

SELECT extensions.throws_matching($test$
  INSERT INTO public.study_events (
    user_id, deck_id, card_id, card_key, mode, correct, idempotency_key
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', 'event-card-duplicate', 'study', TRUE,
    '86000000-0000-4000-8000-000000000021'
  )
$test$, '.*', 'duplicate study event idempotency key is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.study_events (
    user_id, deck_id, card_id, card_key, mode, correct
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', ' ', 'study', TRUE
  )
$test$, '.*', 'blank study event progress key is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.study_events (
    user_id, deck_id, card_id, card_key, mode, correct, response_ms
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', 'negative-response',
    'study', TRUE, -1
  )
$test$, '.*', 'negative response time is rejected');

SELECT extensions.lives_ok($test$
  INSERT INTO public.study_events (
    user_id, deck_id, card_id, card_key, mode, correct, response_ms
  ) VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001', 'zero-response',
    'study', TRUE, 0
  )
$test$, 'zero response time remains valid');

SELECT extensions.lives_ok($test$
  INSERT INTO public.speed_runs (user_id, deck_id, duration, score, accuracy, max_combo)
  VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001', 30, 0, 0, 0
  )
$test$, 'speed result accepts zero score, accuracy, and combo');

SELECT extensions.lives_ok($test$
  INSERT INTO public.speed_runs (user_id, deck_id, duration, score, accuracy)
  VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001', 120, 1, 100
  )
$test$, 'speed result accepts maximum duration and accuracy');

SELECT extensions.throws_matching($test$
  INSERT INTO public.speed_runs (user_id, deck_id, duration, score, accuracy)
  VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001', 30, 1, 101
  )
$test$, '.*', 'accuracy above one hundred is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.speed_runs (user_id, deck_id, duration, score, accuracy)
  VALUES (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001', 30, -1, 50
  )
$test$, '.*', 'negative speed score is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.ai_endpoint_policies (
    endpoint, request_class, request_units, minute_limit, hour_limit,
    day_limit, concurrency_limit, slot_ttl_seconds
  ) VALUES ('   ', 'light', 1, 1, 1, 1, 1, 30)
$test$, '.*', 'blank AI endpoint name is rejected');

SELECT extensions.throws_matching($test$
  INSERT INTO public.ai_usage_events (
    request_id, user_id, endpoint, request_class, request_units,
    idempotency_key, request_hash, status, input_size, started_at, expires_at
  ) VALUES (
    '87000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001', 'getTranslations', 'light', 1,
    '87000000-0000-4000-8000-000000000011', repeat('a', 64), 'active', 0,
    now(), now() - interval '1 second'
  )
$test$, '.*', 'AI reservation expiry must follow its start time');

SELECT extensions.throws_matching($test$
  INSERT INTO public.ai_usage_events (
    request_id, user_id, endpoint, request_class, request_units,
    idempotency_key, request_hash, status, input_size, started_at, expires_at,
    completed_at
  ) VALUES (
    '87000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001', 'getTranslations', 'light', 1,
    '87000000-0000-4000-8000-000000000012', repeat('a', 64), 'active', 0,
    now(), now() + interval '1 minute', now()
  )
$test$, '.*', 'active AI reservation cannot be marked complete');

SELECT extensions.throws_matching($test$
  INSERT INTO public.ai_usage_events (
    request_id, user_id, endpoint, request_class, request_units,
    idempotency_key, request_hash, status, input_size, started_at, expires_at
  ) VALUES (
    '87000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000001', 'getTranslations', 'light', 1,
    '87000000-0000-4000-8000-000000000013', repeat('a', 64), 'succeeded', 0,
    now(), now() + interval '1 minute'
  )
$test$, '.*', 'finished AI reservation requires a completion timestamp');

SELECT extensions.throws_matching($test$
  INSERT INTO public.ai_rate_limit_rollups (
    bucket_start, user_id, endpoint, result, last_seen_at
  ) VALUES (
    date_trunc('minute', now()),
    '81000000-0000-4000-8000-000000000001',
    'getTranslations', 'test', date_trunc('minute', now()) - interval '1 second'
  )
$test$, '.*', 'rate-limit observation cannot predate its bucket');

SELECT * FROM extensions.finish();

ROLLBACK;
