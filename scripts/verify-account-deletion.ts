import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { requireAccountDeletionAdmin } from "../src/lib/account-deletion-admin.ts";
import {
  AccountDeletionWorkflowError,
  cleanupAccountStorage,
} from "../src/lib/account-deletion-workflow.ts";

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !publishableKey || !serviceRoleKey) {
  throw new Error("Local account-deletion test configuration is missing");
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const admin = createClient(url, serviceRoleKey, clientOptions);
const bucket = admin.storage.from("avatars");
const createdUserIds: string[] = [];

async function createFixtureUser(label: string) {
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `account-deletion-${token}@example.invalid`;
  const password = `${randomUUID()}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `delete_${token}`, display_name: label },
  });
  if (error || !data.user) throw new Error("Could not create account-deletion fixture user");
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email, password };
}

async function signIn(email: string, password: string) {
  const client = createClient(url, publishableKey, clientOptions);
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) throw new Error("Fixture sign-in failed");
  return client;
}

async function storageAdapter() {
  return {
    async list(prefix: string, options: { limit: number; offset: number }) {
      const result = await bucket.list(prefix, {
        ...options,
        sortBy: { column: "name", order: "asc" },
      });
      if (result.error) throw result.error;
      return (result.data ?? []).map((entry) => ({
        name: entry.name,
        id: typeof entry.id === "string" ? entry.id : null,
      }));
    },
    async remove(paths: string[]) {
      const result = await bucket.remove(paths);
      if (result.error) throw result.error;
    },
  };
}

async function cleanupStorage(userId: string) {
  return cleanupAccountStorage(await storageAdapter(), userId);
}

async function resumeDatabaseVerificationAsAdmin(
  caller: ReturnType<typeof createClient>,
  callerUserId: string,
  jobId: string,
) {
  await requireAccountDeletionAdmin(
    (userId) => caller.rpc("has_role", { _user_id: userId, _role: "admin" }),
    callerUserId,
  );

  const claimed = await admin.rpc("claim_account_deletion_job", { p_job_id: jobId });
  const job = claimed.data?.[0];
  if (claimed.error || !job) throw new Error("Could not inspect resumable deletion job");
  if (job.job_status === "completed") return { status: "completed" as const };
  if (!job.claimed || !job.lease_token || !job.user_id) {
    throw new AccountDeletionWorkflowError(
      "ACCOUNT_DELETION_ALREADY_IN_PROGRESS",
      409,
      "Account deletion is already in progress.",
    );
  }
  assert.equal(job.resume_step, "database_verification");

  await cleanupAccountStorage(await storageAdapter(), job.user_id, async () => {
    const renewed = await admin.rpc("renew_account_deletion_lease", {
      p_job_id: jobId,
      p_lease_token: job.lease_token,
    });
    if (renewed.error) throw new Error("Could not renew integration deletion lease");
  });
  const finalized = await admin.rpc("finalize_account_deletion_database", {
    p_job_id: jobId,
    p_lease_token: job.lease_token,
  });
  if (finalized.error || finalized.data?.[0]?.job_status !== "completed") {
    throw new Error("Admin resume could not finalize account deletion");
  }
  return { status: "completed" as const };
}

async function uploadAvatarFixtures(userId: string) {
  const paths = Array.from(
    { length: 205 },
    (_, index) => `${userId}/avatar-${String(index).padStart(3, "0")}.png`,
  );
  paths.push(`${userId}/archive/2025/old.png`, `${userId}/archive/2026/current.png`);

  for (let index = 0; index < paths.length; index += 20) {
    const results = await Promise.all(
      paths.slice(index, index + 20).map((path) =>
        bucket.upload(path, new Uint8Array([137, 80, 78, 71]), {
          contentType: "image/png",
          upsert: true,
        }),
      ),
    );
    if (results.some((result) => result.error)) throw new Error("Could not seed avatar fixtures");
  }
}

async function exactCount(table: string, column: string, value: string) {
  const result = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  if (result.error) throw new Error(`Could not verify ${table}`);
  return result.count ?? 0;
}

async function seedUserData(
  userId: string,
  otherUserId: string,
  userClient: ReturnType<typeof createClient>,
) {
  const created = await userClient.rpc("create_deck_with_cards", {
    p_name: "Account deletion fixture",
    p_description: "Deletion integration coverage",
    p_cover_color: null,
    p_target_language: "en",
    p_definition_language: "ru",
    p_cards: [{ term: "delete", definition: "удалять", position: 0 }],
    p_collection_id: null,
    p_use_default_collection: true,
    p_idempotency_key: randomUUID(),
  });
  if (created.error || !created.data?.[0]) throw new Error("Could not seed atomic deck data");
  const deckId = created.data[0].deck_id;
  const cardId = created.data[0].card_ids[0];
  assert.ok(cardId);

  const otherDeckId = randomUUID();
  const otherCollectionId = randomUUID();
  const otherDeck = await admin.from("decks").insert({
    id: otherDeckId,
    user_id: otherUserId,
    name: "Other user public deck",
    visibility: "public",
    published_at: new Date().toISOString(),
  });
  if (otherDeck.error) throw new Error("Could not seed other user deck");
  const otherCollection = await admin.from("collections").insert({
    id: otherCollectionId,
    user_id: otherUserId,
    name: "Other user public collection",
    visibility: "public",
    published_at: new Date().toISOString(),
  });
  if (otherCollection.error) throw new Error("Could not seed other user collection");

  const mutations = await Promise.all([
    admin.from("friendships").insert({ requester_id: userId, addressee_id: otherUserId }),
    admin.from("creator_follows").insert({ creator_id: otherUserId, follower_id: userId }),
    admin.from("deck_likes").insert({ deck_id: otherDeckId, user_id: userId }),
    admin.from("deck_saves").insert({ deck_id: otherDeckId, user_id: userId }),
    admin.from("deck_ratings").insert({ deck_id: otherDeckId, user_id: userId, rating: 5 }),
    admin.from("deck_reports").insert({
      deck_id: otherDeckId,
      reporter_id: userId,
      reason: "Synthetic account deletion report",
    }),
    admin.from("card_associations").insert({
      user_id: userId,
      card_id: cardId,
      text: "Synthetic association",
    }),
    admin.from("deck_learning_settings").insert({
      user_id: userId,
      deck_id: deckId,
      delayed_recall_enabled: true,
    }),
    admin.from("last_studied_decks").insert({ user_id: userId, deck_id: deckId }),
    admin
      .from("streak_days")
      .insert({ user_id: userId, day: new Date().toISOString().slice(0, 10) }),
  ]);
  if (mutations.some((result) => result.error)) throw new Error("Could not seed related user data");

  const session = await userClient.rpc("start_study_session", {
    p_client_session_key: randomUUID(),
    p_deck_id: deckId,
    p_mode: "type",
    p_duration_seconds: null,
  });
  if (session.error || !session.data?.[0]) throw new Error("Could not seed study session");
  const question = await userClient.rpc("issue_study_question", {
    p_session_id: session.data[0].session_id,
    p_card_id: cardId,
    p_client_question_key: randomUUID(),
    p_direction: "term_to_definition",
  });
  if (question.error || !question.data?.[0]) throw new Error("Could not seed study question");
  const answer = await userClient.rpc("record_study_answer", {
    p_question_id: question.data[0].question_id,
    p_submitted_answer: "удалять",
    p_selected_option_id: null,
    p_self_reported_result: null,
    p_response_ms: 250,
    p_idempotency_key: randomUUID(),
  });
  if (answer.error) {
    throw new Error(`Could not seed verified study result (${answer.error.code})`);
  }
  const pendingQuestion = await userClient.rpc("issue_study_question", {
    p_session_id: session.data[0].session_id,
    p_card_id: cardId,
    p_client_question_key: randomUUID(),
    p_direction: "term_to_definition",
  });
  if (pendingQuestion.error || !pendingQuestion.data?.[0]) {
    throw new Error("Could not seed pending study question");
  }

  const now = new Date();
  const usage = await admin.from("ai_usage_events").insert({
    request_id: randomUUID(),
    user_id: userId,
    endpoint: "getTranslations",
    request_class: "light",
    request_units: 1,
    idempotency_key: randomUUID(),
    request_hash: "a".repeat(64),
    ip_hash: null,
    status: "succeeded",
    rate_limit_result: "accepted",
    input_size: 10,
    output_size: 10,
    latency_ms: 1,
    provider_error_category: null,
    started_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    completed_at: now.toISOString(),
  });
  if (usage.error) throw new Error("Could not seed AI usage");
  return {
    otherUserId,
    deckId,
    cardId,
    otherDeckId,
    otherCollectionId,
    sessionId: session.data[0].session_id,
    pendingQuestionId: pendingQuestion.data[0].question_id,
  };
}

type MutationResult = PromiseLike<{ error: unknown }>;

async function expectMutationBlocked(
  phase: string,
  label: string,
  operation: () => MutationResult,
) {
  const result = await operation();
  assert.ok(result.error, `${phase}: ${label} unexpectedly succeeded`);
}

async function assertUserMutationsBlocked(
  client: ReturnType<typeof createClient>,
  userId: string,
  fixture: Awaited<ReturnType<typeof seedUserData>>,
  phase: "requested" | "completed",
) {
  const checks: Array<[string, () => MutationResult]> = [
    [
      "profile update",
      () => client.from("profiles").update({ display_name: "Must not save" }).eq("user_id", userId),
    ],
    [
      "private account settings update",
      () => client.from("profile_private").update({ target_language: "de" }).eq("user_id", userId),
    ],
    ["deck create", () => client.from("decks").insert({ user_id: userId, name: "Must not exist" })],
    [
      "deck edit",
      () => client.from("decks").update({ name: "Must not save" }).eq("id", fixture.deckId),
    ],
    ["deck delete", () => client.from("decks").delete().eq("id", fixture.deckId)],
    [
      "card mutation",
      () => client.from("cards").update({ term: "blocked" }).eq("id", fixture.cardId),
    ],
    [
      "collection mutation",
      () => client.from("collections").insert({ user_id: userId, name: "Must not exist" }),
    ],
    [
      "marketplace like",
      () => client.from("deck_likes").insert({ user_id: userId, deck_id: fixture.otherDeckId }),
    ],
    [
      "marketplace save",
      () => client.from("deck_saves").insert({ user_id: userId, deck_id: fixture.otherDeckId }),
    ],
    [
      "marketplace rating",
      () =>
        client
          .from("deck_ratings")
          .upsert({ user_id: userId, deck_id: fixture.otherDeckId, rating: 4 }),
    ],
    [
      "marketplace report",
      () =>
        client.from("deck_reports").insert({
          reporter_id: userId,
          deck_id: fixture.otherDeckId,
          reason: "Blocked account report",
        }),
    ],
    [
      "collection marketplace report",
      () =>
        client.from("collection_reports").insert({
          reporter_id: userId,
          collection_id: fixture.otherCollectionId,
          reason: "Blocked collection report",
        }),
    ],
    [
      "friend request",
      () =>
        client.from("friendships").insert({
          requester_id: userId,
          addressee_id: fixture.otherUserId,
        }),
    ],
    [
      "creator follow",
      () =>
        client.from("creator_follows").insert({
          follower_id: userId,
          creator_id: fixture.otherUserId,
        }),
    ],
    [
      "marketplace copy RPC",
      () =>
        client.rpc("duplicate_public_deck_atomic", {
          p_source_deck_id: fixture.otherDeckId,
          p_idempotency_key: randomUUID(),
        }),
    ],
    [
      "study start RPC",
      () =>
        client.rpc("start_study_session", {
          p_client_session_key: randomUUID(),
          p_deck_id: fixture.otherDeckId,
          p_mode: "type",
          p_duration_seconds: null,
        }),
    ],
    [
      "study answer RPC",
      () =>
        client.rpc("record_study_answer", {
          p_question_id: fixture.pendingQuestionId,
          p_submitted_answer: "blocked",
          p_response_ms: 100,
          p_idempotency_key: randomUUID(),
        }),
    ],
    [
      "study completion RPC",
      () =>
        client.rpc("complete_study_session", {
          p_session_id: fixture.sessionId,
          p_completion_key: randomUUID(),
        }),
    ],
  ];

  for (const [label, operation] of checks) {
    await expectMutationBlocked(phase, label, operation);
  }

  const avatar = await client.storage
    .from("avatars")
    .upload(`${userId}/avatar-${phase}.png`, new Uint8Array([137, 80, 78, 71]), {
      contentType: "image/png",
    });
  assert.ok(avatar.error, `${phase}: avatar upload unexpectedly succeeded`);
}

try {
  const userA = await createFixtureUser("Deletion integration A");
  const userB = await createFixtureUser("Deletion integration B");
  const userC = await createFixtureUser("Deletion integration admin");
  const clientA = await signIn(userA.email, userA.password);
  const clientB = await signIn(userB.email, userB.password);
  const clientC = await signIn(userC.email, userC.password);
  const adminRole = await admin.from("user_roles").insert({ user_id: userC.id, role: "admin" });
  if (adminRole.error) throw new Error("Could not seed deletion admin role");
  const fixture = await seedUserData(userA.id, userB.id, clientA);
  await uploadAvatarFixtures(userA.id);

  const request = await clientA.rpc("request_account_deletion");
  if (request.error || !request.data?.[0]) throw new Error("Deletion request failed");
  const jobId = request.data[0].job_id;
  const repeated = await clientA.rpc("request_account_deletion");
  assert.equal(repeated.data?.[0]?.job_id, jobId);
  await assertUserMutationsBlocked(clientA, userA.id, fixture, "requested");

  const firstClaim = await admin.rpc("claim_account_deletion_job", { p_job_id: jobId });
  if (firstClaim.error || !firstClaim.data?.[0]?.claimed || !firstClaim.data[0].lease_token) {
    throw new Error("Could not claim deletion job");
  }
  let leaseToken = firstClaim.data[0].lease_token;
  const concurrentClaim = await admin.rpc("claim_account_deletion_job", { p_job_id: jobId });
  assert.equal(concurrentClaim.data?.[0]?.claimed, false);

  const deletedFiles = await cleanupAccountStorage(await storageAdapter(), userA.id, async () => {
    const renewed = await admin.rpc("renew_account_deletion_lease", {
      p_job_id: jobId,
      p_lease_token: leaseToken,
    });
    if (renewed.error) throw renewed.error;
  });
  assert.equal(deletedFiles, 207);
  const storageAdvance = await admin.rpc("advance_account_deletion_job", {
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_expected_step: "storage_cleanup",
    p_next_step: "auth_deletion",
    p_storage_files_deleted: deletedFiles,
  });
  if (storageAdvance.error) throw new Error("Could not advance Storage step");

  const simulatedAuthFailure = await admin.rpc("fail_account_deletion_job", {
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_error_code: "AUTH_TEMPORARY",
    p_retryable: true,
  });
  assert.equal(simulatedAuthFailure.data, "failed_retryable");
  assert.ok((await admin.auth.admin.getUserById(userA.id)).data.user);
  assert.equal(await exactCount("profiles", "user_id", userA.id), 1);

  await delay(5_200);
  const resumed = await admin.rpc("claim_account_deletion_job", { p_job_id: jobId });
  if (resumed.error || !resumed.data?.[0]?.claimed || !resumed.data[0].lease_token) {
    throw new Error("Could not resume retryable deletion job");
  }
  leaseToken = resumed.data[0].lease_token;
  assert.equal(resumed.data[0].resume_step, "auth_deletion");

  const authDeleted = await admin.auth.admin.deleteUser(userA.id);
  if (authDeleted.error) throw new Error("Could not delete fixture Auth user");
  const authAdvance = await admin.rpc("advance_account_deletion_job", {
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_expected_step: "auth_deletion",
    p_next_step: "database_verification",
    p_storage_files_deleted: 0,
  });
  if (authAdvance.error) throw new Error("Could not advance Auth step");

  // Recreate a Storage residue after Auth deletion to force the database
  // finalizer to fail. The user can no longer authenticate at this point.
  const lateAvatarPath = `${userA.id}/late-after-auth-delete.png`;
  const lateAvatar = await bucket.upload(lateAvatarPath, new Uint8Array([137, 80, 78, 71]), {
    contentType: "image/png",
    upsert: true,
  });
  if (lateAvatar.error) throw new Error("Could not seed post-Auth Storage failure");
  const failedFinalizer = await admin.rpc("finalize_account_deletion_database", {
    p_job_id: jobId,
    p_lease_token: leaseToken,
  });
  assert.ok(failedFinalizer.error, "database finalizer must reject non-empty Storage");
  const failedDatabase = await admin.rpc("fail_account_deletion_job", {
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_error_code: "DATABASE_TEMPORARY",
    p_retryable: true,
  });
  assert.equal(failedDatabase.data, "failed_retryable");

  const postAuthLookup = await admin.rpc("claim_account_deletion_job", { p_job_id: jobId });
  if (postAuthLookup.error || !postAuthLookup.data?.[0]) {
    throw new Error("Service worker could not find post-Auth deletion job");
  }
  assert.equal(postAuthLookup.data[0].resume_step, "database_verification");
  assert.equal(postAuthLookup.data[0].claimed, false);
  const attemptsBeforeAdminResume = postAuthLookup.data[0].attempt_count;
  assert.ok((await admin.auth.admin.getUserById(userA.id)).error);

  await assert.rejects(
    resumeDatabaseVerificationAsAdmin(clientB, userB.id, jobId),
    (error: unknown) => error instanceof AccountDeletionWorkflowError && error.statusCode === 403,
  );
  const afterOrdinaryUser = await admin.rpc("claim_account_deletion_job", { p_job_id: jobId });
  assert.equal(afterOrdinaryUser.data?.[0]?.attempt_count, attemptsBeforeAdminResume);

  await delay(10_200);
  const parallelResume = await Promise.allSettled([
    resumeDatabaseVerificationAsAdmin(clientC, userC.id, jobId),
    resumeDatabaseVerificationAsAdmin(clientC, userC.id, jobId),
  ]);
  assert.ok(
    parallelResume.some(
      (result) => result.status === "fulfilled" && result.value.status === "completed",
    ),
    "one admin resume must complete the post-Auth job",
  );
  for (const result of parallelResume) {
    if (result.status === "rejected") {
      assert.ok(result.reason instanceof AccountDeletionWorkflowError);
      assert.equal(result.reason.code, "ACCOUNT_DELETION_ALREADY_IN_PROGRESS");
    }
  }

  const postResume = await admin.rpc("claim_account_deletion_job", { p_job_id: jobId });
  assert.equal(postResume.data?.[0]?.job_status, "completed");
  assert.equal(postResume.data?.[0]?.attempt_count, attemptsBeforeAdminResume + 1);
  assert.equal(await cleanupStorage(userA.id), 0);

  const staleRetry = await clientA.rpc("request_account_deletion");
  assert.equal(staleRetry.error, null);
  assert.equal(staleRetry.data?.[0]?.job_id, jobId);
  assert.equal(staleRetry.data?.[0]?.job_status, "completed");
  await assertUserMutationsBlocked(clientA, userA.id, fixture, "completed");

  const userTables = [
    ["profiles", "user_id"],
    ["profile_private", "user_id"],
    ["user_roles", "user_id"],
    ["decks", "user_id"],
    ["cards", "user_id"],
    ["collections", "user_id"],
    ["collection_decks", "user_id"],
    ["deck_likes", "user_id"],
    ["deck_saves", "user_id"],
    ["deck_ratings", "user_id"],
    ["deck_reports", "reporter_id"],
    ["card_progress", "user_id"],
    ["card_associations", "user_id"],
    ["deck_learning_settings", "user_id"],
    ["delayed_recall_entries", "user_id"],
    ["last_studied_decks", "user_id"],
    ["streak_days", "user_id"],
    ["study_sessions", "user_id"],
    ["study_session_cards", "user_id"],
    ["study_questions", "user_id"],
    ["study_events", "user_id"],
    ["speed_runs", "user_id"],
    ["ai_usage_events", "user_id"],
    ["ai_rate_limit_rollups", "user_id"],
  ] as const;
  for (const [table, column] of userTables) {
    assert.equal(
      await exactCount(table, column, userA.id),
      0,
      `${table} retained deleted user data`,
    );
  }
  assert.equal(await cleanupStorage(userA.id), 0);
  assert.ok((await admin.auth.admin.getUserById(userA.id)).error);

  const completedClaim = await admin.rpc("claim_account_deletion_job", { p_job_id: jobId });
  assert.equal(completedClaim.data?.[0]?.job_status, "completed");
  assert.equal(completedClaim.data?.[0]?.user_id, null);
  assert.ok((await admin.auth.admin.getUserById(userB.id)).data.user);
  assert.equal(await exactCount("decks", "id", fixture.otherDeckId), 1);

  process.stdout.write(
    "PASS resumable account deletion removed Auth, Storage, database, AI, study, marketplace, and private user data\n",
  );
} finally {
  for (const userId of createdUserIds) {
    await cleanupStorage(userId).catch(() => undefined);
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}
