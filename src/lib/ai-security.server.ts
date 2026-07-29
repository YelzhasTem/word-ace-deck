import { createHash, createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { getRequest } from "@tanstack/react-start/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getServerHttpErrorMetadata, httpError, isServerHttpError } from "@/lib/server-http-error";

export const MAX_AI_SERVER_FN_BODY_BYTES = 3_750_000;

export type AiEndpointName =
  | "generateStudyText"
  | "generateDeckWithAI"
  | "getTranslations"
  | "importManualCardsFromText"
  | "importManualCardsFromImage"
  | "generateDeckFromUrl"
  | "generateAssociation";

type AiCompletionStatus = "succeeded" | "failed" | "timed_out";
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

let adminClient: SupabaseClient<Database> | null = null;

function getAdminClient() {
  if (adminClient) return adminClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("[AI security] Server quota configuration is missing.");
    httpError(503, "AI_SECURITY_UNAVAILABLE", "AI is temporarily unavailable.");
  }
  adminClient = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return adminClient;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) result[key] = toJsonValue(nested);
    }
    return result;
  }
  return null;
}

function stableStringify(value: unknown): string {
  const json = toJsonValue(value);
  if (Array.isArray(json)) return `[${json.map(stableStringify).join(",")}]`;
  if (json !== null && typeof json === "object") {
    return `{${Object.keys(json)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(json[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(json);
}

function getTrustedVercelIp() {
  if (process.env.VERCEL !== "1") return null;
  const request = getRequest();
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for");
  const candidate = forwarded?.split(",", 1)[0]?.trim() ?? "";
  return isIP(candidate) ? candidate : null;
}

function getIpHash() {
  const ip = getTrustedVercelIp();
  if (!ip) return null;
  const salt = process.env.AI_IP_HASH_SALT;
  if (!salt || salt.length < 32) {
    console.error("[AI security] AI_IP_HASH_SALT is missing or too short.");
    httpError(503, "AI_SECURITY_UNAVAILABLE", "AI is temporarily unavailable.");
  }
  return createHmac("sha256", salt).update(ip).digest("hex");
}

function requestHash(endpoint: AiEndpointName, input: unknown) {
  return createHash("sha256")
    .update(`${endpoint}\n${stableStringify(input)}`)
    .digest("hex");
}

function inputWithoutIdempotency(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const entries = Object.entries(input).filter(([key]) => key !== "idempotencyKey");
  return Object.fromEntries(entries);
}

function quotaError(decision: string, retryAfter: number): never {
  if (decision === "disabled") {
    httpError(503, "AI_DISABLED", "AI is temporarily unavailable.", retryAfter);
  }
  if (decision === "global_budget" || decision === "global_heavy_budget") {
    httpError(503, "AI_BUDGET_EXHAUSTED", "AI is temporarily unavailable.", retryAfter);
  }
  if (decision === "idempotency_conflict") {
    httpError(409, "AI_IDEMPOTENCY_CONFLICT", "This request identifier was already used.");
  }
  if (decision === "idempotency_in_progress") {
    httpError(409, "AI_REQUEST_IN_PROGRESS", "This AI request is already in progress.", retryAfter);
  }
  if (decision === "idempotency_replay") {
    httpError(409, "AI_REQUEST_REPLAY", "This AI request was already processed.");
  }
  httpError(
    429,
    "AI_RATE_LIMITED",
    "You have reached the AI usage limit. Try again later.",
    retryAfter,
  );
}

function errorCategory(error: unknown) {
  const serverMetadata = getServerHttpErrorMetadata(error);
  if (serverMetadata) return serverMetadata.code.slice(0, 80);
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 80);
  }
  return "AI_INTERNAL_ERROR";
}

function completionStatus(error: unknown): AiCompletionStatus {
  const category = errorCategory(error);
  return category.includes("TIMEOUT") ? "timed_out" : "failed";
}

async function completeUsage(
  client: SupabaseClient<Database>,
  requestId: string,
  userId: string,
  status: AiCompletionStatus,
  outputSize: number,
  latencyMs: number,
  providerErrorCategory: string | null,
) {
  const { error } = await client.rpc("complete_ai_request", {
    p_request_id: requestId,
    p_user_id: userId,
    p_status: status,
    p_output_size: outputSize,
    p_latency_ms: latencyMs,
    p_provider_error_category: providerErrorCategory,
  });
  if (error) {
    console.error("[AI audit] Could not complete usage event", {
      endpoint: "complete_ai_request",
      category: error.code || "database_error",
    });
  }
}

export async function runAiEndpoint<T>(options: {
  endpoint: AiEndpointName;
  userId: string;
  idempotencyKey: string;
  input: unknown;
  operation: () => Promise<T>;
}) {
  const startedAt = Date.now();
  const input = inputWithoutIdempotency(options.input);
  const serializedInput = stableStringify(input);
  const inputSize = Buffer.byteLength(serializedInput, "utf8");
  if (inputSize > MAX_AI_SERVER_FN_BODY_BYTES) {
    httpError(413, "AI_PAYLOAD_TOO_LARGE", "This input is too large for AI processing.");
  }

  const client = getAdminClient();
  const requestId = randomUUID();
  const { data, error } = await client.rpc("acquire_ai_request", {
    p_request_id: requestId,
    p_user_id: options.userId,
    p_endpoint: options.endpoint,
    p_idempotency_key: options.idempotencyKey,
    p_request_hash: requestHash(options.endpoint, input),
    p_ip_hash: getIpHash(),
    p_input_size: inputSize,
  });

  if (error) {
    console.error("[AI security] Quota reservation failed", {
      endpoint: options.endpoint,
      userId: options.userId,
      category: error.code || "database_error",
    });
    httpError(503, "AI_SECURITY_UNAVAILABLE", "AI is temporarily unavailable.");
  }

  const reservation = data?.[0];
  if (!reservation || reservation.decision !== "accepted" || !reservation.reserved_request_id) {
    quotaError(
      reservation?.decision ?? "quota_unavailable",
      reservation?.retry_after_seconds ?? 60,
    );
  }

  try {
    const result = await options.operation();
    const outputSize = Buffer.byteLength(JSON.stringify(result), "utf8");
    await completeUsage(
      client,
      reservation.reserved_request_id,
      options.userId,
      "succeeded",
      outputSize,
      Date.now() - startedAt,
      null,
    );
    return result;
  } catch (error) {
    await completeUsage(
      client,
      reservation.reserved_request_id,
      options.userId,
      completionStatus(error),
      0,
      Date.now() - startedAt,
      errorCategory(error),
    );

    if (isServerHttpError(error)) throw error;
    if (error && typeof error === "object" && "statusCode" in error && "code" in error) {
      const statusCode = Number(error.statusCode);
      const code = typeof error.code === "string" ? error.code : "AI_REQUEST_FAILED";
      const message = error instanceof Error ? error.message : "AI request failed.";
      httpError(statusCode, code, message);
    }

    console.error("[AI] Unexpected request failure", {
      endpoint: options.endpoint,
      userId: options.userId,
      category: errorCategory(error),
    });
    httpError(500, "AI_INTERNAL_ERROR", "AI request failed. Please try again.");
  }
}
