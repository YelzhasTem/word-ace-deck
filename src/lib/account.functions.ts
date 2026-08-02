import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  requireSupabaseAuth,
  requireSupabaseSession,
} from "@/integrations/supabase/auth-middleware";
import { executeAccountDeletion } from "@/lib/account-deletion.server";
import { AccountDeletionWorkflowError } from "@/lib/account-deletion-workflow";
import { httpError } from "@/lib/server-http-error";

const DeleteAccountInput = z.object({ confirmation: z.literal("DELETE") }).strict();
const ResumeDeletionInput = z.object({ jobId: z.string().uuid() }).strict();

function throwSafeDeletionError(error: unknown): never {
  if (error instanceof AccountDeletionWorkflowError) {
    httpError(error.statusCode, error.code, error.message, error.retryAfterSeconds);
  }
  httpError(500, "ACCOUNT_DELETION_FAILED", "Account deletion needs support assistance.");
}

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseSession])
  .inputValidator((input) => DeleteAccountInput.parse(input))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("request_account_deletion");
    const job = data?.[0];
    if (error || !job) {
      httpError(
        503,
        "ACCOUNT_DELETION_RETRYABLE",
        "Account deletion is not complete yet. Please try again shortly.",
        5,
      );
    }

    try {
      const result = await executeAccountDeletion(job.job_id, context.userId);
      return { ok: true as const, status: result.status };
    } catch (workflowError) {
      throwSafeDeletionError(workflowError);
    }
  });

// Operational resume for a job whose Auth user may already be gone. There is no
// public UI for this endpoint and only an authenticated Memora admin may invoke it.
export const resumeAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ResumeDeletionInput.parse(input))
  .handler(async ({ data, context }) => {
    const role = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (role.error || !role.data) {
      httpError(403, "ACCOUNT_DELETION_FAILED", "This deletion request cannot be processed.");
    }

    try {
      const result = await executeAccountDeletion(data.jobId);
      return { ok: true as const, status: result.status };
    } catch (workflowError) {
      throwSafeDeletionError(workflowError);
    }
  });
