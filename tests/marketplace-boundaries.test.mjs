import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";

// Run only against isolated local Supabase. These assertions were first run red
// against the pre-fix schema; fixtures never change application schema.
const url = process.env.SUPABASE_URL;
assert.ok(url, "A local SUPABASE_URL is required");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
  "Marketplace boundary tests refuse non-local Supabase",
);
assert.ok(process.env.SUPABASE_PUBLISHABLE_KEY, "A local publishable key is required");
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, "A local fixture admin key is required");

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY, options);
const userIds = [];
let owner;
let visitor;
let secondVisitor;
let moderator;

function succeeded(result, label) {
  assert.ok(!result.error, `${label} failed (${result.error?.code ?? "unknown"})`);
  return result.data;
}

function denied(result, label) {
  assert.equal(result.error?.code, "42501", `${label} must reject with insufficient privilege`);
}

async function createActor(label, isAdmin = false) {
  const suffix = randomUUID().slice(0, 8);
  const email = `market-boundary-${label}-${suffix}@example.invalid`;
  const password = `Fixture-${randomUUID()}-Aa1!`;
  const created = succeeded(
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: `mb_${label}_${suffix}` },
    }),
    "create fixture user",
  );
  userIds.push(created.user.id);
  const client = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY, options);
  succeeded(await client.auth.signInWithPassword({ email, password }), "sign in fixture user");
  if (isAdmin) {
    succeeded(
      await service.from("user_roles").insert({ user_id: created.user.id, role: "admin" }),
      "assign fixture moderator role",
    );
  }
  return { client, id: created.user.id };
}

before(async () => {
  owner = await createActor("owner");
  visitor = await createActor("visitor");
  secondVisitor = await createActor("visitor2");
  moderator = await createActor("admin", true);
});

after(async () => {
  const failures = [];
  for (const id of userIds.toReversed()) {
    const result = await service.auth.admin.deleteUser(id);
    if (result.error) failures.push(result.error.code ?? "cleanup_failed");
  }
  assert.deepEqual(
    failures,
    [],
    "all temporary accounts must be removed, including on test failure",
  );
});

async function resource(kind, values = {}) {
  const row = succeeded(
    await service
      .from(`${kind}s`)
      .insert({
        user_id: owner.id,
        name: "Synthetic marketplace boundary fixture",
        visibility: "public",
        published_at: new Date().toISOString(),
        ...values,
      })
      .select("id")
      .single(),
    "create fixture resource",
  );
  if (kind === "deck") {
    succeeded(
      await service.from("cards").insert({
        user_id: owner.id,
        deck_id: row.id,
        term: "fixture",
        definition: "synthetic example",
        position: 0,
      }),
      "create fixture card",
    );
  }
  return row.id;
}

async function row(kind, id, fields) {
  return succeeded(
    await service.from(`${kind}s`).select(fields).eq("id", id).single(),
    "read authoritative fixture state",
  );
}

function interaction(kind, id, actor, extra = {}) {
  return { [`${kind}_id`]: id, user_id: actor.id, ...extra };
}

async function report(kind, id) {
  return succeeded(
    await service
      .from(`${kind}_reports`)
      .insert({ [`${kind}_id`]: id, reporter_id: visitor.id, reason: "Synthetic report" })
      .select("id")
      .single(),
    "create fixture report",
  ).id;
}

// Trusted database interfaces. Never fall back to generic protected-column writes.
function moderate(client, kind, reportId) {
  return client.rpc("moderate_marketplace_report", {
    p_resource_type: kind,
    p_report_id: reportId,
    p_action: "hide",
  });
}

function view(client, kind, id) {
  return client.rpc("record_marketplace_view", {
    p_resource_type: kind,
    p_resource_id: id,
  });
}

