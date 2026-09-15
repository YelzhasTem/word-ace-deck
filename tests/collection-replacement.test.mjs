import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
assert.ok(
  url && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
  "Collection replacement fixtures refuse non-local Supabase",
);
assert.ok(process.env.SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY, options);
const users = [];
const legacy = process.env.COLLECTION_REPLACEMENT_REPRODUCE_LEGACY === "true";
let owner;
let visitor;
let decks;
let foreignDeck;

function ok(result) {
  assert.ok(!result.error, `Fixture operation failed (${result.error?.code})`);
  return result.data;
}

async function actor(label) {
  const suffix = randomUUID().slice(0, 8);
  const email = `replacement-${label}-${suffix}@example.invalid`;
  const password = `Fixture-${randomUUID()}-Aa1!`;
  const user = ok(
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: `cr_${label}_${suffix}` },
    }),
  ).user;
  users.push(user.id);
  const client = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY, options);
  const session = ok(await client.auth.signInWithPassword({ email, password })).session;
  return { id: user.id, client, token: session.access_token };
}

before(async () => {
  owner = await actor("owner");
  visitor = await actor("visitor");
  decks = ok(
    await owner.client
      .from("decks")
      .insert(
        Array.from({ length: 500 }, (_, i) => ({
          user_id: owner.id,
          name: `Replacement fixture ${i}`,
        })),
      )
      .select("id"),
  ).map(({ id }) => id);
  foreignDeck = ok(
    await visitor.client
      .from("decks")
      .insert({
        user_id: visitor.id,
        name: "Foreign replacement fixture",
      })
      .select("id")
      .single(),
  ).id;
  ok(await visitor.client.from("decks").update({ visibility: "public" }).eq("id", foreignDeck));
});

after(async () => {
  for (const id of users.toReversed()) ok(await service.auth.admin.deleteUser(id));
  for (const table of ["profiles", "profile_private", "decks", "collections", "collection_decks"]) {
    assert.equal(
      ok(await service.from(table).select("user_id").in("user_id", users)).length,
      0,
      `${table}: synthetic rows must be removed`,
    );
  }
});

async function fixture() {
  const id = ok(
    await owner.client
      .from("collections")
      .insert({
        user_id: owner.id,
        name: "Replacement fixture",
      })
      .select("id")
      .single(),
  ).id;
  ok(
    await owner.client.from("collection_decks").insert(
      decks.slice(0, 2).map((deck_id, position) => ({
        collection_id: id,
        deck_id,
        user_id: owner.id,
        position,
      })),
    ),
  );
  return id;
}

async function snapshot(id) {
  return ok(
    await service
      .from("collection_decks")
      .select("id,collection_id,deck_id,user_id,position,created_at")
      .eq("collection_id", id)
      .order("position"),
  );
}

async function replace(id, ids, actor = owner) {
  // Explicit opt-in red-phase probe of main's old algorithm. Never used by the app
  // or normal CI; localhost guard above applies to both paths.
  if (legacy) {
    const removed = await actor.client
      .from("collection_decks")
      .delete()
      .eq("collection_id", id)
      .eq("user_id", actor.id);
    if (removed.error || ids.length === 0) return removed;
    return actor.client.from("collection_decks").insert(
      ids.map((deck_id, position) => ({
        collection_id: id,
        deck_id,
        user_id: actor.id,
        position,
      })),
    );
  }
  return actor.client.rpc("replace_collection_decks_atomic", {
    p_collection_id: id,
    p_deck_ids: ids,
  });
}

