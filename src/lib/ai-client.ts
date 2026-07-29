import { supabase } from "@/integrations/supabase/client";

function statusFromError(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  const status = "status" in error ? error.status : undefined;
  const directStatus = Number(statusCode ?? status);
  if (Number.isInteger(directStatus) && directStatus >= 400 && directStatus <= 599) {
    return directStatus;
  }
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/\b(400|401|403|408|409|413|422|429|500|502|503|504)\b/);
  return match ? Number(match[1]) : null;
}

function safeAiMessage(error: unknown, fallback: string) {
  const status = statusFromError(error);
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  const serverMessage = error instanceof Error ? error.message.replace(/^HTTP \d{3}:\s*/, "") : "";

  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have access to this AI action.";
  if (status === 408 || status === 504 || code.includes("TIMEOUT")) {
    return "The AI request took too long. Please try again.";
  }
  if (status === 413) return "This input is too large for AI processing.";
  if (status === 429) return "You have reached the AI usage limit. Try again later.";
  if (status === 502) return "The AI provider is temporarily unavailable.";
  if (status === 503) return "AI is temporarily unavailable. Please try again later.";
  if (status === 409) return "This AI request is already being processed.";
  if (status === 400 || status === 422) {
    return serverMessage || "Please check the input.";
  }
  return fallback;
}

export function createAiIdempotencyKey() {
  return crypto.randomUUID();
}

export async function executeAiRequest<T>(operation: () => Promise<T>, fallback: string) {
  try {
    return await operation();
  } catch (firstError) {
    if (statusFromError(firstError) === 401) {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session) {
        try {
          return await operation();
        } catch (retryError) {
          throw new Error(safeAiMessage(retryError, fallback));
        }
      }
    }
    throw new Error(safeAiMessage(firstError, fallback));
  }
}
