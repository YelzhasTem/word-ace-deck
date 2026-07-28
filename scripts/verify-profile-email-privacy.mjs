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

async function verifyAnonRestApi() {
  const headers = {
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`,
  };
  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=*&user_id=eq.${encodeURIComponent(userBId)}`,
    { headers },
  );
  assert.equal(profileResponse.status, 200, "anon REST could not read a public profile");
  const profiles = await profileResponse.json();
  assert.equal(profiles.length, 1, "anon REST returned an unexpected public profile count");
  assertSafeProfile(profiles[0], "anon REST");

  const emailResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=email&user_id=eq.${encodeURIComponent(userBId)}`,
    { headers },
  );
  assert.notEqual(emailResponse.status, 200, "anon REST explicitly selected profiles.email");

  const privateResponse = await fetch(`${supabaseUrl}/rest/v1/profile_private?select=user_id`, {
    headers,
  });
  assert.notEqual(privateResponse.status, 200, "anon REST accessed profile_private");
}

async function assertEmailCannotBeSelected(client, label, userId) {
  const { error } = await client.from("profiles").select("email").eq("user_id", userId);
  assert.ok(error, `${label} explicitly selected profiles.email`);
}

async function readPublicProfile(client, label, userId) {
  const { data, error } = await client.from("profiles").select("*").eq("user_id", userId).single();
  assert.ifError(error);
  assertSafeProfile(data, label);
  await assertEmailCannotBeSelected(client, label, userId);
  return data;
}

async function readAndUpdateOwnPrivateData(client, label, userId) {
  const { data, error } = await client
    .from("profile_private")
    .select("user_id, native_language")
    .eq("user_id", userId)
    .single();
  assert.ifError(error);

  const { error: updateError } = await client
    .from("profile_private")
    .update({ native_language: data.native_language })
    .eq("user_id", userId);
  assert.ifError(updateError);
  assert.equal(data.user_id, userId, `${label} read another user's private row`);
}

async function updateOwnPublicProfile(client, label, userId) {
  const { data, error } = await client
    .from("profiles")
    .select("display_name")
    .eq("user_id", userId)
    .single();
  assert.ifError(error);

  const { error: updateError } = await client
    .from("profiles")
    .update({ display_name: data.display_name })
    .eq("user_id", userId);
  assert.ifError(updateError);
  assert.ok(data, `${label} could not read its own public profile`);
}

async function assertCannotReadPrivateData(client, label, otherUserId) {
  const { data, error } = await client
    .from("profile_private")
    .select("user_id")
    .eq("user_id", otherUserId);
  assert.ifError(error);
  assert.deepEqual(data, [], `${label} read another user's private data`);
}

async function assertCannotUpdateOtherProfile(client, label, otherUserId, displayName) {
  const { data, error } = await client
    .from("profiles")
    .update({ display_name: displayName })
    .eq("user_id", otherUserId)
    .select("user_id");
  assert.ifError(error);
  assert.deepEqual(data, [], `${label} updated another user's profile`);
}

async function assertCannotUpdateOtherPrivateData(client, label, otherUserId) {
  const { data, error } = await client
    .from("profile_private")
    .update({ native_language: "en" })
    .eq("user_id", otherUserId)
    .select("user_id");
  assert.ifError(error);
  assert.deepEqual(data, [], `${label} updated another user's private data`);
}

async function assertCannotUpdateSystemProfileField(client, label, userId) {
  const { error } = await client
    .from("profiles")
    .update({ created_at: new Date().toISOString() })
    .eq("user_id", userId);
  assert.ok(error, `${label} updated a system-managed profile field`);
}

async function assertPublicDeckVisible(client, label, ownerId) {
  const { data, error } = await client
    .from("decks")
    .select("id, user_id, name, visibility")
    .eq("user_id", ownerId)
    .eq("visibility", "public")
    .limit(1);
  assert.ifError(error);
  assert.ok(data.length > 0, `${label} could not read the expected public marketplace deck`);
}

await verifyAnonRestApi();
await readPublicProfile(anon, "anon Supabase JS", userBId);
const { error: anonPrivateError } = await anon.from("profile_private").select("user_id").limit(1);
assert.ok(anonPrivateError, "anon accessed profile_private");
await assertPublicDeckVisible(anon, "anon", userBId);

const userBPublicProfile = await readPublicProfile(userA, "user A", userBId);
await updateOwnPublicProfile(userA, "user A", userAId);
await readAndUpdateOwnPrivateData(userA, "user A", userAId);
await assertCannotReadPrivateData(userA, "user A", userBId);
await assertCannotUpdateOtherProfile(userA, "user A", userBId, userBPublicProfile.display_name);
await assertCannotUpdateOtherPrivateData(userA, "user A", userBId);
await assertCannotUpdateSystemProfileField(userA, "user A", userAId);

const usernamePrefix = userBPublicProfile.username.slice(0, 2);
const { data: friendSearch, error: friendSearchError } = await userA.rpc("search_friend_profiles", {
  _query: usernamePrefix,
  _limit: 12,
});
assert.ifError(friendSearchError);
for (const row of friendSearch ?? []) {
  assert.equal("email" in row, false, "friend search returned email");
}

await assertPublicDeckVisible(userA, "user A", userBId);

const userAPublicProfile = await readPublicProfile(userB, "user B", userAId);
await updateOwnPublicProfile(userB, "user B", userBId);
await readAndUpdateOwnPrivateData(userB, "user B", userBId);
await assertCannotReadPrivateData(userB, "user B", userAId);
await assertCannotUpdateOtherProfile(userB, "user B", userAId, userAPublicProfile.display_name);
await assertCannotUpdateOtherPrivateData(userB, "user B", userAId);
await assertCannotUpdateSystemProfileField(userB, "user B", userBId);
await assertPublicDeckVisible(userB, "user B", userAId);

console.log("Profile email privacy verification passed.");
