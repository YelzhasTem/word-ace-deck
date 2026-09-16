import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { after, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types.ts";
import { createAccountDeletionBackend } from "../src/lib/account-deletion.server.ts";
import {
  AccountDeletionStepError,
  cleanupAccountStorage,
  runAccountDeletionWorkflow,
} from "../src/lib/account-deletion-workflow.ts";
import { requireLocalDeletionFixture } from "../scripts/account-deletion-local-guard.ts";
import {
  deletionFixtureSql as sql,
  fixtureUuid as uuid,
  listFixtureAvatars,
} from "../scripts/account-deletion-fixture-db.ts";

const url = requireLocalDeletionFixture(process.env.SUPABASE_URL);
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(key && serviceKey);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient<Database>(url, serviceKey, options);
const users: string[] = [];
const bucket = admin.storage.from("avatars");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function ok<T>(result: { data: T; error: unknown }): T {
  assert.equal(result.error, null, "local fixture operation failed");
  return result.data;
}
async function actor() {
  const password = `Aa1!${randomUUID()}`;
  const email = `s3-${randomUUID()}@example.invalid`;
  const user = ok(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: `s3_${randomUUID().slice(0, 8)}` },
    }),
  ).user;
  assert.ok(user);
  users.push(user.id);
  const client = createClient<Database>(url, key!, options);
  const session = ok(await client.auth.signInWithPassword({ email, password })).session;
  assert.ok(session);
  return { id: user.id, client, token: session.access_token };
}
async function requested(user: Awaited<ReturnType<typeof actor>>) {
  const result = ok(await user.client.rpc("request_account_deletion"));
  assert.ok(result?.[0]);
  return result[0].job_id;
}
async function cleanupUser(id: string) {
  await cleanupAccountStorage(
    {
      listOwned: async () => listFixtureAvatars(id),
      remove: async (paths) => {
        ok(await bucket.remove(paths));
      },
    },
    id,
  );
  const found = await admin.auth.admin.getUserById(id);
  if (found.data.user) ok(await admin.auth.admin.deleteUser(id));
  else assert.ok(found.error?.status === 404 || found.error?.code === "user_not_found");
  assert.equal(sql(`SELECT private.account_deletion_residual_count(${uuid(id)})`), "0");
}
after(async () => {
  for (const id of users.toReversed()) await cleanupUser(id);
  sql(`DELETE FROM private.account_deletion_jobs WHERE user_ref_hash IN
    (SELECT private.account_deletion_user_hash(id) FROM unnest(ARRAY[${users.map(uuid).join(",")}]) id)`);
});

test("real coordinator deletes an empty account and replay/status stay consistent", async () => {
  const user = await actor();
  const job = await requested(user);
  const backend = createAccountDeletionBackend(admin);
  assert.equal((await runAccountDeletionWorkflow(backend, job, user.id)).status, "completed");
  assert.equal((await runAccountDeletionWorkflow(backend, job)).status, "completed");
  assert.equal(
    ok(await user.client.rpc("get_my_account_deletion_status"))?.[0]?.job_status,
    "completed",
  );
  assert.equal(sql(`SELECT private.account_deletion_residual_count(${uuid(user.id)})`), "0");
});

test("real Storage: >1000 nested avatars, legacy owner paths, partial failure and resume", async () => {
  const user = await actor();
  const names = Array.from({ length: 1005 }, (_, i) => `${user.id}/archive/${i % 7}/${i}.png`);
  for (let i = 0; i < names.length; i += 20) {
    const results = await Promise.all(
      names.slice(i, i + 20).map((name) => bucket.upload(name, png, { contentType: "image/png" })),
    );
    results.forEach(ok);
  }
  const legacy = `legacy-${randomUUID()}/old.png`;
  ok(await bucket.upload(legacy, png, { contentType: "image/png" }));
  sql(
    `UPDATE storage.objects SET owner_id=${uuid(user.id)}::text WHERE bucket_id='avatars' AND name='${legacy}'`,
  );
  const job = await requested(user);
  const backend = createAccountDeletionBackend(admin);
  const original = backend.cleanupStorage;
  backend.cleanupStorage = async (userId, checkpoint, jobId, token) => {
    let removes = 0;
    return cleanupAccountStorage(
      {
        listOwned: async () =>
          ok(
            await admin.rpc("list_account_deletion_avatars", {
              p_job_id: jobId,
              p_lease_token: token,
            }),
          )!.map((row) => row.name),
        remove: async (paths) => {
          if (++removes === 2) throw new AccountDeletionStepError("STORAGE_TEMPORARY");
          ok(await bucket.remove(paths));
        },
      },
      userId,
      checkpoint,
    );
  };
  await assert.rejects(runAccountDeletionWorkflow(backend, job));
  assert.equal(
    sql(
      `SELECT count(*) FROM storage.objects WHERE owner_id=${uuid(user.id)}::text OR name LIKE ${uuid(user.id)}::text || '/%'`,
    ),
    "906",
  );
  sql(
    `UPDATE private.account_deletion_jobs SET next_retry_at=now()-interval '1 second' WHERE id=${uuid(job)}`,
  );
  backend.cleanupStorage = original;
  assert.equal((await runAccountDeletionWorkflow(backend, job)).status, "completed");
  assert.equal(sql(`SELECT private.account_deletion_residual_count(${uuid(user.id)})`), "0");
});

