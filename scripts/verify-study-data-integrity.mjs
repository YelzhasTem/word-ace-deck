import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "STUDY_TEST_USER_A_ACCESS_TOKEN",
  "STUDY_TEST_USER_A_ID",
  "STUDY_TEST_USER_B_ACCESS_TOKEN",
  "STUDY_TEST_USER_B_ID",
  "STUDY_TEST_DECK_A_ID",
  "STUDY_TEST_CARD_A_ID",
  "STUDY_TEST_PRIVATE_DECK_B_ID",
  "STUDY_TEST_PRIVATE_CARD_B_ID",
  "STUDY_TEST_PUBLIC_DECK_B_ID",
  "STUDY_TEST_PUBLIC_CARD_B_ID",
];

for (const name of requiredEnvironment) {
  assert.ok(process.env[name], `Missing ${name}`);
}

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const expectWritesBlocked = process.env.STUDY_TEST_EXPECT_DIRECT_WRITES_BLOCKED !== "false";
const fixture = {
  userAId: process.env.STUDY_TEST_USER_A_ID,
  userBId: process.env.STUDY_TEST_USER_B_ID,
  deckAId: process.env.STUDY_TEST_DECK_A_ID,
  cardAId: process.env.STUDY_TEST_CARD_A_ID,
  privateDeckBId: process.env.STUDY_TEST_PRIVATE_DECK_B_ID,
  privateCardBId: process.env.STUDY_TEST_PRIVATE_CARD_B_ID,
  publicDeckBId: process.env.STUDY_TEST_PUBLIC_DECK_B_ID,
  publicCardBId: process.env.STUDY_TEST_PUBLIC_CARD_B_ID,
};

function client(accessToken) {
  return createClient(supabaseUrl, publishableKey, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const anon = client();
const userA = client(process.env.STUDY_TEST_USER_A_ACCESS_TOKEN);
const userB = client(process.env.STUDY_TEST_USER_B_ACCESS_TOKEN);

async function rpcOne(api, name, args) {
  const { data, error } = await api.rpc(name, args).single();
  assert.ifError(error);
  assert.ok(data, `${name} returned no data`);
  return data;
}

async function startSession(api, deckId, mode = "study", duration = undefined, key = randomUUID()) {
  return rpcOne(api, "start_study_session", {
    p_client_session_key: key,
    p_deck_id: deckId,
    p_mode: mode,
    p_duration_seconds: duration,
  });
}

async function recordAnswer(api, sessionId, cardId, options = {}) {
  return rpcOne(api, "record_study_answer", {
    p_idempotency_key: options.idempotencyKey ?? randomUUID(),
    p_session_id: sessionId,
    p_card_id: cardId,
    p_result: options.result ?? true,
    p_response_ms: options.responseMs ?? 1200,
    p_progress_key: options.progressKey,
  });
}

async function assertRpcDenied(api, name, args, label) {
  const { error } = await api.rpc(name, args);
  assert.ok(error, label);
}

async function assertMutationDenied(operation, label) {
  const { error } = await operation;
  assert.ok(error, label);
}

await assertRpcDenied(
  anon,
  "start_study_session",
  {
    p_client_session_key: randomUUID(),
    p_deck_id: fixture.deckAId,
    p_mode: "study",
  },
  "Anonymous user started a study session",
);

const sessionKey = randomUUID();
const sessionA = await startSession(userA, fixture.deckAId, "study", undefined, sessionKey);
const duplicateSessionA = await startSession(
  userA,
  fixture.deckAId,
  "study",
  undefined,
  sessionKey,
);
assert.equal(duplicateSessionA.session_id, sessionA.session_id, "Session start is not idempotent");

await assertRpcDenied(
  userA,
  "start_study_session",
  {
    p_client_session_key: sessionKey,
    p_deck_id: fixture.deckAId,
    p_mode: "type",
  },
  "A session key was reused with different parameters",
);

const eventKey = randomUUID();
const firstAnswer = await recordAnswer(userA, sessionA.session_id, fixture.cardAId, {
  idempotencyKey: eventKey,
});
assert.equal(firstAnswer.duplicate, false);
assert.equal(firstAnswer.correct_count, 1);
assert.equal(Number(firstAnswer.mastery), 0.25);

const duplicateAnswer = await recordAnswer(userA, sessionA.session_id, fixture.cardAId, {
  idempotencyKey: eventKey,
});
assert.equal(duplicateAnswer.duplicate, true, "Repeated answer was not detected");
assert.equal(duplicateAnswer.correct_count, 1, "Repeated answer changed progress");

await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: eventKey,
    p_session_id: sessionA.session_id,
    p_card_id: fixture.cardAId,
    p_result: false,
    p_response_ms: 1200,
  },
  "An idempotency key accepted a changed result",
);
await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_session_id: sessionA.session_id,
    p_card_id: fixture.cardAId,
    p_result: true,
    p_response_ms: -1,
  },
  "Negative response time was accepted",
);
await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_session_id: sessionA.session_id,
    p_card_id: fixture.privateCardBId,
    p_result: true,
  },
  "A card outside the session deck was accepted",
);
await assertRpcDenied(
  userA,
  "start_study_session",
  {
    p_client_session_key: randomUUID(),
    p_deck_id: fixture.privateDeckBId,
    p_mode: "study",
  },
  "User A started a session for user B's private deck",
);

