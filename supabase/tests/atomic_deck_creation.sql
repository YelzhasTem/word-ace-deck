CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

BEGIN;

SELECT extensions.no_plan();

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    '91000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'atomic-a@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"atomic_a","display_name":"Atomic A"}'::jsonb,
    now(), now()
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'atomic-b@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"atomic_b","display_name":"Atomic B"}'::jsonb,
    now(), now()
  );

INSERT INTO public.collections (id, user_id, name)
VALUES
  (
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'Atomic owner collection'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002',
    'Atomic foreign collection'
  );

INSERT INTO public.decks (id, user_id, name, visibility, published_at)
VALUES
  (
    '93100000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    'Atomic public source', 'public', now()
  ),
  (
    '93100000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002',
    'Atomic rollback source', 'public', now()
  );

INSERT INTO public.cards (deck_id, user_id, term, definition, position)
VALUES
  (
    '93100000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    'public-source', 'public definition', 0
  ),
  (
    '93100000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002',
    'first-source', 'first definition', 0
  ),
  (
    '93100000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002',
    'rollback-last', 'last definition', 1
  );

INSERT INTO public.collections (
  id, user_id, name, visibility, published_at
) VALUES (
  '93200000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000002',
  'Atomic public collection source', 'public', now()
);
INSERT INTO public.collection_decks (collection_id, deck_id, user_id, position)
VALUES
  (
    '93200000-0000-4000-8000-000000000001',
    '93100000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002', 0
  ),
  (
    '93200000-0000-4000-8000-000000000001',
    '93100000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002', 1
  );

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.create_deck_with_cards(text,text,text,text,text,jsonb,uuid,boolean,uuid)',
    'EXECUTE'
  ),
  'anon cannot execute atomic deck creation'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'private.content_creation_requests', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'private.content_creation_requests', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'private.user_default_collections', 'SELECT'),
  'authenticated clients cannot read or mutate private creation control tables'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'private.claim_content_creation(uuid,text,uuid,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot call private idempotency helpers'
);

SELECT set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT extensions.lives_ok($test$
  SELECT * FROM public.create_deck_with_cards(
    'One card', '', NULL, 'en', 'ru',
    '[{"term":"hello","definition":"привет","position":0}]'::jsonb,
    NULL, FALSE, '94000000-0000-4000-8000-000000000001'
  )
$test$, 'creation with one Unicode card succeeds without a collection');

SELECT extensions.is(
  (SELECT count(*) FROM public.decks WHERE name = 'One card'),
  1::BIGINT,
  'one-card creation writes exactly one deck'
);
SELECT extensions.is(
  (
    SELECT count(*) FROM public.cards AS card
    JOIN public.decks AS deck ON deck.id = card.deck_id
    WHERE deck.name = 'One card' AND card.user_id = auth.uid()
  ),
  1::BIGINT,
  'one-card creation writes exactly one owned card'
);
SELECT extensions.is(
  (
    SELECT count(*) FROM public.collection_decks AS link
    JOIN public.decks AS deck ON deck.id = link.deck_id
    WHERE deck.name = 'One card'
  ),
  0::BIGINT,
  'creation without a collection creates no link'
);

SELECT extensions.lives_ok($test$
  SELECT * FROM public.create_deck_with_cards(
    repeat('n', 120), repeat('d', 300), 'emerald', 'fr', 'en',
    jsonb_build_array(
      jsonb_build_object('term', repeat('t', 160), 'definition', repeat('u', 300), 'position', 0),
      jsonb_build_object('term', 'deux', 'definition', 'two', 'position', 1),
      jsonb_build_object('term', 'trois', 'definition', 'three', 'position', 2)
    ),
    '93000000-0000-4000-8000-000000000001', FALSE,
    '94000000-0000-4000-8000-000000000002'
  )
$test$, 'multiple cards and documented text boundaries succeed in an owned collection');

SELECT extensions.is(
  (
    SELECT array_agg(card.position ORDER BY card.position)
    FROM public.cards AS card
    JOIN public.decks AS deck ON deck.id = card.deck_id
    WHERE deck.name = repeat('n', 120)
  ),
  ARRAY[0, 1, 2],
  'card positions preserve the requested order'
);
SELECT extensions.is(
  (
    SELECT count(*) FROM public.collection_decks AS link
    JOIN public.decks AS deck ON deck.id = link.deck_id
    WHERE deck.name = repeat('n', 120)
      AND link.collection_id = '93000000-0000-4000-8000-000000000001'
      AND link.user_id = auth.uid()
  ),
  1::BIGINT,
  'owned collection link is written with the authenticated owner'
);

SELECT extensions.lives_ok($test$
  SELECT * FROM public.create_deck_with_cards(
    'Default collection deck', '', NULL, 'en', 'ru',
    '[{"term":"one","definition":"один","position":0}]'::jsonb,
    NULL, TRUE, '94000000-0000-4000-8000-000000000003'
  )
$test$, 'default collection selection succeeds atomically');
RESET ROLE;
SELECT extensions.is(
  (
    SELECT count(*) FROM private.user_default_collections
    WHERE user_id = '91000000-0000-4000-8000-000000000001'
  ),
  1::BIGINT,
  'one designated default collection is recorded for the user'
);
SET LOCAL ROLE authenticated;

