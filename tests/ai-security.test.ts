import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Response } from "undici";
import {
  fetchSafeUrlText,
  isPublicIpAddress,
  normalizeHostname,
  parseSafeRemoteUrl,
  resolveSafeUrl,
  SafeUrlFetchError,
  URL_FETCH_MAX_REDIRECTS,
  URL_FETCH_MAX_URL_CHARS,
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

const PUBLIC_LOOKUP = async () => [{ address: "8.8.8.8", family: 4 as const }];

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

test("only globally routable IPv4 and IPv6 addresses are accepted", () => {
  for (const address of [
    "0.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "::127.0.0.1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::127.0.0.1",
    "64:ff9b:1::1",
    "100::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
    "5f00::1",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("URL parser is HTTPS-only and rejects malformed or ambiguous input", async () => {
  for (const [url, code] of [
    ["http://example.com", "URL_SCHEME_BLOCKED"],
    ["file:///etc/passwd", "URL_SCHEME_BLOCKED"],
    ["ftp://example.com/file", "URL_SCHEME_BLOCKED"],
    ["gopher://example.com/1", "URL_SCHEME_BLOCKED"],
    ["data:text/plain,hello", "URL_SCHEME_BLOCKED"],
    ["blob:https://example.com/id", "URL_SCHEME_BLOCKED"],
    ["javascript:alert(1)", "URL_SCHEME_BLOCKED"],
    ["https://user:password@example.com", "URL_CREDENTIALS_BLOCKED"],
    ["https://localhost/test", "URL_HOST_BLOCKED"],
    ["https://sub.localhost:3000/test", "URL_HOST_BLOCKED"],
    ["https://service.internal/test", "URL_HOST_BLOCKED"],
    ["https://router.localdomain/test", "URL_HOST_BLOCKED"],
    ["https://metadata.google.internal/test", "URL_HOST_BLOCKED"],
    ["https://example.com/%0aheader", "URL_INVALID"],
    ["https://example.com/%250aheader", "URL_INVALID"],
    ["https://example.com/\u200bhidden", "URL_INVALID"],
    ["https://example.com:99999/", "URL_INVALID"],
    ["https://example.com../", "URL_HOST_INVALID"],
    [`https://example.com/${"a".repeat(URL_FETCH_MAX_URL_CHARS)}`, "URL_INVALID"],
  ]) {
    await expectSafeUrlError(() => parseSafeRemoteUrl(url), code, 422);
  }

  assert.equal(normalizeHostname("EXAMPLE.COM."), "example.com");
  assert.equal(
    parseSafeRemoteUrl("https://EXAMPLE.COM./path#fragment").toString(),
    "https://example.com/path",
  );
  assert.equal(parseSafeRemoteUrl("https://éxample.com/").hostname, "xn--xample-9ua.com");
  assert.equal(parseSafeRemoteUrl("https://xn--xample-9ua.com/").hostname, "xn--xample-9ua.com");
});

test("HTTP SSRF targets are rejected before hostname resolution", async () => {
  for (const url of [
    "http://localhost/",
    "http://localhost:3000/",
    "http://sub.localhost/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://0.0.0.0/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://[::ffff:127.0.0.1]/",
  ]) {
    await expectSafeUrlError(() => parseSafeRemoteUrl(url), "URL_SCHEME_BLOCKED", 422);
  }
});

test("alternate IP spellings cannot bypass literal-address validation", async () => {
  for (const url of [
    "https://0.0.0.0/",
    "https://127.0.0.1/",
    "https://127.1/",
    "https://2130706433/",
    "https://0x7f000001/",
    "https://017700000001/",
    "https://%31%32%37.0.0.1/",
    "https://10.0.0.1/",
    "https://172.16.0.1/",
    "https://192.168.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://100.64.0.1/",
    "https://[::1]/",
    "https://[fc00::1]/",
    "https://[fe80::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:10.0.0.1]/",
  ]) {
    await expectSafeUrlError(() => resolveSafeUrl(url), "URL_HOST_BLOCKED", 422);
  }
});

test("every DNS answer is validated before the request is pinned", async () => {
  await expectSafeUrlError(
    () =>
      resolveSafeUrl("https://example.com", async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.2", family: 4 },
      ]),
    "URL_HOST_BLOCKED",
    422,
  );

  await expectSafeUrlError(
    () => resolveSafeUrl("https://example.com", async () => [{ address: "8.8.8.8", family: 6 }]),
    "URL_HOST_BLOCKED",
    422,
  );

  const resolved = await resolveSafeUrl("https://example.com", async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ]);
  assert.equal(resolved.addresses.length, 2);
});

test("valid public HTTPS pages and up to three redirects are accepted", async () => {
  const visited: string[] = [];
  const request: SafeUrlRequest = async (url) => {
    visited.push(url.toString());
    if (url.pathname === "/start") {
      return {
        response: new Response(null, { status: 302, headers: { location: "/second" } }),
        close: async () => undefined,
      };
    }
    if (url.pathname === "/second") {
      return {
        response: new Response(null, {
          status: 307,
          headers: { location: "https://other.example/third#ignored" },
        }),
        close: async () => undefined,
      };
    }
    if (url.pathname === "/third") {
      return {
        response: new Response(null, { status: 308, headers: { location: "/final" } }),
        close: async () => undefined,
      };
    }
    return {
      response: new Response("safe page", { headers: { "content-type": "text/html" } }),
      close: async () => undefined,
    };
  };

  const result = await fetchSafeUrlText("https://example.com/start", {
    lookup: PUBLIC_LOOKUP,
    request,
  });
  assert.equal(result.text, "safe page");
  assert.equal(result.finalUrl, "https://other.example/final");
  assert.equal(visited.length, URL_FETCH_MAX_REDIRECTS + 1);
});

test("redirect targets are revalidated and cannot cross into local networks", async () => {
  let calls = 0;
  const request: SafeUrlRequest = async () => {
    calls += 1;
    return {
      response: new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/private" },
      }),
      close: async () => undefined,
    };
  };
  await expectSafeUrlError(
    () => fetchSafeUrlText("https://example.com", { lookup: PUBLIC_LOOKUP, request }),
    "URL_HOST_BLOCKED",
    422,
  );
  assert.equal(calls, 1);

  for (const location of [
    "file:///etc/passwd",
    "http://example.com/insecure",
    "https://user:password@example.com/private",
  ]) {
    await expectSafeUrlError(
      () =>
        fetchSafeUrlText("https://example.com", {
          lookup: PUBLIC_LOOKUP,
          request: async () => ({
            response: new Response(null, { status: 302, headers: { location } }),
            close: async () => undefined,
          }),
        }),
      location.startsWith("https://user") ? "URL_CREDENTIALS_BLOCKED" : "URL_SCHEME_BLOCKED",
      422,
    );
  }
});

test("redirect loops, malformed redirects, and excessive redirects are rejected", async () => {
  const redirectLoop: SafeUrlRequest = async (url) => ({
    response: new Response(null, {
      status: 302,
      headers: { location: url.pathname === "/a" ? "/b" : "/a#fragment" },
    }),
    close: async () => undefined,
  });
  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com/a", {
        lookup: PUBLIC_LOOKUP,
        request: redirectLoop,
      }),
    "URL_REDIRECT_LOOP",
    422,
  );

  for (const headers of [{}, { location: "https://[" }]) {
    await expectSafeUrlError(
      () =>
        fetchSafeUrlText("https://example.com", {
          lookup: PUBLIC_LOOKUP,
          request: async () => ({
            response: new Response(null, { status: 302, headers }),
            close: async () => undefined,
          }),
        }),
      "URL_REDIRECT_INVALID",
      422,
    );
  }

  let redirectNumber = 0;
  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com", {
        lookup: PUBLIC_LOOKUP,
        request: async () => ({
          response: new Response(null, {
            status: 302,
            headers: { location: `/redirect-${(redirectNumber += 1)}` },
          }),
          close: async () => undefined,
        }),
      }),
    "URL_REDIRECT_LIMIT",
    422,
  );
  assert.equal(redirectNumber, URL_FETCH_MAX_REDIRECTS + 1);
});

