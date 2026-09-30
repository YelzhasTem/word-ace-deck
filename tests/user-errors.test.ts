import assert from "node:assert/strict";
import { test } from "node:test";
import { getUserErrorMessage } from "../src/lib/user-errors.ts";

test("maps network failures to a readable message", () => {
  assert.match(getUserErrorMessage(new TypeError("Load failed"), "x"), /No connection/);
  assert.match(getUserErrorMessage(new TypeError("Failed to fetch"), "x"), /No connection/);
});

test("maps expired sessions to a sign-in message", () => {
  assert.match(
    getUserErrorMessage(new Error("HTTP 401: Unauthorized"), "x"),
    /session has expired/,
  );
  assert.match(getUserErrorMessage(new Error("JWT expired"), "x"), /session has expired/);
});

test("strips the HTTP status prefix from server messages", () => {
  assert.equal(
    getUserErrorMessage(new Error("HTTP 409: This deck was already copied."), "x"),
    "This deck was already copied.",
  );
});

test("keeps plain messages and falls back when empty", () => {
  assert.equal(
    getUserErrorMessage(new Error("Deck name is required."), "x"),
    "Deck name is required.",
  );
  assert.equal(getUserErrorMessage(null, "Fallback"), "Fallback");
});