SELECT extensions.lives_ok($test$
  SELECT * FROM public.create_deck_with_cards(
    'Replay deck', '', NULL, 'en', 'ru',
    '[{"term":"same","definition":"тот же","position":0}]'::jsonb,
    NULL, FALSE, '94000000-0000-4000-8000-000000000004'
  )
$test$, 'first idempotent request succeeds');
SELECT extensions.lives_ok($test$
  SELECT * FROM public.create_deck_with_cards(
    'Replay deck', '', NULL, 'en', 'ru',
    '[{"term":"same","definition":"тот же","position":0}]'::jsonb,
    NULL, FALSE, '94000000-0000-4000-8000-000000000004'
  )
$test$, 'retry with the same idempotency key and payload succeeds');
SELECT extensions.is(
  (SELECT count(*) FROM public.decks WHERE name = 'Replay deck'),
  1::BIGINT,
  'idempotent replay does not create a duplicate deck'
);
SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Changed replay deck', '', NULL, 'en', 'ru',
    '[{"term":"changed","definition":"изменено","position":0}]'::jsonb,
    NULL, FALSE, '94000000-0000-4000-8000-000000000004'
  )
$test$, 'IDEMPOTENCY_CONFLICT', 'same key with a different payload is rejected');

SELECT extensions.lives_ok($test$
  SELECT * FROM public.duplicate_public_deck_atomic(
    '93100000-0000-4000-8000-000000000001',
    '94100000-0000-4000-8000-000000000001'
  )
$test$, 'public deck copy succeeds through one atomic RPC');
SELECT extensions.lives_ok($test$
  SELECT * FROM public.duplicate_public_deck_atomic(
    '93100000-0000-4000-8000-000000000001',
    '94100000-0000-4000-8000-000000000001'
  )
$test$, 'public deck copy retry returns the existing copy');
SELECT extensions.is(
  (
    SELECT count(*) FROM public.decks
    WHERE source_deck_id = '93100000-0000-4000-8000-000000000001'
      AND user_id = auth.uid()
  ),
  1::BIGINT,
  'public deck copy replay does not create a duplicate'
);

SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Empty cards', '', NULL, 'en', 'ru', '[]'::jsonb,
    NULL, FALSE, '94000000-0000-4000-8000-000000000005'
  )
$test$, 'INVALID_CARD', 'empty card array is rejected');
SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Blank term', '', NULL, 'en', 'ru',
    '[{"term":"   ","definition":"valid","position":0}]'::jsonb,
    NULL, FALSE, '94000000-0000-4000-8000-000000000006'
  )
$test$, 'INVALID_CARD', 'blank card term is rejected');
SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Missing term', '', NULL, 'en', 'ru',
    '[{"definition":"valid","position":0}]'::jsonb,
    NULL, FALSE, '94000000-0000-4000-8000-000000000015'
  )
$test$, 'INVALID_CARD', 'missing required card fields are rejected');
SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Wrong term type', '', NULL, 'en', 'ru',
    '[{"term":42,"definition":"valid","position":0}]'::jsonb,
    NULL, FALSE, '94000000-0000-4000-8000-000000000016'
  )
$test$, 'INVALID_CARD', 'non-string card fields are rejected');
SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Long definition', '', NULL, 'en', 'ru',
    jsonb_build_array(jsonb_build_object(
      'term', 'valid', 'definition', repeat('d', 301), 'position', 0
    )),
    NULL, FALSE, '94000000-0000-4000-8000-000000000007'
  )
$test$, 'INVALID_CARD', 'overlong card definition is rejected');
SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Bad position', '', NULL, 'en', 'ru',
    '[{"term":"valid","definition":"valid","position":1}]'::jsonb,
    NULL, FALSE, '94000000-0000-4000-8000-000000000008'
  )
$test$, 'INVALID_CARD', 'non-contiguous card position is rejected');
SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Too many cards', '', NULL, 'en', 'ru',
    (
      SELECT jsonb_agg(jsonb_build_object(
        'term', 'term-' || value, 'definition', 'definition', 'position', value
      )) FROM generate_series(0, 100) AS value
    ),
    NULL, FALSE, '94000000-0000-4000-8000-000000000009'
  )
$test$, 'TOO_MANY_CARDS', 'batch larger than one hundred cards is rejected');
SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Missing collection', '', NULL, 'en', 'ru',
    '[{"term":"valid","definition":"valid","position":0}]'::jsonb,
    '93000000-0000-4000-8000-000000000099', FALSE,
    '94000000-0000-4000-8000-000000000010'
  )
$test$, 'COLLECTION_NOT_FOUND', 'missing collection rejects the whole request');
SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Foreign collection', '', NULL, 'en', 'ru',
    '[{"term":"valid","definition":"valid","position":0}]'::jsonb,
    '93000000-0000-4000-8000-000000000002', FALSE,
    '94000000-0000-4000-8000-000000000011'
  )
