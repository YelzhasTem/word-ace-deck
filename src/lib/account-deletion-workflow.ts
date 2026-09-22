export const ACCOUNT_DELETION_STORAGE_PAGE_SIZE = 100;
export const ACCOUNT_DELETION_STORAGE_BATCH_SIZE = 100;
export const ACCOUNT_DELETION_MAX_BATCHES = 50;
export const ACCOUNT_DELETION_DEADLINE_MS = 120_000;

export type AccountDeletionResumeStep =
  | "storage_cleanup"
  | "auth_deletion"
  | "capability_drain"
  | "database_verification"
  | "done";

export type AccountDeletionStatus =
  | "requested"
  | "storage_cleanup_pending"
  | "auth_deletion_pending"
  | "capability_drain_pending"
  | "database_verification_pending"
  | "completed"
  | "failed_retryable"
  | "failed_terminal";

export type AccountDeletionErrorCode =
  | "ACCOUNT_DELETION_ALREADY_IN_PROGRESS"
  | "ACCOUNT_DELETION_RETRYABLE"
  | "ACCOUNT_DELETION_FAILED"
  | "ACCOUNT_ALREADY_DELETED";

export type AccountDeletionStepErrorCode =
  | "STORAGE_TEMPORARY"
  | "AUTH_TEMPORARY"
  | "DATABASE_TEMPORARY"
  | "PROVIDER_RESIDUAL"
  | "WORKFLOW_TIMEOUT";

