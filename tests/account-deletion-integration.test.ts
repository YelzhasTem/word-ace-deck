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
  elapseFixtureCapabilityDrain,
} from "../scripts/account-deletion-fixture-db.ts";

const url = requireLocalDeletionFixture(process.env.SUPABASE_URL);
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(key && serviceKey);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient<Database>(url, serviceKey, options);
const users: string[] = [];
const multipartUploads: { key: string; uploadId: string }[] = [];
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
  for (const upload of multipartUploads)
    multipartApi("abort", upload.key, undefined, upload.uploadId);
  for (const id of users.toReversed()) await cleanupUser(id);
  sql(`DELETE FROM private.account_deletion_jobs WHERE user_ref_hash IN
    (SELECT private.account_deletion_user_hash(id) FROM unnest(ARRAY[${users.map(uuid).join(",")}]) id)`);
});

// Use the provider container's existing AWS SDK and LOCAL CLI S3 credentials.
// No generated key is created, and no direct multipart metadata DML is used.
// Sign the public /storage/v1 prefix; the local transport strips it just like
// the gateway, preserving the signed Host and avoiding proxy host rewriting.
function multipartApi(
  operation: "create" | "part" | "abort" | "complete" | "put",
  path: string,
  token?: string,
  uploadId?: string,
  etag?: string,
): { uploadId?: string; etag?: string } {
  requireLocalDeletionFixture(url);
  const result = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_storage_monfppjrvkyepjkfexqm",
      "node",
      "-e",
      `
    const fs=require('node:fs'); const input=JSON.parse(fs.readFileSync(0,'utf8'));
      const {S3Client,CreateMultipartUploadCommand,UploadPartCommand,AbortMultipartUploadCommand,CompleteMultipartUploadCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
      const {NodeHttpHandler}=require('@smithy/node-http-handler');
      const transport=new NodeHttpHandler({connectionTimeout:3000,requestTimeout:10000});
      const credentials=input.token
        ? {accessKeyId:process.env.TENANT_ID,secretAccessKey:process.env.ANON_KEY,sessionToken:input.token}
        : {accessKeyId:process.env.S3_PROTOCOL_ACCESS_KEY_ID,secretAccessKey:process.env.S3_PROTOCOL_ACCESS_KEY_SECRET};
      const client=new S3Client({region:'local',endpoint:'http://127.0.0.1:5000/storage/v1/s3',forcePathStyle:true,
        credentials,maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',requestHandler:{
          handle:(request,options)=>transport.handle({...request,path:request.path.slice('/storage/v1'.length)},options),
          destroy:()=>transport.destroy()
        }});
    const common={Bucket:'avatars',Key:input.path,UploadId:input.uploadId};
    const command=input.operation==='create' ? new CreateMultipartUploadCommand({...common,ContentType:'image/png'})
      : input.operation==='part' ? new UploadPartCommand({...common,PartNumber:1,Body:Buffer.from([137,80,78,71,13,10,26,10])})
      : input.operation==='complete' ? new CompleteMultipartUploadCommand({...common,MultipartUpload:{Parts:[{PartNumber:1,ETag:input.etag}]}})
      : input.operation==='put' ? new PutObjectCommand({...common,ContentType:'image/png',Body:Buffer.from([137,80,78,71,13,10,26,10])})
      : new AbortMultipartUploadCommand(common);
    client.send(command).then(result=>process.stdout.write(JSON.stringify({uploadId:result.UploadId,etag:result.ETag})))
      .catch(error=>{process.stderr.write('Local S3 fixture: '+error.name+' HTTP '+error.$metadata?.httpStatusCode);process.exitCode=1;})
      .finally(()=>client.destroy());
  `,
    ],
    {
      input: JSON.stringify({ operation, path, token, uploadId, etag }),
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const parsed: unknown = JSON.parse(result);
  assert.ok(parsed && typeof parsed === "object");
  const value: { uploadId?: string; etag?: string } = {};
  if ("uploadId" in parsed) {
    assert.equal(typeof parsed.uploadId, "string");
    value.uploadId = String(parsed.uploadId);
  }
  if ("etag" in parsed) {
    assert.equal(typeof parsed.etag, "string");
    value.etag = String(parsed.etag);
  }
  return value;
}

