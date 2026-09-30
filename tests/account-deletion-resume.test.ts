import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = new URL("../scripts/resume-account-deletion-job.ts", import.meta.url);
const PROJECT_REF = "abcdefghijklmnopqrst";
const OTHER_PROJECT_REF = "tsrqponmlkjihgfedcbaq";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const ENV = {
  SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"x".repeat(32)}`,
};
const ARGS = ["--expected-project-ref", PROJECT_REF, "--job-id", JOB_ID];
const USAGE =
  "Usage: npm run account-deletion:resume -- --expected-project-ref <ref> --job-id <uuid>\n";
const ENV_ERROR = "Account deletion runtime validation failed. No request was sent.\n";
const RESUME_ERROR = "Account deletion resume did not complete. Review the safe job status.\n";
const PRIVATE_DATA = "22222222-2222-4222-8222-222222222222/private/avatar.png raw-provider-error";
const COMPLETED = {
  job_id: JOB_ID,
  user_id: null,
  job_status: "completed",
  resume_step: "done",
  lease_token: null,
  attempt_count: 1,
  claimed: false,
  retry_after_seconds: 0,
};

type SyntheticEnv = Partial<Record<keyof typeof ENV | "VITE_SUPABASE_URL", string>>;
type Mode = "completed" | "provider-error" | "network-error" | "malformed" | "timeout" | "drain";

// Every child has a synthetic environment and a fetch replacement installed before CLI import.
// The extra pipe carries only counters/booleans, never credentials or provider payloads.
function runCli(
  args = ARGS,
  env: SyntheticEnv = ENV,
  mode: Mode = "completed",
  invocation: "direct" | "import" | "injected" = "direct",
) {
  const expectedEnv = invocation === "injected" ? ENV : env;
  const preload = `
    import { writeSync } from "node:fs";
    const metrics = { calls: 0, requestMatches: true, timeouts: [] };
    const expected = ${JSON.stringify(expectedEnv)};
    const mode = ${JSON.stringify(mode)};
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (ms) => {
      metrics.timeouts.push(ms);
      return mode === "timeout" ? AbortSignal.abort() : timeout(ms);
    };
    globalThis.fetch = async (input, init) => {
      metrics.calls++;
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      metrics.requestMatches &&=
        url.origin === new URL(expected.SUPABASE_URL || expected.VITE_SUPABASE_URL).origin &&
        url.pathname === "/rest/v1/rpc/claim_account_deletion_job" &&
        url.search === "" && init?.method === "POST" &&
        init?.body === JSON.stringify({ p_job_id: ${JSON.stringify(JOB_ID)} }) &&
        headers.get("apikey") === expected.SUPABASE_SERVICE_ROLE_KEY &&
        headers.get("authorization") === "Bearer " + expected.SUPABASE_SERVICE_ROLE_KEY &&
        init?.signal instanceof AbortSignal;
      init?.signal?.throwIfAborted();
      const privateData = ${JSON.stringify(PRIVATE_DATA)} + expected.SUPABASE_SERVICE_ROLE_KEY;
      if (mode === "network-error") throw new Error(privateData);
      if (mode === "provider-error") {
        return Response.json({ message: privateData, details: privateData }, { status: 500 });
      }
      const row = ${JSON.stringify(COMPLETED)};
      if (mode === "malformed") row.job_status = privateData;
      if (mode === "drain") {
        row.job_status = "capability_drain_pending";
        row.resume_step = "capability_drain";
        row.retry_after_seconds = 3600;
      }
      return Response.json([row]);
    };
    process.on("exit", () => writeSync(3, JSON.stringify(metrics)));
  `;
  const importCode = `
    process.argv = [process.execPath, "/synthetic-operator-runner.mjs", ...${JSON.stringify(args)}];
    const cli = await import(${JSON.stringify(SCRIPT.href)});
    ${invocation === "injected" ? `process.exitCode = await cli.runResumeAccountDeletionJob(${JSON.stringify(args)}, { env: ${JSON.stringify(ENV)} });` : ""}
  `;
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      `data:text/javascript,${encodeURIComponent(preload)}`,
      ...(invocation === "direct"
        ? [fileURLToPath(SCRIPT), ...args]
        : ["--input-type=module", "-e", importCode]),
    ],
    {
      env: { NODE_NO_WARNINGS: "1", ...env },
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  const metrics: { calls: number; requestMatches: boolean; timeouts: number[] } = JSON.parse(
    String(child.output[3]),
  );
  return { code: child.status, stdout: child.stdout, stderr: child.stderr, ...metrics };
}

const invalidArguments: [string, string[]][] = [
  ["no flags", []],
  ["missing expected project", ["--job-id", JOB_ID]],
  ["missing job", ARGS.slice(0, 2)],
  ["missing job value", ARGS.slice(0, 3)],
  ["missing project value", ["--expected-project-ref", "--job-id", JOB_ID]],
  ["empty project", ["--expected-project-ref", "", "--job-id", JOB_ID]],
  ["empty job", [...ARGS.slice(0, 3), ""]],
  ["invalid ref", ["--expected-project-ref", "bad-ref", "--job-id", JOB_ID]],
  ["invalid UUID", [...ARGS.slice(0, 3), PRIVATE_DATA]],
  ["duplicate project", [...ARGS, "--expected-project-ref", OTHER_PROJECT_REF]],
  ["duplicate job", [...ARGS, "--job-id", JOB_ID]],
  ["duplicate instead of required flag", ["--job-id", JOB_ID, "--job-id", JOB_ID]],
  ["--dry-run", [...ARGS, "--dry-run"]],
  ["unknown flag", [...ARGS, "--unknown", "value"]],
  ["extra value", [...ARGS, PRIVATE_DATA]],
  ["inline flag value", [`--expected-project-ref=${PROJECT_REF}`, "--job-id", JOB_ID]],
];
for (const [name, args] of invalidArguments) {
  test(`resume CLI rejects ${name} before requests`, () => {
    assert.deepEqual(runCli(args), {
      code: 2,
      stdout: "",
      stderr: USAGE,
      calls: 0,
      requestMatches: true,
      timeouts: [],
    });
  });
}

function legacyKey(payload: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    Buffer.alloc(32).toString("base64url"),
  ].join(".");
}

const invalidEnvironments: [string, SyntheticEnv][] = [
  ["empty env", {}],
  ["missing URL", { SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY }],
  ["mismatched project", { ...ENV, SUPABASE_URL: `https://${OTHER_PROJECT_REF}.supabase.co` }],
  [
    "mismatched server URL despite valid fallback",
    {
      ...ENV,
      SUPABASE_URL: `https://${OTHER_PROJECT_REF}.supabase.co`,
      VITE_SUPABASE_URL: ENV.SUPABASE_URL,
    },
  ],
  ["noncanonical URL", { ...ENV, SUPABASE_URL: `${ENV.SUPABASE_URL}/rest/v1` }],
  [
    "credential-bearing URL",
    { ...ENV, SUPABASE_URL: `https://secret:secret@${PROJECT_REF}.supabase.co` },
  ],
  ["HTTP URL", { ...ENV, SUPABASE_URL: `http://${PROJECT_REF}.supabase.co` }],
  ["missing key", { SUPABASE_URL: ENV.SUPABASE_URL }],
  ["malformed key", { ...ENV, SUPABASE_SERVICE_ROLE_KEY: PRIVATE_DATA }],
  [
    "anon JWT",
    { ...ENV, SUPABASE_SERVICE_ROLE_KEY: legacyKey({ role: "anon", ref: PROJECT_REF }) },
  ],
  [
    "wrong-project JWT",
    {
      ...ENV,
      SUPABASE_SERVICE_ROLE_KEY: legacyKey({ role: "service_role", ref: OTHER_PROJECT_REF }),
    },
  ],
  [
    "expired JWT",
    {
      ...ENV,
      SUPABASE_SERVICE_ROLE_KEY: legacyKey({ role: "service_role", ref: PROJECT_REF, exp: 1 }),
    },
  ],
];
for (const [name, env] of invalidEnvironments) {
  test(`resume CLI rejects ${name} before requests`, () => {
    assert.deepEqual(runCli(ARGS, env), {
      code: 2,
      stdout: "",
      stderr: ENV_ERROR,
      calls: 0,
      requestMatches: true,
      timeouts: [],
    });
  });
}

