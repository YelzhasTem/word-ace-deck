import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
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
  "capability_drain_pending",
  "database_verification_pending",
  "completed",
  "failed_retryable",
  "failed_terminal",
]);

const AccountDeletionResumeStepSchema = z.enum([
  "storage_cleanup",
  "auth_deletion",
  "capability_drain",
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

function deletionAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw databaseStepError();
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            AbortSignal.timeout(15_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    },
  });
}

export function createAccountDeletionBackend(
  admin: SupabaseClient<Database> = deletionAdminClient(),
): AccountDeletionBackend {
  const bucket = admin.storage.from("avatars");

  return {
    async claim(jobId) {
      const { data, error } = await admin.rpc("claim_account_deletion_job", {
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
      const { error } = await admin.rpc("renew_account_deletion_lease", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
      });
      if (error) throw databaseStepError();
    },

    async cleanupStorage(userId, onProgress, jobId, leaseToken) {
      return cleanupAccountStorage(
        {
          async listOwned() {
            const { data, error } = await admin.rpc("list_account_deletion_avatars", {
              p_job_id: jobId,
              p_lease_token: leaseToken,
            });
            if (error) throw new AccountDeletionStepError("STORAGE_TEMPORARY");
            return (data ?? []).map((entry) => entry.name);
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
      const lookup = await admin.auth.admin.getUserById(userId);
      if (lookup.error) {
        if (isMissingAuthUser(lookup.error)) return;
        throw new AccountDeletionStepError("AUTH_TEMPORARY");
      }

      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error && !isMissingAuthUser(deleted.error)) {
        throw new AccountDeletionStepError("AUTH_TEMPORARY");
      }
    },

    async advance(jobId, leaseToken, expectedStep, nextStep, storageFilesDeleted) {
      const { data, error } = await admin.rpc("advance_account_deletion_job", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_expected_step: expectedStep,
        p_next_step: nextStep,
        p_storage_files_deleted: storageFilesDeleted,
      });
      if (error || !data?.[0]) throw databaseStepError();
      return { retryAfterSeconds: data[0].retry_after_seconds };
    },

    async fail(jobId, leaseToken, errorCode, retryable) {
      const { data, error } = await admin.rpc("fail_account_deletion_job", {
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
      const { data, error } = await admin.rpc("finalize_account_deletion_database", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
      });
      if (error?.message === "ACCOUNT_DELETION_STORAGE_NOT_EMPTY") {
        throw new AccountDeletionStepError("PROVIDER_RESIDUAL");
      }
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
