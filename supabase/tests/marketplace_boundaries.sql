BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

-- These assertions describe the intended contract, not the vulnerable baseline.
-- No application rows or persistent schema changes are made by this file.
SELECT extensions.ok(
  NOT has_column_privilege('authenticated', resource, column_name, operation),
  format('%s: authenticated cannot %s protected %s', resource, operation, column_name)
)
FROM (VALUES ('public.decks'), ('public.collections')) AS resources(resource)
CROSS JOIN (VALUES
  ('id'), ('created_at'), ('updated_at'), ('hidden_at'), ('published_at'),
  ('learner_count'), ('like_count'), ('rating_sum'), ('rating_count'),
  ('view_count'), ('copy_count')
) AS protected(column_name)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS operations(operation);

SELECT extensions.ok(
  NOT has_column_privilege('authenticated', resource, column_name, operation),
  format('%s: authenticated cannot %s copy provenance', resource, operation)
)
FROM (VALUES
  ('public.decks', 'source_deck_id'),
  ('public.collections', 'source_collection_id')
) AS provenance(resource, column_name)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS operations(operation);

SELECT extensions.ok(
  NOT has_column_privilege('authenticated', resource, 'user_id', 'UPDATE'),
  format('%s: ownership cannot be reassigned by table UPDATE', resource)
)
FROM (VALUES ('public.decks'), ('public.collections')) AS resources(resource);

SELECT extensions.ok(
  has_column_privilege('authenticated', resource, column_name, 'UPDATE'),
  format('%s: owner-editable %s retains UPDATE permission', resource, column_name)
)
FROM (VALUES
  ('public.decks', 'name'), ('public.decks', 'description'),
  ('public.decks', 'cover_color'), ('public.decks', 'target_language'),
  ('public.decks', 'definition_language'), ('public.decks', 'visibility'),
  ('public.decks', 'category'), ('public.decks', 'keywords'),
  ('public.collections', 'name'), ('public.collections', 'description'),
  ('public.collections', 'visibility'), ('public.collections', 'keywords')
) AS editable(resource, column_name);

SELECT extensions.ok(
  NOT has_column_privilege('authenticated', resource, column_name, operation),
  format('%s: authenticated cannot %s moderation %s', resource, operation, column_name)
)
FROM (VALUES ('public.deck_reports'), ('public.collection_reports')) AS reports(resource)
CROSS JOIN (VALUES ('status'), ('reviewed_at')) AS protected(column_name)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS operations(operation);

SELECT extensions.ok(
  relrowsecurity,
  format('%s retains RLS', relname)
)
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname = ANY (ARRAY[
    'decks', 'collections', 'deck_likes', 'deck_ratings', 'deck_saves',
    'collection_likes', 'collection_ratings', 'collection_saves',
    'deck_reports', 'collection_reports'
  ]);

SELECT extensions.ok(
  NOT has_table_privilege(actor, 'public.' || resource, operation),
  format('%s lacks unnecessary %s on %s', actor, operation, resource)
)
FROM (VALUES ('anon'), ('authenticated')) AS actors(actor)
CROSS JOIN (VALUES ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) AS operations(operation)
CROSS JOIN (VALUES ('decks'), ('collections'), ('deck_likes'), ('deck_ratings'),
  ('deck_saves'), ('deck_reports'), ('collection_likes'), ('collection_ratings'),
  ('collection_saves'), ('collection_reports'), ('creator_follows')) AS resources(resource);

SELECT extensions.ok(
  NOT has_table_privilege(actor, 'private.marketplace_view_receipts', operation),
  format('%s cannot %s private view receipts', actor, operation)
)
FROM (VALUES ('anon'), ('authenticated')) AS actors(actor)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS operations(operation);

SELECT extensions.ok(relrowsecurity, 'view receipts retain RLS')
FROM pg_class WHERE oid = 'private.marketplace_view_receipts'::regclass;

SELECT extensions.ok(
  has_function_privilege('authenticated', signature, 'EXECUTE')
  AND NOT has_function_privilege('anon', signature, 'EXECUTE'),
  format('%s has narrow caller grants', signature)
)
FROM (VALUES ('public.record_marketplace_view(text,uuid)'),
  ('public.moderate_marketplace_report(text,uuid,text)')) AS rpc(signature);

SELECT extensions.ok(
  p.proconfig @> ARRAY['search_path=pg_catalog'] AND NOT EXISTS (
    SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ), format('%s has fixed search_path and no PUBLIC execution', p.proname)
)
FROM pg_proc p WHERE p.oid = ANY (ARRAY[
  'private.maintain_marketplace_aggregates()'::regprocedure,
  'private.keep_marketplace_rating_identity()'::regprocedure,
  'private.set_marketplace_publication_time()'::regprocedure,
  'private.touch_marketplace_updated_at()'::regprocedure,
  'public.record_marketplace_view(text,uuid)'::regprocedure,
  'public.moderate_marketplace_report(text,uuid,text)'::regprocedure,
  'public.duplicate_public_deck_atomic(uuid,uuid)'::regprocedure,
  'public.duplicate_public_collection_atomic(uuid,uuid)'::regprocedure
]);

SELECT extensions.is((SELECT count(*)::integer FROM pg_constraint
  WHERE conrelid = 'private.marketplace_view_receipts'::regclass
    AND contype = 'f' AND confdeltype = 'c'), 3, 'all receipt foreign keys cascade');

SELECT * FROM extensions.finish();
ROLLBACK;
