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
  "Atomic deck fixture is restricted to local Supabase",
);

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const password = `Atomic-Deck-${randomUUID()}-Aa1!`;
const userIds = [];

function userClient() {
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createUser(label) {
  const email = `atomic-deck-${suffix}-${label}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `atomic_deck_${suffix}_${label}` },
  });
  assert.ifError(error);
  assert.ok(data.user);
  userIds.push(data.user.id);

  const client = userClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  assert.ifError(signInError);
  return { id: data.user.id, client };
}

function createArgs(name, idempotencyKey, useDefaultCollection = false) {
  return {
    p_name: name,
    p_description: "Atomic integration fixture",
    p_cover_color: null,
    p_target_language: "en",
    p_definition_language: "ru",
    p_cards: [
      { term: `${name}-one`, definition: "один", position: 0 },
      { term: `${name}-two`, definition: "два", position: 1 },
    ],
    p_collection_id: null,
    p_use_default_collection: useDefaultCollection,
    p_idempotency_key: idempotencyKey,
  };
}

try {
  const userA = await createUser("a");
  const userB = await createUser("b");

  const replayKey = randomUUID();
  const concurrentResults = await Promise.all([
    userA.client.rpc("create_deck_with_cards", createArgs("Concurrent replay", replayKey)),
    userA.client.rpc("create_deck_with_cards", createArgs("Concurrent replay", replayKey)),
  ]);
  for (const result of concurrentResults) assert.ifError(result.error);
  const concurrentIds = concurrentResults.map((result) => result.data?.[0]?.deck_id);
  assert.ok(concurrentIds.every(Boolean));
  assert.equal(new Set(concurrentIds).size, 1, "Concurrent retry created duplicate deck IDs");
  assert.deepEqual(
    concurrentResults.map((result) => result.data[0].duplicate).sort(),
    [false, true],
    "One concurrent caller must create and the other must replay",
  );

  const conflict = await userA.client.rpc(
    "create_deck_with_cards",
    createArgs("Changed concurrent payload", replayKey),
  );
  assert.ok(conflict.error?.message.includes("IDEMPOTENCY_CONFLICT"));

  const { error: deleteReplayResultError } = await admin
    .from("decks")
    .delete()
    .eq("id", concurrentIds[0]);
  assert.ifError(deleteReplayResultError);
  const deletedReplay = await userA.client.rpc(
    "create_deck_with_cards",
    createArgs("Concurrent replay", replayKey),
  );
  assert.ok(
    deletedReplay.error?.message.includes("IDEMPOTENCY_RESULT_GONE"),
    "A deleted result must not be returned as a successful replay",
  );

  const defaultResults = await Promise.all([
    userA.client.rpc(
      "create_deck_with_cards",
      createArgs("Concurrent default one", randomUUID(), true),
    ),
    userA.client.rpc(
      "create_deck_with_cards",
      createArgs("Concurrent default two", randomUUID(), true),
    ),
    userB.client.rpc(
      "create_deck_with_cards",
      createArgs("Independent user default", randomUUID(), true),
    ),
  ]);
  for (const result of defaultResults) assert.ifError(result.error);
  const defaultCollectionIds = defaultResults
    .slice(0, 2)
    .map((result) => result.data?.[0]?.collection_id);
  assert.ok(defaultCollectionIds.every(Boolean));
  assert.equal(
    new Set(defaultCollectionIds).size,
    1,
    "Concurrent requests selected different default collections",
  );
  assert.notEqual(
    defaultResults[0].data?.[0]?.collection_id,
    defaultResults[2].data?.[0]?.collection_id,
    "Different users must receive independent default collections",
  );
  const { count: defaultCount, error: defaultCountError } = await admin
    .from("collections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userA.id)
    .eq("name", "My collection");
  assert.ifError(defaultCountError);
  assert.equal(defaultCount, 1, "Concurrent requests created duplicate default collections");
  const { count: userBDefaultCount, error: userBDefaultCountError } = await admin
    .from("collections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userB.id)
    .eq("name", "My collection");
  assert.ifError(userBDefaultCountError);
  assert.equal(userBDefaultCount, 1, "A second user's default collection was not independent");

  const { data: sourceDeck, error: sourceDeckError } = await admin
    .from("decks")
    .insert({
      user_id: userB.id,
      name: "Atomic public source",
      visibility: "public",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  assert.ifError(sourceDeckError);
  const { error: sourceCardsError } = await admin.from("cards").insert([
    {
      deck_id: sourceDeck.id,
      user_id: userB.id,
      term: "source-one",
      definition: "source definition one",
      position: 0,
    },
    {
      deck_id: sourceDeck.id,
      user_id: userB.id,
      term: "source-two",
      definition: "source definition two",
      position: 1,
    },
  ]);
  assert.ifError(sourceCardsError);

  const copyKey = randomUUID();
  const firstCopy = await userA.client.rpc("duplicate_public_deck_atomic", {
    p_source_deck_id: sourceDeck.id,
    p_idempotency_key: copyKey,
  });
  const replayCopy = await userA.client.rpc("duplicate_public_deck_atomic", {
    p_source_deck_id: sourceDeck.id,
    p_idempotency_key: copyKey,
  });
  assert.ifError(firstCopy.error);
  assert.ifError(replayCopy.error);
  assert.equal(firstCopy.data[0].deck_id, replayCopy.data[0].deck_id);
  assert.equal(replayCopy.data[0].duplicate, true);
  const { count: copiedCardCount, error: copiedCardsError } = await admin
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", firstCopy.data[0].deck_id);
  assert.ifError(copiedCardsError);
  assert.equal(copiedCardCount, 2, "Atomic deck copy omitted cards");

  const { data: sourceCollection, error: sourceCollectionError } = await admin
    .from("collections")
    .insert({
      user_id: userB.id,
      name: "Atomic public collection source",
      visibility: "public",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  assert.ifError(sourceCollectionError);
  const { error: sourceLinkError } = await admin.from("collection_decks").insert({
    collection_id: sourceCollection.id,
    deck_id: sourceDeck.id,
    user_id: userB.id,
    position: 0,
  });
  assert.ifError(sourceLinkError);

  const collectionCopy = await userA.client.rpc("duplicate_public_collection_atomic", {
    p_source_collection_id: sourceCollection.id,
    p_idempotency_key: randomUUID(),
  });
  assert.ifError(collectionCopy.error);
  assert.equal(collectionCopy.data[0].deck_ids.length, 1);
  const { count: copiedLinkCount, error: copiedLinkError } = await admin
    .from("collection_decks")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", collectionCopy.data[0].collection_id);
  assert.ifError(copiedLinkError);
  assert.equal(copiedLinkCount, 1, "Atomic collection copy omitted its deck link");
} finally {
  for (const userId of userIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error("Could not remove one local atomic-deck fixture user.");
  }
}

console.log("Atomic deck creation concurrency fixture passed and removed its users.");
