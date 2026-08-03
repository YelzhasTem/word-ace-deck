import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  "supabase/migrations/20260803010000_atomic_account_deletion.sql",
  "utf8",
);
const accountFunctions = await readFile("src/lib/account.functions.ts", "utf8");
const accountAdmin = await readFile("src/lib/account-deletion-admin.ts", "utf8");
const workflow = await readFile("src/lib/account-deletion-workflow.ts", "utf8");
const server = await readFile("src/lib/account-deletion.server.ts", "utf8");
const operatorScript = await readFile("scripts/resume-account-deletion-job.ts", "utf8");
const authMiddleware = await readFile("src/integrations/supabase/auth-middleware.ts", "utf8");
const profile = await readFile("src/routes/profile.tsx", "utf8");
const generatedTypes = await readFile("src/integrations/supabase/types.ts", "utf8");
const sqlTests = await readFile("supabase/tests/account_deletion.sql", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const workflowFile = await readFile(".github/workflows/account-deletion.yml", "utf8");
const documentation = await readFile("docs/account-deletion.md", "utf8");

assert.match(migration, /^BEGIN;/);
assert.match(migration, /COMMIT;\s*$/);
assert.match(migration, /CREATE TABLE private\.account_deletion_jobs/);
const jobDefinition = migration.slice(
  migration.indexOf("CREATE TABLE private.account_deletion_jobs"),
  migration.indexOf("CREATE INDEX account_deletion_jobs_retry_idx"),
);
assert.doesNotMatch(jobDefinition, /REFERENCES auth\.users/);
assert.match(jobDefinition, /user_id UUID/);
assert.match(jobDefinition, /user_ref_hash TEXT NOT NULL UNIQUE/);
assert.match(jobDefinition, /attempt_count INTEGER/);
assert.match(jobDefinition, /lease_token UUID/);
assert.match(jobDefinition, /next_retry_at TIMESTAMPTZ/);
assert.match(jobDefinition, /retention_until TIMESTAMPTZ/);

const securityDefinerRpcs = [
  "is_account_deletion_pending",
  "request_account_deletion",
  "get_my_account_deletion_status",
  "claim_account_deletion_job",
  "renew_account_deletion_lease",
  "advance_account_deletion_job",
  "fail_account_deletion_job",
  "finalize_account_deletion_database",
  "purge_expired_account_deletion_jobs",
];
for (const rpc of securityDefinerRpcs) {
  assert.match(migration, new RegExp(`FUNCTION public\\.${rpc}\\(`), `Missing ${rpc}`);
  assert.match(generatedTypes, new RegExp(`\\b${rpc}:`), `Generated types are missing ${rpc}`);
  const start = migration.indexOf(`FUNCTION public.${rpc}(`);
  const end = migration.indexOf("$function$;", start);
  const definition = migration.slice(start, end);
  assert.match(definition, /SECURITY DEFINER/, `${rpc} must be SECURITY DEFINER`);
  assert.match(definition, /SET search_path = /, `${rpc} must fix search_path`);
}

const requestSignature = migration.match(
  /FUNCTION public\.request_account_deletion\(([\s\S]*?)\)\nRETURNS/,
);
assert.ok(requestSignature);
assert.doesNotMatch(requestSignature[1], /user_id|uuid/i);
assert.match(migration, /UUID := auth\.uid\(\)/);
assert.match(migration, /ALTER TABLE private\.account_deletion_jobs ENABLE ROW LEVEL SECURITY/);
assert.match(
  migration,
  /REVOKE ALL ON TABLE private\.account_deletion_jobs FROM PUBLIC, anon, authenticated/,
);
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.request_account_deletion\(\) TO authenticated/,
);
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.claim_account_deletion_job\(UUID\) TO service_role/,
);
assert.doesNotMatch(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.claim_account_deletion_job\(UUID\) TO (?:anon|authenticated|PUBLIC)/,
);
assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
assert.match(migration, /job\.user_ref_hash = private\.account_deletion_user_hash\(p_user_id\)/);
assert.match(migration, /ACCOUNT_DELETION_STORAGE_NOT_EMPTY/);
assert.match(migration, /DELETE FROM public\.study_events WHERE user_id = v_user_id/);
assert.match(migration, /DELETE FROM private\.content_creation_requests WHERE user_id = v_user_id/);
assert.match(migration, /user_id = NULL,[\s\S]+status = 'completed'/);
assert.match(migration, /INTERVAL '30 days'/);
assert.match(migration, /INTERVAL '90 days'/);
assert.match(migration, /block_pending_account_mutation/);
assert.match(migration, /NOT public\.is_account_deletion_pending\(\)/g);