$test$, 'COLLECTION_ACCESS_DENIED', 'foreign collection rejects the whole request');
SELECT extensions.is(
  (
    SELECT count(*) FROM public.decks
    WHERE name IN ('Empty cards', 'Blank term', 'Missing term', 'Wrong term type',
      'Long definition', 'Bad position', 'Too many cards', 'Missing collection',
      'Foreign collection')
  ),
  0::BIGINT,
  'validation and ownership failures leave no deck rows'
);

RESET ROLE;
CREATE FUNCTION pg_temp.fail_atomic_last_card()
RETURNS TRIGGER LANGUAGE plpgsql AS $trigger$
BEGIN
  IF NEW.term = 'rollback-last' THEN
    RAISE EXCEPTION 'synthetic late card failure';
  END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER fail_atomic_last_card
  BEFORE INSERT ON public.cards
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_atomic_last_card();
SET LOCAL ROLE authenticated;

SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Late card rollback', '', NULL, 'en', 'ru',
    '[{"term":"first","definition":"valid","position":0},
      {"term":"rollback-last","definition":"valid","position":1}]'::jsonb,
    NULL, FALSE, '94000000-0000-4000-8000-000000000012'
  )
$test$, 'CREATE_DECK_FAILED', 'failure on the final card returns a safe error');
SELECT extensions.throws_matching($test$
  SELECT * FROM public.duplicate_public_deck_atomic(
    '93100000-0000-4000-8000-000000000002',
    '94100000-0000-4000-8000-000000000002'
  )
$test$, 'CREATE_DECK_FAILED', 'late card failure rolls back a public deck copy');
SELECT extensions.throws_matching($test$
  SELECT * FROM public.duplicate_public_collection_atomic(
    '93200000-0000-4000-8000-000000000001',
    '94100000-0000-4000-8000-000000000003'
  )
$test$, 'CREATE_DECK_FAILED', 'late card failure rolls back a public collection copy');
SELECT extensions.is(
  (SELECT count(*) FROM public.decks WHERE name = 'Late card rollback'),
  0::BIGINT,
  'failure on the final card rolls back the deck'
);
SELECT extensions.is(
  (
    SELECT count(*) FROM public.cards
    WHERE term IN ('first', 'rollback-last') AND user_id = auth.uid()
  ),
  0::BIGINT,
  'failure on the final card rolls back earlier cards'
);
SELECT extensions.is(
  (
    SELECT count(*) FROM public.decks
    WHERE source_deck_id = '93100000-0000-4000-8000-000000000002'
      AND user_id = auth.uid()
  ),
  0::BIGINT,
  'failed public deck copy leaves no copied deck'
);
SELECT extensions.is(
  (
    SELECT count(*) FROM public.collections
    WHERE source_collection_id = '93200000-0000-4000-8000-000000000001'
      AND user_id = auth.uid()
  ),
  0::BIGINT,
  'failed public collection copy leaves no copied collection'
);
SELECT extensions.is(
  (
    SELECT count(*) FROM public.decks
    WHERE source_deck_id = '93100000-0000-4000-8000-000000000001'
      AND user_id = auth.uid()
  ),
  1::BIGINT,
  'failed collection copy rolls back decks created before the final failure'
);

RESET ROLE;
DROP TRIGGER fail_atomic_last_card ON public.cards;
CREATE FUNCTION pg_temp.fail_atomic_collection_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $trigger$
BEGIN
  IF NEW.collection_id = '93000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'synthetic collection link failure';
  END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER fail_atomic_collection_link
  BEFORE INSERT ON public.collection_decks
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_atomic_collection_link();
SET LOCAL ROLE authenticated;

SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'Late link rollback', '', NULL, 'en', 'ru',
    '[{"term":"link-card","definition":"valid","position":0}]'::jsonb,
    '93000000-0000-4000-8000-000000000001', FALSE,
    '94000000-0000-4000-8000-000000000013'
  )
$test$, 'CREATE_DECK_FAILED', 'failure while adding the requested collection link is safe');
SELECT extensions.is(
  (SELECT count(*) FROM public.decks WHERE name = 'Late link rollback'),
  0::BIGINT,
  'collection-link failure rolls back the deck'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.cards WHERE term = 'link-card'),
  0::BIGINT,
  'collection-link failure rolls back all cards'
);

RESET ROLE;
DROP TRIGGER fail_atomic_collection_link ON public.collection_decks;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_matching($test$
  SELECT * FROM public.create_deck_with_cards(
    'No auth', '', NULL, 'en', 'ru',
    '[{"term":"valid","definition":"valid","position":0}]'::jsonb,
    NULL, FALSE, '94000000-0000-4000-8000-000000000014'
  )
$test$, 'UNAUTHENTICATED', 'authenticated role without a user session is rejected');

RESET ROLE;
SELECT * FROM extensions.finish();

ROLLBACK;
