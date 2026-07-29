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
  "STUDY_TEST_CARDS_A_JSON",
  "STUDY_TEST_PRIVATE_DECK_B_ID",
  "STUDY_TEST_PRIVATE_CARD_B_ID",
  "STUDY_TEST_PUBLIC_DECK_B_ID",
  "STUDY_TEST_PUBLIC_CARD_B_ID",
  "STUDY_TEST_PUBLIC_CARD_B_TERM",
  "STUDY_TEST_PUBLIC_CARD_B_DEFINITION",
];

for (const name of requiredEnvironment) assert.ok(process.env[name], `Missing ${name}`);

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const expectWritesBlocked = process.env.STUDY_TEST_EXPECT_DIRECT_WRITES_BLOCKED !== "false";
const expectLegacyBooleanBlocked = process.env.STUDY_TEST_EXPECT_LEGACY_BOOLEAN_BLOCKED !== "false";
const cardsA = JSON.parse(process.env.STUDY_TEST_CARDS_A_JSON);
assert.equal(cardsA.length, 4, "Multiple-choice tests require four fixture cards");

const fixture = {
  userAId: process.env.STUDY_TEST_USER_A_ID,
  userBId: process.env.STUDY_TEST_USER_B_ID,
  deckAId: process.env.STUDY_TEST_DECK_A_ID,
  privateDeckBId: process.env.STUDY_TEST_PRIVATE_DECK_B_ID,
  privateCardBId: process.env.STUDY_TEST_PRIVATE_CARD_B_ID,
  publicDeckBId: process.env.STUDY_TEST_PUBLIC_DECK_B_ID,
  publicCardBId: process.env.STUDY_TEST_PUBLIC_CARD_B_ID,
  publicCardBTerm: process.env.STUDY_TEST_PUBLIC_CARD_B_TERM,
  publicCardBDefinition: process.env.STUDY_TEST_PUBLIC_CARD_B_DEFINITION,
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

async function assertRpcDenied(api, name, args, label) {
  const { error } = await api.rpc(name, args);
  assert.ok(error, label);
}

async function assertMutationDenied(operation, label) {
  const { error } = await operation;
  assert.ok(error, label);
}

async function startSession(api, deckId, mode, duration = undefined, key = randomUUID()) {
  return rpcOne(api, "start_study_session", {
    p_client_session_key: key,
    p_deck_id: deckId,
    p_mode: mode,
    p_duration_seconds: duration,
  });
}

async function issueQuestion(api, sessionId, cardId, direction, key = randomUUID()) {
  return rpcOne(api, "issue_study_question", {
    p_client_question_key: key,
    p_session_id: sessionId,
    p_card_id: cardId,
    p_direction: direction,
  });
}

async function recordAnswer(api, questionId, input, idempotencyKey = randomUUID()) {
  return rpcOne(api, "record_study_answer", {
    p_idempotency_key: idempotencyKey,
    p_question_id: questionId,
    p_submitted_answer: input.submittedAnswer,
    p_selected_option_id: input.selectedOptionId,
    p_self_reported_result: input.selfReportedResult,
    p_response_ms: input.responseMs ?? 1200,
  });
}

async function postRpc(name, args, accessToken) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  return { response, body: await response.json().catch(() => null) };
}

async function assertPrivateTableUnreadable(api, table, label) {
  const { error } = await api.from(table).select("id").limit(1);
  assert.ok(error, label);
}

await assertRpcDenied(
  anon,
  "start_study_session",
  { p_client_session_key: randomUUID(), p_deck_id: fixture.deckAId, p_mode: "type" },
  "Anonymous user started a study session",
);
await assertRpcDenied(
  anon,
  "issue_study_question",
  {
    p_client_question_key: randomUUID(),
    p_session_id: randomUUID(),
    p_card_id: cardsA[0].id,
    p_direction: "term_to_definition",
  },
  "Anonymous user issued a study question",
);
await assertRpcDenied(
  anon,
  "record_study_answer",
  { p_idempotency_key: randomUUID(), p_question_id: randomUUID(), p_submitted_answer: "x" },
  "Anonymous user submitted a study answer",
);
for (const table of ["study_session_cards", "study_questions", "study_question_options"]) {
  await assertPrivateTableUnreadable(userA, table, `Authenticated user read private ${table}`);
  await assertPrivateTableUnreadable(anon, table, `Anonymous user read private ${table}`);
}