assert.doesNotMatch(
  accountFunctions,
  /deleteWhere|storage\.from|auth\.admin\.deleteUser|\.delete\(\)/,
);
const deleteAccountInput = accountFunctions.match(/const DeleteAccountInput = ([^;]+);/)?.[1];
assert.ok(deleteAccountInput);
assert.doesNotMatch(deleteAccountInput, /userId|user_id|uuid/);
const deleteHandler = accountFunctions.slice(
  accountFunctions.indexOf("export const deleteMyAccount"),
  accountFunctions.indexOf("export const resumeAccountDeletion"),
);
assert.doesNotMatch(deleteHandler, /p_user_id|user_id:/);
assert.match(accountFunctions, /requireSupabaseSession/);
assert.match(accountFunctions, /request_account_deletion/);
assert.match(accountFunctions, /executeAccountDeletion\(job\.job_id, context\.userId\)/);
assert.match(accountFunctions, /confirmation: z\.literal\("DELETE"\)/);
assert.match(accountFunctions, /error instanceof AccountDeletionWorkflowError/);
assert.doesNotMatch(
  accountFunctions,
  /(?:rpc|role)\.error\.message|throw error|JSON\.stringify\(error/,
);
const resumeHandler = accountFunctions.slice(
  accountFunctions.indexOf("export const resumeAccountDeletion"),
);
assert.match(resumeHandler, /createServerFn\(\{ method: "POST" \}\)/);
assert.match(resumeHandler, /middleware\(\[requireSupabaseAuth\]\)/);
assert.match(resumeHandler, /executeAccountDeletionAsAdmin/);
assert.match(resumeHandler, /return \{ ok: true as const, status: result\.status \}/);
assert.doesNotMatch(resumeHandler, /userId:\s*data|data\.userId|data\.user_id/);
assert.match(accountAdmin, /AccountDeletionAdminRoleLookup/);
assert.match(accountAdmin, /if \(role\.error \|\| !role\.data\)/);
assert.match(accountAdmin, /statusCode|AccountDeletionWorkflowError/);
assert.match(server, /caller\.rpc\("has_role"/);
assert.match(server, /_role: "admin"/);
assert.match(server, /return executeAccountDeletion\(jobId\)/);
assert.doesNotMatch(accountAdmin + server, /email|access_token|refresh_token|storage.*path/i);

const mutatingServerFiles = [
  "src/lib/ai.functions.ts",
  "src/lib/decks.functions.ts",
  "src/lib/collections.functions.ts",
  "src/lib/community.functions.ts",
  "src/lib/friends.functions.ts",
];
for (const file of mutatingServerFiles) {
  const source = await readFile(file, "utf8");
  const starts = [...source.matchAll(/createServerFn\(\{ method: "POST" \}\)/g)].map(
    (match) => match.index,
  );
  for (const [position, start] of starts.entries()) {
    const end = starts[position + 1] ?? source.length;
    assert.match(
      source.slice(start, end),
      /\.middleware\(\[requireSupabaseAuth\]\)/,
      `${file} has a POST server function without pending-deletion middleware`,
    );
  }
}

assert.match(workflow, /ACCOUNT_DELETION_STORAGE_PAGE_SIZE = 100/);
assert.match(workflow, /while \(true\)/);
assert.match(workflow, /collectStorageFiles\(storage, path, onProgress\)/);
assert.match(workflow, /MAX_STORAGE_CLEANUP_PASSES/);
assert.match(workflow, /backend\.renewLease/);
assert.match(workflow, /backend\.cleanupStorage\(userId/);
assert.match(workflow, /backend\.deleteAuthUser\(userId\)/);
assert.match(workflow, /backend\.finalizeDatabase/);
assert.match(server, /supabaseAdmin\.auth\.admin\.deleteUser/);
assert.match(server, /isMissingAuthUser/);
assert.match(server, /supabaseAdmin\.storage\.from\("avatars"\)/);
assert.doesNotMatch(server, /VITE_SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(
  server + accountAdmin + operatorScript,
  /console\.(?:log|error)|JSON\.stringify\(error/,
);
assert.match(operatorScript, /JobIdSchema/);
assert.match(operatorScript, /executeAccountDeletion\(jobId\.data\)/);
assert.doesNotMatch(operatorScript, /user[_-]?id|email|token|storage.*path/i);

assert.match(authMiddleware, /requireSupabaseSession/);
assert.match(authMiddleware, /is_account_deletion_pending/);
assert.match(authMiddleware, /ACCOUNT_DELETION_ALREADY_IN_PROGRESS/);
assert.match(profile, /deleteConfirmation !== "DELETE"/);
assert.match(profile, /localStorage\.clear\(\)/);
assert.match(profile, /sessionStorage\.clear\(\)/);
assert.match(profile, /window\.location\.replace\("\/"\)/);
assert.doesNotMatch(profile, /getUserErrorMessage\(error, "Could not delete your account/);

for (const testName of [
  "repeated requests return the same deletion job",
  "a concurrent worker cannot acquire the active job",
  "an Auth Admin failure leaves a retryable job",
  "the deletion job survives Auth user deletion",
  "database finalization transaction repairs synthetic legacy leftovers",
  "completed deletion has no Auth, database, private, or avatar residue",
  "another user and their content are untouched",
  "a previously issued JWT remains blocked after completed Auth deletion",
  "a stale retry after completion returns the same completed job",
]) {
  assert.match(sqlTests, new RegExp(testName), `Missing SQL test: ${testName}`);
}

assert.ok(packageJson.scripts["check:account-deletion"]);
assert.ok(packageJson.scripts["test:account-deletion:fixture"]);
assert.match(workflowFile, /npm run check:account-deletion/);
assert.match(workflowFile, /supabase db reset --local/);
assert.match(workflowFile, /supabase test db/);
assert.match(workflowFile, /verify-account-deletion\.ts/);
assert.match(workflowFile, /resume-account-deletion-job\.ts/);
assert.match(workflowFile, /Verify service-role credentials are absent from browser assets/);
assert.match(documentation, /Supabase Storage and Supabase Auth are separate services/);
assert.match(
  documentation,
  /Completed jobs retain only pseudonymous operational metadata for 30 days/,
);
assert.match(documentation, /does\s+not claim to provide universal recent reauthentication/);
assert.match(documentation, /npm run account-deletion:resume -- --job-id <job-id>/);
assert.match(documentation, /No automatic retry scheduler is installed/);
assert.match(documentation, /future operational task/i);

console.log("Account deletion static audit passed.");