const publicSession = await startSession(userA, fixture.publicDeckBId);
const publicAnswer = await recordAnswer(userA, publicSession.session_id, fixture.publicCardBId);
assert.equal(publicAnswer.correct_count, 1, "Public deck study did not update user A's progress");
await assertRpcDenied(
  userB,
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_session_id: sessionA.session_id,
    p_card_id: fixture.cardAId,
    p_result: true,
  },
  "User B wrote to user A's session",
);

const { data: userBProgress, error: userBProgressError } = await userB
  .from("card_progress")
  .select("id")
  .eq("user_id", fixture.userAId);
assert.ifError(userBProgressError);
assert.deepEqual(userBProgress, [], "User B read user A's progress");

const completionKey = randomUUID();
const completed = await rpcOne(userA, "complete_study_session", {
  p_session_id: sessionA.session_id,
  p_completion_key: completionKey,
});
assert.equal(completed.answer_count, 1);
const repeatedCompletion = await rpcOne(userA, "complete_study_session", {
  p_session_id: sessionA.session_id,
  p_completion_key: completionKey,
});
assert.equal(repeatedCompletion.duplicate, true, "Repeated completion was not idempotent");
await assertRpcDenied(
  userA,
  "complete_study_session",
  { p_session_id: sessionA.session_id, p_completion_key: randomUUID() },
  "Completed session accepted a different completion key",
);
await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_session_id: sessionA.session_id,
    p_card_id: fixture.cardAId,
    p_result: true,
  },
  "Completed session accepted another answer",
);

const speedSession = await startSession(userA, fixture.deckAId, "speed", 30);
await recordAnswer(userA, speedSession.session_id, fixture.cardAId, { result: true });
await recordAnswer(userA, speedSession.session_id, fixture.cardAId, { result: false });
const speedCompletionKey = randomUUID();
const speedResult = await rpcOne(userA, "complete_study_session", {
  p_session_id: speedSession.session_id,
  p_completion_key: speedCompletionKey,
});
assert.equal(speedResult.score, 110);
assert.equal(speedResult.accuracy, 50);
assert.equal(speedResult.max_combo, 1);
assert.equal(speedResult.answer_count, 2);
await rpcOne(userA, "complete_study_session", {
  p_session_id: speedSession.session_id,
  p_completion_key: speedCompletionKey,
});
const { count: speedRunCount, error: speedRunCountError } = await userA
  .from("speed_runs")
  .select("id", { count: "exact", head: true })
  .eq("session_id", speedSession.session_id);
assert.ifError(speedRunCountError);
assert.equal(speedRunCount, 1, "One speed session created more than one aggregate");

const { error: settingError } = await userA.from("deck_learning_settings").upsert(
  {
    user_id: fixture.userAId,
    deck_id: fixture.deckAId,
    delayed_recall_enabled: true,
  },
  { onConflict: "user_id,deck_id" },
);
assert.ifError(settingError);
const { data: scheduled, error: scheduleError } = await userA.rpc("schedule_recall_card", {
  p_card_id: fixture.cardAId,
});
assert.ifError(scheduleError);
assert.equal(scheduled, true);
const recallSession = await startSession(userA, fixture.deckAId, "recall");
const recallResult = await recordAnswer(userA, recallSession.session_id, fixture.cardAId);
assert.equal(recallResult.recall_score, 15);
assert.equal(recallResult.recall_stage_idx, 1);
assert.equal(recallResult.recall_interval_idx, 1);

const { data: known, error: knownError } = await userA.rpc("set_card_known", {
  p_card_id: fixture.cardAId,
  p_known: true,
});
assert.ifError(knownError);
assert.equal(known, true);
await assertRpcDenied(
  userA,
  "set_card_known",
  { p_card_id: fixture.privateCardBId, p_known: true },
  "User A changed user B's card marker",
);

