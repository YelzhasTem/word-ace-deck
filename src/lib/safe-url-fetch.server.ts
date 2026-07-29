import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, buildConnector, fetch as undiciFetch, type Response } from "undici";

export const URL_FETCH_MAX_BYTES = 512 * 1024;
export const URL_FETCH_TIMEOUT_MS = 12_000;
export const URL_FETCH_MAX_REDIRECTS = 4;
export const URL_TEXT_EXCERPT_CHARS = 12_000;

const ALLOWED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ENCODED_CONTROL_CHARACTERS = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const LOCAL_HOSTNAME = /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/i;
const METADATA_HOSTNAME = /(?:^|\.)metadata(?:\.google\.internal)?$/i;

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export class SafeUrlFetchError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "SafeUrlFetchError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

type ResolvedAddress = { address: string; family: 4 | 6 };
export type SafeLookup = (hostname: string) => Promise<ResolvedAddress[]>;
export type SafeUrlRequest = (
  url: URL,
  addresses: ResolvedAddress[],
  controller: AbortController,
) => Promise<{ response: Response; close: () => Promise<void> }>;
export type SafeUrlFetchDependencies = {
  lookup?: SafeLookup;
  request?: SafeUrlRequest;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

function fail(statusCode: number, code: string, message: string): never {
  throw new SafeUrlFetchError(statusCode, code, message);
}

function hostnameWithoutBrackets(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function isPublicIpAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blockedIpv4Addresses.check(address, "ipv4");
  if (family === 6) return !blockedIpv6Addresses.check(address, "ipv6");
  return false;
}

export function parseSafeRemoteUrl(rawUrl: string) {
  if (!rawUrl || hasControlCharacters(rawUrl) || ENCODED_CONTROL_CHARACTERS.test(rawUrl)) {
    fail(422, "URL_INVALID", "Enter a valid public web address.");
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawUrl);
  } catch {
    fail(422, "URL_INVALID", "Enter a valid public web address.");
  }
  if (hasControlCharacters(decoded)) {
    fail(422, "URL_INVALID", "Enter a valid public web address.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(422, "URL_INVALID", "Enter a valid public web address.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail(422, "URL_SCHEME_BLOCKED", "Only public HTTP and HTTPS pages are supported.");
  }
  if (url.username || url.password) {
    fail(422, "URL_CREDENTIALS_BLOCKED", "Web addresses containing credentials are not supported.");
  }

  const hostname = hostnameWithoutBrackets(url.hostname).toLowerCase();
  if (!hostname || LOCAL_HOSTNAME.test(hostname) || METADATA_HOSTNAME.test(hostname)) {
    fail(422, "URL_HOST_BLOCKED", "This web address is not publicly accessible.");
  }
  url.hash = "";
  return url;
}

const defaultLookup: SafeLookup = async (hostname) => {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses
    .filter(
      (entry): entry is { address: string; family: 4 | 6 } =>
        entry.family === 4 || entry.family === 6,
    )
    .map(({ address, family }) => ({ address, family }));
};

export async function resolveSafeUrl(rawUrl: string | URL, lookup: SafeLookup = defaultLookup) {
  const url = parseSafeRemoteUrl(String(rawUrl));
  const hostname = hostnameWithoutBrackets(url.hostname);
  let addresses: ResolvedAddress[];

  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await lookup(hostname);
    } catch {
      fail(422, "URL_DNS_FAILED", "Could not resolve this web address.");
    }
  }

  if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    fail(422, "URL_HOST_BLOCKED", "This web address is not publicly accessible.");
  }

  return { url, addresses };
}

function createPinnedAgent(hostname: string, address: ResolvedAddress) {
  const connector = buildConnector({ timeout: 5_000 });
  const connect: ReturnType<typeof buildConnector> = (options, callback) => {
    connector(
      {
        ...options,
        hostname: address.address,
        host: address.address,
        servername: hostname,
      },
      callback,
    );
  };

  return new Agent({
    connect,
    connections: 1,
    pipelining: 0,
    headersTimeout: 6_000,
    bodyTimeout: URL_FETCH_TIMEOUT_MS,
    maxResponseSize: URL_FETCH_MAX_BYTES + 1,
  });
}

async function readLimitedText(response: Response, controller: AbortController, maxBytes: number) {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
      fail(422, "URL_CONTENT_LENGTH_INVALID", "The page returned an invalid size.");
    }
    if (declaredBytes > maxBytes) {
      fail(413, "URL_RESPONSE_TOO_LARGE", "This page is too large to import.");
    }
  }

  if (!response.body) return { text: "", bytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        controller.abort();
        fail(413, "URL_RESPONSE_TOO_LARGE", "This page is too large to import.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { text, bytes };
  } finally {
    reader.releaseLock();
  }
}

const pinnedRequest: SafeUrlRequest = async (url, addresses, controller) => {
  const hostname = hostnameWithoutBrackets(url.hostname);
  const address = addresses.find((candidate) => candidate.family === 4) ?? addresses[0];
  const agent = createPinnedAgent(hostname, address);
  try {
    const response = await undiciFetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "MemoraBot/1.0",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "Accept-Encoding": "identity",
      },
      redirect: "manual",
      credentials: "omit",
      signal: controller.signal,
      dispatcher: agent,
    });
    return { response, close: () => agent.close() };
  } catch (error) {
    await agent.close().catch(() => undefined);
    throw error;
  }
};

export async function fetchSafeUrlText(
  rawUrl: string,
  dependencies: SafeUrlFetchDependencies = {},
) {
  const timeoutMs = dependencies.timeoutMs ?? URL_FETCH_TIMEOUT_MS;
  const maxBytes = dependencies.maxBytes ?? URL_FETCH_MAX_BYTES;
  const maxRedirects = dependencies.maxRedirects ?? URL_FETCH_MAX_REDIRECTS;
  const request = dependencies.request ?? pinnedRequest;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  let currentUrl = parseSafeRemoteUrl(rawUrl);

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const { url, addresses } = await resolveSafeUrl(currentUrl, dependencies.lookup);
      const requested = await request(url, addresses, controller);
      const { response } = requested;

      try {
        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location)
            fail(422, "URL_REDIRECT_INVALID", "The page returned an invalid redirect.");
          if (redirectCount >= maxRedirects) {
            fail(422, "URL_REDIRECT_LIMIT", "This page redirects too many times.");
          }
          try {
            currentUrl = parseSafeRemoteUrl(new URL(location, url).toString());
          } catch (error) {
            if (error instanceof SafeUrlFetchError) throw error;
            fail(422, "URL_REDIRECT_INVALID", "The page returned an invalid redirect.");
          }
          continue;
        }

        if (!response.ok) {
          await response.body?.cancel();
          fail(422, "URL_UPSTREAM_ERROR", "Could not load this page.");
        }

        const contentType = (response.headers.get("content-type") ?? "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
          await response.body?.cancel();
          fail(422, "URL_CONTENT_TYPE_BLOCKED", "Only HTML and plain-text pages are supported.");
        }

        const body = await readLimitedText(response, controller, maxBytes);
        return { ...body, contentType, finalUrl: url.toString() };
      } finally {
        await requested.close().catch(() => undefined);
      }
    }
  } catch (error) {
    if (error instanceof SafeUrlFetchError) throw error;
    if (controller.signal.aborted) {
      fail(504, "URL_FETCH_TIMEOUT", "The page took too long to respond.");
    }
    fail(422, "URL_FETCH_FAILED", "Could not load the page. Check the URL.");
  } finally {
    clearTimeout(deadline);
  }

  fail(422, "URL_REDIRECT_LIMIT", "This page redirects too many times.");
}
