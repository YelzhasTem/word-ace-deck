import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { isUuid } from "../src/lib/uuid.ts";

test("accepts database-generated UUIDs", () => {
  for (let i = 0; i < 20; i += 1) assert.equal(isUuid(randomUUID()), true);
  assert.equal(isUuid("3F2504E0-4F89-41D3-9A0C-0305E82C3301"), true);
});

test("rejects malformed ids", () => {
  assert.equal(isUuid(""), false);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid("3f2504e0-4f89-41d3-9a0c0305e82c3301"), false);
  assert.equal(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301-extra"), false);
});
