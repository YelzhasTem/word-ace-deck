const DECK_CREATION_MESSAGES = {
  UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  INVALID_DECK: "Check the deck name, description, and languages.",
  INVALID_CARD: "Every card needs a valid word, translation, and position.",
  TOO_MANY_CARDS: "A deck can contain at most 100 cards.",
  TOO_MANY_DECKS: "This collection is too large to copy at once.",
  COLLECTION_NOT_FOUND: "That collection no longer exists.",
  COLLECTION_ACCESS_DENIED: "You can only add a deck to your own collection.",
  DECK_NOT_FOUND: "That public deck is no longer available.",
  IDEMPOTENCY_CONFLICT: "This request was already used for different content. Please try again.",
  IDEMPOTENCY_RESULT_GONE:
    "The original result was deleted. Start a new request to create it again.",
  CREATE_DECK_FAILED: "Could not create the deck. Nothing was saved.",
} as const;

export type DeckCreationErrorCode = keyof typeof DECK_CREATION_MESSAGES;

function errorText(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const fields = new Set(["message", "details", "hint"]);
  const values = Object.entries(error)
    .filter(([field, value]) => fields.has(field) && typeof value === "string")
    .map(([, value]) => value);
  if (error instanceof Error) values.push(error.message);
  return values.join(" ");
}

export function getDeckCreationErrorCode(error: unknown): DeckCreationErrorCode | null {
  const text = errorText(error);
  return (
    (Object.keys(DECK_CREATION_MESSAGES).find((code) => text.includes(code)) as
      | DeckCreationErrorCode
      | undefined) ?? null
  );
}

export function getDeckCreationErrorMessage(
  error: unknown,
  fallback = DECK_CREATION_MESSAGES.CREATE_DECK_FAILED,
) {
  const code = getDeckCreationErrorCode(error);
  return code ? DECK_CREATION_MESSAGES[code] : fallback;
}

export function createContentIdempotencyKey() {
  return crypto.randomUUID();
}
