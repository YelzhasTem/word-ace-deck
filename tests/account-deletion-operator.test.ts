import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  renderAccountDeletionAttention,
  runListAccountDeletionJobs,
} from "../scripts/list-account-deletion-jobs.ts";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PRIVATE_DATA = `${USER_ID}/private/avatar.png private-provider-error`;
const ROW = {
  job_id: JOB_ID,
  job_status: "failed_retryable",
  resume_step: "storage_cleanup",
  attempt_count: 2,
  next_retry_at: "2026-09-17T10:20:30.123456+00:00",
  age_seconds: 123.5,
  last_error_code: "STORAGE_TEMPORARY",
};

test("attention rendering allowlists exactly seven fields and never prints user identifiers", () => {
  const dirty = {
    ...ROW,
    user_id: USER_ID,
    user_ref_hash: "private-hash",
    lease_token: USER_ID,
    storage_path: PRIVATE_DATA,
    last_error: PRIVATE_DATA,
    details: { message: PRIVATE_DATA },
    toJSON: () => ({ leaked: PRIVATE_DATA }),
  };
  const output = renderAccountDeletionAttention([dirty]);
  assert.deepEqual(JSON.parse(output), [ROW]);
  assert.equal(Object.keys(JSON.parse(output)[0]).length, 7);
  assert.ok(output.endsWith("\n"));
  assert.ok(!output.includes(USER_ID));
  assert.ok(!output.includes(PRIVATE_DATA));
  assert.equal(dirty.user_id, USER_ID);
  assert.equal(renderAccountDeletionAttention([]), "[]\n");
});

test("attention rendering accepts all known statuses, steps, and stored error codes", () => {
  const allowed = {
    job_status: [
      "requested",
      "storage_cleanup_pending",
      "auth_deletion_pending",
      "capability_drain_pending",
      "database_verification_pending",
      "completed",
      "failed_retryable",
      "failed_terminal",
    ],
    resume_step: [
      "storage_cleanup",
      "auth_deletion",
      "capability_drain",
      "database_verification",
      "done",
    ],
    last_error_code: [
      null,
      "STORAGE_TEMPORARY",
      "AUTH_TEMPORARY",
      "DATABASE_TEMPORARY",
      "PROVIDER_RESIDUAL",
      "WORKFLOW_TIMEOUT",
      "ATTEMPT_LIMIT_REACHED",
    ],
    next_retry_at: [
      null,
      "2026-09-17T10:20:30Z",
      "2026-09-17T10:20:30.123456+00:00",
      "2026-09-17T10:20:30+05:00",
    ],
  };
  for (const [field, values] of Object.entries(allowed)) {
    for (const value of values) {
      const row = { ...ROW, [field]: value };
      assert.deepEqual(JSON.parse(renderAccountDeletionAttention([row])), [row]);
    }
  }
});

test("attention rendering rejects unsafe values without exposing validation details", () => {
  const rejected = {
    job_id: [PRIVATE_DATA, 123, null, undefined, "not-a-uuid"],
    job_status: [PRIVATE_DATA, "unknown", null, undefined],
    resume_step: [PRIVATE_DATA, "unknown", null, undefined],
    attempt_count: [PRIVATE_DATA, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1],
    next_retry_at: [
      PRIVATE_DATA,
      "infinity",
      "2026-02-30T00:00:00Z",
      "2026-09-17",
      "2026-09-17T10:20:30",
      "2026-09-17T10:20:30+99:99",
      "2026-09-17T10:20:30Z\nprivate-data",
    ],
    age_seconds: [PRIVATE_DATA, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1],
    last_error_code: [PRIVATE_DATA, "ACCOUNT_DELETION_FAILED", "unknown", undefined],
  };
  for (const [field, values] of Object.entries(rejected)) {
    for (const value of values) {
      assert.throws(() => renderAccountDeletionAttention([{ ...ROW, [field]: value }]), {
        name: "Error",
        message: "Invalid account deletion attention response.",
      });
    }
  }
});

test("attention rendering requires every field and rejects malformed or oversized pages", () => {
  for (const field of Object.keys(ROW)) {
    const row: Record<string, unknown> = { ...ROW, user_id: USER_ID };
    delete row[field];
    assert.throws(() => renderAccountDeletionAttention([row]));
  }
  for (const value of [null, undefined, {}, ROW, [null], [ROW, { ...ROW, job_id: PRIVATE_DATA }]]) {
    assert.throws(() => renderAccountDeletionAttention(value));
  }
  assert.equal(JSON.parse(renderAccountDeletionAttention(Array(100).fill(ROW))).length, 100);
  assert.throws(() => renderAccountDeletionAttention(Array(101).fill(ROW)));
});