for (const kind of ["deck", "collection"]) {
  const table = `${kind}s`;

  for (const [column, value] of Object.entries({
    learner_count: 99,
    like_count: 99,
    rating_sum: 6,
    rating_count: 3,
    view_count: 99,
    copy_count: 99,
    published_at: "2001-01-01T00:00:00.000Z",
  })) {
    test(`${kind}: owner cannot UPDATE ${column}`, async () => {
      // A valid nonzero seed avoids mistaking a CHECK failure for authorization.
      const id = await resource(kind, { rating_sum: 5, rating_count: 2 });
      const beforeRow = await row(kind, id, column);
      denied(
        await owner.client
          .from(table)
          .update({ [column]: value })
          .eq("id", id),
        column,
      );
      assert.deepEqual(await row(kind, id, column), beforeRow);
    });
  }

  test(`${kind}: owner cannot clear admin-set hidden_at`, async () => {
    const id = await resource(kind, { hidden_at: new Date().toISOString() });
    denied(await owner.client.from(table).update({ hidden_at: null }).eq("id", id), "unhide");
    assert.ok((await row(kind, id, "hidden_at")).hidden_at);
    const visible = succeeded(await anon.from(table).select("id").eq("id", id), "anonymous read");
    assert.equal(visible.length, 0);
  });

  test(`${kind}: owner cannot set hidden_at`, async () => {
    const id = await resource(kind);
    denied(
      await owner.client.from(table).update({ hidden_at: new Date().toISOString() }).eq("id", id),
      "hide",
    );
    assert.equal((await row(kind, id, "hidden_at")).hidden_at, null);
  });

  test(`${kind}: mixed editable/protected UPDATE is entirely rejected`, async () => {
    const id = await resource(kind, { hidden_at: new Date().toISOString() });
    const original = await row(kind, id, "name,hidden_at");
    denied(
      await owner.client.from(table).update({ name: "Changed", hidden_at: null }).eq("id", id),
      "mixed update",
    );
    assert.deepEqual(await row(kind, id, "name,hidden_at"), original);
  });

  test(`${kind}: INSERT cannot seed forged aggregate/admin values`, async () => {
    denied(
      await owner.client.from(table).insert({
        user_id: owner.id,
        name: "Forged fixture",
        like_count: 77,
        hidden_at: new Date().toISOString(),
      }),
      "protected insert",
    );
  });

  test(`${kind}: normal owner editing and cross-user isolation remain intact`, async () => {
    const id = await resource(kind);
    succeeded(
      await owner.client
        .from(table)
        .update({ name: "Owner edit", description: "Valid" })
        .eq("id", id),
      "owner edit",
    );
    await visitor.client.from(table).update({ name: "Forbidden edit" }).eq("id", id);
    assert.equal((await row(kind, id, "name")).name, "Owner edit");
  });

  test(`${kind}: hidden content stays invisible to anon and another user`, async () => {
    const id = await resource(kind, { hidden_at: new Date().toISOString() });
    for (const client of [anon, visitor.client]) {
      assert.deepEqual(succeeded(await client.from(table).select("id").eq("id", id), "read"), []);
    }
  });

  test(`${kind}: report INSERT cannot set its own moderation status`, async () => {
    const id = await resource(kind);
    denied(
      await visitor.client.from(`${kind}_reports`).insert({
        [`${kind}_id`]: id,
        reporter_id: visitor.id,
        reason: "Synthetic report",
        status: "dismissed",
        reviewed_at: new Date().toISOString(),
      }),
      "report moderation fields",
    );
  });

  test(`${kind}: non-owner like updates the authoritative count`, async () => {
    const id = await resource(kind);
    succeeded(
      await visitor.client.from(`${kind}_likes`).insert(interaction(kind, id, visitor)),
      "like",
    );
    assert.equal((await row(kind, id, "like_count")).like_count, 1);
  });

  test(`${kind}: unlike decrements a previously consistent count`, async () => {
    const id = await resource(kind);
    succeeded(
      await visitor.client.from(`${kind}_likes`).insert(interaction(kind, id, visitor)),
      "like",
    );
    // Seed a consistent pre-delete state even on the known broken baseline.
    succeeded(await service.from(table).update({ like_count: 1 }).eq("id", id), "seed count");
    succeeded(
      await visitor.client
        .from(`${kind}_likes`)
        .delete()
        .eq(`${kind}_id`, id)
        .eq("user_id", visitor.id),
      "unlike",
    );
    assert.equal((await row(kind, id, "like_count")).like_count, 0);
  });

  test(`${kind}: parallel distinct likes do not lose increments`, async () => {
    const id = await resource(kind);
    const results = await Promise.all(
      [visitor, secondVisitor].map((actor) =>
        actor.client.from(`${kind}_likes`).insert(interaction(kind, id, actor)),
      ),
    );
    results.forEach((result) => succeeded(result, "parallel like"));
    assert.equal((await row(kind, id, "like_count")).like_count, 2);
  });

  test(`${kind}: initial rating and repeated upserts never double-count`, async () => {
    const id = await resource(kind);
    for (const rating of [2, 5, 5]) {
      succeeded(
        await visitor.client
          .from(`${kind}_ratings`)
          .upsert(interaction(kind, id, visitor, { rating }), { onConflict: `${kind}_id,user_id` }),
        "rate",
      );
      assert.deepEqual(await row(kind, id, "rating_sum,rating_count"), {
        rating_sum: rating,
        rating_count: 1,
      });
    }
  });

  test(`${kind}: changing an existing rating adjusts sum but not count`, async () => {
    const id = await resource(kind);
    succeeded(
      await visitor.client
        .from(`${kind}_ratings`)
        .insert(interaction(kind, id, visitor, { rating: 2 })),
      "seed rating",
    );
    succeeded(
      await service.from(table).update({ rating_sum: 2, rating_count: 1 }).eq("id", id),
      "seed count",
    );
    for (const rating of [5, 5]) {
      succeeded(
        await visitor.client
          .from(`${kind}_ratings`)
          .upsert(interaction(kind, id, visitor, { rating }), { onConflict: `${kind}_id,user_id` }),
        "update rating",
      );
      assert.deepEqual(await row(kind, id, "rating_sum,rating_count"), {
        rating_sum: 5,
        rating_count: 1,
      });
    }
  });

  test(`${kind}: concurrent ratings maintain authoritative sum/count`, async () => {
    const id = await resource(kind);
    const results = await Promise.all(
      [visitor, secondVisitor].map((actor, index) =>
        actor.client
          .from(`${kind}_ratings`)
          .upsert(interaction(kind, id, actor, { rating: index + 3 }), {
            onConflict: `${kind}_id,user_id`,
          }),
      ),
    );
    results.forEach((result) => succeeded(result, "parallel rating"));
    assert.deepEqual(await row(kind, id, "rating_sum,rating_count"), {
      rating_sum: 7,
      rating_count: 2,
    });
  });

  test(`${kind}: trusted rating cleanup updates both aggregates`, async () => {
    const id = await resource(kind);
    succeeded(
      await visitor.client
        .from(`${kind}_ratings`)
        .insert(interaction(kind, id, visitor, { rating: 4 })),
      "seed rating",
    );
    succeeded(
      await service.from(table).update({ rating_sum: 4, rating_count: 1 }).eq("id", id),
      "seed consistent counters",
    );
    succeeded(
      // Rating deletion is an existing trusted cleanup operation, not a new
      // client permission. Normal users currently have no DELETE RLS policy.
      await service.from(`${kind}_ratings`).delete().eq(`${kind}_id`, id).eq("user_id", visitor.id),
      "delete rating",
    );
    assert.deepEqual(await row(kind, id, "rating_sum,rating_count"), {
      rating_sum: 0,
      rating_count: 0,
    });
  });

  test(`${kind}: a rating cannot be retargeted to another resource`, async () => {
    const source = await resource(kind);
    const target = await resource(kind);
    succeeded(
      await visitor.client
        .from(`${kind}_ratings`)
        .insert(interaction(kind, source, visitor, { rating: 3 })),
      "seed rating",
    );
    denied(
      await visitor.client
        .from(`${kind}_ratings`)
        .update({ [`${kind}_id`]: target })
        .eq(`${kind}_id`, source)
        .eq("user_id", visitor.id),
      "rating identity update",
    );
    const ratings = succeeded(
      await service
        .from(`${kind}_ratings`)
        .select(`${kind}_id,rating`)
        .eq("user_id", visitor.id)
        .in(`${kind}_id`, [source, target]),
      "read rating identity",
    );
    assert.deepEqual(ratings, [{ [`${kind}_id`]: source, rating: 3 }]);
  });

  test(`${kind}: legacy future-dated ratings can still be updated safely`, async () => {
    const id = await resource(kind);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    succeeded(
      await service.from(`${kind}_ratings`).insert({
        ...interaction(kind, id, visitor, { rating: 2 }),
        created_at: future,
        updated_at: future,
      }),
      "future timestamp fixture",
    );
    succeeded(
      await visitor.client
        .from(`${kind}_ratings`)
        .upsert(interaction(kind, id, visitor, { rating: 5 }), {
          onConflict: `${kind}_id,user_id`,
        }),
      "update legacy rating",
    );
    assert.deepEqual(await row(kind, id, "rating_sum,rating_count"), {
      rating_sum: 5,
      rating_count: 1,
    });
    const timestamps = succeeded(
      await service
        .from(`${kind}_ratings`)
        .select("created_at,updated_at")
        .eq(`${kind}_id`, id)
        .single(),
      "rating time",
    );
    assert.ok(Date.parse(timestamps.updated_at) >= Date.parse(timestamps.created_at));
  });

  test(`${kind}: legacy future-dated parents still accept trusted interactions`, async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const id = await resource(kind, { created_at: future, updated_at: future });
    succeeded(
      await visitor.client.from(`${kind}_likes`).insert(interaction(kind, id, visitor)),
      "future-parent like",
    );
    succeeded(
      await visitor.client
        .from(`${kind}_ratings`)
        .insert(interaction(kind, id, visitor, { rating: 3 })),
      "future-parent rating",
    );
    succeeded(await view(visitor.client, kind, id), "future-parent view");
    assert.deepEqual(await row(kind, id, "like_count,rating_sum,rating_count,view_count"), {
      like_count: 1,
      rating_sum: 3,
      rating_count: 1,
      view_count: 1,
    });
  });

  test(`${kind}: save does not masquerade as a learner, like, or copy`, async () => {
    const id = await resource(kind);
    succeeded(
      await visitor.client.from(`${kind}_saves`).insert(interaction(kind, id, visitor)),
      "save",
    );
    assert.deepEqual(await row(kind, id, "learner_count,like_count,copy_count"), {
      learner_count: 0,
      like_count: 0,
      copy_count: 0,
    });
  });

  test(`${kind}: existing atomic copy retry increments counters only once`, async () => {
    const id = await resource(kind);
    const args = { [`p_source_${kind}_id`]: id, p_idempotency_key: randomUUID() };
    for (let index = 0; index < 2; index++) {
      succeeded(await visitor.client.rpc(`duplicate_public_${kind}_atomic`, args), "copy retry");
    }
    assert.deepEqual(await row(kind, id, "copy_count,learner_count"), {
      copy_count: 1,
      learner_count: 1,
    });
  });

  test(`${kind}: distinct concurrent atomic copies both succeed and count`, async () => {
    for (let round = 0; round < 3; round++) {
      const id = await resource(kind);
      const results = await Promise.all(
        [visitor, secondVisitor].map((actor) =>
          actor.client.rpc(`duplicate_public_${kind}_atomic`, {
            [`p_source_${kind}_id`]: id,
            p_idempotency_key: randomUUID(),
          }),
        ),
      );
      results.forEach((result) => succeeded(result, "parallel copy"));
      assert.deepEqual(await row(kind, id, "copy_count,learner_count"), {
        copy_count: 2,
        learner_count: 2,
      });
    }
  });

  test(`${kind}: admin hide is atomic and repeatable`, async () => {
    const id = await resource(kind);
    const reportId = await report(kind, id);
    for (let index = 0; index < 2; index++) {
      succeeded(await moderate(moderator.client, kind, reportId), "moderation RPC");
    }
    assert.ok((await row(kind, id, "hidden_at")).hidden_at);
    const reportRow = succeeded(
      await service
        .from(`${kind}_reports`)
        .select("status,reviewed_at")
        .eq("id", reportId)
        .single(),
      "read report",
    );
    assert.equal(reportRow.status, "hidden");
    assert.ok(reportRow.reviewed_at);
    assert.deepEqual(
      succeeded(await anon.from(table).select("id").eq("id", id), "public read"),
      [],
    );
  });

  test(`${kind}: non-admin moderation is rejected`, async () => {
    const id = await resource(kind);
    const reportId = await report(kind, id);
    denied(await moderate(owner.client, kind, reportId), "non-admin moderation");
    assert.equal((await row(kind, id, "hidden_at")).hidden_at, null);
  });

  test(`${kind}: legitimate distinct viewers increment without loss`, async () => {
    const id = await resource(kind);
    const results = await Promise.all([
      view(visitor.client, kind, id),
      view(secondVisitor.client, kind, id),
    ]);
    results.forEach((result) => succeeded(result, "view RPC"));
    assert.equal((await row(kind, id, "view_count")).view_count, 2);
  });

  test(`${kind}: same-viewer concurrent replay counts once per UTC day`, async () => {
    const id = await resource(kind);
    const results = await Promise.all(
      Array.from({ length: 3 }, () => view(visitor.client, kind, id)),
    );
    results.forEach((result) => succeeded(result, "view replay"));
    assert.equal((await row(kind, id, "view_count")).view_count, 1);
  });

  test(`${kind}: anon and hidden-resource views are rejected`, async () => {
    const id = await resource(kind, { hidden_at: new Date().toISOString() });
    denied(await view(anon, kind, id), "anonymous view");
    denied(await view(visitor.client, kind, id), "hidden resource view");
    assert.equal((await row(kind, id, "view_count")).view_count, 0);
  });

  test(`${kind}: two-user publish/interact/moderate flow remains secure`, async () => {
    const id = succeeded(
      await owner.client
        .from(table)
        .insert({
          user_id: owner.id,
          name: "Owner-created fixture",
        })
        .select("id")
        .single(),
      "owner creates private resource",
    ).id;
    assert.equal((await row(kind, id, "published_at")).published_at, null);
    succeeded(
      await owner.client.from(table).update({ visibility: "public" }).eq("id", id),
      "owner publishes",
    );
    assert.ok((await row(kind, id, "published_at")).published_at);
    succeeded(
      await visitor.client.from(`${kind}_likes`).insert(interaction(kind, id, visitor)),
      "visitor likes",
    );
    succeeded(
      await visitor.client
        .from(`${kind}_ratings`)
        .upsert(interaction(kind, id, visitor, { rating: 4 }), {
          onConflict: `${kind}_id,user_id`,
        }),
      "visitor rates",
    );
    assert.equal(succeeded(await view(visitor.client, kind, id), "visitor views"), 1);
    assert.deepEqual(await row(kind, id, "like_count,rating_sum,rating_count,view_count"), {
      like_count: 1,
      rating_sum: 4,
      rating_count: 1,
      view_count: 1,
    });
    denied(
      await owner.client.from(table).update({ like_count: 500 }).eq("id", id),
      "owner counter forgery",
    );
    succeeded(
      await visitor.client.from(`${kind}_reports`).insert({
        [`${kind}_id`]: id,
        reporter_id: visitor.id,
        reason: "Synthetic moderation report",
      }),
      "visitor report",
    );
    const reportId = succeeded(
      await moderator.client.from(`${kind}_reports`).select("id").eq(`${kind}_id`, id).single(),
      "admin queue",
    ).id;
    succeeded(await moderate(moderator.client, kind, reportId), "admin hides");
    denied(await owner.client.from(table).update({ hidden_at: null }).eq("id", id), "owner unhide");
    succeeded(
      await owner.client.from(table).update({ visibility: "private" }).eq("id", id),
      "owner unpublishes hidden item",
    );
    assert.equal((await row(kind, id, "published_at")).published_at, null);
    succeeded(
      await owner.client.from(table).update({ visibility: "public" }).eq("id", id),
      "owner republishes hidden item",
    );
    assert.ok((await row(kind, id, "hidden_at")).hidden_at);
    assert.deepEqual(
      succeeded(await anon.from(table).select("id").eq("id", id), "anon hidden read"),
      [],
    );
  });

  test(`${kind}: hidden targets cannot receive new likes, ratings, or saves`, async () => {
    const id = await resource(kind, { hidden_at: new Date().toISOString() });
    for (const actor of [owner, visitor]) {
      for (const suffix of ["likes", "ratings", "saves"]) {
        denied(
          await actor.client
            .from(`${kind}_${suffix}`)
            .insert(interaction(kind, id, actor, suffix === "ratings" ? { rating: 5 } : {})),
          "hidden interaction",
        );
      }
    }
  });

  test(`${kind}: trusted user cleanup decrements surviving author's totals`, async () => {
    const actor = await createActor("cleanup");
    const id = await resource(kind);
    succeeded(
      await actor.client.from(`${kind}_likes`).insert(interaction(kind, id, actor)),
      "cleanup like",
    );
    succeeded(
      await actor.client
        .from(`${kind}_ratings`)
        .insert(interaction(kind, id, actor, { rating: 3 })),
      "cleanup rating",
    );
    succeeded(await view(actor.client, kind, id), "cleanup view");
    succeeded(await service.auth.admin.deleteUser(actor.id), "trusted fixture user cleanup");
    userIds.splice(userIds.indexOf(actor.id), 1);
    assert.deepEqual(await row(kind, id, "like_count,rating_sum,rating_count,view_count"), {
      like_count: 0,
      rating_sum: 0,
      rating_count: 0,
      view_count: 1,
    });
  });

  test(`${kind}: invalid RPC parameters and extra counter inputs cannot mutate data`, async () => {
    const id = await resource(kind);
    const wrongKind = await visitor.client.rpc("record_marketplace_view", {
      p_resource_type: "other",
      p_resource_id: id,
    });
    assert.equal(wrongKind.error?.code, "22023");
    const extra = await visitor.client.rpc("record_marketplace_view", {
      p_resource_type: kind,
      p_resource_id: id,
      p_count: 999,
    });
    assert.ok(extra.error);
    assert.equal((await row(kind, id, "view_count")).view_count, 0);
    const reportId = await report(kind, id);
    const anonymous = await moderate(anon, kind, reportId);
    denied(anonymous, "anon moderation");
    const invalidAction = await moderator.client.rpc("moderate_marketplace_report", {
      p_resource_type: kind,
      p_report_id: reportId,
      p_action: "unhide",
    });
    assert.equal(invalidAction.error?.code, "22023");
    assert.equal((await row(kind, id, "hidden_at")).hidden_at, null);
  });
}

