import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { requireLocalDeletionFixture } from "./account-deletion-local-guard.ts";

function unsafeSocketPath(value: string) {
  return (
    /[\s\\%?#]/u.test(value) ||
    [...value].some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  );
}

export function resolveLocalDeletionDocker() {
  requireLocalDeletionFixture(process.env.SUPABASE_URL);
  const env = { ...process.env };
  try {
    // Fail closed on an explicit context: implicit inspect can prefer HOST even if
    // CONTEXT names a missing context. `--` keeps the name separate from CLI flags.
    // Without one, inspect resolves HOST/saved/default metadata without daemon I/O.
    const contextArgs = env.DOCKER_CONTEXT ? ["--", env.DOCKER_CONTEXT] : [];
    const endpoint: unknown = JSON.parse(
      execFileSync(
        "docker",
        ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}", ...contextArgs],
        {
          env,
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 16 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
    assert.equal(typeof endpoint, "string");
    assert.ok(typeof endpoint === "string" && !unsafeSocketPath(endpoint));
    const url = new URL(endpoint);
    assert.ok(
      url.protocol === "unix:" &&
        !url.hostname &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.search &&
        !url.hash &&
        isAbsolute(url.pathname) &&
        normalize(url.pathname) === url.pathname &&
        endpoint === `unix://${url.pathname}`,
    );
    const socket = realpathSync(url.pathname);
    assert.ok(!unsafeSocketPath(socket) && statSync(socket).isSocket());
    const pinnedEndpoint = `unix://${socket}`;
    // A subsequent context/env/config change must not redirect exec or session cleanup.
    delete env.DOCKER_CONTEXT;
    delete env.DOCKER_TLS;
    delete env.DOCKER_TLS_VERIFY;
    delete env.DOCKER_CERT_PATH;
    env.DOCKER_HOST = pinnedEndpoint;
    return Object.freeze({ endpoint: pinnedEndpoint, env: Object.freeze(env) });
  } catch {
    // Docker errors can include remote credentials/addresses; never reflect them.
    throw new Error("Account deletion fixtures require a verified local Docker Unix socket");
  }
}

function sqlOnPinnedDocker(
  sql: string,
  docker: ReturnType<typeof resolveLocalDeletionDocker>,
): string {
  return execFileSync(
    "docker",
    [
      "--host",
      docker.endpoint,
      "exec",
      "-i",
      "supabase_db_monfppjrvkyepjkfexqm",
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atq",
    ],
    {
      env: docker.env,
      input: sql,
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}

// Local Docker socket only. Never accept a database URL/password or remote host.
export function deletionFixtureSql(sql: string): string {
  return sqlOnPinnedDocker(sql, resolveLocalDeletionDocker());
}

export function fixtureUuid(value: string) {
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  return `'${value}'::uuid`;
}

// Independent local backends for lock-order tests; no caller-supplied connection target.
export async function openDeletionFixtureSession() {
  const docker = resolveLocalDeletionDocker();
  const name = `memora-fence-${randomUUID()}`;
  const child = spawn(
    "docker",
    [
      "--host",
      docker.endpoint,
      "exec",
      "-i",
      "-e",
      `PGAPPNAME=${name}`,
      "supabase_db_monfppjrvkyepjkfexqm",
      "psql",
      "-XAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=verbose",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { env: docker.env },
  );
  let output = "";
  let errors = "";
  let stopped = false;
  let check = () => {};
  let running = false;
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
    check();
  });
  child.stderr.on("data", (chunk) => {
    errors += String(chunk);
  });
  child.on("error", (error) => {
    errors += error.message;
    stopped = true;
    check();
  });
  child.stdin.on("error", (error) => {
    errors += error.message;
    check();
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on("close", (code) => {
      stopped = true;
      check();
      resolve(code);
    });
  });

  function query(statement: string): Promise<string> {
    assert.ok(!running && !stopped, "Fixture backend must be idle and connected");
    running = true;
    const offset = output.length;
    const marker = `DONE_${randomUUID().replaceAll("-", "")}`;
    const result = new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, value = "") => {
        clearTimeout(timer);
        running = false;
        check = () => {};
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => finish(new Error("Fixture SQL barrier timed out")), 15_000);
      check = () => {
        const end = output.indexOf(marker, offset);
        if (end !== -1) finish(undefined, output.slice(offset, end).trim());
        else if (stopped) finish(new Error(`Fixture SQL session ended: ${errors}`));
      };
      child.stdin.write(`${statement}\n\\echo ${marker}\n`);
    });
    // A blocked query can fail while its caller is observing locks in another backend.
    void result.catch(() => undefined);
    return result;
  }

  async function close() {
    try {
      // Termination also rolls back an open/failed transaction and releases xact locks.
      sqlOnPinnedDocker(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE application_name='${name}' AND backend_type='client backend'
          AND pid <> pg_backend_pid()`,
        docker,
      );
    } finally {
      child.stdin.destroy();
      if (!stopped) child.kill("SIGTERM");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              child.kill("SIGKILL");
              reject(new Error("Fixture child session did not exit"));
            }, 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  try {
    const ready = await query(`SET statement_timeout='12s'; SET lock_timeout='10s';
      SET idle_in_transaction_session_timeout='30s';
      SELECT 'PID=' || pg_backend_pid();`);
    const pid = Number(ready.match(/^PID=(\d+)$/m)?.[1]);
    assert.ok(Number.isSafeInteger(pid) && pid > 0, "Fixture backend PID missing");
    return { pid, name, query, close, exited };
  } catch (error) {
    await close();
    throw error;
  }
}

// Test-only DB-clock simulation, guarded by loopback URL and local Docker.
// No production RPC accepts a clock/deadline override.
export function elapseFixtureCapabilityDrain(jobId: string) {
  deletionFixtureSql(`UPDATE private.account_deletion_jobs
    SET capability_drain_started_at=now()-interval '25 hours 1 second',
        capability_drain_until=now()-interval '1 second'
    WHERE id=${fixtureUuid(jobId)} AND resume_step='capability_drain'
      AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id=user_id)`);
}

export function listFixtureAvatars(userId: string): string[] {
  const id = fixtureUuid(userId);
  const value: unknown = JSON.parse(
    deletionFixtureSql(`SELECT coalesce(json_agg(name), '[]') FROM (
    SELECT name FROM storage.objects WHERE bucket_id='avatars'
    AND (owner_id=${id}::text OR name LIKE ${id}::text || '/%') ORDER BY name LIMIT 100
  ) AS page`),
  );
  assert.ok(Array.isArray(value) && value.every((entry) => typeof entry === "string"));
  return value;
}