const PROJECT_REF = "abcdefghijklmnopqrst";
const OTHER_PROJECT_REF = "tsrqponmlkjihgfedcbaq";
const ENV = {
  SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"x".repeat(32)}`,
};
const ARGS = ["--expected-project-ref", PROJECT_REF];
const QUERY_ERROR =
  "Could not list account deletion attention jobs. No job changes were requested.\n";
const SCRIPT_URL = new URL("../scripts/list-account-deletion-jobs.ts", import.meta.url);

type RunOptions = NonNullable<Parameters<typeof runListAccountDeletionJobs>[1]>;

async function captureRun(args = ARGS, options: RunOptions = {}) {
  let stdout = "";
  let stderr = "";
  let calls = 0;
  const transport: typeof fetch = async (...request) => {
    calls += 1;
    if (!options.fetch) throw new Error("Unexpected test request");
    return options.fetch(...request);
  };
  const code = await runListAccountDeletionJobs(args, {
    env: ENV,
    ...options,
    fetch: transport,
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return { code, stdout, stderr, calls };
}

function legacyKey(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.${Buffer.alloc(32).toString("base64url")}`;
}

test("operator rejects missing, repeated, unknown, and invalid arguments before any request", async () => {
  for (const args of [
    [],
    ["--expected-project-ref"],
    ["--expected-project-ref", ""],
    ["--after-job-id", JOB_ID],
    [...ARGS, "--expected-project-ref", PROJECT_REF],
    [...ARGS, "--after-job-id"],
    [...ARGS, "--after-job-id", PRIVATE_DATA],
    [...ARGS, "--after-job-id", JOB_ID, "--after-job-id", JOB_ID],
    [...ARGS, "--limit", "101"],
    [...ARGS, "--resume"],
    [...ARGS, "--job-id", USER_ID],
    [...ARGS, "--unknown", PRIVATE_DATA],
    [...ARGS, PRIVATE_DATA],
  ]) {
    const result = await captureRun(args);
    assert.equal(result.code, 2);
    assert.equal(result.calls, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Usage: --expected-project-ref <ref> [--after-job-id <uuid>]\n");
  }
});

test("operator validates project, canonical URL, and service-key shape offline", async () => {
  const invalidEnvs: RunOptions["env"][] = [
    {},
    { ...ENV, SUPABASE_URL: undefined },
    { ...ENV, SUPABASE_URL: `https://${OTHER_PROJECT_REF}.supabase.co` },
    {
      ...ENV,
      SUPABASE_URL: `https://${OTHER_PROJECT_REF}.supabase.co`,
      VITE_SUPABASE_URL: ENV.SUPABASE_URL,
    },
    { ...ENV, SUPABASE_URL: `http://${PROJECT_REF}.supabase.co` },
    { ...ENV, SUPABASE_URL: `${ENV.SUPABASE_URL}/rest/v1` },
    { ...ENV, SUPABASE_URL: `${ENV.SUPABASE_URL}/?private=secret` },
    { ...ENV, SUPABASE_URL: `https://private:secret@${PROJECT_REF}.supabase.co` },
    { ...ENV, SUPABASE_URL: "http://localhost:54321" },
    { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined },
    { ...ENV, SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_not-a-service-key" },
    { ...ENV, SUPABASE_SERVICE_ROLE_KEY: PRIVATE_DATA },
    { ...ENV, SUPABASE_SERVICE_ROLE_KEY: legacyKey({ role: "anon", ref: PROJECT_REF }) },
    {
      ...ENV,
      SUPABASE_SERVICE_ROLE_KEY: legacyKey({ role: "service_role", ref: OTHER_PROJECT_REF }),
    },
    {
      ...ENV,
      SUPABASE_SERVICE_ROLE_KEY: legacyKey({ role: "service_role", ref: PROJECT_REF, exp: 1 }),
    },
  ];
  for (const env of invalidEnvs) {
    const result = await captureRun(ARGS, { env });
    assert.deepEqual(result, {
      code: 2,
      calls: 0,
      stdout: "",
      stderr: "Account deletion runtime validation failed. No request was sent.\n",
    });
  }
  for (const ref of [OTHER_PROJECT_REF, " ", USER_ID, PRIVATE_DATA]) {
    const result = await captureRun(["--expected-project-ref", ref]);
    assert.equal(result.code, 2);
    assert.equal(result.calls, 0);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Account deletion runtime validation failed. No request was sent.\n",
    );
  }
});

test("operator makes only one public read-only RPC using the server service key", async () => {
  const result = await captureRun(ARGS, {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, ENV.SUPABASE_URL);
      assert.equal(url.pathname, "/rest/v1/rpc/list_account_deletion_attention");
      assert.deepEqual(Object.fromEntries(url.searchParams), { p_limit: "100" });
      assert.equal(init?.method, "GET");
      assert.equal(init?.body, undefined);
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init.signal.aborted, false);
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      assert.equal(headers.get("apikey"), ENV.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(headers.get("accept-profile"), "public");
      return Response.json([{ ...ROW, user_id: USER_ID, storage_path: PRIVATE_DATA }]);
    },
  });
  assert.deepEqual(result, {
    code: 0,
    calls: 1,
    stdout: `${JSON.stringify([ROW])}\n`,
    stderr: "",
  });
});

