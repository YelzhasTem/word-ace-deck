import assert from "node:assert/strict";
import test from "node:test";
import { requireAccountDeletionAdmin } from "../src/lib/account-deletion-admin.ts";
import {
  AccountDeletionStepError,
  AccountDeletionWorkflowError,
  cleanupAccountStorage,
  runAccountDeletionWorkflow,
  type AccountDeletionBackend,
  type AccountDeletionClaim,
  type AccountDeletionResumeStep,
  type AccountDeletionStatus,
  type AccountDeletionStepErrorCode,
  type AccountDeletionStorage,
} from "../src/lib/account-deletion-workflow.ts";
import { getAccountDeletionErrorMessage } from "../src/lib/account-deletion-errors.ts";

class FakeStorage implements AccountDeletionStorage {
  readonly files: Set<string>;
  readonly offsets: number[] = [];
  removeCalls = 0;
  failRemoveCall: number | null = null;

  constructor(paths: string[]) {
    this.files = new Set(paths);
  }

  async list(prefix: string, options: { limit: number; offset: number }) {
    this.offsets.push(options.offset);
    const base = prefix ? `${prefix}/` : "";
    const entries = new Map<string, { name: string; id: string | null }>();

    for (const path of this.files) {
      if (!path.startsWith(base)) continue;
      const remainder = path.slice(base.length);
      if (!remainder) continue;
      const slash = remainder.indexOf("/");
      if (slash >= 0) {
        const name = remainder.slice(0, slash);
        entries.set(name, { name, id: null });
      } else {
        entries.set(remainder, { name: remainder, id: path });
      }
    }

    return [...entries.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(options.offset, options.offset + options.limit);
  }

  async remove(paths: string[]) {
    this.removeCalls += 1;
    if (this.failRemoveCall === this.removeCalls) {
      throw new AccountDeletionStepError("STORAGE_TEMPORARY");
    }
    for (const path of paths) this.files.delete(path);
  }
}

class FakeBackend implements AccountDeletionBackend {
  status: AccountDeletionStatus = "requested";
  resumeStep: AccountDeletionResumeStep = "storage_cleanup";
  leaseActive = false;
  attemptCount = 0;
  storageCalls = 0;
  authCalls = 0;
  finalizeCalls = 0;
  failAuthAttempts = 0;
  failDatabaseAttempts = 0;
  readonly userId = "a1000000-0000-4000-8000-000000000001";
  readonly leaseToken = "a2000000-0000-4000-8000-000000000001";

  async claim(jobId: string): Promise<AccountDeletionClaim> {
    if (this.status === "completed") {
      return {
        jobId,
        userId: null,
        status: "completed",
        resumeStep: "done",
        leaseToken: null,
        attemptCount: this.attemptCount,
        claimed: false,
        retryAfterSeconds: 0,
      };
    }
    if (this.status === "failed_terminal") {
      return {
        jobId,
        userId: this.userId,
        status: this.status,
        resumeStep: this.resumeStep,
        leaseToken: null,
        attemptCount: this.attemptCount,
        claimed: false,
        retryAfterSeconds: 0,
      };
    }
    if (this.leaseActive) {
      return {
        jobId,
        userId: this.userId,
        status: this.status,
        resumeStep: this.resumeStep,
        leaseToken: null,
        attemptCount: this.attemptCount,
        claimed: false,
        retryAfterSeconds: 10,
      };
    }
    this.leaseActive = true;
    this.attemptCount += 1;
    return {
      jobId,
      userId: this.userId,
      status: this.status,
      resumeStep: this.resumeStep,
      leaseToken: this.leaseToken,
      attemptCount: this.attemptCount,
      claimed: true,
      retryAfterSeconds: 0,
    };
  }

  async renewLease() {}

  async cleanupStorage(_userId: string, onProgress: () => Promise<void>) {
    this.storageCalls += 1;
    await onProgress();
    return this.storageCalls === 1 ? 205 : 0;
  }

