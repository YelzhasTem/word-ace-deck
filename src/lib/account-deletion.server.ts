import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "../integrations/supabase/client.server.ts";
import type { Database } from "../integrations/supabase/types.ts";
import { requireAccountDeletionAdmin } from "./account-deletion-admin.ts";
import {
  AccountDeletionStepError,
  AccountDeletionWorkflowError,
  cleanupAccountStorage,
  runAccountDeletionWorkflow,
  type AccountDeletionBackend,
  type AccountDeletionClaim,
} from "./account-deletion-workflow.ts";

const AccountDeletionStatusSchema = z.enum([
  "requested",
  "storage_cleanup_pending",
  "auth_deletion_pending",
  "database_verification_pending",
  "completed",
  "failed_retryable",
  "failed_terminal",
]);

const AccountDeletionResumeStepSchema = z.enum([
  "storage_cleanup",
  "auth_deletion",
  "database_verification",
  "done",
]);

const ClaimRowSchema = z.object({
  job_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  job_status: AccountDeletionStatusSchema,
  resume_step: AccountDeletionResumeStepSchema,
  lease_token: z.string().uuid().nullable(),
  attempt_count: z.number().int().nonnegative(),
  claimed: z.boolean(),
  retry_after_seconds: z.number().int().nonnegative(),
});

function parseClaimRow(value: unknown): AccountDeletionClaim {
  const row = ClaimRowSchema.parse(value);
  return {
    jobId: row.job_id,
    userId: row.user_id,
    status: row.job_status,
    resumeStep: row.resume_step,
    leaseToken: row.lease_token,
    attemptCount: row.attempt_count,
    claimed: row.claimed,
    retryAfterSeconds: row.retry_after_seconds,
  };
}

function isMissingAuthUser(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.code === "user_not_found" || candidate.status === 404;
}

function databaseStepError() {
  return new AccountDeletionStepError("DATABASE_TEMPORARY");
}

export function createAccountDeletionBackend(): AccountDeletionBackend {
  const bucket = supabaseAdmin.storage.from("avatars");

  return {
    async claim(jobId) {
      const { data, error } = await supabaseAdmin.rpc("claim_account_deletion_job", {
        p_job_id: jobId,
      });
      if (error || !data?.[0]) {
        throw new AccountDeletionWorkflowError(
          "ACCOUNT_DELETION_RETRYABLE",
          503,
          "Account deletion is not complete yet. Please try again shortly.",
          5,
        );
      }
      return parseClaimRow(data[0]);
    },

    async renewLease(jobId, leaseToken) {
      const { error } = await supabaseAdmin.rpc("renew_account_deletion_lease", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
      });
      if (error) throw databaseStepError();
    },

    async cleanupStorage(userId, onProgress) {
      return cleanupAccountStorage(
        {
          async list(prefix, options) {
            const { data, error } = await bucket.list(prefix, {
              limit: options.limit,
              offset: options.offset,
              sortBy: { column: "name", order: "asc" },
            });
            if (error) throw new AccountDeletionStepError("STORAGE_TEMPORARY");
            return (data ?? []).map((entry) => ({
              name: entry.name,
              id: typeof entry.id === "string" ? entry.id : null,
            }));
          },
          async remove(paths) {
            const { error } = await bucket.remove(paths);
            if (error) throw new AccountDeletionStepError("STORAGE_TEMPORARY");
          },
        },
        userId,
        onProgress,
      );
    },

    async deleteAuthUser(userId) {
      const lookup = await supabaseAdmin.auth.admin.getUserById(userId);
      if (lookup.error) {
        if (isMissingAuthUser(lookup.error)) return;
        throw new AccountDeletionStepError("AUTH_TEMPORARY");
      }

      const deleted = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (deleted.error && !isMissingAuthUser(deleted.error)) {
        throw new AccountDeletionStepError("AUTH_TEMPORARY");
      }
    },

    async advance(jobId, leaseToken, expectedStep, nextStep, storageFilesDeleted) {
      const { error } = await supabaseAdmin.rpc("advance_account_deletion_job", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_expected_step: expectedStep,
        p_next_step: nextStep,
        p_storage_files_deleted: storageFilesDeleted,
      });
      if (error) throw databaseStepError();
    },

    async fail(jobId, leaseToken, errorCode, retryable) {
      const { data, error } = await supabaseAdmin.rpc("fail_account_deletion_job", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_error_code: errorCode,
        p_retryable: retryable,
      });
      if (error || (data !== "failed_retryable" && data !== "failed_terminal")) {
        throw databaseStepError();
      }
      return data;
    },

    async finalizeDatabase(jobId, leaseToken) {
      const { data, error } = await supabaseAdmin.rpc("finalize_account_deletion_database", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
      });
      if (error || !data?.[0] || data[0].job_status !== "completed") {
        throw databaseStepError();
      }
      return { removedRows: data[0].removed_rows };
    },
  };
}

export async function executeAccountDeletion(jobId: string, expectedUserId?: string) {
  return runAccountDeletionWorkflow(createAccountDeletionBackend(), jobId, expectedUserId);
}

export async function executeAccountDeletionAsAdmin(
  caller: SupabaseClient<Database>,
  callerUserId: string,
  jobId: string,
) {
  await requireAccountDeletionAdmin(
    (userId) => caller.rpc("has_role", { _user_id: userId, _role: "admin" }),
    callerUserId,
  );

  return executeAccountDeletion(jobId);
}
