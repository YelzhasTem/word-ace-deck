import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Response } from "undici";
import {
  fetchSafeUrlText,
  isPublicIpAddress,
  parseSafeRemoteUrl,
  resolveSafeUrl,
  SafeUrlFetchError,
  type SafeUrlRequest,
} from "../src/lib/safe-url-fetch.server.ts";
import {
  ImageValidationError,
  MAX_IMPORT_IMAGE_BYTES,
  validateImportImage,
} from "../src/lib/image-validation.ts";
import {
  AuthTokenError,
  verifySupabaseAuthorization,
} from "../src/integrations/supabase/auth-token.ts";

async function expectSafeUrlError(
  operation: () => Promise<unknown> | unknown,
  code: string,
  statusCode: number,
) {
  await assert.rejects(
    async () => operation(),
    (error: unknown) => {
      assert.ok(error instanceof SafeUrlFetchError);
      assert.equal(error.code, code);
      assert.equal(error.statusCode, statusCode);
      return true;
    },
  );
}

test("authorization requires verified non-anon Supabase claims", async () => {
  const shouldNotVerify = async () => {
    assert.fail("invalid authorization reached token verification");
  };
  await assert.rejects(
    () => verifySupabaseAuthorization(null, shouldNotVerify),
    (error: unknown) => error instanceof AuthTokenError && error.code === "AUTH_REQUIRED",
  );
  await assert.rejects(
    () => verifySupabaseAuthorization("Bearer broken token", shouldNotVerify),
    (error: unknown) => error instanceof AuthTokenError && error.code === "AUTH_INVALID",
  );

  for (const result of [
    { data: null, error: new Error("invalid signature") },
    { data: null, error: new Error("token expired") },
    { data: { claims: { role: "anon" } }, error: null },
    { data: { claims: { sub: "user-a", role: "anon" } }, error: null },
  ]) {
    await assert.rejects(
      () => verifySupabaseAuthorization("Bearer token", async () => result),
      (error: unknown) => error instanceof AuthTokenError && error.code === "AUTH_INVALID",
    );
  }

  const verified = await verifySupabaseAuthorization("Bearer token", async () => ({
    data: { claims: { sub: "user-a", role: "authenticated" } },
    error: null,
  }));
  assert.equal(verified.userId, "user-a");
  assert.equal(verified.token, "token");
});

test("only globally routable IP addresses are accepted", () => {
  for (const address of [
    "0.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("URL parser rejects unsafe schemes, credentials, local names, and controls", async () => {
  for (const [url, code] of [
    ["file:///etc/passwd", "URL_SCHEME_BLOCKED"],
    ["ftp://example.com/file", "URL_SCHEME_BLOCKED"],
    ["data:text/plain,hello", "URL_SCHEME_BLOCKED"],
    ["javascript:alert(1)", "URL_SCHEME_BLOCKED"],
    ["https://user:password@example.com", "URL_CREDENTIALS_BLOCKED"],
    ["http://localhost/test", "URL_HOST_BLOCKED"],
    ["http://service.internal/test", "URL_HOST_BLOCKED"],
    ["http://metadata.google.internal/test", "URL_HOST_BLOCKED"],
    ["https://example.com/%0aheader", "URL_INVALID"],
  ]) {
    await expectSafeUrlError(() => parseSafeRemoteUrl(url), code, 422);
  }
  assert.equal(
    parseSafeRemoteUrl("https://example.com/path#fragment").toString(),
    "https://example.com/path",
  );
});

test("DNS answers are all validated before a request", async () => {
  await expectSafeUrlError(
    () =>
      resolveSafeUrl("https://example.com", async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.2", family: 4 },
      ]),
    "URL_HOST_BLOCKED",
    422,
  );
});

test("a public redirect cannot cross into loopback", async () => {
  let calls = 0;
  const request: SafeUrlRequest = async () => {
    calls += 1;
    return {
      response: new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
      close: async () => undefined,
    };
  };
  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com", {
        lookup: async () => [{ address: "8.8.8.8", family: 4 }],
        request,
      }),
    "URL_HOST_BLOCKED",
    422,
  );
  assert.equal(calls, 1);
});

test("redirect count, content type, byte size, and timeout are bounded", async () => {
  const publicLookup = async () => [{ address: "8.8.8.8", family: 4 as const }];
  const redirect: SafeUrlRequest = async (url) => ({
    response: new Response(null, {
      status: 302,
      headers: { location: new URL(`/next-${url.pathname.length}`, url).toString() },
    }),
    close: async () => undefined,
  });
  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com", {
        lookup: publicLookup,
        request: redirect,
        maxRedirects: 1,
      }),
    "URL_REDIRECT_LIMIT",
    422,
  );

  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com", {
        lookup: publicLookup,
        maxBytes: 10,
        request: async () => ({
          response: new Response("12345678901", { headers: { "content-type": "text/plain" } }),
          close: async () => undefined,
        }),
      }),
    "URL_RESPONSE_TOO_LARGE",
    413,
  );

  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com", {
        lookup: publicLookup,
        request: async () => ({
          response: new Response("binary", { headers: { "content-type": "application/pdf" } }),
          close: async () => undefined,
        }),
      }),
    "URL_CONTENT_TYPE_BLOCKED",
    422,
  );

  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com", {
        lookup: publicLookup,
        timeoutMs: 10,
        request: async (_url, _addresses, controller) =>
          new Promise((_resolve, reject) => {
            controller.signal.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          }),
      }),
    "URL_FETCH_TIMEOUT",
    504,
  );
});

test("image validation checks base64, decoded size, MIME, and magic bytes", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(validateImportImage(png.toString("base64"), "image/png"), png.toString("base64"));

  assert.throws(
    () => validateImportImage("not base64", "image/png"),
    (error: unknown) =>
      error instanceof ImageValidationError && error.code === "IMAGE_BASE64_INVALID",
  );
  assert.throws(
    () => validateImportImage(png.toString("base64"), "image/jpeg"),
    (error: unknown) =>
      error instanceof ImageValidationError && error.code === "IMAGE_TYPE_MISMATCH",
  );
  const oversized = Buffer.alloc(MAX_IMPORT_IMAGE_BYTES + 1, 0);
  oversized.set(png, 0);
  assert.throws(
    () => validateImportImage(oversized.toString("base64"), "image/png"),
    (error: unknown) => error instanceof ImageValidationError && error.statusCode === 413,
  );
});

test("all public AI server functions have auth, idempotency, and fixed provider limits", async () => {
  const source = await readFile(new URL("../src/lib/ai.functions.ts", import.meta.url), "utf8");
  assert.equal(source.includes("generateClozeSentence"), false);
  assert.equal((source.match(/createServerFn\(\{ method: "POST" \}\)/g) ?? []).length, 7);
  assert.equal((source.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? []).length, 7);
  assert.equal((source.match(/idempotencyKey: IdempotencyKeyInput/g) ?? []).length, 7);
  assert.match(source, /maxOutputTokens: endpointConfig\.maxOutputTokens/);
  assert.match(source, /signal: controller\.signal/);
  assert.doesNotMatch(source, /redirect:\s*["']follow["']/);
});
