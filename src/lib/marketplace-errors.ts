type DatabaseError = { code?: string; message?: string } | null | undefined;

export function getMarketplaceError(error: DatabaseError) {
  if (error?.message === "UNAUTHENTICATED") {
    return { status: 401, code: "UNAUTHENTICATED", message: "Please sign in to continue." };
  }
  if (error?.code === "42501") {
    return {
      status: 403,
      code: "MARKETPLACE_ACCESS_DENIED",
      message: "You do not have permission to perform this action.",
    };
  }
  if (error?.message === "REPORT_NOT_FOUND" || error?.code === "PGRST116") {
    return {
      status: 404,
      code: "MARKETPLACE_NOT_FOUND",
      message: "This item is no longer available.",
    };
  }
  if (error?.code === "23505") {
    return {
      status: 409,
      code: "MARKETPLACE_CONFLICT",
      message: "This action has already changed. Refresh and try again.",
    };
  }
  if (error?.code === "22023" || error?.code === "23514") {
    return {
      status: 422,
      code: "INVALID_MARKETPLACE_REQUEST",
      message: "Please check your input and try again.",
    };
  }
  return {
    status: 500,
    code: "MARKETPLACE_REQUEST_FAILED",
    message: "This action could not be completed. Please try again.",
  };
}