test("multiple multipart uploads: stale completion fenced, partial abort retry and other-user isolation", async () => {
  const user = await actor();
  const other = await actor();
  const uploads = [user, user, other].map((owner, i) => {
    const path = `${owner.id}/parts-${i}.png`;
    const created = multipartApi("create", path, owner.token);
    assert.ok(created.uploadId);
    const entry = { key: path, uploadId: created.uploadId };
    multipartUploads.push(entry);
    const part = multipartApi("part", path, owner.token, created.uploadId);
    assert.ok(part.etag);
    return { entry, etag: part.etag };
  });
  const job = await requested(user);
  const backend = createAccountDeletionBackend(admin);
  // Existing user token remains cryptographically valid, but the final metadata
  // fence must reject completion both while pending and after Auth is gone.
  // Elevated completion bypasses admission RLS but cannot bypass the commit fence.
  // The backend may have completed bytes already; metadata and parts remain until abort.
  assert.throws(() =>
    multipartApi(
      "complete",
      uploads[0].entry.key,
      undefined,
      uploads[0].entry.uploadId,
      uploads[0].etag,
    ),
  );
  assert.equal(listFixtureAvatars(user.id).length, 0);
  assert.equal((await runAccountDeletionWorkflow(backend, job)).status, "capability_drain_pending");
  assert.throws(() =>
    multipartApi(
      "complete",
      uploads[1].entry.key,
      user.token,
      uploads[1].entry.uploadId,
      uploads[1].etag,
    ),
  );
  assert.throws(() => multipartApi("create", `${user.id}/fresh-multipart.png`, user.token));
  elapseFixtureCapabilityDrain(job);
  await assert.rejects(runAccountDeletionWorkflow(backend, job));
  assert.equal(
    sql(`SELECT private.account_deletion_provider_residual_count(${uuid(user.id)})`),
    "4",
  );
  const abort = (entry: { key: string; uploadId: string }) => {
    multipartApi("abort", entry.key, undefined, entry.uploadId);
    multipartUploads.splice(multipartUploads.indexOf(entry), 1);
  };
  abort(uploads[0].entry);
  // Operator/process failure between uploads leaves the second upload visible.
  sql(
    `UPDATE private.account_deletion_jobs SET next_retry_at=now()-interval '1 second' WHERE id=${uuid(job)}`,
  );
  await assert.rejects(runAccountDeletionWorkflow(backend, job));
  assert.equal(
    sql(`SELECT private.account_deletion_provider_residual_count(${uuid(user.id)})`),
    "2",
  );
  assert.equal(
    sql(`SELECT private.account_deletion_provider_residual_count(${uuid(other.id)})`),
    "2",
  );
  abort(uploads[1].entry);
  const providerFileCount = (path: string) =>
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
    )
      .trim()
      .split("\n")
      .filter(Boolean).length;
  const cleanupDeadline = Date.now() + 10_000;
  while (providerFileCount(uploads[0].entry.key) && Date.now() < cleanupDeadline) await delay(50);
  assert.equal(
    providerFileCount(uploads[0].entry.key),
    0,
    "rejected completion bytes cleaned by local provider",
  );
  assert.equal(
    providerFileCount(uploads[1].entry.key),
    0,
    "abort removes local incomplete part bytes",
  );
  assert.ok(providerFileCount(uploads[2].entry.key) > 0, "unrelated user part bytes remain");
  sql(
    `UPDATE private.account_deletion_jobs SET next_retry_at=now()-interval '1 second' WHERE id=${uuid(job)}`,
  );
  assert.equal((await runAccountDeletionWorkflow(backend, job)).status, "completed");
  assert.equal(
    sql(`SELECT private.account_deletion_provider_residual_count(${uuid(other.id)})`),
    "2",
  );
  abort(uploads[2].entry);
});

