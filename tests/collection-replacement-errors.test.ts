import assert from "node:assert/strict";
import { test } from "node:test";
import { getCollectionReplacementError } from "../src/lib/collection-replacement-errors.ts";

test("replacement errors distinguish safe validation, auth and unavailable resources", () => {
  for (const message of ["INVALID_DECK_IDS", "DUPLICATE_DECK_IDS", "TOO_MANY_DECKS"]) {
    assert.equal(getCollectionReplacementError({ message }).status, 422);
  }
  assert.equal(getCollectionReplacementError({ message: "UNAUTHENTICATED" }).status, 401);
  assert.equal(getCollectionReplacementError({ message: "COLLECTION_NOT_AVAILABLE" }).status, 404);
  assert.equal(getCollectionReplacementError({ message: "DECK_NOT_AVAILABLE" }).status, 422);
  assert.equal(getCollectionReplacementError({ code: "42501" }).status, 403);
});

test("unexpected database details never reach collection users", () => {
  for (const code of ["23503", "23505", "23514", "XX000", "P0001", "PGRST202", undefined]) {
    const safe = getCollectionReplacementError({ code, message: "SECRET_TABLE_CONSTRAINT_STACK" });
    assert.equal(safe.status, 500);
    assert.ok(!JSON.stringify(safe).includes("SECRET_TABLE_CONSTRAINT_STACK"));
  }
  assert.equal(getCollectionReplacementError(null).status, 500);
});