const { data: editableCard, error: editableCardError } = await userA
  .from("cards")
  .insert({
    user_id: fixture.userAId,
    deck_id: fixture.deckAId,
    term: "temporary editable card",
    definition: "temporary editable definition",
    position: 1,
  })
  .select("id")
  .single();
assert.ifError(editableCardError);
const { error: editCardError } = await userA
  .from("cards")
  .update({
    term: "temporary edited card",
    definition: "temporary edited definition",
    position: 2,
  })
  .eq("id", editableCard.id);
assert.ifError(editCardError);
const { error: deleteCardError } = await userA.from("cards").delete().eq("id", editableCard.id);
assert.ifError(deleteCardError);
await assertMutationDenied(
  userA.from("cards").insert({
    user_id: fixture.userAId,
    deck_id: fixture.privateDeckBId,
    term: "invalid cross-owner card",
    definition: "must be rejected",
    position: 0,
  }),
  "User A inserted a card into user B's deck",
);
await assertMutationDenied(
  userA.from("cards").insert({
    user_id: fixture.userAId,
    deck_id: fixture.deckAId,
    term: "invalid known-state card",
    definition: "must be rejected",
    position: 3,
    known: true,
  }),
  "Client supplied cards.known during insert",
);
await assertMutationDenied(
  userA.from("deck_learning_settings").upsert(
    {
      user_id: fixture.userAId,
      deck_id: fixture.privateDeckBId,
      delayed_recall_enabled: true,
    },
    { onConflict: "user_id,deck_id" },
  ),
  "User A created learning settings for user B's private deck",
);
await assertMutationDenied(
  userA.from("card_associations").insert({
    user_id: fixture.userAId,
    card_id: fixture.privateCardBId,
    text: "must be rejected",
  }),
  "User A created an association for user B's private card",
);

if (expectWritesBlocked) {
  await assertMutationDenied(
    userA
      .from("card_progress")
      .update({ mastery: 0.99, correct_count: 999999 })
      .eq("user_id", fixture.userAId),
    "Direct card_progress update succeeded",
  );
  await assertMutationDenied(
    userA.from("study_events").insert({
      user_id: fixture.userAId,
      deck_id: fixture.deckAId,
      card_id: fixture.cardAId,
      card_key: fixture.cardAId,
      correct: true,
      mode: "study",
    }),
    "Direct study_events insert succeeded",
  );
  await assertMutationDenied(
    userA.from("speed_runs").insert({
      user_id: fixture.userAId,
      deck_id: fixture.deckAId,
      duration: 30,
      score: 999999,
      accuracy: 100,
    }),
    "Direct speed_runs insert succeeded",
  );
  await assertMutationDenied(
    userA.from("delayed_recall_entries").update({ score: 100 }).eq("user_id", fixture.userAId),
    "Direct recall aggregate update succeeded",
  );
  await assertMutationDenied(
    userA.from("streak_days").insert({
      user_id: fixture.userAId,
      day: "2099-01-01",
    }),
    "Direct streak insert succeeded",
  );
  await assertMutationDenied(
    userA
      .from("last_studied_decks")
      .update({ last_studied_at: "2099-01-01T00:00:00Z" })
      .eq("user_id", fixture.userAId),
    "Direct last-studied update succeeded",
  );
  await assertMutationDenied(
    userA.from("study_sessions").insert({
      user_id: fixture.userAId,
      deck_id: fixture.deckAId,
      client_session_key: randomUUID(),
      mode: "study",
    }),
    "Direct study session insert succeeded",
  );
  await assertMutationDenied(
    userA
      .from("profile_private")
      .update({ total_xp: 999999, streak_days: 999999 })
      .eq("user_id", fixture.userAId),
    "Direct private aggregate update succeeded",
  );
  await assertMutationDenied(
    userA.from("cards").update({ known: false }).eq("id", fixture.cardAId),
    "Direct cards.known update succeeded",
  );

  const restResponse = await fetch(`${supabaseUrl}/rest/v1/study_events`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${process.env.STUDY_TEST_USER_A_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      user_id: fixture.userAId,
      deck_id: fixture.deckAId,
      card_id: fixture.cardAId,
      card_key: fixture.cardAId,
      correct: true,
      mode: "study",
    }),
  });
  assert.ok(restResponse.status >= 400, "Direct PostgREST study event insert succeeded");
}

console.log(
  `Study data integrity verification passed (direct writes ${expectWritesBlocked ? "blocked" : "compatibility phase"}).`,
);
