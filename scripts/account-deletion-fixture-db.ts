import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { requireLocalDeletionFixture } from "./account-deletion-local-guard.ts";

// Local Docker socket only. Never accept a database URL/password or remote host.
export function deletionFixtureSql(sql: string): string {
  requireLocalDeletionFixture(process.env.SUPABASE_URL);
  assert.ok(
    !process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith("unix:"),
    "Local Docker required",
  );
  return execFileSync(
    "docker",
    [
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
    { input: sql, encoding: "utf8", timeout: 20_000, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

export function fixtureUuid(value: string) {
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  return `'${value}'::uuid`;
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
