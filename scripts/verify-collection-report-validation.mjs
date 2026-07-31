import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && publishableKey && serviceRoleKey, "Supabase test environment is incomplete");

const hostname = new URL(url).hostname;
assert.ok(
  hostname === "127.0.0.1" || hostname === "localhost",
  "Collection report fixture is restricted to local Supabase",
);

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const userClient = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const email = `collection-report-${suffix}@example.invalid`;
const password = `Collection-Report-${randomUUID()}-Aa1!`;
let userId;
let collectionId;

async function insertReason(reason) {
  return userClient.from("collection_reports").insert({
    collection_id: collectionId,
    reporter_id: userId,
    reason,
  });
}

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `collection_report_${suffix}` },
  });
  assert.ifError(createError);
  assert.ok(created.user);
  userId = created.user.id;

  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
  assert.ifError(signInError);

  const { data: collection, error: collectionError } = await admin
    .from("collections")
    .insert({
      user_id: userId,
      name: "Collection report validation fixture",
      visibility: "public",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  assert.ifError(collectionError);
  assert.ok(collection);
  collectionId = collection.id;

  for (const reason of ["  abc  ", "Ordinary report reason", "界".repeat(400), "😀😀😀"]) {
    const { error } = await insertReason(reason);
    assert.ifError(error);
  }

  // PostgreSQL can coerce JSON scalars to TEXT, so input types are enforced by
  // the server schema unit test; this direct path verifies stored text invariants.
  for (const reason of ["", "   ", "x", "no", "x".repeat(401), null]) {
    const { error } = await insertReason(reason);
    assert.ok(error, "Direct Supabase insert unexpectedly bypassed report validation");
  }
} finally {
  if (collectionId) await admin.from("collections").delete().eq("id", collectionId);
  if (userId) await admin.auth.admin.deleteUser(userId);
}

console.log("Collection report validation fixture passed.");
