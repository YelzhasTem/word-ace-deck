import { AccountDeletionWorkflowError } from "./account-deletion-workflow.ts";

export type AccountDeletionAdminRoleLookup = (
  userId: string,
) => PromiseLike<{ data: boolean | null; error: unknown }>;

export async function requireAccountDeletionAdmin(
  lookupRole: AccountDeletionAdminRoleLookup,
  callerUserId: string,
) {
  const role = await lookupRole(callerUserId);
  if (role.error || !role.data) {
    throw new AccountDeletionWorkflowError(
      "ACCOUNT_DELETION_FAILED",
      403,
      "This deletion request cannot be processed.",
    );
  }
}
