import assert from "node:assert/strict";
import { test } from "node:test";
import { getMarketplaceError } from "../src/lib/marketplace-errors.ts";

test("marketplace authorization failures have fixed safe statuses", () => {
  assert.equal(getMarketplaceError({ message: "UNAUTHENTICATED" }).status, 401);
  assert.equal(getMarketplaceError({ code: "42501", message: "private SQL details" }).status, 403);
});

test("marketplace missing items, conflicts and invalid input are distinct", () => {
  assert.equal(getMarketplaceError({ message: "REPORT_NOT_FOUND" }).status, 404);
  assert.equal(getMarketplaceError({ code: "PGRST116" }).status, 404);
  assert.equal(getMarketplaceError({ code: "23505" }).status, 409);
  assert.equal(getMarketplaceError({ code: "22023" }).status, 422);
  assert.equal(getMarketplaceError({ code: "23514" }).status, 422);
});

test("no database details or unexpected messages escape the error map", () => {
  for (const code of ["42501", "23505", "23514", "XX000", "PGRST202", undefined]) {
    const safe = getMarketplaceError({ code, message: "SECRET_SQL_INTERNALS" });
    assert.ok(!JSON.stringify(safe).includes("SECRET_SQL_INTERNALS"));
  }
  assert.equal(getMarketplaceError(null).status, 500);
});
