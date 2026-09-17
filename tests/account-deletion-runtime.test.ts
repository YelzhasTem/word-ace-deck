import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseHostedSupabaseUrl,
  validateAccountDeletionRuntimeEnv,
  type AccountDeletionRuntimeEnv,
} from "../scripts/account-deletion-runtime.ts";

const PROJECT = "a".repeat(20);
const OTHER_PROJECT = "b".repeat(20);
const HOSTED_URL = `https://${PROJECT}.supabase.co`;
const NOW = 2_000_000_000;
const MODERN_KEY = `sb_secret_${"obviously_fake_test_key_".repeat(2)}`;
const SIGNATURE = Buffer.from("obviously-fake-signature".padEnd(32, "!")).toString("base64url");
const CLI = fileURLToPath(new URL("../scripts/check-account-deletion-runtime.ts", import.meta.url));

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(payload: unknown, header: unknown = { alg: "HS256", typ: "JWT" }) {
  return `${encode(header)}.${encode(payload)}.${SIGNATURE}`;
}

function env(key = jwt({ role: "service_role", ref: PROJECT, exp: NOW + 60 })) {
  return { SUPABASE_URL: HOSTED_URL, SUPABASE_SERVICE_ROLE_KEY: key };
}

function validate(input: AccountDeletionRuntimeEnv) {
  return validateAccountDeletionRuntimeEnv(input, PROJECT, NOW);
}

function rejectsKey(key: string) {
  const result = validate(env(key));
  assert.equal(result.ok, false);
  if (key.trim()) {
    assert.ok(!JSON.stringify(result).includes(key), "Validation must not echo key input");
  }
}

function runCli(args: string[], input: Record<string, string | undefined> = env()) {
  // Do not inherit credentials, NODE_OPTIONS, or env-file settings from the test runner.
  const child = spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    env: input,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  const output = child.stdout + child.stderr;
  for (const value of Object.values(input)) {
    if (value) assert.ok(!output.includes(value), "CLI must not echo environment input");
  }
  return { ...child, output };
}

test("hosted parser accepts only the canonical HTTPS base URL with optional root slash", () => {
  assert.equal(parseHostedSupabaseUrl(HOSTED_URL), PROJECT);
  assert.equal(parseHostedSupabaseUrl(`${HOSTED_URL}/`), PROJECT);
  for (const value of [
    undefined,
    "",
    "not-a-url-obviously-fake",
    `http://${PROJECT}.supabase.co`,
    `https://${PROJECT}.supabase.co.evil.test`,
    "https://custom.example.test",
    "http://localhost:54321",
    "https://127.0.0.1:54321",
    "http://[::1]:54321",
    "file:///tmp/fake",
    `https://obviously-fake:password@${PROJECT}.supabase.co`,
    `https://@${PROJECT}.supabase.co`,
    `${HOSTED_URL}:443`,
    `${HOSTED_URL}:54321`,
    `${HOSTED_URL}/rest/v1`,
    `${HOSTED_URL}/auth/v1`,
    `${HOSTED_URL}//`,
    `${HOSTED_URL}/./`,
    `${HOSTED_URL}/fake/../`,
    `${HOSTED_URL}/%2e`,
    `${HOSTED_URL}?`,
    `${HOSTED_URL}?fake=secret`,
    `${HOSTED_URL}#`,
    `${HOSTED_URL}#fake`,
    `${HOSTED_URL}/\\`,
    ` ${HOSTED_URL}`,
    `${HOSTED_URL}\n`,
    HOSTED_URL.toUpperCase(),
    `https://%61${PROJECT.slice(1)}.supabase.co`,
    `https://${PROJECT}.supabase.co.`,
  ]) {
    assert.equal(parseHostedSupabaseUrl(value), null);
  }
});

test("validation is deterministic, does not mutate env, and returns no credentials", () => {
  const input = Object.freeze(env());
  const expected = { ok: true, assurance: "shape-only", keyFormat: "legacy-jwt" };
  assert.deepEqual(validate(input), expected);
  assert.deepEqual(validate(input), expected);
  assert.deepEqual(input, env());
});