test("Auth succeeds, finalizer fails, two real resumes lease one worker", async () => {
  const user = await actor();
  const job = await requested(user);
  const backend = createAccountDeletionBackend(admin);
  const original = backend.finalizeDatabase;
  backend.finalizeDatabase = async () => {
    throw new AccountDeletionStepError("DATABASE_TEMPORARY");
  };
  await assert.rejects(runAccountDeletionWorkflow(backend, job));
  assert.ok((await admin.auth.admin.getUserById(user.id)).error);
  assert.equal(
    sql(
      `SELECT status || ':' || resume_step FROM private.account_deletion_jobs WHERE id=${uuid(job)}`,
    ),
    "failed_retryable:database_verification",
  );
  sql(
    `UPDATE private.account_deletion_jobs SET next_retry_at=now()-interval '1 second' WHERE id=${uuid(job)}`,
  );
  backend.finalizeDatabase = original;
  const results = await Promise.allSettled([
    runAccountDeletionWorkflow(backend, job),
    runAccountDeletionWorkflow(backend, job),
  ]);
  assert.ok(results.some((r) => r.status === "fulfilled"));
  assert.equal(
    sql(`SELECT attempt_count FROM private.account_deletion_jobs WHERE id=${uuid(job)}`),
    "2",
  );
  assert.equal(sql(`SELECT private.account_deletion_residual_count(${uuid(user.id)})`), "0");
});

test("marketplace receipts/cascades reconcile and independent copies survive source deletion", async () => {
  const owner = await actor();
  const visitor = await actor();
  const created = ok(
    await owner.client.rpc("create_deck_with_cards", {
      p_name: "Source",
      p_description: null,
      p_cover_color: null,
      p_target_language: "en",
      p_definition_language: "ru",
      p_cards: [{ term: "one", definition: "один", position: 0 }],
      p_collection_id: null,
      p_use_default_collection: true,
      p_idempotency_key: randomUUID(),
    }),
  )![0];
  ok(await owner.client.from("decks").update({ visibility: "public" }).eq("id", created.deck_id));
  ok(
    await owner.client
      .from("collections")
      .update({ visibility: "public" })
      .eq("id", created.collection_id!),
  );
  const copy = ok(
    await visitor.client.rpc("duplicate_public_deck_atomic", {
      p_source_deck_id: created.deck_id,
      p_idempotency_key: randomUUID(),
    }),
  )![0];
  const collectionCopy = ok(
    await visitor.client.rpc("duplicate_public_collection_atomic", {
      p_source_collection_id: created.collection_id!,
      p_idempotency_key: randomUUID(),
    }),
  )![0];
  ok(await visitor.client.from("decks").update({ visibility: "public" }).eq("id", copy.deck_id));
  ok(
    await visitor.client
      .from("collections")
      .update({ visibility: "public" })
      .eq("id", collectionCopy.collection_id),
  );
  for (const [type, id] of [
    ["deck", copy.deck_id],
    ["collection", collectionCopy.collection_id],
  ] as const) {
    ok(
      await owner.client.rpc("record_marketplace_view", {
        p_resource_type: type,
        p_resource_id: id,
      }),
    );
  }
  ok(await owner.client.from("deck_likes").insert({ deck_id: copy.deck_id, user_id: owner.id }));
  ok(
    await owner.client
      .from("deck_ratings")
      .insert({ deck_id: copy.deck_id, user_id: owner.id, rating: 5 }),
  );
  ok(
    await owner.client
      .from("collection_likes")
      .insert({ collection_id: collectionCopy.collection_id, user_id: owner.id }),
  );
  ok(
    await owner.client
      .from("collection_ratings")
      .insert({ collection_id: collectionCopy.collection_id, user_id: owner.id, rating: 4 }),
  );
  assert.equal(
    sql(`SELECT count(*) FROM private.marketplace_view_receipts WHERE user_id=${uuid(owner.id)}`),
    "2",
  );
  assert.equal(
    (await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), await requested(owner)))
      .status,
    "completed",
  );
  const deck = ok(
    await visitor.client
      .from("decks")
      .select("source_deck_id,like_count,rating_sum,rating_count,view_count")
      .eq("id", copy.deck_id)
      .single(),
  );
  assert.deepEqual(deck, {
    source_deck_id: null,
    like_count: 0,
    rating_sum: 0,
    rating_count: 0,
    view_count: 1,
  });
  const collection = ok(
    await visitor.client
      .from("collections")
      .select("source_collection_id,like_count,rating_sum,rating_count")
      .eq("id", collectionCopy.collection_id)
      .single(),
  );
  assert.deepEqual(collection, {
    source_collection_id: null,
    like_count: 0,
    rating_sum: 0,
    rating_count: 0,
  });
  assert.equal(
    ok(await visitor.client.from("cards").select("id").eq("deck_id", copy.deck_id))!.length,
    1,
  );
  assert.equal(sql(`SELECT private.account_deletion_residual_count(${uuid(owner.id)})`), "0");
});

