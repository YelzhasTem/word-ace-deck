import assert from "node:assert/strict";
import test from "node:test";
import {
  createContentIdempotencyKey,
  getDeckCreationErrorCode,
  getDeckCreationErrorMessage,
} from "../src/lib/deck-creation-errors.ts";

test("known atomic RPC errors become fixed user-facing messages", () => {
  assert.equal(
    getDeckCreationErrorMessage({ message: "COLLECTION_ACCESS_DENIED" }),
    "You can only add a deck to your own collection.",
  );
  assert.equal(
    getDeckCreationErrorMessage(new Error("IDEMPOTENCY_CONFLICT")),
    "This request was already used for different content. Please try again.",
  );
  assert.equal(getDeckCreationErrorCode({ details: "TOO_MANY_CARDS" }), "TOO_MANY_CARDS");
  assert.equal(
    getDeckCreationErrorMessage({ message: "IDEMPOTENCY_RESULT_GONE" }),
    "The original result was deleted. Start a new request to create it again.",
  );
  assert.equal(
    getDeckCreationErrorMessage({ message: "TOO_MANY_DECKS" }),
    "This collection is too large to copy at once.",
  );
});

test("unknown database details never reach the client message", () => {
  const raw = {
    code: "23514",
    message: 'new row violates check constraint "cards_term_shape_check"',
    details: "Failing row contains internal values",
  };
  const message = getDeckCreationErrorMessage(raw);
  assert.equal(message, "Could not create the deck. Nothing was saved.");
  assert.doesNotMatch(message, /constraint|cards|postgres|sql|failing row/i);
});

test("content creation keys are unique UUIDs", () => {
  const first = createContentIdempotencyKey();
  const second = createContentIdempotencyKey();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first, second);
});