for (const [label, input, code] of [
  ["foreign public deck", () => [decks[2], foreignDeck], "DECK_NOT_AVAILABLE"],
  ["nonexistent deck", () => [decks[2], randomUUID()], "DECK_NOT_AVAILABLE"],
  ["duplicate IDs", () => [decks[2], decks[2]], "DUPLICATE_DECK_IDS"],
  ["null list", () => null, "INVALID_DECK_IDS"],
  ["null element", () => [decks[2], null], "INVALID_DECK_IDS"],
  ["501 decks", () => [...decks, randomUUID()], "TOO_MANY_DECKS"],
]) {
  test(`invalid ${label} preserves all original links`, async () => {
    const id = await fixture();
    const before = await snapshot(id);
    const result = await replace(id, input());
    assert.ok(result.error, "invalid replacement must reject");
    assert.deepEqual(
      await snapshot(id),
      before,
      "failed replacement must not delete or change old links",
    );
    if (!legacy) assert.equal(result.error.message, code);
  });
}

test("valid replacement uses exactly requested order and is membership-idempotent", async () => {
  const id = await fixture();
  const desired = [decks[4], decks[1], decks[3]];
  for (let i = 0; i < 2; i++) {
    assert.equal(ok(await replace(id, desired)), 3);
    assert.deepEqual(
      (await snapshot(id)).map(({ deck_id, position, user_id }) => ({
        deck_id,
        position,
        user_id,
      })),
      desired.map((deck_id, position) => ({ deck_id, position, user_id: owner.id })),
    );
  }
});

test("empty list clears atomically and repeated empty replacement succeeds", async () => {
  const id = await fixture();
  assert.equal(ok(await replace(id, [])), 0);
  assert.deepEqual(await snapshot(id), []);
  assert.equal(ok(await replace(id, [])), 0);
});

test("existing 500-link limit is accepted, including the last position", async () => {
  const id = await fixture();
  assert.equal(ok(await replace(id, decks)), 500);
  assert.deepEqual(
    (await snapshot(id)).map(({ deck_id, position }) => ({ deck_id, position })),
    decks.map((deck_id, position) => ({ deck_id, position })),
  );
});

test("other user and nonexistent collection fail without exposing ownership", async () => {
  const id = await fixture();
  const before = await snapshot(id);
  for (const collectionId of [id, randomUUID()]) {
    const result = await replace(collectionId, [foreignDeck], visitor);
    assert.equal(result.error?.message, "COLLECTION_NOT_AVAILABLE");
  }
  assert.deepEqual(await snapshot(id), before);
});

test("anon cannot execute RPC; direct ownership FK and RLS defenses remain active", async () => {
  const id = await fixture();
  const before = await snapshot(id);
  assert.equal(
    (
      await anon.rpc("replace_collection_decks_atomic", {
        p_collection_id: id,
        p_deck_ids: [],
      })
    ).error?.code,
    "42501",
  );
  assert.equal(
    (
      await owner.client.from("collection_decks").insert({
        collection_id: id,
        deck_id: foreignDeck,
        user_id: owner.id,
        position: 2,
      })
    ).error?.code,
    "23503",
  );
  assert.equal(
    (
      await visitor.client.from("collection_decks").insert({
        collection_id: id,
        deck_id: decks[2],
        user_id: owner.id,
        position: 2,
      })
    ).error?.code,
    "42501",
  );
  ok(await visitor.client.from("collection_decks").delete().eq("collection_id", id));
  assert.deepEqual(await snapshot(id), before);
});

test("raw PostgREST rejects malformed and owner-spoofed requests without writes", async () => {
  const id = await fixture();
  const before = await snapshot(id);
  for (const body of [
    { p_collection_id: id, p_deck_ids: ["not-a-uuid"] },
    { p_collection_id: id, p_deck_ids: "not-an-array" },
    { p_collection_id: id, p_deck_ids: [], user_id: visitor.id },
  ]) {
    const response = await fetch(`${url}/rest/v1/rpc/replace_collection_decks_atomic`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    assert.ok(response.status >= 400);
    await response.arrayBuffer();
    assert.deepEqual(await snapshot(id), before);
  }
  const response = await fetch(`${url}/rest/v1/rpc/replace_collection_decks_atomic`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_collection_id: id, p_deck_ids: [decks[3], decks[2]] }),
  });
  assert.equal(response.status, 200);
  assert.equal(await response.json(), 2);
  assert.deepEqual(
    (await snapshot(id)).map((row) => row.deck_id),
    [decks[3], decks[2]],
  );
});