test("pending admin cannot moderate using Stage 1 RPC; unrelated resources are not changed", async () => {
  const moderator = await actor();
  const owner = await actor();
  ok(await admin.from("user_roles").insert({ user_id: moderator.id, role: "admin" }));
  const deck = ok(
    await owner.client
      .from("decks")
      .insert({ user_id: owner.id, name: "Moderation fence" })
      .select("id")
      .single(),
  )!;
  ok(await owner.client.from("decks").update({ visibility: "public" }).eq("id", deck.id));
  const report = ok(
    await moderator.client
      .from("deck_reports")
      .insert({ deck_id: deck.id, reporter_id: moderator.id, reason: "Synthetic report" })
      .select("id")
      .single(),
  )!;
  const job = await requested(moderator);
  assert.ok(
    (
      await moderator.client.rpc("moderate_marketplace_report", {
        p_resource_type: "deck",
        p_report_id: report.id,
        p_action: "hide",
      })
    ).error,
  );
  assert.equal(
    ok(await admin.from("decks").select("hidden_at").eq("id", deck.id).single())!.hidden_at,
    null,
  );
  await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), job);
  assert.ok(
    (
      await moderator.client.rpc("moderate_marketplace_report", {
        p_resource_type: "deck",
        p_report_id: report.id,
        p_action: "hide",
      })
    ).error,
  );
});

test("signed upload issued before request is rejected pending, completed, and after tombstone purge", async () => {
  const user = await actor();
  const path = `${user.id}/signed.png`;
  const signed = ok(await user.client.storage.from("avatars").createSignedUploadUrl(path));
  assert.ok(signed);
  const job = await requested(user);
  for (const phase of ["pending", "completed", "purged"]) {
    if (phase === "completed")
      await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), job);
    if (phase === "purged") {
      sql(
        `UPDATE private.account_deletion_jobs SET retention_until=now()-interval '1 second' WHERE id=${uuid(job)}`,
      );
      ok(await admin.rpc("purge_expired_account_deletion_jobs"));
    }
    assert.ok(
      (
        await user.client.storage
          .from("avatars")
          .uploadToSignedUrl(path, signed.token, png, { contentType: "image/png" })
      ).error,
      phase,
    );
    assert.equal(listFixtureAvatars(user.id).length, 0);
  }
});

