import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const aiSource = await readFile("src/lib/ai.functions.ts", "utf8");
const authSource = await readFile("src/integrations/supabase/auth-middleware.ts", "utf8");
const authTokenSource = await readFile("src/integrations/supabase/auth-token.ts", "utf8");
const quotaSource = await readFile("src/lib/ai-security.server.ts", "utf8");
const errorSource = await readFile("src/lib/server-http-error.ts", "utf8");
const urlSource = await readFile("src/lib/safe-url-fetch.server.ts", "utf8");
const migration = await readFile("supabase/migrations/20260730003000_harden_ai_usage.sql", "utf8");
const envExample = await readFile(".env.example", "utf8");

assert.equal(aiSource.includes("generateClozeSentence"), false, "Unused cloze endpoint is present");
assert.equal(
  (aiSource.match(/createServerFn\(\{ method: "POST" \}\)/g) ?? []).length,
  7,
  "Unexpected number of public AI server functions",
);
assert.equal(
  (aiSource.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? []).length,
  7,
  "Every AI server function must require server-side auth",
);
assert.equal(
  (aiSource.match(/idempotencyKey: IdempotencyKeyInput/g) ?? []).length,
  7,
  "Every AI endpoint must require an idempotency key",
);
assert.match(aiSource, /maxOutputTokens: endpointConfig\.maxOutputTokens/);
assert.match(aiSource, /GEMINI_TIMEOUT_MS/);
assert.doesNotMatch(aiSource, /GEMINI_FALLBACK_MODEL/);
assert.match(authSource, /httpError\(401/);
assert.match(authSource, /verifySupabaseAuthorization/);
assert.match(authSource, /Authorization: `Bearer \$\{auth\.token\}`/);
assert.match(authTokenSource, /claims\.role === \"anon\"/);
assert.match(quotaSource, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(quotaSource, /x-vercel-forwarded-for/);
assert.match(quotaSource, /createHmac\(\"sha256\"/);
assert.match(errorSource, /HTTP \$\{statusCode\}/);
assert.match(urlSource, /redirect: \"manual\"/);
assert.match(urlSource, /buildConnector/);
assert.match(urlSource, /URL_FETCH_MAX_BYTES = 512 \* 1024/);
assert.doesNotMatch(urlSource, /redirect:\s*["']follow["']/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
assert.match(migration, /FROM PUBLIC, anon, authenticated/g);
assert.match(migration, /TO service_role/g);
assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/g);
assert.match(envExample, /^AI_IP_HASH_SALT=$/m);

console.log("AI security static checks passed.");