test("resume CLI accepts both argument orders through the real backend and coordinator", () => {
  for (const args of [ARGS, ["--job-id", JOB_ID, "--expected-project-ref", PROJECT_REF]]) {
    assert.deepEqual(runCli(args), {
      code: 0,
      stdout: "Account deletion status: completed\n",
      stderr: "",
      calls: 1,
      requestMatches: true,
      timeouts: [15_000],
    });
  }
});

test("resume uses the validated fallback URL and synthetic legacy key", () => {
  const result = runCli(ARGS, {
    SUPABASE_URL: "",
    VITE_SUPABASE_URL: ENV.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: legacyKey({ role: "service_role", ref: PROJECT_REF }),
  });
  assert.equal(result.code, 0);
  assert.equal(result.calls, 1);
  assert.equal(result.requestMatches, true);
  assert.equal(result.stderr, "");
});

test("resume import is inert even with valid CLI arguments and runtime env", () => {
  assert.deepEqual(runCli(ARGS, ENV, "completed", "import"), {
    code: 0,
    stdout: "",
    stderr: "",
    calls: 0,
    requestMatches: true,
    timeouts: [],
  });
});

test("resume backend uses injected validated credentials, not a different process.env", () => {
  const result = runCli(
    ARGS,
    {
      SUPABASE_URL: `https://${OTHER_PROJECT_REF}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"y".repeat(32)}`,
    },
    "completed",
    "injected",
  );
  assert.equal(result.code, 0);
  assert.equal(result.calls, 1);
  assert.equal(result.requestMatches, true);
  assert.equal(result.stdout, "Account deletion status: completed\n");
  assert.equal(result.stderr, "");
});

for (const mode of ["provider-error", "network-error", "malformed", "timeout"] as const) {
  test(`resume suppresses ${mode} details and exits without retrying`, () => {
    assert.deepEqual(runCli(ARGS, ENV, mode), {
      code: 1,
      stdout: "",
      stderr: RESUME_ERROR,
      calls: 1,
      requestMatches: true,
      timeouts: [15_000],
    });
  });
}

test("resume preserves the coordinator drain handoff without polling", () => {
  assert.deepEqual(runCli(ARGS, ENV, "drain"), {
    code: 0,
    stdout: "Account deletion status: capability_drain_pending\n",
    stderr: "",
    calls: 1,
    requestMatches: true,
    timeouts: [15_000],
  });
});
