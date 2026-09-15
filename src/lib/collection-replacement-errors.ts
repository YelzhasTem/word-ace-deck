type DatabaseError = { code?: string; message?: string } | null | undefined;

export function getCollectionReplacementError(error: DatabaseError) {
  switch (error?.message) {
    case "UNAUTHENTICATED":
      return { status: 401, code: "UNAUTHENTICATED", message: "Please sign in to continue." };
    case "COLLECTION_NOT_AVAILABLE":
      return {
        status: 404,
        code: "COLLECTION_NOT_AVAILABLE",
        message: "This collection is no longer available.",
      };
    case "DECK_NOT_AVAILABLE":
      return {
        status: 422,
        code: "DECK_NOT_AVAILABLE",
        message: "Choose only decks that are still in your library.",
      };
    case "DUPLICATE_DECK_IDS":
      return {
        status: 422,
        code: "DUPLICATE_DECK_IDS",
        message: "Each deck can be selected only once.",
      };
    case "TOO_MANY_DECKS":
      return { status: 422, code: "TOO_MANY_DECKS", message: "Select no more than 500 decks." };
    case "INVALID_DECK_IDS":
      return {
        status: 422,
        code: "INVALID_DECK_IDS",
        message: "Please check your deck selection and try again.",
      };
  }
  if (error?.code === "42501") {
    return {
      status: 403,
      code: "COLLECTION_ACCESS_DENIED",
      message: "You do not have permission to change this collection.",
    };
  }
  return {
    status: 500,
    code: "REPLACE_COLLECTION_DECKS_FAILED",
    message: "Your deck selection could not be saved. Please try again.",
  };
}