const sessionKey = randomUUID();
const typeSession = await startSession(userA, fixture.deckAId, "type", undefined, sessionKey);
const duplicateTypeSession = await startSession(
  userA,
  fixture.deckAId,
  "type",
  undefined,
  sessionKey,
);
assert.equal(
  duplicateTypeSession.session_id,
  typeSession.session_id,
  "Session start is not idempotent",
);
await assertRpcDenied(
  userA,
  "start_study_session",
  {
    p_client_session_key: sessionKey,
    p_deck_id: fixture.deckAId,
    p_mode: "study",
  },
  "A session key was reused with different parameters",
);

const originalDefinition = cardsA[0].definition;
const tamperedDefinition = "definition changed after session start";
const { error: tamperError } = await userA
  .from("cards")
  .update({ definition: tamperedDefinition })
  .eq("id", cardsA[0].id);
assert.ifError(tamperError);

const textQuestion = await issueQuestion(
  userA,
  typeSession.session_id,
  cardsA[0].id,
  "term_to_definition",
);
assert.equal(textQuestion.answer_kind, "text");
assert.equal(textQuestion.verification_type, "server_verified");
assert.deepEqual(textQuestion.options, []);
assert.equal(
  JSON.stringify(textQuestion).includes(originalDefinition),
  false,
  "Text question disclosed the expected answer before submission",
);

const textKey = randomUUID();
const normalizedCorrect = await recordAnswer(
  userA,
  textQuestion.question_id,
  { submittedAnswer: `  ${originalDefinition.toUpperCase()}!!!  ` },
  textKey,
);
assert.equal(normalizedCorrect.correct, true, "Server rejected normalized correct text");
assert.equal(normalizedCorrect.verification_type, "server_verified");
assert.equal(normalizedCorrect.expected_answer, originalDefinition);
assert.equal(normalizedCorrect.duplicate, false);

const duplicateCorrect = await recordAnswer(
  userA,
  textQuestion.question_id,
  { submittedAnswer: `  ${originalDefinition.toUpperCase()}!!!  ` },
  textKey,
);
assert.equal(duplicateCorrect.duplicate, true, "Repeated text answer was not idempotent");
assert.equal(
  duplicateCorrect.correct_count,
  normalizedCorrect.correct_count,
  "Repeated text answer changed progress",
);
await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: textKey,
    p_question_id: textQuestion.question_id,
    p_submitted_answer: "different payload",
    p_response_ms: 1200,
  },
  "Idempotency key accepted changed submitted text",
);
await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_question_id: textQuestion.question_id,
    p_self_reported_result: true,
    p_response_ms: 1200,
  },
  "Server-verifiable text question accepted self-reported true",
);
await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_question_id: textQuestion.question_id,
    p_submitted_answer: originalDefinition,
    p_verification_type: "server_verified",
  },
  "Client selected verification_type",
);

const { error: restoreError } = await userA
  .from("cards")
  .update({ definition: originalDefinition })
  .eq("id", cardsA[0].id);
assert.ifError(restoreError);

const wrongQuestion = await issueQuestion(
  userA,
  typeSession.session_id,
  cardsA[1].id,
  "term_to_definition",
);
const wrongText = await recordAnswer(userA, wrongQuestion.question_id, {
  submittedAnswer: "definitely incorrect",
});
assert.equal(wrongText.correct, false, "Server accepted incorrect text");

const alternateQuestion = await issueQuestion(
  userA,
  typeSession.session_id,
  cardsA[3].id,
  "term_to_definition",
);
const alternateText = await recordAnswer(userA, alternateQuestion.question_id, {
  submittedAnswer: "alternate answer",
});
assert.equal(alternateText.correct, true, "Server rejected an allowed alternative answer");