test("operator passes the explicit UUID cursor and does not auto-page a full result", async () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    ...ROW,
    job_id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
  }));
  const result = await captureRun(["--after-job-id", JOB_ID, ...ARGS], {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/rest/v1/rpc/list_account_deletion_attention");
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        p_limit: "100",
        p_after_job_id: JOB_ID,
      });
      assert.equal(init?.method, "GET");
      return Response.json(rows);
    },
  });
  assert.equal(result.code, 0);
  assert.equal(result.calls, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), rows);
});

test("operator supports the validated browser-URL fallback and legacy service key", async () => {
  const env = {
    VITE_SUPABASE_URL: ENV.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: legacyKey({ role: "service_role", ref: PROJECT_REF }),
  };
  const result = await captureRun(ARGS, {
    env,
    fetch: async (input, init) => {
      assert.equal(new URL(String(input)).origin, ENV.SUPABASE_URL);
      assert.equal(new Headers(init?.headers).get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
      return Response.json([]);
    },
  });
  assert.deepEqual(result, { code: 0, calls: 1, stdout: "[]\n", stderr: "" });
});

test("operator preserves failed jobs in future backoff without client-side filtering or resumption", async () => {
  const rows = [
    { ...ROW, next_retry_at: "2099-01-01T00:00:00Z" },
    { ...ROW, job_status: "failed_terminal", next_retry_at: null },
  ];
  const result = await captureRun(ARGS, { fetch: async () => Response.json(rows) });
  assert.equal(result.code, 0);
  assert.equal(result.calls, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), rows);
});

test("operator suppresses raw errors and never retries or resumes after query failures", async () => {
  const errorBody = { code: "private-code", message: PRIVATE_DATA, details: PRIVATE_DATA };
  const fetchers: (typeof fetch)[] = [
    async () => Response.json(errorBody, { status: 401 }),
    async () => Response.json(errorBody, { status: 500 }),
    async () => Response.json(errorBody, { status: 520 }),
    async () => new Response(PRIVATE_DATA, { status: 502 }),
    async () => new Response(PRIVATE_DATA, { status: 200 }),
    async () => {
      throw new Error(PRIVATE_DATA);
    },
  ];
  for (const fetcher of fetchers) {
    const result = await captureRun(ARGS, { fetch: fetcher });
    assert.deepEqual(result, { code: 1, calls: 1, stdout: "", stderr: QUERY_ERROR });
  }
});

test("operator rejects unsafe or oversized success payloads without partial output", async () => {
  for (const data of [
    null,
    { user_id: USER_ID },
    [ROW, { ...ROW, last_error_code: PRIVATE_DATA }],
    [{ ...ROW, job_status: PRIVATE_DATA }],
    Array(101).fill(ROW),
  ]) {
    const result = await captureRun(ARGS, { fetch: async () => Response.json(data) });
    assert.deepEqual(result, { code: 1, calls: 1, stdout: "", stderr: QUERY_ERROR });
  }
});

test("operator uses a 15-second abort deadline and suppresses timeout details", async (context) => {
  let timeoutCalls = 0;
  context.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    timeoutCalls += 1;
    assert.equal(milliseconds, 15_000);
    return AbortSignal.abort(new Error(PRIVATE_DATA));
  });
  const result = await captureRun(ARGS, {
    fetch: async (_input, init) => {
      assert.ok(init?.signal);
      init.signal.throwIfAborted();
      throw new Error("Expected the deadline signal to be aborted");
    },
  });
  assert.equal(timeoutCalls, 1);
  assert.deepEqual(result, { code: 1, calls: 1, stdout: "", stderr: QUERY_ERROR });
});

test("operator client disables session persistence, token refresh, and browser session detection", () => {
  const source = readFileSync(SCRIPT_URL, "utf8");
  assert.match(source, /persistSession:\s*false/);
  assert.match(source, /autoRefreshToken:\s*false/);
  assert.match(source, /detectSessionInUrl:\s*false/);
  assert.doesNotMatch(
    source,
    /account-deletion\.server|executeAccountDeletion|runAccountDeletionWorkflow/,
  );
});

test("operator module import does not execute the CLI or issue network requests", () => {
  const imported = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `globalThis.fetch = () => { throw new Error("Unexpected network request"); };
       await import(${JSON.stringify(SCRIPT_URL.href)});`,
    ],
    { env: { NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 5_000 },
  );
  assert.equal(imported.status, 0);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");
});

test("operator direct main guard requires explicit project acknowledgement", () => {
  const invoked = spawnSync(
    process.execPath,
    ["--experimental-strip-types", fileURLToPath(SCRIPT_URL)],
    { env: { NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 5_000 },
  );
  assert.equal(invoked.status, 2);
  assert.equal(invoked.stdout, "");
  assert.equal(invoked.stderr, "Usage: --expected-project-ref <ref> [--after-job-id <uuid>]\n");
});