test("simultaneous replacements never mix sets or lose positions", async () => {
  const id = await fixture();
  const first = decks.slice(0, 250);
  const second = decks.slice(250).toReversed();
  for (let iteration = 0; iteration < 8; iteration++) {
    const results = await Promise.all([replace(id, first), replace(id, second)]);
    results.forEach(ok);
    const rows = await snapshot(id);
    const actual = rows.map((row) => row.deck_id);
    assert.ok(
      JSON.stringify(actual) === JSON.stringify(first) ||
        JSON.stringify(actual) === JSON.stringify(second),
    );
    assert.deepEqual(
      rows.map((row) => row.position),
      Array.from({ length: 250 }, (_, i) => i),
    );
  }
});

test("overlapping requests wait on the shared transaction lock before deleting links", async () => {
  const id = await fixture();
  const before = await snapshot(id);
  // Docker targets only the disposable CLI database, never a linked database.
  const args = [
    "exec",
    "-i",
    "supabase_db_monfppjrvkyepjkfexqm",
    "psql",
    "-XAtq",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
  ];
  const blocker = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise((resolve) => {
    blocker.on("error", () => resolve(-1));
    blocker.on("close", resolve);
  });
  let output = "";
  blocker.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  const pending = [];
  try {
    blocker.stdin.write(`BEGIN; SET idle_in_transaction_session_timeout = '10s';
      SELECT pg_advisory_xact_lock(hashtextextended('${id}'::text, 52017002));
      SELECT 'LOCK_READY';\n`);
    const deadline = Date.now() + 5000;
    while (!output.includes("LOCK_READY") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(output.includes("LOCK_READY"), "fixture lock acquired");
    pending.push(replace(id, [decks[3], decks[4]]), replace(id, [decks[5]]));
    let waiting = 0;
    while (Date.now() < deadline && waiting < 2) {
      waiting = Number(
        execFileSync(
          "docker",
          [
            ...args,
            "-c",
            `SELECT count(*)
        FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND NOT l.granted
          AND a.query LIKE '%replace_collection_decks_atomic%';`,
          ],
          { encoding: "utf8" },
        ).trim(),
      );
      if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(waiting, 2, "both real HTTP requests blocked on collection lock");
    assert.deepEqual(await snapshot(id), before, "no DELETE runs while waiting");
  } finally {
    blocker.stdin.end("ROLLBACK;\n");
    assert.equal(await closed, 0, "fixture transaction released");
    (await Promise.all(pending)).forEach(ok);
  }
  const ids = (await snapshot(id)).map((row) => row.deck_id);
  assert.ok(
    JSON.stringify(ids) === JSON.stringify([decks[3], decks[4]]) ||
      JSON.stringify(ids) === JSON.stringify([decks[5]]),
  );
});

test("atomic deck creation and replacement share the collection lock", async () => {
  const id = await fixture();
  const desired = [decks[4], decks[3]];
  const [replacement, creation] = await Promise.all([
    replace(id, desired),
    owner.client.rpc("create_deck_with_cards", {
      p_name: "Concurrent atomic creation",
      p_description: "",
      p_cover_color: "sky",
      p_target_language: "en",
      p_definition_language: "ru",
      p_cards: [{ term: "test", definition: "example", position: 0 }],
      p_collection_id: id,
      p_use_default_collection: false,
      p_idempotency_key: randomUUID(),
    }),
  ]);
  ok(replacement);
  const created = ok(creation)[0];
  const rows = await snapshot(id);
  const ids = rows.map((row) => row.deck_id);
  assert.ok(
    JSON.stringify(ids) === JSON.stringify(desired) ||
      JSON.stringify(ids) === JSON.stringify([...desired, created.deck_id]),
  );
  assert.deepEqual(
    rows.map((row) => row.position),
    ids.map((_, i) => i),
  );
  assert.equal(
    ok(await owner.client.from("cards").select("id").eq("deck_id", created.deck_id)).length,
    1,
  );
});