test("S3 single PUT works normally but stale JWT and elevated late PUT are fenced", async () => {
  const user = await actor();
  multipartApi("put", `${user.id}/s3-put.png`, user.token);
  assert.equal(listFixtureAvatars(user.id).length, 1);
  const job = await requested(user);
  assert.throws(() => multipartApi("put", `${user.id}/pending-put.png`, user.token));
  await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), job);
  assert.throws(() => multipartApi("put", `${user.id}/late-put.png`, user.token));
  assert.throws(() => multipartApi("put", `${user.id}/elevated-put.png`));
  assert.equal(listFixtureAvatars(user.id).length, 0);
});

test("real TUS creation/finalization works and pre-deletion upload cannot finish with stale JWT", async () => {
  const user = await actor();
  const headers = { Authorization: `Bearer ${user.token}`, apikey: key!, "Tus-Resumable": "1.0.0" };
  const create = async (name: string) => {
    const metadata = Object.entries({
      bucketName: "avatars",
      objectName: name,
      contentType: "image/png",
    })
      .map(([field, value]) => `${field} ${Buffer.from(value).toString("base64")}`)
      .join(",");
    const response = await fetch(`${url}/storage/v1/upload/resumable`, {
      method: "POST",
      headers: { ...headers, "Upload-Length": String(png.length), "Upload-Metadata": metadata },
      signal: AbortSignal.timeout(10_000),
    });
    await response.arrayBuffer();
    assert.equal(response.status, 201, "local TUS creation supported");
    const location = new URL(response.headers.get("location")!);
    const path = location.pathname.startsWith("/storage/v1/")
      ? location.pathname
      : `/storage/v1${location.pathname}`;
    return `${url}${path}`;
  };
  const patch = async (target: string) => {
    const response = await fetch(target, {
      method: "PATCH",
      headers: {
        ...headers,
        "Upload-Offset": "0",
        "Content-Type": "application/offset+octet-stream",
      },
      body: png,
      signal: AbortSignal.timeout(10_000),
    });
    await response.arrayBuffer();
    return response.status;
  };
  assert.equal(await patch(await create(`${user.id}/tus-normal.png`)), 204);
  const pending = await create(`${user.id}/tus-pending.png`);
  const job = await requested(user);
  assert.ok((await patch(pending)) >= 400);
  await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), job);
  assert.ok((await patch(pending)) >= 400);
  assert.equal(listFixtureAvatars(user.id).length, 0);
  // Supported TUS termination with the LOCAL server credential removes temporary
  // file-store state; no direct provider metadata manipulation.
  const termination = await fetch(pending, {
    method: "DELETE",
    headers: {
      "Tus-Resumable": "1.0.0",
      Authorization: `Bearer ${serviceKey}`,
      apikey: key!,
    },
    signal: AbortSignal.timeout(10_000),
  });
  await termination.arrayBuffer();
  assert.ok([204, 404, 410].includes(termination.status), "local TUS termination succeeds");
});

test("real S3 multipart and parts block completion until supported provider abort", async () => {
  const user = await actor();
  const path = `${user.id}/multipart.png`;
  const upload = multipartApi("create", path, user.token);
  assert.ok(upload.uploadId);
  const tracked = { key: path, uploadId: upload.uploadId };
  multipartUploads.push(tracked);
  multipartApi("part", path, user.token, upload.uploadId);
  assert.equal(
    sql(`SELECT private.account_deletion_provider_residual_count(${uuid(user.id)})`),
    "2",
  );
  const job = await requested(user);
  const backend = createAccountDeletionBackend(admin);
  assert.equal((await runAccountDeletionWorkflow(backend, job)).status, "capability_drain_pending");
  elapseFixtureCapabilityDrain(job);
  await assert.rejects(runAccountDeletionWorkflow(backend, job));
  assert.equal(
    sql(
      `SELECT status || ':' || last_error_code FROM private.account_deletion_jobs WHERE id=${uuid(job)}`,
    ),
    "failed_retryable:PROVIDER_RESIDUAL",
  );
  assert.equal(
    sql(`SELECT private.account_deletion_provider_residual_count(${uuid(user.id)})`),
    "2",
  );
  multipartApi("abort", path, undefined, upload.uploadId);
  multipartUploads.splice(multipartUploads.indexOf(tracked), 1);
  assert.equal(
    sql(`SELECT private.account_deletion_provider_residual_count(${uuid(user.id)})`),
    "0",
  );
  sql(
    `UPDATE private.account_deletion_jobs SET next_retry_at=now()-interval '1 second' WHERE id=${uuid(job)}`,
  );
  assert.equal((await runAccountDeletionWorkflow(backend, job)).status, "completed");
});