test("collection: nested deck copy counters increment once, including on replay", async () => {
  const collectionId = await resource("collection");
  const deckIds = [await resource("deck"), await resource("deck")];
  succeeded(
    await service.from("collection_decks").insert(
      deckIds.map((id, position) => ({
        collection_id: collectionId,
        deck_id: id,
        user_id: owner.id,
        position,
      })),
    ),
    "seed collection links",
  );
  const args = { p_source_collection_id: collectionId, p_idempotency_key: randomUUID() };
  for (let index = 0; index < 2; index++) {
    succeeded(
      await visitor.client.rpc("duplicate_public_collection_atomic", args),
      "copy collection",
    );
  }
  assert.deepEqual(await row("collection", collectionId, "copy_count,learner_count"), {
    copy_count: 1,
    learner_count: 1,
  });
  for (const id of deckIds) {
    assert.deepEqual(await row("deck", id, "copy_count,learner_count"), {
      copy_count: 1,
      learner_count: 1,
    });
  }
});

test("overlapping collection copies and direct deck copies use consistent lock order", async () => {
  const deckIds = [await resource("deck"), await resource("deck")];
  const collectionIds = [await resource("collection"), await resource("collection")];
  for (const [index, collectionId] of collectionIds.entries()) {
    succeeded(
      await service.from("collection_decks").insert(
        (index ? deckIds.toReversed() : deckIds).map((id, position) => ({
          collection_id: collectionId,
          deck_id: id,
          user_id: owner.id,
          position,
        })),
      ),
      "overlapping collection fixture",
    );
  }
  const results = await Promise.all([
    visitor.client.rpc("duplicate_public_collection_atomic", {
      p_source_collection_id: collectionIds[0],
      p_idempotency_key: randomUUID(),
    }),
    secondVisitor.client.rpc("duplicate_public_collection_atomic", {
      p_source_collection_id: collectionIds[1],
      p_idempotency_key: randomUUID(),
    }),
    visitor.client.rpc("duplicate_public_deck_atomic", {
      p_source_deck_id: deckIds[0],
      p_idempotency_key: randomUUID(),
    }),
  ]);
  results.forEach((result) => succeeded(result, "overlapping copy"));
  assert.equal((await row("deck", deckIds[0], "copy_count")).copy_count, 3);
  assert.equal((await row("deck", deckIds[1], "copy_count")).copy_count, 2);
});

test("creator follows still use owned relation rows, not writable counters", async () => {
  succeeded(
    await visitor.client
      .from("creator_follows")
      .insert({ creator_id: owner.id, follower_id: visitor.id }),
    "follow",
  );
  denied(
    await owner.client
      .from("creator_follows")
      .insert({ creator_id: owner.id, follower_id: secondVisitor.id }),
    "forged follower",
  );
  const followed = succeeded(
    await visitor.client
      .from("creator_follows")
      .select("id")
      .eq("creator_id", owner.id)
      .eq("follower_id", visitor.id),
    "follow read",
  );
  assert.equal(followed.length, 1);
  succeeded(
    await visitor.client.from("creator_follows").delete().eq("id", followed[0].id),
    "unfollow",
  );
});
