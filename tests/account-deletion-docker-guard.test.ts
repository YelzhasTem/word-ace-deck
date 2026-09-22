import assert from "node:assert/strict";
import childProcess, {
  type ExecFileSyncOptionsWithStringEncoding,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  deletionFixtureSql,
  openDeletionFixtureSession,
  resolveLocalDeletionDocker,
} from "../scripts/account-deletion-fixture-db.ts";

const realSpawn = childProcess.spawn;
const inspectArgs = ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"];
const safeError = /^Error: Account deletion fixtures require a verified local Docker Unix socket$/;
const envNames = [
  "SUPABASE_URL",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "DOCKER_CONFIG",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
];
type Invocation = { args: readonly string[]; env: NodeJS.ProcessEnv; input?: unknown };

// Mock only process boundaries: these tests never invoke Docker or a daemon.
async function withDockerMock(
  t: TestContext,
  env: NodeJS.ProcessEnv,
  inspect: (env: NodeJS.ProcessEnv, context: string | undefined) => string,
  run: (calls: {
    inspections: Invocation[];
    sql: Invocation[];
    sessions: Invocation[];
  }) => Promise<void>,
) {
  const saved = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const calls = {
    inspections: [] as Invocation[],
    sql: [] as Invocation[],
    sessions: [] as Invocation[],
  };
  for (const name of envNames) delete process.env[name];
  process.env.SUPABASE_URL = "http://127.0.0.1:54321";
  Object.assign(process.env, env);
  t.mock.method(
    childProcess,
    "execFileSync",
    (command: string, args: readonly string[], options: ExecFileSyncOptionsWithStringEncoding) => {
      assert.equal(command, "docker");
      assert.ok(options.env, "Every Docker invocation must have an environment snapshot");
      const invocation = { args: [...args], env: { ...options.env }, input: options.input };
      if (args[0] === "context" && args[1] === "inspect") {
        calls.inspections.push(invocation);
        return inspect(invocation.env, args[4] === "--" ? args[5] : undefined);
      }
      assert.equal(args[0], "--host");
      assert.equal(args[2], "exec");
      calls.sql.push(invocation);
      return "SQL_OK\n";
    },
  );
  t.mock.method(
    childProcess,
    "spawn",
    (command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) => {
      assert.equal(command, "docker");
      assert.ok(options.env);
      assert.equal(args[0], "--host");
      assert.equal(args[2], "exec");
      calls.sessions.push({ args: [...args], env: { ...options.env } });
      // A local Node child models psql's line protocol and exit lifecycle, not SQL execution.
      return realSpawn(
        process.execPath,
        [
          "-e",
          `
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        if (line.includes('pg_backend_pid()')) process.stdout.write('PID=4242\\n');
        if (line.startsWith('\\\\echo ')) process.stdout.write(line.slice(6)+'\\n');
      });
    `,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
    },
  );
  syncBuiltinESMExports();
  try {
    await run(calls);
    // Assert outside the resolver's catch: a mock assertion must not masquerade
    // as an expected fail-closed resolution error in a negative test.
    for (const invocation of calls.inspections) {
      const context = invocation.env.DOCKER_CONTEXT;
      assert.deepEqual(invocation.args, [...inspectArgs, ...(context ? ["--", context] : [])]);
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    for (const name of envNames) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

async function blocked(calls: { sql: Invocation[]; sessions: Invocation[] }) {
  assert.throws(() => deletionFixtureSql("SELECT 1"), safeError);
  await assert.rejects(openDeletionFixtureSession(), safeError);
  assert.deepEqual(calls.sql, [], "Rejection must precede docker exec / SQL");
  assert.deepEqual(calls.sessions, [], "Rejection must precede session spawn");
}

async function localSocket(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "memora-docker-"));
  const path = join(directory, "s.sock");
  const server = createServer((connection) => connection.destroy());
  t.after(async () => {
    try {
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  return { endpoint: `unix://${path}`, pinned: `unix://${realpathSync(path)}`, directory };
}

test("Docker guard rejects remote DOCKER_CONTEXT even when DOCKER_HOST is Unix", async (t) => {
  const socket = await localSocket(t);
  await withDockerMock(
    t,
    { DOCKER_CONTEXT: "remote", DOCKER_HOST: socket.endpoint },
    (env, context) => {
      // Model CLI 29.6.2: implicit inspect falls back to HOST despite CONTEXT.
      if (context === undefined) return JSON.stringify(env.DOCKER_HOST);
      if (context === "remote") return JSON.stringify("ssh://operator@remote.invalid");
      throw new Error("Unknown context");
    },
    async (calls) => {
      await blocked(calls);
      assert.equal(calls.inspections.length, 2);
    },
  );
});

test("Docker guard never falls back to HOST for a missing explicit context", async (t) => {
  const socket = await localSocket(t);
  for (const context of ["missing", "--format", " "]) {
    await withDockerMock(
      t,
      { DOCKER_CONTEXT: context, DOCKER_HOST: socket.endpoint },
      (env, selected) => {
        if (selected === undefined) return JSON.stringify(env.DOCKER_HOST);
        throw new Error("Context does not exist");
      },
      blocked,
    );
  }
});

test("Docker guard inspects explicit default and validates its resolved HOST", async (t) => {
  const socket = await localSocket(t);
  for (const host of [socket.endpoint, "tcp://remote.invalid:2376"]) {
    await withDockerMock(
      t,
      { DOCKER_CONTEXT: "default", DOCKER_HOST: host },
      (env, context) => {
        if (context === "default") return JSON.stringify(env.DOCKER_HOST);
        throw new Error("Expected explicit default");
      },
      async (calls) => {
        if (host === socket.endpoint) {
          assert.equal(resolveLocalDeletionDocker().endpoint, socket.pinned);
          assert.deepEqual(calls.sql, []);
          assert.deepEqual(calls.sessions, []);
        } else await blocked(calls);
      },
    );
  }
});

test("Docker guard rejects remote saved context without environment overrides", async (t) => {
  await withDockerMock(
    t,
    { DOCKER_CONFIG: "/offline/saved-context" },
    (env) => {
      assert.equal(env.DOCKER_CONTEXT, undefined);
      assert.equal(env.DOCKER_HOST, undefined);
      assert.equal(env.DOCKER_CONFIG, "/offline/saved-context");
      return JSON.stringify("tcp://remote.invalid:2376");
    },
    blocked,
  );
});

test("Docker guard accepts and pins a verified Unix socket, not inherited context/TLS", async (t) => {
  const socket = await localSocket(t);
  await withDockerMock(
    t,
    {
      DOCKER_CONTEXT: "local",
      DOCKER_HOST: "tcp://ignored.invalid:2376",
      DOCKER_TLS: "1",
      DOCKER_TLS_VERIFY: "1",
      DOCKER_CERT_PATH: "/offline/certs",
    },
    (env, context) => {
      if (context === "local") return JSON.stringify(socket.endpoint);
      return JSON.stringify(env.DOCKER_HOST);
    },
    async (calls) => {
      assert.equal(deletionFixtureSql("SELECT 1"), "SQL_OK");
      assert.equal(calls.sql.length, 1);
      const invocation = calls.sql[0];
      assert.deepEqual(invocation.args.slice(0, 3), ["--host", socket.pinned, "exec"]);
      assert.equal(invocation.env.DOCKER_HOST, socket.pinned);
      for (const name of ["DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"])
        assert.equal(invocation.env[name], undefined);
      assert.equal(process.env.DOCKER_CONTEXT, "local", "Parent environment must not change");
    },
  );
});

test("Docker guard uses implicit inspect when explicit context is unset or empty", async (t) => {
  const socket = await localSocket(t);
  for (const contextEnv of [{}, { DOCKER_CONTEXT: "" }]) {
    await withDockerMock(
      t,
      { ...contextEnv, DOCKER_HOST: socket.endpoint, DOCKER_CONFIG: "/offline/saved-remote" },
      (env, context) => {
        if (context === undefined) return JSON.stringify(env.DOCKER_HOST);
        throw new Error("Unexpected explicit context");
      },
      async (calls) => {
        assert.equal(resolveLocalDeletionDocker().endpoint, socket.pinned);
        assert.deepEqual(calls.inspections[0].args, inspectArgs);
        assert.deepEqual(calls.sql, []);
        assert.deepEqual(calls.sessions, []);
      },
    );
  }
});

test("Docker guard fails closed on resolution failure, malformed JSON or unknown endpoint", async (t) => {
  for (const response of [undefined, "not json", "null", "{}", "[]", '""']) {
    await withDockerMock(
      t,
      {},
      () => {
        if (response === undefined) throw new Error("Sensitive remote discovery error");
        return response;
      },
      blocked,
    );
  }
});

test("Docker guard rejects remote and malformed endpoint forms before exec", async (t) => {
  for (const endpoint of [
    "tcp://127.0.0.1:2375",
    "ssh://host.invalid",
    "npipe:////./pipe/docker_engine",
    "unix:relative",
    "unix://host.invalid/var/run/docker.sock",
    "unix:///tmp/s.sock?x=1",
    "unix:///tmp/s.sock#fragment",
    "unix:///tmp/%73.sock",
    "unix:///tmp/a/../s.sock",
    "unix:///tmp/s.sock\n",
    "unix:///tmp/s\u0000.sock",
    "unix:///tmp\\s.sock",
  ])
    await withDockerMock(t, {}, () => JSON.stringify(endpoint), blocked);
});

test("Docker guard requires an existing socket, not a regular file, directory or missing path", async (t) => {
  const socket = await localSocket(t);
  const file = join(socket.directory, "not-a-socket");
  writeFileSync(file, "fixture");
  for (const path of [file, socket.directory, join(socket.directory, "missing")])
    await withDockerMock(t, {}, () => JSON.stringify(`unix://${path}`), blocked);
});

test("Docker guard retains loopback check before any Docker resolution", async (t) => {
  await withDockerMock(
    t,
    { SUPABASE_URL: "https://project.supabase.co" },
    () => {
      assert.fail("Hosted Supabase must fail before Docker inspection");
    },
    async (calls) => {
      assert.throws(() => deletionFixtureSql("SELECT 1"), /refuse non-local/);
      await assert.rejects(openDeletionFixtureSession(), /refuse non-local/);
      assert.deepEqual(calls, { inspections: [], sql: [], sessions: [] });
    },
  );
});

test(
  "Docker session launch and cleanup keep the same pinned endpoint after context/env changes",
  { timeout: 10_000 },
  async (t) => {
    const socket = await localSocket(t);
    await withDockerMock(
      t,
      { DOCKER_CONTEXT: "local", DOCKER_CONFIG: "/offline/original" },
      () => JSON.stringify(socket.endpoint),
      async (calls) => {
        const session = await openDeletionFixtureSession();
        try {
          assert.equal(session.pid, 4242);
          process.env.DOCKER_CONTEXT = "remote-after-start";
          process.env.DOCKER_HOST = "tcp://remote.invalid:2376";
          process.env.DOCKER_CONFIG = "/offline/replaced";
        } finally {
          await session.close();
        }
        assert.equal(calls.inspections.length, 1, "Cleanup must not re-resolve a changed context");
        assert.equal(calls.sessions.length, 1);
        assert.equal(calls.sql.length, 1);
        const start = calls.sessions[0];
        const cleanup = calls.sql[0];
        assert.deepEqual(start.args.slice(0, 3), ["--host", socket.pinned, "exec"]);
        assert.deepEqual(cleanup.args.slice(0, 3), start.args.slice(0, 3));
        assert.deepEqual(cleanup.env, start.env);
        assert.equal(cleanup.env.DOCKER_HOST, socket.pinned);
        assert.equal(cleanup.env.DOCKER_CONTEXT, undefined);
        assert.equal(cleanup.env.DOCKER_CONFIG, "/offline/original");
        assert.match(String(cleanup.input), /pg_terminate_backend/);
        assert.ok(
          String(cleanup.input).includes(session.name),
          "Cleanup targets only its own session",
        );
      },
    );
  },
);
