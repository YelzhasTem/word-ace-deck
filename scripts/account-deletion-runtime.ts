import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";

export type AccountDeletionRuntimeEnv = Readonly<{
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}>;

export type AccountDeletionRuntimeResult =
  | { ok: true; assurance: "shape-only"; keyFormat: "legacy-jwt" | "sb_secret" }
  | { ok: false; error: string };

const PROJECT_REF = /^[a-z0-9]{20}$/;

// Return only the hosted project ref, never the potentially credential-bearing input.
export function parseHostedSupabaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
    if (!match || url.protocol !== "https:") return null;

    // Raw equality also rejects normalization of credentials, ports, dot paths, and escapes.
    const canonical = `https://${url.hostname}`;
    if (value !== canonical && value !== `${canonical}/`) return null;
    return match[1];
  } catch {
    return null;
  }
}

function decodeSegment(segment: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  const bytes = Buffer.from(segment, "base64url");
  return bytes.toString("base64url") === segment ? bytes : null;
}

function decodeObject(bytes: Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// The caller supplies time so validation is deterministic and has no ambient env or clock reads.
export function validateAccountDeletionRuntimeEnv(
  env: AccountDeletionRuntimeEnv,
  expectedProjectRef: string,
  nowSeconds: number,
): AccountDeletionRuntimeResult {
  if (!PROJECT_REF.test(expectedProjectRef)) {
    return { ok: false, error: "An explicit hosted Supabase project ref is required." };
  }
  if (!Number.isFinite(nowSeconds) || nowSeconds < 0) {
    return { ok: false, error: "A valid current time is required for expiry checks." };
  }

  // Match deletionAdminClient's precedence, including fallback for an empty server URL.
  const projectRef = parseHostedSupabaseUrl(env.SUPABASE_URL || env.VITE_SUPABASE_URL);
  if (!projectRef) {
    return {
      ok: false,
      error:
        "SUPABASE_URL (or VITE_SUPABASE_URL fallback) must be a canonical hosted HTTPS base URL.",
    };
  }
  if (projectRef !== expectedProjectRef) {
    return { ok: false, error: "The server Supabase URL does not match the expected project ref." };
  }

  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is required." };
  }

  // Opaque modern keys can only be screened for prefix, alphabet, and minimum token length.
  if (/^sb_secret_[A-Za-z0-9_-]{32,}$/.test(key)) {
    return { ok: true, assurance: "shape-only", keyFormat: "sb_secret" };
  }

  const segments = key.split(".");
  const [headerBytes, payloadBytes, signatureBytes] = segments.map(decodeSegment);
  if (segments.length !== 3 || !headerBytes || !payloadBytes || signatureBytes?.length !== 32) {
    return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY has an unsupported or malformed shape." };
  }
  const header = decodeObject(headerBytes);
  const payload = decodeObject(payloadBytes);
  if (!header || header.alg !== "HS256" || ("typ" in header && header.typ !== "JWT") || !payload) {
    return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY has a malformed legacy JWT shape." };
  }
  if (payload.role !== "service_role") {
    return { ok: false, error: "The legacy JWT must have the service_role role." };
  }
  if ("ref" in payload && payload.ref !== expectedProjectRef) {
    return {
      ok: false,
      error: "The legacy JWT project ref does not match the expected project ref.",
    };
  }
  if (
    "exp" in payload &&
    (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= nowSeconds)
  ) {
    return { ok: false, error: "The legacy JWT expiry is invalid or expired." };
  }

  return { ok: true, assurance: "shape-only", keyFormat: "legacy-jwt" };
}