  async deleteAuthUser() {
    this.authCalls += 1;
    if (this.failAuthAttempts > 0) {
      this.failAuthAttempts -= 1;
      throw new AccountDeletionStepError("AUTH_TEMPORARY");
    }
  }

  async advance(
    _jobId: string,
    _leaseToken: string,
    _expectedStep: "storage_cleanup" | "auth_deletion",
    nextStep: "auth_deletion" | "database_verification",
  ) {
    this.resumeStep = nextStep;
    this.status =
      nextStep === "auth_deletion" ? "auth_deletion_pending" : "database_verification_pending";
  }

  async fail(
    _jobId: string,
    _leaseToken: string,
    _errorCode: AccountDeletionStepErrorCode,
    retryable: boolean,
  ) {
    this.leaseActive = false;
    this.status = retryable ? "failed_retryable" : "failed_terminal";
    return this.status;
  }

  async finalizeDatabase() {
    this.finalizeCalls += 1;
    if (this.failDatabaseAttempts > 0) {
      this.failDatabaseAttempts -= 1;
      throw new AccountDeletionStepError("DATABASE_TEMPORARY");
    }
    this.status = "completed";
    this.resumeStep = "done";
    this.leaseActive = false;
    return { removedRows: 0 };
  }
}

test("Storage cleanup traverses nested folders and every page beyond 1,000 objects", async () => {
  const userId = "user-a";
  const files = Array.from(
    { length: 1_205 },
    (_, index) => `${userId}/avatar-${String(index).padStart(4, "0")}.png`,
  );
  files.push(`${userId}/archive/2025/old.png`, `${userId}/archive/2026/current.png`);
  const storage = new FakeStorage(files);

  const deleted = await cleanupAccountStorage(storage, userId);

  assert.equal(deleted, 1_207);
  assert.equal(storage.files.size, 0);
  assert.ok(storage.offsets.includes(100));
  assert.ok(storage.offsets.includes(200));
  assert.ok(storage.offsets.includes(1_000));
  assert.ok(storage.offsets.includes(1_200));
  assert.ok(storage.removeCalls >= 13);
});

test("Storage cleanup resumes safely after a partial batch failure", async () => {
  const userId = "user-b";
  const storage = new FakeStorage(
    Array.from({ length: 205 }, (_, index) => `${userId}/avatar-${index}.png`),
  );
  storage.failRemoveCall = 2;

  await assert.rejects(
    cleanupAccountStorage(storage, userId),
    (error: unknown) =>
      error instanceof AccountDeletionStepError && error.code === "STORAGE_TEMPORARY",
  );
  assert.equal(storage.files.size, 105);

  storage.failRemoveCall = null;
  const deletedOnResume = await cleanupAccountStorage(storage, userId);
  assert.equal(deletedOnResume, 105);
  assert.equal(storage.files.size, 0);
});

test("Storage cleanup treats an already empty prefix as success", async () => {
  const storage = new FakeStorage([]);
  assert.equal(await cleanupAccountStorage(storage, "missing-user"), 0);
  assert.equal(storage.removeCalls, 0);
});

test("Workflow completes Storage, Auth, final Storage scan, and database verification", async () => {
  const backend = new FakeBackend();
  const result = await runAccountDeletionWorkflow(backend, "job-a", backend.userId);

  assert.deepEqual(result, { status: "completed", removedRows: 0 });
  assert.equal(backend.storageCalls, 2);
  assert.equal(backend.authCalls, 1);
  assert.equal(backend.finalizeCalls, 1);
});

test("Auth failure stays retryable and resumes from Auth without repeating completed Storage step", async () => {
  const backend = new FakeBackend();
  backend.failAuthAttempts = 1;

  await assert.rejects(
    runAccountDeletionWorkflow(backend, "job-b", backend.userId),
    (error: unknown) =>
      error instanceof AccountDeletionWorkflowError && error.code === "ACCOUNT_DELETION_RETRYABLE",
  );
  assert.equal(backend.status, "failed_retryable");
  assert.equal(backend.resumeStep, "auth_deletion");
  assert.equal(backend.storageCalls, 1);

  const result = await runAccountDeletionWorkflow(backend, "job-b", backend.userId);
  assert.equal(result.status, "completed");
  assert.equal(backend.storageCalls, 2);
  assert.equal(backend.authCalls, 2);
});

test("Database verification failure resumes without reporting false completion", async () => {
  const backend = new FakeBackend();
  backend.failDatabaseAttempts = 1;

  await assert.rejects(
    runAccountDeletionWorkflow(backend, "job-c", backend.userId),
    (error: unknown) =>
      error instanceof AccountDeletionWorkflowError && error.code === "ACCOUNT_DELETION_RETRYABLE",
  );
  assert.equal(backend.status, "failed_retryable");
  assert.equal(backend.resumeStep, "database_verification");

  const result = await runAccountDeletionWorkflow(backend, "job-c", backend.userId);
  assert.equal(result.status, "completed");
  assert.equal(backend.authCalls, 1);
  assert.equal(backend.finalizeCalls, 2);
});

test("Two concurrent workflow requests allow only one active lease", async () => {
  const backend = new FakeBackend();
  const results = await Promise.allSettled([
    runAccountDeletionWorkflow(backend, "job-d", backend.userId),
    runAccountDeletionWorkflow(backend, "job-d", backend.userId),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof AccountDeletionWorkflowError);
  assert.equal(rejected.reason.code, "ACCOUNT_DELETION_ALREADY_IN_PROGRESS");
  assert.equal(backend.authCalls, 1);
});

test("Expected-user mismatch cannot delete another account", async () => {
  const backend = new FakeBackend();
  await assert.rejects(
    runAccountDeletionWorkflow(backend, "job-e", "b1000000-0000-4000-8000-000000000002"),
    (error: unknown) => error instanceof AccountDeletionWorkflowError && error.statusCode === 403,
  );
  assert.equal(backend.storageCalls, 0);
  assert.equal(backend.authCalls, 0);
});

test("A completed job is an idempotent success", async () => {
  const backend = new FakeBackend();
  backend.status = "completed";
  backend.resumeStep = "done";
  const result = await runAccountDeletionWorkflow(backend, "job-f");
  assert.deepEqual(result, { status: "completed", removedRows: 0 });
});

test("UI error mapping never reflects unknown internal details", () => {
  assert.equal(
    getAccountDeletionErrorMessage(new Error("constraint account_deletion_jobs_pkey SQLSTATE")),
    "Could not complete account deletion. Please try again.",
  );
  assert.equal(
    getAccountDeletionErrorMessage(new Error("HTTP 503: Account deletion is not complete yet.")),
    "Account deletion is not complete yet. Please try again shortly.",
  );
});

test("Admin resume authorization rejects ordinary users and lookup failures", async () => {
  for (const lookup of [
    async () => ({ data: false, error: null }),
    async () => ({ data: null, error: new Error("internal role lookup detail") }),
  ]) {
    await assert.rejects(
      requireAccountDeletionAdmin(lookup, "b1000000-0000-4000-8000-000000000002"),
      (error: unknown) =>
        error instanceof AccountDeletionWorkflowError &&
        error.statusCode === 403 &&
        error.message === "This deletion request cannot be processed.",
    );
  }
});

test("Admin resume authorization accepts only a confirmed Memora admin role", async () => {
  let checkedUserId = "";
  await requireAccountDeletionAdmin(async (userId) => {
    checkedUserId = userId;
    return { data: true, error: null };
  }, "c1000000-0000-4000-8000-000000000003");
  assert.equal(checkedUserId, "c1000000-0000-4000-8000-000000000003");
});
