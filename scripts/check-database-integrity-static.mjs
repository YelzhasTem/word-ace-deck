import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPath = path.join(
  root,
  "supabase/migrations/20260731010000_harden_database_integrity.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");
const sqlTests = fs.readFileSync(path.join(root, "supabase/tests/database_integrity.sql"), "utf8");
const generatedTypes = fs.readFileSync(
  path.join(root, "src/integrations/supabase/types.ts"),
  "utf8",
);
const communityFunctions = fs.readFileSync(
  path.join(root, "src/lib/community.functions.ts"),
  "utf8",
);
const reportValidation = fs.readFileSync(path.join(root, "src/lib/report-validation.ts"), "utf8");
const communityRoute = fs.readFileSync(path.join(root, "src/routes/community.tsx"), "utf8");

assert.match(migration, /^BEGIN;/);
assert.match(migration, /COMMIT;\s*$/);
assert.doesNotMatch(
  migration,
  /\b(?:INSERT INTO|UPDATE|DELETE FROM)\b/i,
  "Integrity migration must not rewrite or delete production data",
);

for (const constraint of [
  "profiles_user_id_auth_fkey",
  "decks_user_id_auth_fkey",
  "collections_user_id_auth_fkey",
  "collection_decks_collection_owner_fkey",
  "collection_decks_deck_owner_fkey",
  "study_session_cards_session_owner_fkey",
  "study_questions_session_owner_fkey",
  "study_events_session_owner_fkey",
  "speed_runs_session_owner_fkey",
  "decks_name_shape_check",
  "decks_keywords_shape_check",
  "decks_counters_check",
  "collections_name_shape_check",
  "collections_keywords_shape_check",
  "cards_term_shape_check",
  "cards_definition_shape_check",
  "cards_position_check",
  "card_progress_attempt_totals_check",
  "card_progress_timing_shape_check",
  "ai_usage_events_time_check",
  "ai_usage_events_completion_shape_check",
]) {
  assert.match(migration, new RegExp(`\\b${constraint}\\b`), `Missing ${constraint}`);
}

for (const intentionallyUnvalidated of ["profiles_user_id_auth_fkey", "decks_user_id_auth_fkey"]) {
  assert.match(
    migration,
    new RegExp(`${intentionallyUnvalidated}[\\s\\S]{0,180}NOT VALID;`),
    `${intentionallyUnvalidated} must protect new writes without deleting legacy rows`,
  );
  assert.doesNotMatch(
    migration,
    new RegExp(`VALIDATE CONSTRAINT ${intentionallyUnvalidated}`),
    `${intentionallyUnvalidated} must remain unvalidated until approved cleanup`,
  );
}

for (const requiredScenario of [
  "numeric NaN mastery is rejected",
  "numeric positive infinity mastery is rejected",
  "numeric negative infinity mastery is rejected",
  "duplicate study event idempotency key is rejected",
  "duplicate rating is rejected",
  "self-friendship is rejected",
  "negative response time is rejected",
  "accuracy above one hundred is rejected",
  "study stage above its maximum is rejected",
  "collection cannot link a deck owned by another user",
  "new deck cannot reference a missing Auth user",
  "valid mastery and study-stage upper boundaries remain valid",
  "collection report accepts exactly three trimmed characters",
  "collection report accepts exactly four hundred Unicode characters",
  "blank collection report reason is rejected by a direct insert",
  "overlong collection report reason is rejected by a direct insert",
]) {
  assert.match(sqlTests, new RegExp(requiredScenario), `Missing test: ${requiredScenario}`);
}

for (const generatedRelationship of [
  "collection_decks_deck_owner_fkey",
  "study_session_cards_session_owner_fkey",
  "study_events_session_owner_fkey",
]) {
  assert.match(
    generatedTypes,
    new RegExp(`\\b${generatedRelationship}\\b`),
    `Generated types are missing ${generatedRelationship}`,
  );
}

for (const nullableAiSignature of [
  "p_ip_hash: string | null",
  "reserved_request_id: string | null",
  "p_provider_error_category?: string | null",
]) {
  assert.match(
    generatedTypes,
    new RegExp(nullableAiSignature.replace(/[?|]/g, "\\$&")),
    `Generated types lost RPC nullability: ${nullableAiSignature}`,
  );
}

assert.match(communityFunctions, /\.rpc\("duplicate_public_deck_atomic"/);
assert.match(communityFunctions, /"duplicate_public_collection_atomic"/);
assert.doesNotMatch(
  communityFunctions.slice(
    communityFunctions.indexOf("export const duplicatePublicDeck"),
    communityFunctions.indexOf("export const getCreatorProfile"),
  ),
  /\.from\("(?:decks|cards|collections|collection_decks)"\)/,
  "Marketplace duplication must use the atomic database RPCs",
);

assert.match(reportValidation, /REPORT_REASON_MIN_LENGTH = 3/);
assert.match(reportValidation, /REPORT_REASON_MAX_LENGTH = 400/);
assert.match(reportValidation, /Array\.from\(value\)\.length/);
assert.match(communityFunctions, /export const reportCollection = createServerFn/);
assert.match(communityFunctions, /\.inputValidator\(parseCollectionReportInput\)/);
assert.match(communityFunctions, /\.inputValidator\(parseDeckReportInput\)/);
assert.equal(
  communityFunctions.match(/throw new Error\(reportDatabaseErrorMessage\(error\)\)/g)?.length,
  2,
  "Both report types must hide raw database errors",
);
assert.match(communityRoute, /maxLength=\{REPORT_REASON_MAX_LENGTH\}/);
assert.match(communityRoute, /safeReportClientErrorMessage\(error\)/);

console.log("Database integrity static audit passed.");