export class AccountDeletionWorkflowError extends Error {
  readonly code: AccountDeletionErrorCode;
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: AccountDeletionErrorCode,
    statusCode: number,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AccountDeletionWorkflowError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AccountDeletionStepError extends Error {
  readonly code: AccountDeletionStepErrorCode;
  readonly retryable: boolean;

  constructor(code: AccountDeletionStepErrorCode, retryable = true) {
    super(code);
    this.name = "AccountDeletionStepError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type AccountDeletionStorage = {
  listOwned(userId: string, limit: number): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
};

export type AccountDeletionClaim = {
  jobId: string;
  userId: string | null;
  status: AccountDeletionStatus;
  resumeStep: AccountDeletionResumeStep;
  leaseToken: string | null;
  attemptCount: number;
  claimed: boolean;
  retryAfterSeconds: number;
};

export type AccountDeletionBackend = {
  claim(jobId: string): Promise<AccountDeletionClaim>;
  renewLease(jobId: string, leaseToken: string): Promise<void>;
  cleanupStorage(
    userId: string,
    onProgress: () => Promise<void>,
    jobId: string,
    leaseToken: string,
  ): Promise<number>;
  deleteAuthUser(userId: string): Promise<void>;
  advance(
    jobId: string,
    leaseToken: string,
    expectedStep: "storage_cleanup" | "auth_deletion",
    nextStep: "auth_deletion" | "capability_drain",
    storageFilesDeleted: number,
  ): Promise<{ retryAfterSeconds: number }>;
  fail(
    jobId: string,
    leaseToken: string,
    errorCode: AccountDeletionStepErrorCode,
    retryable: boolean,
  ): Promise<"failed_retryable" | "failed_terminal">;
  finalizeDatabase(jobId: string, leaseToken: string): Promise<{ removedRows: number }>;
};

export async function cleanupAccountStorage(
  storage: AccountDeletionStorage,
  userId: string,
  onProgress: () => Promise<void> = async () => undefined,
) {
  let deleted = 0;
  const deadline = Date.now() + ACCOUNT_DELETION_DEADLINE_MS;

  for (let batch = 0; batch < ACCOUNT_DELETION_MAX_BATCHES; batch += 1) {
    if (Date.now() >= deadline) throw new AccountDeletionStepError("WORKFLOW_TIMEOUT");
    await onProgress();
    const paths = await storage.listOwned(userId, ACCOUNT_DELETION_STORAGE_PAGE_SIZE);
    if (paths.length > ACCOUNT_DELETION_STORAGE_BATCH_SIZE)
      throw new AccountDeletionStepError("STORAGE_TEMPORARY");
    if (paths.length === 0) return deleted;
    await onProgress();
    await storage.remove(paths);
    deleted += paths.length;
    await onProgress();
  }

  throw new AccountDeletionStepError("WORKFLOW_TIMEOUT");
}

function stepErrorFor(
  error: unknown,
  step: Exclude<AccountDeletionResumeStep, "done">,
): AccountDeletionStepError {
  if (error instanceof AccountDeletionStepError) return error;
  if (step === "storage_cleanup") return new AccountDeletionStepError("STORAGE_TEMPORARY");
  if (step === "auth_deletion") return new AccountDeletionStepError("AUTH_TEMPORARY");
  return new AccountDeletionStepError("DATABASE_TEMPORARY");
}

export async function runAccountDeletionWorkflow(
  backend: AccountDeletionBackend,
  jobId: string,
  expectedUserId?: string,
) {
  const claim = await backend.claim(jobId);

  if (expectedUserId && claim.userId && claim.userId !== expectedUserId) {
    throw new AccountDeletionWorkflowError(
      "ACCOUNT_DELETION_FAILED",
      403,
      "This deletion request cannot be processed.",
    );
  }

  if (claim.status === "completed") {
    return { status: "completed" as const, removedRows: 0 };
  }
  if (claim.status === "failed_terminal") {
    throw new AccountDeletionWorkflowError(
      "ACCOUNT_DELETION_FAILED",
      500,
      "Account deletion needs support assistance.",
    );
  }
  if (claim.status === "capability_drain_pending" && !claim.claimed) {
    return {
      status: "capability_drain_pending" as const,
      retryAfterSeconds: claim.retryAfterSeconds,
    };
  }
  if (!claim.claimed || !claim.leaseToken) {
    throw new AccountDeletionWorkflowError(
      "ACCOUNT_DELETION_ALREADY_IN_PROGRESS",
      409,
      "Account deletion is already in progress.",
      claim.retryAfterSeconds || undefined,
    );
  }
  if (!claim.userId || (expectedUserId && claim.userId !== expectedUserId)) {
    throw new AccountDeletionWorkflowError(
      "ACCOUNT_DELETION_FAILED",
      403,
      "This deletion request cannot be processed.",
    );
  }

  const leaseToken = claim.leaseToken;
  const userId = claim.userId;
  let step = claim.resumeStep;
  const deadline = Date.now() + ACCOUNT_DELETION_DEADLINE_MS;
  const checkpoint = async () => {
    if (Date.now() >= deadline) throw new AccountDeletionStepError("WORKFLOW_TIMEOUT");
    await backend.renewLease(jobId, leaseToken);
  };

  try {
    if (step === "storage_cleanup") {
      const deleted = await backend.cleanupStorage(userId, checkpoint, jobId, leaseToken);
      await checkpoint();
      await backend.advance(jobId, leaseToken, "storage_cleanup", "auth_deletion", deleted);
      step = "auth_deletion";
    }

    if (step === "auth_deletion") {
      await checkpoint();
      await backend.deleteAuthUser(userId);
      await checkpoint();
      const drain = await backend.advance(
        jobId,
        leaseToken,
        "auth_deletion",
        "capability_drain",
        0,
      );
      // Auth absence is verified and the absolute deadline is persisted by SQL.
      // The handoff releases the lease. No timer/worker is kept alive here.
      return {
        status: "capability_drain_pending" as const,
        retryAfterSeconds: drain.retryAfterSeconds,
      };
    }

    if (step === "database_verification") {
      // SQL only grants this step after the capability deadline. Delete late
      // uploads through the provider API, then verify all provider metadata.
      await backend.cleanupStorage(userId, checkpoint, jobId, leaseToken);
      await checkpoint();
      const result = await backend.finalizeDatabase(jobId, leaseToken);
      return { status: "completed" as const, removedRows: result.removedRows };
    }

    throw new AccountDeletionStepError("DATABASE_TEMPORARY");
  } catch (error) {
    if (error instanceof AccountDeletionWorkflowError) throw error;
    const safeError = stepErrorFor(error, step === "done" ? "database_verification" : step);
    let failureStatus: "failed_retryable" | "failed_terminal" = "failed_retryable";
    try {
      failureStatus = await backend.fail(jobId, leaseToken, safeError.code, safeError.retryable);
    } catch {
      // The durable lease expires automatically. A later request can reclaim it.
    }

    if (failureStatus === "failed_terminal" || !safeError.retryable) {
      throw new AccountDeletionWorkflowError(
        "ACCOUNT_DELETION_FAILED",
        500,
        "Account deletion needs support assistance.",
      );
    }
    throw new AccountDeletionWorkflowError(
      "ACCOUNT_DELETION_RETRYABLE",
      503,
      "Account deletion is not complete yet. Please try again shortly.",
      safeError.code === "PROVIDER_RESIDUAL" ? 3600 : 5,
    );
  }
}
