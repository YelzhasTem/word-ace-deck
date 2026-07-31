import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCollectionReportInput,
  parseDeckReportInput,
  REPORT_REASON_INVALID_MESSAGE,
  REPORT_REASON_RANGE_MESSAGE,
  REPORT_REASON_TOO_LONG_MESSAGE,
  REPORT_REASON_TOO_SHORT_MESSAGE,
  REPORT_SUBMISSION_FAILED_MESSAGE,
  reportDatabaseErrorMessage,
  safeReportClientErrorMessage,
} from "../src/lib/report-validation.ts";

const COLLECTION_ID = "85000000-0000-4000-8000-000000000001";
const DECK_ID = "83000000-0000-4000-8000-000000000001";

test("collection report reasons are trimmed and accept documented boundaries", () => {
  assert.equal(
    parseCollectionReportInput({ collectionId: COLLECTION_ID, reason: "  abc  " }).reason,
    "abc",
  );
  assert.equal(
    parseCollectionReportInput({ collectionId: COLLECTION_ID, reason: "Misleading title" }).reason,
    "Misleading title",
  );
  assert.equal(
    parseCollectionReportInput({ collectionId: COLLECTION_ID, reason: "界".repeat(400) }).reason,
    "界".repeat(400),
  );
});

test("report length counts Unicode code points consistently with PostgreSQL", () => {
  assert.equal(
    parseCollectionReportInput({ collectionId: COLLECTION_ID, reason: "😀😀😀" }).reason,
    "😀😀😀",
  );
  assert.equal(parseDeckReportInput({ deckId: DECK_ID, reason: "理由です" }).reason, "理由です");
});

test("direct server input rejects empty, blank, short, and oversized reasons", () => {
  for (const reason of ["", "   ", "x", "no"]) {
    assert.throws(
      () => parseCollectionReportInput({ collectionId: COLLECTION_ID, reason }),
      new RegExp(REPORT_REASON_TOO_SHORT_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }

  assert.throws(
    () => parseCollectionReportInput({ collectionId: COLLECTION_ID, reason: "x".repeat(401) }),
    new RegExp(REPORT_REASON_TOO_LONG_MESSAGE),
  );
});

test("direct server input rejects null and non-string reasons", () => {
  for (const reason of [null, 123, {}, ["valid-looking"]]) {
    assert.throws(
      () => parseCollectionReportInput({ collectionId: COLLECTION_ID, reason }),
      new RegExp(REPORT_REASON_INVALID_MESSAGE),
    );
  }
});

test("database failures are reduced to safe user-facing messages", () => {
  const constraintError = {
    code: "23514",
    message: 'new row violates check constraint "collection_reports_reason_check"',
  };
  assert.equal(reportDatabaseErrorMessage(constraintError), REPORT_REASON_RANGE_MESSAGE);
  assert.equal(
    reportDatabaseErrorMessage({ code: "XX000", message: "internal database details" }),
    REPORT_SUBMISSION_FAILED_MESSAGE,
  );
  assert.equal(
    safeReportClientErrorMessage(new Error(constraintError.message)),
    REPORT_SUBMISSION_FAILED_MESSAGE,
  );
  assert.doesNotMatch(reportDatabaseErrorMessage(constraintError), /constraint|postgres|sql/i);
});