test("content type, encoding, declared size, and streamed size are bounded", async () => {
  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com", {
        lookup: PUBLIC_LOOKUP,
        maxBytes: 10,
        request: async () => ({
          response: new Response("small", {
            headers: { "content-type": "text/plain", "content-length": "11" },
          }),
          close: async () => undefined,
        }),
      }),
    "URL_RESPONSE_TOO_LARGE",
    413,
  );

  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com", {
        lookup: PUBLIC_LOOKUP,
        maxBytes: 10,
        request: async () => ({
          response: new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("123456"));
                controller.enqueue(new TextEncoder().encode("78901"));
                controller.close();
              },
            }),
            { headers: { "content-type": "text/plain" } },
          ),
          close: async () => undefined,
        }),
      }),
    "URL_RESPONSE_TOO_LARGE",
    413,
  );

  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com", {
        lookup: PUBLIC_LOOKUP,
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
        lookup: PUBLIC_LOOKUP,
        request: async () => ({
          response: new Response("compressed", {
            headers: { "content-type": "text/html", "content-encoding": "gzip" },
          }),
          close: async () => undefined,
        }),
      }),
    "URL_CONTENT_ENCODING_BLOCKED",
    422,
  );

  const plainText = await fetchSafeUrlText("https://example.com", {
    lookup: PUBLIC_LOOKUP,
    request: async () => ({
      response: new Response("plain text", { headers: { "content-type": "text/plain" } }),
      close: async () => undefined,
    }),
  });
  assert.equal(plainText.text, "plain text");
});

test("the total timeout covers DNS and the upstream request", async () => {
  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com", {
        lookup: PUBLIC_LOOKUP,
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

  await expectSafeUrlError(
    () =>
      fetchSafeUrlText("https://example.com", {
        lookup: async () => new Promise(() => undefined),
        timeoutMs: 10,
        request: async () => assert.fail("request ran after a timed-out DNS lookup"),
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
  assert.doesNotMatch(source, /Source: \$\{data\.url\}/);
  assert.match(source, /new URL\(page\.finalUrl\)/);
});
