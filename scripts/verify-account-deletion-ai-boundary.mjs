import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { requireLocalDeletionFixture } from "./account-deletion-local-guard.ts";
import { deletionFixtureSql as sql, fixtureUuid as uuid } from "./account-deletion-fixture-db.ts";
const url = requireLocalDeletionFixture(process.env.SUPABASE_URL);
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_PUBLISHABLE_KEY);
const originalFetch = globalThis.fetch;
// Even a regression must not reach Gemini or any other external provider.
globalThis.fetch = (input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname),
    "External network forbidden in deletion AI test",
  );
  return originalFetch(input, init);
};
const root = path.resolve(".vercel/output/functions/__server.func");
const ai = readdirSync(path.join(root, "_ssr")).find((name) =>
  /^ai\.functions-.*\.mjs$/.test(name),
);
assert.ok(ai, "Build NITRO_PRESET=vercel before this fixture");
const source = readFileSync(path.join(root, "_ssr", ai), "utf8");
const endpoints = [
  ...source.matchAll(/createServerRpc\(\{\s*id: "([a-f0-9]+)",\s*name: "([^"]+)"/g),
];
assert.equal(endpoints.length, 7);
const app = (await import(pathToFileURL(path.join(root, "index.mjs")).href)).default;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const client = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY, options);
const password = `Aa1!${randomUUID()}`;
const email = `stage3-ai-${randomUUID()}@example.invalid`;
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { username: `s3ai_${randomUUID().slice(0, 8)}` },
});
assert.equal(created.error, null);
const user = created.data.user;
assert.ok(user);
let checked = 0;
try {
  const session = await client.auth.signInWithPassword({ email, password });
  assert.equal(session.error, null);
  const token = session.data.session.access_token;
  const request = async (id, auth) => {
    const headers = { "x-tsr-serverFn": "true" };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const response = await app.fetch(
      new Request(`http://localhost/_serverFn/${id}`, { method: "POST", headers }),
    );
    await response.text();
    return response.status;
  };
  for (const [, id] of endpoints) {
    assert.equal(await request(id), 401);
    checked++;
  }
  const job = await client.rpc("request_account_deletion");
  assert.equal(job.error, null);
  for (const [, id] of endpoints) {
    assert.equal(await request(id, token), 403);
    checked++;
  }
  assert.equal((await admin.auth.admin.deleteUser(user.id)).error, null);
  for (const [, id] of endpoints) {
    assert.equal(await request(id, token), 403);
    checked++;
  }
  assert.equal(
    sql(`SELECT count(*) FROM public.ai_usage_events WHERE user_id=${uuid(user.id)}`),
    "0",
  );
  console.log(
    `PASS ${checked} built Vercel-handler AI auth/pending/stale-JWT checks; no external provider calls`,
  );
} finally {
  const found = await admin.auth.admin.getUserById(user.id);
  if (found.data.user) assert.equal((await admin.auth.admin.deleteUser(user.id)).error, null);
  assert.equal(sql(`SELECT private.account_deletion_residual_count(${uuid(user.id)})`), "0");
  sql(
    `DELETE FROM private.account_deletion_jobs WHERE user_ref_hash=private.account_deletion_user_hash(${uuid(user.id)})`,
  );
  globalThis.fetch = originalFetch;
}