test("real streamed upload admitted before deletion cannot finalize after completion", async () => {
  const user = await actor();
  const path = `${user.id}/in-flight.png`;
  // Kong buffers request bodies. Reach the actual local Storage listener inside
  // its container to hold an admitted backend stream (no production URL/key).
  const uploader = spawn("docker", [
    "exec",
    "-i",
    "supabase_storage_monfppjrvkyepjkfexqm",
    "node",
    "-e",
    `
    const rl = require('node:readline').createInterface({input:process.stdin});
    let req;
    rl.on('line', line => {
      if (req) { req.end(Buffer.alloc(1016)); return; }
      const input=JSON.parse(line);
      req=require('node:http').request('http://127.0.0.1:5000/object/avatars/'+input.path,
        {method:'POST',headers:{Authorization:'Bearer '+input.token,'content-type':'image/png','content-length':'1024'}},
        res=>{res.resume();res.on('end',()=>{console.log('STATUS:'+res.statusCode);rl.close();});});
      req.on('error',()=>{console.log('UPLOAD_ERROR');rl.close();});
      req.write(Buffer.from([137,80,78,71,13,10,26,10]));
    });
    rl.on('close',()=>{if(req)req.destroy();});
  `,
  ]);
  let output = "";
  uploader.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  const closed = new Promise<number | null>((resolve) => uploader.on("close", resolve));
  // Observe the provider's real file-backend stream, not an arbitrary delay.
  const files = () =>
    execFileSync(
      "docker",
      [
        "exec",
        "supabase_storage_monfppjrvkyepjkfexqm",
        "find",
        "/mnt",
        "-type",
        "f",
        "-path",
        `*${path}*`,
      ],
      { encoding: "utf8", timeout: 5000 },
    ).trim();
  try {
    uploader.stdin.write(JSON.stringify({ path, token: user.token }) + "\n");
    const deadline = Date.now() + 8000;
    while (!files() && Date.now() < deadline) await delay(50);
    assert.ok(files(), "upload must be admitted and streaming before deletion");
    await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), await requested(user));
    uploader.stdin.write("finish\n");
    assert.equal(await closed, 0);
    assert.ok(
      Number(output.match(/STATUS:(\d+)/)?.[1]) >= 400,
      "late metadata finalization must fail",
    );
    assert.equal(listFixtureAvatars(user.id).length, 0);
    const cleanupDeadline = Date.now() + 10000;
    while (files() && Date.now() < cleanupDeadline) await delay(50);
    assert.equal(files(), "", "Storage must remove rejected upload backend bytes");
  } finally {
    uploader.stdin.end();
    await closed;
  }
});

test("replacement first: Auth cascade waits for atomic replacement; deletion first: replacement denied", async () => {
  const user = await actor();
  const decks = ok(
    await user.client
      .from("decks")
      .insert([
        { user_id: user.id, name: "old" },
        { user_id: user.id, name: "new" },
      ])
      .select("id"),
  )!;
  const collection = ok(
    await user.client
      .from("collections")
      .insert({ user_id: user.id, name: "race" })
      .select("id")
      .single(),
  )!;
  ok(
    await user.client.rpc("replace_collection_decks_atomic", {
      p_collection_id: collection.id,
      p_deck_ids: [decks[0].id],
    }),
  );
  const child = spawn("docker", [
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
  ]);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  const closed = new Promise<number | null>((resolve) => child.on("close", resolve));
  let deletion: Promise<unknown> | undefined;
  try {
    child.stdin
      .write(`BEGIN; SET idle_in_transaction_session_timeout='15s'; SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims','{"sub":"${user.id}","role":"authenticated"}',true);
      SELECT public.replace_collection_decks_atomic(${uuid(collection.id)}, ARRAY[${uuid(decks[1].id)}]);
      SELECT 'REPLACEMENT_READY';\n`);
    const deadline = Date.now() + 5000;
    while (!output.includes("REPLACEMENT_READY") && Date.now() < deadline) await delay(20);
    assert.ok(output.includes("REPLACEMENT_READY"));
    const job = await requested(user);
    let finished = false;
    deletion = runAccountDeletionWorkflow(createAccountDeletionBackend(admin), job).finally(() => {
      finished = true;
    });
    let waiting = false;
    while (Date.now() < deadline) {
      waiting = Number(sql("SELECT count(*) FROM pg_locks WHERE NOT granted")) > 0;
      if (waiting) break;
      await delay(20);
    }
    assert.ok(
      waiting && !finished,
      "Auth cascade must wait for the admitted replacement transaction",
    );
    assert.deepEqual(
      ok(
        await admin
          .from("collection_decks")
          .select("deck_id,position")
          .eq("collection_id", collection.id),
      ),
      [{ deck_id: decks[0].id, position: 0 }],
    );
    child.stdin.end("COMMIT;\n");
    assert.equal(await closed, 0);
    await deletion;
    assert.equal(sql(`SELECT private.account_deletion_residual_count(${uuid(user.id)})`), "0");
  } finally {
    if (!child.stdin.writableEnded) child.stdin.end("ROLLBACK;\n");
    await closed;
    await deletion?.catch(() => undefined);
  }
  const second = await actor();
  const own = ok(
    await second.client
      .from("collections")
      .insert({ user_id: second.id, name: "pending" })
      .select("id")
      .single(),
  )!;
  const job = await requested(second);
  assert.ok(
    (
      await second.client.rpc("replace_collection_decks_atomic", {
        p_collection_id: own.id,
        p_deck_ids: [],
      })
    ).error,
  );
  await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), job);
  assert.equal(sql("SELECT count(*) FROM pg_locks WHERE NOT granted"), "0");
});
