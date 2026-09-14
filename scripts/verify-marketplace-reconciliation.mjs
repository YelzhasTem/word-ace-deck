import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// This explicitly opted-in upgrade rehearsal destroys ONLY an empty local stack.
// It must run after other fixtures, never concurrently with them.
const url = process.env.SUPABASE_URL;
assert.ok(
  url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
  "Local Supabase required",
);
assert.equal(
  process.env.MARKETPLACE_RECONCILIATION_RESET_LOCAL,
  "true",
  "Explicit local reset opt-in required",
);
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, "Local fixture key required");
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const userIds = [];

function ok(result, label) {
  assert.ok(!result.error, `${label} failed (${result.error?.code ?? "unknown"})`);
  return result.data;
}

function localSupabase(args) {
  try {
    execFileSync("npx", ["--yes", "supabase@2.110.0", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 240_000,
    });
  } catch {
    throw new Error("Local migration rehearsal command failed; no remote command was requested.");
  }
}

async function actor() {
  const suffix = randomUUID();
  const data = ok(
    await admin.auth.admin.createUser({
      email: `marketplace-upgrade-${suffix}@example.invalid`,
      password: `Aa1!${randomUUID()}`,
      email_confirm: true,
      user_metadata: { username: `upgrade_${suffix.slice(0, 8)}` },
    }),
    "create upgrade fixture user",
  );
  userIds.push(data.user.id);
  return data.user.id;
}

const safeFields =
  "id,user_id,name,description,visibility,published_at,hidden_at,created_at,updated_at,copy_count,learner_count,view_count";
const users = ok(
  await admin.auth.admin.listUsers({ page: 1, perPage: 1 }),
  "check empty local Auth",
);
assert.equal(users.users.length, 0, "Refusing reset of a local stack containing users");
for (const table of ["profiles", "profile_private", "decks", "cards", "collections"]) {
  const result = await admin.from(table).select("user_id", { count: "exact", head: true });
  ok(result, "check empty local table");
  assert.equal(result.count, 0, "Refusing reset of a nonempty local stack");
}

localSupabase(["db", "reset", "--local", "--version", "20260802010000"]);
const fixtures = [];
try {
  const owner = await actor();
  const visitor = await actor();
  for (const kind of ["deck", "collection"]) {
    for (const hasEvents of [true, false]) {
      const table = `${kind}s`;
      const id = ok(
        await admin
          .from(table)
          .insert({
            user_id: owner,
            name: "Existing synthetic marketplace content",
            description: "Preserve this content",
            visibility: "public",
            published_at: "2020-01-01T00:00:00Z",
          })
          .select("id")
          .single(),
        "create legacy resource",
      ).id;
      if (hasEvents) {
        for (const [index, userId] of [owner, visitor].entries()) {
          ok(
            await admin.from(`${kind}_likes`).insert({ [`${kind}_id`]: id, user_id: userId }),
            "legacy like",
          );
          ok(
            await admin
              .from(`${kind}_ratings`)
              .insert({ [`${kind}_id`]: id, user_id: userId, rating: index ? 5 : 2 }),
            "legacy rating",
          );
          ok(
            await admin.from(`${kind}_saves`).insert({ [`${kind}_id`]: id, user_id: userId }),
            "legacy save",
          );
        }
      }
      ok(
        await admin
          .from(table)
          .update({
            like_count: 123,
            rating_count: 99,
            rating_sum: 99,
            copy_count: 7,
            learner_count: 7,
            view_count: 11,
          })
          .eq("id", id),
        "seed historically forged totals",
      );
      const before = ok(
        await admin.from(table).select(safeFields).eq("id", id).single(),
        "snapshot metadata",
      );
      fixtures.push({ kind, id, hasEvents, before });
    }
  }
  localSupabase(["migration", "up", "--local"]);
  for (const fixture of fixtures) {
    const { kind, id, hasEvents, before } = fixture;
    const after = ok(
      await admin.from(`${kind}s`).select(safeFields).eq("id", id).single(),
      "read preserved metadata",
    );
    assert.deepEqual(
      after,
      before,
      "Migration changed source content or historical metadata/counters",
    );
    const totals = ok(
      await admin
        .from(`${kind}s`)
        .select("like_count,rating_count,rating_sum")
        .eq("id", id)
        .single(),
      "read reconciled totals",
    );
    assert.deepEqual(totals, {
      like_count: hasEvents ? 2 : 0,
      rating_count: hasEvents ? 2 : 0,
      rating_sum: hasEvents ? 7 : 0,
    });
    for (const suffix of ["likes", "ratings", "saves"]) {
      const result = await admin
        .from(`${kind}_${suffix}`)
        .select("id", { count: "exact", head: true })
        .eq(`${kind}_id`, id);
      ok(result, "check retained source events");
      assert.equal(result.count, hasEvents ? 2 : 0);
    }
  }
  console.log(
    "Marketplace upgrade/backfill rehearsal passed: four existing resources reconciled; metadata, saves and event rows preserved.",
  );
} finally {
  for (const id of userIds.toReversed())
    ok(await admin.auth.admin.deleteUser(id), "remove upgrade fixture user");
}
