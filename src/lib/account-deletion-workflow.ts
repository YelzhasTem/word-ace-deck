export const ACCOUNT_DELETION_STORAGE_PAGE_SIZE = 100;
export const ACCOUNT_DELETION_STORAGE_BATCH_SIZE = 100;
const MAX_STORAGE_CLEANUP_PASSES = 20;

export type AccountDeletionResumeStep =
  | "storage_cleanup"
  | "auth_deletion"
  | "database_verification"
  | "done";

export type AccountDeletionStatus =
  | "requested"
  | "storage_cleanup_pending"
  | "auth_deletion_pending"
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

export type AccountDeletionStorageEntry = {
  name: string;
  id: string | null;
};

export type AccountDeletionStorage = {
  list(
    prefix: string,
    options: { limit: number; offset: number },
  ): Promise<AccountDeletionStorageEntry[]>;
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
  cleanupStorage(userId: string, onProgress: () => Promise<void>): Promise<number>;
  deleteAuthUser(userId: string): Promise<void>;
  advance(
    jobId: string,
    leaseToken: string,
    expectedStep: Exclude<AccountDeletionResumeStep, "done" | "database_verification">,
    nextStep: Exclude<AccountDeletionResumeStep, "done" | "storage_cleanup">,
    storageFilesDeleted: number,
  ): Promise<void>;
  fail(
    jobId: string,
    leaseToken: string,
    errorCode: AccountDeletionStepErrorCode,
    retryable: boolean,
  ): Promise<"failed_retryable" | "failed_terminal">;
  finalizeDatabase(jobId: string, leaseToken: string): Promise<{ removedRows: number }>;
};

function joinStoragePath(prefix: string, name: string) {
  return prefix ? `${prefix}/${name}` : name;
}

async function collectStorageFiles(
  storage: AccountDeletionStorage,
  prefix: string,
  onProgress: () => Promise<void>,
): Promise<string[]> {
  const files: string[] = [];
  let offset = 0;

  while (true) {
    const entries = await storage.list(prefix, {
      limit: ACCOUNT_DELETION_STORAGE_PAGE_SIZE,
      offset,
    });
    await onProgress();

    for (const entry of entries) {
      const path = joinStoragePath(prefix, entry.name);
      if (entry.id) files.push(path);
      else files.push(...(await collectStorageFiles(storage, path, onProgress)));
    }

    if (entries.length < ACCOUNT_DELETION_STORAGE_PAGE_SIZE) break;
    offset += entries.length;
  }

  return files;
}

export async function cleanupAccountStorage(
  storage: AccountDeletionStorage,
  userId: string,
  onProgress: () => Promise<void> = async () => undefined,
) {
  let deleted = 0;

  for (let pass = 0; pass < MAX_STORAGE_CLEANUP_PASSES; pass += 1) {
    const paths = await collectStorageFiles(storage, userId, onProgress);
    if (paths.length === 0) return deleted;

    for (let index = 0; index < paths.length; index += ACCOUNT_DELETION_STORAGE_BATCH_SIZE) {
      const batch = paths.slice(index, index + ACCOUNT_DELETION_STORAGE_BATCH_SIZE);
      await storage.remove(batch);
      deleted += batch.length;
      await onProgress();
    }
  }

  throw new AccountDeletionStepError("STORAGE_TEMPORARY");
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

  try {
    if (step === "storage_cleanup") {
      const deleted = await backend.cleanupStorage(userId, () =>
        backend.renewLease(jobId, leaseToken),
      );
      await backend.advance(jobId, leaseToken, "storage_cleanup", "auth_deletion", deleted);
      step = "auth_deletion";
    }

    if (step === "auth_deletion") {
      await backend.deleteAuthUser(userId);
      await backend.advance(jobId, leaseToken, "auth_deletion", "database_verification", 0);
      step = "database_verification";
    }

    if (step === "database_verification") {
      // A second idempotent scan closes the narrow race with an avatar upload
      // that was already in flight when the deletion job was requested.
      await backend.cleanupStorage(userId, () => backend.renewLease(jobId, leaseToken));
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
      5,
    );
  }
}
