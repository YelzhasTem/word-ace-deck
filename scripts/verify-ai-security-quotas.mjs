import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const allowConfigMutation = process.env.AI_SECURITY_TEST_CONFIG_MUTATION === "true";
assert.ok(url && publishableKey && serviceRoleKey, "Supabase test environment is incomplete");

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = randomUUID().slice(0, 8);
const password = `Ai-Security-${randomUUID()}!`;
const users = [];

async function createTestUser(label) {
  const email = `ai-security-${label}-${runId}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `ai_security_${label}_${runId}` },
  });
  assert.ifError(error);
  assert.ok(data.user);
  users.push(data.user.id);
  return { id: data.user.id, email };
}

function reservationArgs(userId, endpoint, overrides = {}) {
  return {
    p_request_id: randomUUID(),
    p_user_id: userId,
    p_endpoint: endpoint,
    p_idempotency_key: randomUUID(),
    p_request_hash: "a".repeat(64),
    p_ip_hash: null,
    p_input_size: 100,
    ...overrides,
  };
}

async function acquire(userId, endpoint, overrides) {
  const { data, error } = await admin.rpc(
    "acquire_ai_request",
    reservationArgs(userId, endpoint, overrides),
  );
  assert.ifError(error);
  assert.equal(data.length, 1);
  return data[0];
}

async function complete(userId, requestId, status = "succeeded") {
  const { data, error } = await admin.rpc("complete_ai_request", {
    p_request_id: requestId,
    p_user_id: userId,
    p_status: status,
    p_output_size: 50,
    p_latency_ms: 10,
    p_provider_error_category: null,
  });
  assert.ifError(error);
  assert.equal(data, true);
}

let originalConfig;
try {
  const userA = await createTestUser("a");
  const userB = await createTestUser("b");

  const { error: anonTableError } = await anon
    .from("ai_usage_events")
    .select("request_id")
    .limit(1);
  assert.ok(anonTableError, "anon unexpectedly read AI usage");
  const { error: anonRpcError } = await anon.rpc(
    "acquire_ai_request",
    reservationArgs(userA.id, "getTranslations"),
  );
  assert.ok(anonRpcError, "anon unexpectedly reserved AI usage");

  const userClient = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await userClient.auth.signInWithPassword({
    email: userA.email,
    password,
  });
  assert.ifError(signInError);
  const { error: userRpcError } = await userClient.rpc(
    "acquire_ai_request",
    reservationArgs(userA.id, "getTranslations"),
  );
  assert.ok(userRpcError, "authenticated browser role unexpectedly reserved AI usage");

  const parallel = await Promise.all(
    Array.from({ length: 5 }, () => acquire(userA.id, "generateDeckWithAI")),
  );
  const accepted = parallel.filter((entry) => entry.decision === "accepted");
  assert.equal(accepted.length, 1, "parallel requests bypassed concurrency protection");
  assert.ok(parallel.some((entry) => entry.decision === "user_concurrency"));

  const userBSlot = await acquire(userB.id, "generateDeckWithAI");
  assert.equal(userBSlot.decision, "accepted", "user A consumed user B's quota");
  await complete(userA.id, accepted[0].reserved_request_id);
  await complete(userB.id, userBSlot.reserved_request_id);

  for (let index = 0; index < 2; index += 1) {
    const slot = await acquire(userB.id, "generateDeckWithAI");
    assert.equal(slot.decision, "accepted");
    await complete(userB.id, slot.reserved_request_id);
  }
  const heavyMinuteLimit = await acquire(userB.id, "generateDeckWithAI");
  assert.equal(heavyMinuteLimit.decision, "user_minute");

  for (let index = 0; index < 12; index += 1) {
    const slot = await acquire(userA.id, "getTranslations");
    assert.equal(slot.decision, "accepted");
    await complete(userA.id, slot.reserved_request_id);
  }
  const lightMinuteLimit = await acquire(userA.id, "getTranslations");
  assert.equal(lightMinuteLimit.decision, "user_minute");

  const key = randomUUID();
  const first = await acquire(userA.id, "generateAssociation", {
    p_idempotency_key: key,
    p_request_hash: "b".repeat(64),
  });
  assert.equal(first.decision, "accepted");
  await complete(userA.id, first.reserved_request_id);
  const replay = await acquire(userA.id, "generateAssociation", {
    p_idempotency_key: key,
    p_request_hash: "b".repeat(64),
  });
  assert.equal(replay.decision, "idempotency_replay");
  const conflict = await acquire(userA.id, "generateAssociation", {
    p_idempotency_key: key,
    p_request_hash: "c".repeat(64),
  });
  assert.equal(conflict.decision, "idempotency_conflict");

  if (allowConfigMutation) {
    const { data: config, error: configError } = await admin
      .from("ai_runtime_config")
      .select("*")
      .single();
    assert.ifError(configError);
    originalConfig = config;

    const { error: disableError } = await admin
      .from("ai_runtime_config")
      .update({ enabled: false })
      .eq("singleton", true);
    assert.ifError(disableError);
    const disabled = await acquire(userB.id, "getTranslations");
    assert.equal(disabled.decision, "disabled");

    const { error: budgetError } = await admin
      .from("ai_runtime_config")
      .update({ enabled: true, daily_request_unit_budget: 0 })
      .eq("singleton", true);
    assert.ifError(budgetError);
    const exhausted = await acquire(userB.id, "getTranslations");
    assert.equal(exhausted.decision, "global_budget");
  }

  const { data: policies, error: policyError } = await admin
    .from("ai_endpoint_policies")
    .select("endpoint, request_units, request_class, concurrency_limit");
  assert.ifError(policyError);
  assert.equal(policies.length, 7);
  assert.ok(policies.find((policy) => policy.endpoint === "getTranslations")?.request_units === 1);
  assert.ok(
    policies.find((policy) => policy.endpoint === "importManualCardsFromImage")?.request_units ===
      8,
  );

  console.log(
    `AI quota integration checks passed (${allowConfigMutation ? "including" : "excluding"} config mutation).`,
  );
} finally {
  if (originalConfig) {
    await admin
      .from("ai_runtime_config")
      .update({
        enabled: originalConfig.enabled,
        daily_request_unit_budget: originalConfig.daily_request_unit_budget,
        daily_heavy_request_unit_budget: originalConfig.daily_heavy_request_unit_budget,
        per_user_hourly_unit_limit: originalConfig.per_user_hourly_unit_limit,
        per_user_daily_unit_limit: originalConfig.per_user_daily_unit_limit,
        ip_minute_request_limit: originalConfig.ip_minute_request_limit,
        ip_hour_request_limit: originalConfig.ip_hour_request_limit,
        ip_daily_request_limit: originalConfig.ip_daily_request_limit,
        ip_concurrency_limit: originalConfig.ip_concurrency_limit,
      })
      .eq("singleton", true);
  }
  for (const userId of users) {
    await admin.auth.admin.deleteUser(userId);
  }
}