await assertRpcDenied(
  userA,
  "issue_study_question",
  {
    p_client_question_key: randomUUID(),
    p_session_id: typeSession.session_id,
    p_card_id: fixture.privateCardBId,
    p_direction: "term_to_definition",
  },
  "Question issuance accepted a card outside the session deck",
);
await assertRpcDenied(
  userB,
  "issue_study_question",
  {
    p_client_question_key: randomUUID(),
    p_session_id: typeSession.session_id,
    p_card_id: cardsA[0].id,
    p_direction: "term_to_definition",
  },
  "User B issued a question in user A's session",
);
await assertRpcDenied(
  userB,
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_question_id: textQuestion.question_id,
    p_submitted_answer: originalDefinition,
  },
  "User B answered user A's question",
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

const publicSession = await startSession(userA, fixture.publicDeckBId, "type");
const publicQuestion = await issueQuestion(
  userA,
  publicSession.session_id,
  fixture.publicCardBId,
  "term_to_definition",
);
const publicAnswer = await recordAnswer(userA, publicQuestion.question_id, {
  submittedAnswer: fixture.publicCardBDefinition,
});
assert.equal(publicAnswer.correct, true, "Public deck answer was not server-verified");

const studySession = await startSession(userA, fixture.deckAId, "study");
const studyQuestion = await issueQuestion(
  userA,
  studySession.session_id,
  cardsA[0].id,
  "term_to_definition",
);
assert.equal(studyQuestion.answer_kind, "self_reported");
assert.equal(studyQuestion.verification_type, "self_reported");
const selfReported = await recordAnswer(userA, studyQuestion.question_id, {
  selfReportedResult: true,
});
assert.equal(selfReported.correct, true);
assert.equal(selfReported.verification_type, "self_reported");
assert.equal(
  selfReported.expected_answer,
  null,
  "Self-reported RPC returned a private expected answer",
);
await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_question_id: studyQuestion.question_id,
    p_submitted_answer: originalDefinition,
  },
  "Self-reported mode accepted submitted text",
);

for (const [mode, direction] of [
  ["reverse", "definition_to_term"],
  ["assoc", "term_to_definition"],
]) {
  const session = await startSession(userA, fixture.deckAId, mode);
  const question = await issueQuestion(userA, session.session_id, cardsA[0].id, direction);
  const answer = await recordAnswer(userA, question.question_id, { selfReportedResult: false });
  assert.equal(answer.verification_type, "self_reported", `${mode} was not self-reported`);
}

const speedSession = await startSession(userA, fixture.deckAId, "speed", 30);
const speedQuestionA = await issueQuestion(
  userA,
  speedSession.session_id,
  cardsA[0].id,
  "term_to_definition",
);
const speedQuestionB = await issueQuestion(
  userA,
  speedSession.session_id,
  cardsA[1].id,
  "term_to_definition",
);
for (const question of [speedQuestionA, speedQuestionB]) {
  assert.equal(question.answer_kind, "multiple_choice");
  assert.equal(question.verification_type, "server_verified");
  assert.equal(question.options.length, 4);
  for (const option of question.options) {
    assert.deepEqual(Object.keys(option).sort(), ["id", "text"], "Option disclosed correctness");
  }
}
const correctOptionA = speedQuestionA.options.find(
  (option) => option.text === cardsA[0].definition,
);
const wrongOptionB = speedQuestionB.options.find((option) => option.text !== cardsA[1].definition);
assert.ok(correctOptionA, "Correct server option was not issued");
assert.ok(wrongOptionB, "Wrong server option was not issued");

await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_question_id: speedQuestionA.question_id,
    p_selected_option_id: randomUUID(),
  },
  "Arbitrary selected_option_id was accepted",
);
await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_question_id: speedQuestionA.question_id,
    p_selected_option_id: speedQuestionB.options[0].id,
  },
  "Option from another question was accepted",
);
await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_question_id: speedQuestionA.question_id,
    p_self_reported_result: true,
  },
  "Multiple-choice question accepted self-reported true",
);

