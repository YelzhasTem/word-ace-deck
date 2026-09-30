export function getAccountDeletionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (message.includes("already in progress")) {
    return "Account deletion is already in progress. Please wait a moment.";
  }
  if (message.includes("not complete yet")) {
    return "Account deletion is not complete yet. Please try again shortly.";
  }
  if (message.includes("sign in") || message.includes("session")) {
    return "Please sign in again before deleting your account.";
  }
  if (message.includes("support assistance")) {
    return "Account deletion needs support assistance. Your account is not marked as deleted.";
  }
  return "Could not complete account deletion. Please try again.";
}
