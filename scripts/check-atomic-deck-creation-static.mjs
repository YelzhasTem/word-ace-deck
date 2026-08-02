import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260802010000_atomic_deck_creation.sql"),
  "utf8",
);
const deckFunctions = fs.readFileSync(path.join(root, "src/lib/decks.functions.ts"), "utf8");
const communityFunctions = fs.readFileSync(
  path.join(root, "src/lib/community.functions.ts"),
  "utf8",
);
const dashboard = fs.readFileSync(path.join(root, "src/routes/dashboard.tsx"), "utf8");
const community = fs.readFileSync(path.join(root, "src/routes/community.tsx"), "utf8");
const communityDeck = fs.readFileSync(path.join(root, "src/routes/community.$deckId.tsx"), "utf8");
const generatedTypes = fs.readFileSync(
  path.join(root, "src/integrations/supabase/types.ts"),
  "utf8",
);
const sqlTests = fs.readFileSync(
  path.join(root, "supabase/tests/atomic_deck_creation.sql"),
  "utf8",
);

assert.match(migration, /^BEGIN;/);
assert.match(migration, /COMMIT;\s*$/);
for (const rpc of [
  "create_deck_with_cards",
  "duplicate_public_deck_atomic",
  "duplicate_public_collection_atomic",
]) {
  assert.match(migration, new RegExp(`FUNCTION public\\.${rpc}\\(`), `Missing ${rpc}`);
  assert.match(generatedTypes, new RegExp(`\\b${rpc}:`), `Generated types are missing ${rpc}`);
}

assert.equal(
  (migration.match(/SECURITY DEFINER/g) ?? []).length,
  3,
  "Only the three public atomic RPCs should be security definers",
);
assert.equal(
  (migration.match(/SET search_path = pg_catalog, public/g) ?? []).length,
  3,
  "Every security-definer RPC needs a fixed search_path",
);
for (const rpc of [
  "create_deck_with_cards",
  "duplicate_public_deck_atomic",
  "duplicate_public_collection_atomic",
]) {
  const signature = migration.match(
    new RegExp(`FUNCTION public\\.${rpc}\\(([\\s\\S]*?)\\)\\nRETURNS`),
  );
  assert.ok(signature, `Could not inspect ${rpc} signature`);
  assert.doesNotMatch(signature[1], /p_user_id/i, `${rpc} must not accept a user ID`);
}
assert.equal(
  (migration.match(/UUID := auth\.uid\(\)/g) ?? []).length,
  3,
  "Every public atomic RPC must derive its owner from auth.uid()",
);
assert.match(migration, /jsonb_array_length\(p_cards\)/);
assert.match(migration, /v_card_count > 100/);
assert.match(migration, /v_card_count = 0/);
assert.match(migration, /COLLECTION_ACCESS_DENIED/);
assert.match(migration, /IDEMPOTENCY_CONFLICT/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(
  migration,
  /REVOKE ALL ON TABLE private\.content_creation_requests FROM PUBLIC, anon, authenticated/,
);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.create_deck_with_cards[\s\S]+FROM PUBLIC, anon/,
);

assert.doesNotMatch(deckFunctions, /createDeckRow|addDeckToCollection|ensureDefaultCollectionId/);
assert.doesNotMatch(deckFunctions, /Deck was created, but cards were not saved/);
assert.equal(
  (deckFunctions.match(/\.rpc\("create_deck_with_cards"/g) ?? []).length,
  1,
  "Deck server function must use only the atomic RPC",
);
assert.equal((communityFunctions.match(/\.rpc\("duplicate_public_deck_atomic"/g) ?? []).length, 1);
assert.equal((communityFunctions.match(/"duplicate_public_collection_atomic"/g) ?? []).length, 1);
assert.doesNotMatch(
  communityFunctions.slice(
    communityFunctions.indexOf("export const duplicatePublicDeck"),
    communityFunctions.indexOf("export const getCreatorProfile"),
  ),
  /\.from\("(?:decks|cards|collections|collection_decks)"\)/,
  "Marketplace copy server functions must not retain partial-write fallbacks",
);

assert.match(dashboard, /stableCreationKey/);
assert.match(dashboard, /isCreatingDeck/);
assert.match(community, /copyingDeckId/);
assert.match(community, /copyingCollectionId/);
assert.match(community, /idempotencyKey/);
assert.match(communityDeck, /idempotencyKey: duplicateKey\.current/);
assert.match(communityDeck, /duplicateActive/);

for (const rollbackScenario of [
  "failure on the final card rolls back the deck",
  "failure on the final card rolls back earlier cards",
  "collection-link failure rolls back the deck",
  "collection-link failure rolls back all cards",
  "idempotent replay does not create a duplicate deck",
  "foreign collection rejects the whole request",
  "late card failure rolls back a public deck copy",
  "late card failure rolls back a public collection copy",
  "failed collection copy rolls back decks created before the final failure",
]) {
  assert.match(sqlTests, new RegExp(rollbackScenario), `Missing SQL test: ${rollbackScenario}`);
}

console.log("Atomic deck creation static audit passed.");