test("operator GET RPC is read-only, redacted and unavailable to ordinary users", async () => {
  const user = await actor();
  const job = await requested(user);
  const before = sql(
    `SELECT row_to_json(job)::text FROM private.account_deletion_jobs job WHERE id=${uuid(job)}`,
  );
  assert.ok((await user.client.rpc("list_account_deletion_attention", {}, { get: true })).error);
  const rows = ok(await admin.rpc("list_account_deletion_attention", {}, { get: true }));
  const row = rows.find((entry) => entry.job_id === job);
  assert.ok(row);
  assert.deepEqual(Object.keys(row).sort(), [
    "age_seconds",
    "attempt_count",
    "job_id",
    "job_status",
    "last_error_code",
    "next_retry_at",
    "resume_step",
  ]);
  assert.equal(
    sql(
      `SELECT row_to_json(job)::text FROM private.account_deletion_jobs job WHERE id=${uuid(job)}`,
    ),
    before,
  );
  await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), job);
  assert.ok(
    !ok(await admin.rpc("list_account_deletion_attention", {}, { get: true })).some(
      (entry) => entry.job_id === job,
    ),
    "future successful drain is not overdue",
  );
});

test("real coordinator deletes an empty account and replay/status stay consistent", async () => {
  const user = await actor();
  const job = await requested(user);
  const backend = createAccountDeletionBackend(admin);
  assert.equal(
    (await runAccountDeletionWorkflow(backend, job, user.id)).status,
    "capability_drain_pending",
  );
  const attempts = sql(
    `SELECT attempt_count FROM private.account_deletion_jobs WHERE id=${uuid(job)}`,
  );
  for (let i = 0; i < 12; i++) {
    const freshBackend = createAccountDeletionBackend(admin);
    const result = await runAccountDeletionWorkflow(freshBackend, job);
    assert.equal(result.status, "capability_drain_pending");
  }
  assert.equal(
    sql(`SELECT attempt_count FROM private.account_deletion_jobs WHERE id=${uuid(job)}`),
    attempts,
  );
  elapseFixtureCapabilityDrain(job);
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
  assert.equal((await runAccountDeletionWorkflow(backend, job)).status, "capability_drain_pending");
  elapseFixtureCapabilityDrain(job);
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
  assert.equal((await runAccountDeletionWorkflow(backend, job)).status, "capability_drain_pending");
  elapseFixtureCapabilityDrain(job);
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

test("lost Auth response and lost drain response resume without extending the deadline", async () => {
  const user = await actor();
  const job = await requested(user);
  const backend = createAccountDeletionBackend(admin);
  const removeAuth = backend.deleteAuthUser;
  backend.deleteAuthUser = async (id) => {
    await removeAuth(id);
    throw new AccountDeletionStepError("AUTH_TEMPORARY");
  };
  await assert.rejects(runAccountDeletionWorkflow(backend, job));
  assert.ok((await admin.auth.admin.getUserById(user.id)).error);
  backend.deleteAuthUser = removeAuth;
  sql(
    `UPDATE private.account_deletion_jobs SET next_retry_at=now()-interval '1 second' WHERE id=${uuid(job)}`,
  );
  const advance = backend.advance;
  backend.advance = async (...args) => {
    await advance(...args);
    throw new AccountDeletionStepError("DATABASE_TEMPORARY");
  };
  await assert.rejects(runAccountDeletionWorkflow(backend, job));
  const deadline = sql(
    `SELECT capability_drain_until FROM private.account_deletion_jobs WHERE id=${uuid(job)}`,
  );
  assert.equal(
    sql(`SELECT status FROM private.account_deletion_jobs WHERE id=${uuid(job)}`),
    "capability_drain_pending",
  );
  const restarted = createAccountDeletionBackend(admin);
  assert.equal(
    (await runAccountDeletionWorkflow(restarted, job)).status,
    "capability_drain_pending",
  );
  assert.equal(
    sql(`SELECT capability_drain_until FROM private.account_deletion_jobs WHERE id=${uuid(job)}`),
    deadline,
  );
  elapseFixtureCapabilityDrain(job);
  assert.equal((await runAccountDeletionWorkflow(restarted, job)).status, "completed");
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
  const deletionJob = await requested(owner);
  assert.equal(
    (await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), deletionJob)).status,
    "capability_drain_pending",
  );
  elapseFixtureCapabilityDrain(deletionJob);
  assert.equal(
    (await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), deletionJob)).status,
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

test("pre-issued signed upload is fenced during drain and after tombstone purge", async () => {
  const user = await actor();
  const path = `${user.id}/signed.png`;
  const signed = ok(await user.client.storage.from("avatars").createSignedUploadUrl(path));
  assert.ok(signed);
  const job = await requested(user);
  const backend = createAccountDeletionBackend(admin);
  assert.ok(
    (
      await user.client.storage
        .from("avatars")
        .upload(`${user.id}/fresh.png`, png, { contentType: "image/png" })
    ).error,
    "RLS blocks fresh requests",
  );
  assert.equal((await runAccountDeletionWorkflow(backend, job)).status, "capability_drain_pending");
  assert.ok(
    (
      await user.client.storage
        .from("avatars")
        .uploadToSignedUrl(path, signed.token, png, { contentType: "image/png" })
    ).error,
  );
  assert.equal(listFixtureAvatars(user.id).length, 0);
  assert.equal((await runAccountDeletionWorkflow(backend, job)).status, "capability_drain_pending");
  // This advances only the LOCAL DB clock, not the actual signed URL expiry.
  // The still-valid local capability must also fail after tombstone purge:
  // the fence checks Auth absence independently of tombstone retention.
  elapseFixtureCapabilityDrain(job);
  assert.equal((await runAccountDeletionWorkflow(backend, job)).status, "completed");
  assert.equal(listFixtureAvatars(user.id).length, 0);
  sql(
    `UPDATE private.account_deletion_jobs SET retention_until=now()-interval '1 second' WHERE id=${uuid(job)}`,
  );
  ok(await admin.rpc("purge_expired_account_deletion_jobs"));
  assert.equal(
    sql(`SELECT count(*) FROM private.account_deletion_jobs WHERE id=${uuid(job)}`),
    "0",
  );
  assert.ok(
    (
      await user.client.storage
        .from("avatars")
        .uploadToSignedUrl(path, signed.token, png, { contentType: "image/png" })
    ).error,
  );
  assert.equal(listFixtureAvatars(user.id).length, 0);
});

test("real admitted stream is fenced at finalization and provider cleans rejected bytes", async () => {
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
    const job = await requested(user);
    assert.equal(
      (await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), job)).status,
      "capability_drain_pending",
    );
    uploader.stdin.write("finish\n");
    assert.equal(await closed, 0);
    assert.ok(Number(output.match(/STATUS:(\d+)/)?.[1]) >= 400, "late metadata is rejected");
    assert.equal(listFixtureAvatars(user.id).length, 0);
    elapseFixtureCapabilityDrain(job);
    assert.equal(
      (await runAccountDeletionWorkflow(createAccountDeletionBackend(admin), job)).status,
      "completed",
    );
    assert.equal(listFixtureAvatars(user.id).length, 0);
    const cleanupDeadline = Date.now() + 10000;
    while (files() && Date.now() < cleanupDeadline) await delay(50);
    assert.equal(files(), "", "local provider cleans rejected upload backend bytes");
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