const speedKey = randomUUID();
const speedCorrect = await recordAnswer(
  userA,
  speedQuestionA.question_id,
  { selectedOptionId: correctOptionA.id },
  speedKey,
);
assert.equal(speedCorrect.correct, true, "Server rejected its correct option");
assert.equal(speedCorrect.correct_option_id, correctOptionA.id);
const repeatedSpeed = await recordAnswer(
  userA,
  speedQuestionA.question_id,
  { selectedOptionId: correctOptionA.id },
  speedKey,
);
assert.equal(repeatedSpeed.duplicate, true);
await assertRpcDenied(
  userA,
  "record_study_answer",
  {
    p_idempotency_key: speedKey,
    p_question_id: speedQuestionA.question_id,
    p_selected_option_id: speedQuestionA.options.find((option) => option.id !== correctOptionA.id)
      .id,
    p_response_ms: 1200,
  },
  "Idempotency key accepted a changed option",
);
const speedWrong = await recordAnswer(userA, speedQuestionB.question_id, {
  selectedOptionId: wrongOptionB.id,
});
assert.equal(speedWrong.correct, false, "Server accepted an incorrect option");

const speedCompletionKey = randomUUID();
const speedResult = await rpcOne(userA, "complete_study_session", {
  p_session_id: speedSession.session_id,
  p_completion_key: speedCompletionKey,
});
assert.equal(speedResult.answer_count, 2);
assert.equal(speedResult.score, 110);
assert.equal(speedResult.accuracy, 50);
assert.equal(speedResult.max_combo, 1);
const repeatedCompletion = await rpcOne(userA, "complete_study_session", {
  p_session_id: speedSession.session_id,
  p_completion_key: speedCompletionKey,
});
assert.equal(repeatedCompletion.duplicate, true, "Session completion was not idempotent");

const deepSession = await startSession(userA, fixture.deckAId, "deep");
const deepQuestion = await issueQuestion(
  userA,
  deepSession.session_id,
  cardsA[2].id,
  "definition_to_term",
);
const deepCorrectOption = deepQuestion.options.find((option) => option.text === cardsA[2].term);
assert.ok(deepCorrectOption);
const deepAnswer = await recordAnswer(userA, deepQuestion.question_id, {
  selectedOptionId: deepCorrectOption.id,
});
assert.equal(deepAnswer.correct, true, "Deep mode was not server-verified");

const { error: settingError } = await userA
  .from("deck_learning_settings")
  .upsert(
    { user_id: fixture.userAId, deck_id: fixture.deckAId, delayed_recall_enabled: true },
    { onConflict: "user_id,deck_id" },
  );
assert.ifError(settingError);
const { data: scheduled, error: scheduleError } = await userA.rpc("schedule_recall_card", {
  p_card_id: cardsA[0].id,
});
assert.ifError(scheduleError);
assert.equal(scheduled, true);
const recallSession = await startSession(userA, fixture.deckAId, "recall");
const recallQuestion = await issueQuestion(
  userA,
  recallSession.session_id,
  cardsA[0].id,
  "definition_to_term",
);
const recallResult = await recordAnswer(userA, recallQuestion.question_id, {
  submittedAnswer: cardsA[0].term,
});
assert.equal(recallResult.correct, true);
assert.equal(recallResult.verification_type, "server_verified");
assert.equal(recallResult.recall_score, 15);

const restSession = await startSession(userA, fixture.deckAId, "assoc");
const restQuestion = await issueQuestion(
  userA,
  restSession.session_id,
  cardsA[1].id,
  "term_to_definition",
);
const restSafeAnswer = await postRpc(
  "record_study_answer",
  {
    p_idempotency_key: randomUUID(),
    p_question_id: restQuestion.question_id,
    p_self_reported_result: true,
  },
  process.env.STUDY_TEST_USER_A_ACCESS_TOKEN,
);
assert.equal(restSafeAnswer.response.status, 200, "Safe direct PostgREST RPC failed");
assert.equal(restSafeAnswer.body[0].verification_type, "self_reported");