test("server URL precedence matches deletion admin, without hiding invalid server configuration", () => {
  const key = env().SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(
    validate({ VITE_SUPABASE_URL: HOSTED_URL, SUPABASE_SERVICE_ROLE_KEY: key }).ok,
    true,
  );
  assert.equal(validate({ ...env(), SUPABASE_URL: "", VITE_SUPABASE_URL: HOSTED_URL }).ok, true);
  assert.equal(validate({ ...env(), VITE_SUPABASE_URL: "invalid-unused-fallback" }).ok, true);
  for (const serverUrl of [" ", "invalid", `https://${OTHER_PROJECT}.supabase.co`]) {
    assert.equal(
      validate({ ...env(), SUPABASE_URL: serverUrl, VITE_SUPABASE_URL: HOSTED_URL }).ok,
      false,
    );
  }
  assert.equal(validate({ SUPABASE_SERVICE_ROLE_KEY: key }).ok, false);
});

test("expected project ref is explicit, exact, and hosted-only; time is supplied explicitly", () => {
  for (const expected of ["", "local", PROJECT.toUpperCase(), ` ${PROJECT}`, OTHER_PROJECT]) {
    assert.equal(validateAccountDeletionRuntimeEnv(env(), expected, NOW).ok, false);
  }
  for (const now of [NaN, Infinity, -1]) {
    assert.equal(validateAccountDeletionRuntimeEnv(env(), PROJECT, now).ok, false);
  }
  assert.equal(
    validateAccountDeletionRuntimeEnv(
      { ...env(), SUPABASE_URL: "http://localhost:54321" },
      "local",
      NOW,
    ).ok,
    false,
  );
});

test("only the server admin key is accepted; missing, blank, anon, and public keys fail", () => {
  assert.equal(validate({ SUPABASE_URL: HOSTED_URL }).ok, false);
  const publicOnly = {
    SUPABASE_URL: HOSTED_URL,
    SUPABASE_PUBLISHABLE_KEY: MODERN_KEY,
    VITE_SUPABASE_SERVICE_ROLE_KEY: MODERN_KEY,
    VITE_SUPABASE_PUBLISHABLE_KEY: MODERN_KEY,
  };
  assert.equal(validate(publicOnly).ok, false);
  for (const key of [
    " ",
    "obviously-fake-not-a-key",
    `sb_publishable_${"obviously_fake_".repeat(3)}`,
    jwt({ role: "anon", ref: PROJECT }),
    jwt({ role: "authenticated", ref: PROJECT }),
    jwt({ role: "SERVICE_ROLE", ref: PROJECT }),
    jwt({ ref: PROJECT }),
    jwt({ role: ["service_role"] }),
  ]) {
    rejectsKey(key);
  }
  assert.equal(validate(env("")).ok, false);
});

test("opaque modern secret keys are accepted explicitly as shape-only", () => {
  assert.deepEqual(validate(env(MODERN_KEY)), {
    ok: true,
    assurance: "shape-only",
    keyFormat: "sb_secret",
  });
  assert.equal(validate(env(`sb_secret_${"a".repeat(30)}_-`)).ok, true);
  for (const key of [
    "sb_secret_",
    "sb_secret_obviously_fake_short",
    `sb_secret_${"a".repeat(31)}`,
    `${MODERN_KEY}=`,
    `${MODERN_KEY}+`,
    `${MODERN_KEY}/`,
    `${MODERN_KEY}\n`,
    ` ${MODERN_KEY}`,
  ]) {
    rejectsKey(key);
  }
});

test("legacy JWT role is mandatory, while ref and expiry are optional but validated when present", () => {
  for (const payload of [
    { role: "service_role" },
    { role: "service_role", ref: PROJECT },
    { role: "service_role", exp: NOW + 0.5 },
    { role: "service_role", ref: PROJECT, exp: NOW + 1 },
  ]) {
    assert.equal(validate(env(jwt(payload))).ok, true);
  }
  for (const ref of [OTHER_PROJECT, null, 123, "", [PROJECT]]) {
    rejectsKey(jwt({ role: "service_role", ref }));
  }
  for (const exp of [NOW, NOW - 1, 0, -1, null, `${NOW + 60}`, false, [], {}]) {
    rejectsKey(jwt({ role: "service_role", exp }));
  }
  const nonFinitePayload = Buffer.from('{"role":"service_role","exp":1e400}').toString("base64url");
  rejectsKey(`${encode({ alg: "HS256" })}.${nonFinitePayload}.${SIGNATURE}`);
});

