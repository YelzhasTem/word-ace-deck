import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SECURITY_TEST_USER_A_ACCESS_TOKEN",
  "SECURITY_TEST_USER_A_ID",
  "SECURITY_TEST_USER_B_ACCESS_TOKEN",
  "SECURITY_TEST_USER_B_ID",
];

for (const name of requiredEnvironment) {
  assert.ok(process.env[name], `Missing ${name}`);
}

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const userAId = process.env.SECURITY_TEST_USER_A_ID;
const userBId = process.env.SECURITY_TEST_USER_B_ID;

function testClient(accessToken) {
  return createClient(supabaseUrl, publishableKey, {
    global: accessToken
      ? {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      : undefined,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

const anon = testClient();
const userA = testClient(process.env.SECURITY_TEST_USER_A_ACCESS_TOKEN);
const userB = testClient(process.env.SECURITY_TEST_USER_B_ACCESS_TOKEN);
const allowedProfileFields = new Set([
  "id",
  "user_id",
  "username",
  "display_name",
  "avatar_url",
  "created_at",
  "updated_at",
]);

function assertSafeProfile(row, label) {
  assert.ok(row, `${label} did not return a profile`);
  assert.equal("email" in row, false, `${label} returned email`);
  for (const field of Object.keys(row)) {
    assert.ok(allowedProfileFields.has(field), `${label} returned unexpected field ${field}`);
  }
}

async function assertEmailCannotBeSelected(client, label, userId) {
  const { error } = await client.from("profiles").select("email").eq("user_id", userId);
  assert.ok(error, `${label} explicitly selected profiles.email`);
}

async function readPublicProfile(client, label) {
  const { data, error } = await client.from("profiles").select("*").eq("user_id", userBId).single();
  assert.ifError(error);
  assertSafeProfile(data, label);
  await assertEmailCannotBeSelected(client, label, userBId);
  return data;
}

await readPublicProfile(anon, "anon");
const { error: anonPrivateError } = await anon.from("profile_private").select("user_id").limit(1);
assert.ok(anonPrivateError, "anon accessed profile_private");

const userBPublicProfile = await readPublicProfile(userA, "user A");
const { data: userBPrivateForA, error: userBPrivateForAError } = await userA
  .from("profile_private")
  .select("user_id")
  .eq("user_id", userBId);
assert.ifError(userBPrivateForAError);
assert.deepEqual(userBPrivateForA, [], "user A read user B private data");

const { data: userAPrivate, error: userAPrivateError } = await userA
  .from("profile_private")
  .select("user_id, native_language")
  .eq("user_id", userAId)
  .single();
assert.ifError(userAPrivateError);

const { error: ownPrivateUpdateError } = await userA
  .from("profile_private")
  .update({ native_language: userAPrivate.native_language })
  .eq("user_id", userAId);
assert.ifError(ownPrivateUpdateError);

const { data: forbiddenProfileUpdate, error: forbiddenProfileUpdateError } = await userA
  .from("profiles")
  .update({ display_name: userBPublicProfile.display_name })
  .eq("user_id", userBId)
  .select("user_id");
assert.ifError(forbiddenProfileUpdateError);
assert.deepEqual(forbiddenProfileUpdate, [], "user A updated user B profile");

const { data: forbiddenPrivateUpdate, error: forbiddenPrivateUpdateError } = await userA
  .from("profile_private")
  .update({ native_language: userAPrivate.native_language })
  .eq("user_id", userBId)
  .select("user_id");
assert.ifError(forbiddenPrivateUpdateError);
assert.deepEqual(forbiddenPrivateUpdate, [], "user A updated user B private data");

const usernamePrefix = userBPublicProfile.username.slice(0, 2);
const { data: friendSearch, error: friendSearchError } = await userA.rpc("search_friend_profiles", {
  _query: usernamePrefix,
  _limit: 12,
});
assert.ifError(friendSearchError);
for (const row of friendSearch ?? []) {
  assert.equal("email" in row, false, "friend search returned email");
}

const { data: publicDecks, error: publicDecksError } = await userA
  .from("decks")
  .select("id, user_id, name, visibility")
  .eq("user_id", userBId)
  .eq("visibility", "public")
  .limit(1);
assert.ifError(publicDecksError);
assert.ok(publicDecks.length > 0, "user B must own a public deck for this verification");

await readPublicProfile(userB, "user B");
const { data: userAPrivateForB, error: userAPrivateForBError } = await userB
  .from("profile_private")
  .select("user_id")
  .eq("user_id", userAId);
assert.ifError(userAPrivateForBError);
assert.deepEqual(userAPrivateForB, [], "user B read user A private data");

console.log("Profile email privacy verification passed.");