if (expectLegacyBooleanBlocked) {
  await assertRpcDenied(
    userA,
    "record_study_answer",
    {
      p_idempotency_key: randomUUID(),
      p_session_id: typeSession.session_id,
      p_card_id: cardsA[0].id,
      p_result: true,
      p_response_ms: 1200,
    },
    "Legacy boolean record_study_answer overload is still callable",
  );
  const legacyRest = await postRpc(
    "record_study_answer",
    {
      p_idempotency_key: randomUUID(),
      p_session_id: typeSession.session_id,
      p_card_id: cardsA[0].id,
      p_result: true,
    },
    process.env.STUDY_TEST_USER_A_ACCESS_TOKEN,
  );
  assert.ok(legacyRest.response.status >= 400, "Legacy boolean RPC succeeded through PostgREST");
}

const { data: serverEvents, error: eventError } = await userA
  .from("study_events")
  .select("question_id, verification_type, submitted_answer, selected_option_id, correct")
  .in("question_id", [
    textQuestion.question_id,
    studyQuestion.question_id,
    speedQuestionA.question_id,
  ]);
assert.ifError(eventError);
assert.equal(serverEvents.length, 3);
assert.equal(
  serverEvents.find((event) => event.question_id === textQuestion.question_id).verification_type,
  "server_verified",
);
assert.equal(
  serverEvents.find((event) => event.question_id === studyQuestion.question_id).verification_type,
  "self_reported",
);
assert.equal(
  serverEvents.find((event) => event.question_id === speedQuestionA.question_id).selected_option_id,
  correctOptionA.id,
);

const { data: userBProgress, error: userBProgressError } = await userB
  .from("card_progress")
  .select("id")
  .eq("user_id", fixture.userAId);
assert.ifError(userBProgressError);
assert.deepEqual(userBProgress, [], "User B read user A's progress");

const { data: known, error: knownError } = await userA.rpc("set_card_known", {
  p_card_id: cardsA[0].id,
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

await assertMutationDenied(
  userA.from("cards").insert({
    user_id: fixture.userAId,
    deck_id: fixture.privateDeckBId,
    term: "invalid cross-owner card",
    definition: "must be rejected",
    position: 99,
  }),
  "User A inserted a card into user B's deck",
);
await assertMutationDenied(
  userA.from("cards").update({ known: false }).eq("id", cardsA[0].id),
  "Direct cards.known update succeeded",
);

if (expectWritesBlocked) {
  await assertMutationDenied(
    userA.from("card_progress").insert({
      user_id: fixture.userAId,
      deck_id: fixture.deckAId,
      card_id: cardsA[0].id,
      card_key: `${cardsA[0].id}:forged`,
      mastery: 1,
      stage: 4,
      correct_count: 999999,
      wrong_count: 0,
      due_at: "2099-01-01T00:00:00Z",
    }),
    "Direct card_progress insert succeeded",
  );
  await assertMutationDenied(
    userA.from("study_events").insert({
      user_id: fixture.userAId,
      deck_id: fixture.deckAId,
      card_id: cardsA[0].id,
      card_key: cardsA[0].id,
      correct: true,
      mode: "type",
    }),
    "Direct study_events insert succeeded",
  );
  await assertMutationDenied(
    userA
      .from("study_events")
      .update({ correct: false, response_ms: 999999 })
      .eq("question_id", textQuestion.question_id),
    "Existing study event update succeeded",
  );
  await assertMutationDenied(
    userA.from("study_events").delete().eq("question_id", textQuestion.question_id),
    "Existing study event delete succeeded",
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
    userA.from("streak_days").insert({ user_id: fixture.userAId, day: "2099-01-01" }),
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

  const directRest = await fetch(`${supabaseUrl}/rest/v1/study_events`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${process.env.STUDY_TEST_USER_A_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: fixture.userAId,
      deck_id: fixture.deckAId,
      card_id: cardsA[0].id,
      card_key: cardsA[0].id,
      correct: true,
      mode: "type",
    }),
  });
  assert.ok(directRest.status >= 400, "Direct PostgREST study event insert succeeded");
}

console.log("Study data integrity verification passed with server-verified answer checks.");