test("malformed legacy JWT encoding, JSON, headers, and signature shape fail without echoing input", () => {
  const validKey = env().SUPABASE_SERVICE_ROLE_KEY;
  const [header, payload] = validKey.split(".");
  const invalidUtf8 = Buffer.concat([
    Buffer.from('{"role":"service_role","fake":"'),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ]).toString("base64url");
  for (const key of [
    "obviously.fake.jwt",
    `${header}.${payload}`,
    `${validKey}.extra`,
    `.${payload}.${SIGNATURE}`,
    `${header}..${SIGNATURE}`,
    `${header}.${payload}.`,
    `${header}.${payload}.a`,
    `${header}.${payload}.b2J2aW91c2x5LWZha2U`,
    `${header}.${payload}.${SIGNATURE}=`,
    `${header}=.${payload}.${SIGNATURE}`,
    `${header}.***.${SIGNATURE}`,
    `${header}.${encode("not an object")}.${SIGNATURE}`,
    `${header}.${Buffer.from("{obviously-fake-invalid-json").toString("base64url")}.${SIGNATURE}`,
    `${header}.${invalidUtf8}.${SIGNATURE}`,
    `${validKey}\n`,
    ` ${validKey}`,
    jwt(null),
    jwt([]),
    jwt({ role: "service_role" }, null),
    jwt({ role: "service_role" }, []),
    jwt({ role: "service_role" }, {}),
    jwt({ role: "service_role" }, { alg: "none" }),
    jwt({ role: "service_role" }, { alg: "RS256" }),
    jwt({ role: "service_role" }, { alg: "HS256", typ: "not-jwt" }),
  ]) {
    rejectsKey(key);
  }
});

test("CLI accepts explicit separated/equal flags and states its offline limitations", () => {
  for (const key of [env().SUPABASE_SERVICE_ROLE_KEY, MODERN_KEY]) {
    for (const args of [
      ["--expected-project-ref", PROJECT],
      [`--expected-project-ref=${PROJECT}`],
    ]) {
      const result = runCli(args, env(key));
      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /passed .*shape-only/);
      assert.match(
        result.stdout,
        /signatures, key\/project binding, permissions, and liveness are NOT verified/,
      );
      assert.match(result.stdout, /No network requests or mutations/);
    }
  }
  const fallback = runCli(["--expected-project-ref", PROJECT], {
    VITE_SUPABASE_URL: HOSTED_URL,
    SUPABASE_SERVICE_ROLE_KEY: MODERN_KEY,
  });
  assert.equal(fallback.status, 0);
});

test("CLI rejects omitted, duplicate, and unknown arguments without echoing arguments", () => {
  const secretArgument = "obviously-fake-sensitive-argument";
  for (const args of [
    [],
    ["--expected-project-ref"],
    ["--expected-project-ref="],
    [secretArgument],
    ["--expected-project-ref", PROJECT, secretArgument],
    ["--expected-project-ref", PROJECT, "--expected-project-ref", PROJECT],
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Usage:/);
    assert.ok(!result.output.includes(secretArgument));
  }
  const invalidRef = runCli(["--expected-project-ref", secretArgument]);
  assert.equal(invalidRef.status, 1);
  assert.ok(!invalidRef.output.includes(secretArgument));
});

test("CLI failures are nonzero and never reveal keys, decoded payloads, URLs, or parser exceptions", () => {
  const marker = "obviously-fake-sensitive-marker";
  for (const input of [
    {},
    { SUPABASE_URL: HOSTED_URL },
    env(marker),
    env(jwt({ role: "anon", fake: marker })),
    env(jwt({ role: "service_role", ref: OTHER_PROJECT, fake: marker })),
    env(jwt({ role: "service_role", exp: 1, fake: marker })),
    env(jwt({ role: "service_role", exp: "invalid", fake: marker })),
    { ...env(), SUPABASE_URL: `https://${OTHER_PROJECT}.supabase.co` },
    { ...env(), SUPABASE_URL: `https://${marker}:fake-password@${PROJECT}.supabase.co` },
    { ...env(), SUPABASE_URL: `https://[${marker}` },
  ]) {
    const result = runCli(["--expected-project-ref", PROJECT], input);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /preflight failed:/);
    assert.ok(!result.output.includes(marker));
    assert.doesNotMatch(result.output, /SyntaxError|TypeError|ERR_INVALID_URL|\n\s+at /);
  }
  const local = runCli(["--expected-project-ref", "local"], {
    ...env(),
    SUPABASE_URL: "http://localhost:54321",
  });
  assert.equal(local.status, 1);
});
