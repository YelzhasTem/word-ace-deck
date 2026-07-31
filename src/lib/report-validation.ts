import { z } from "zod";

export const REPORT_REASON_MIN_LENGTH = 3;
export const REPORT_REASON_MAX_LENGTH = 400;

export const REPORT_REASON_INVALID_MESSAGE = "Enter a valid report reason.";
export const REPORT_REASON_TOO_SHORT_MESSAGE = "Enter at least 3 characters.";
export const REPORT_REASON_TOO_LONG_MESSAGE = "Keep the reason to 400 characters or fewer.";
export const REPORT_REASON_RANGE_MESSAGE = "Enter a reason between 3 and 400 characters.";
export const REPORT_SUBMISSION_FAILED_MESSAGE = "Could not send the report. Please try again.";

function codePointLength(value: string) {
  return Array.from(value).length;
}

export const reportReasonSchema = z
  .string({
    required_error: REPORT_REASON_INVALID_MESSAGE,
    invalid_type_error: REPORT_REASON_INVALID_MESSAGE,
  })
  .transform((value) => value.trim())
  .superRefine((value, context) => {
    const length = codePointLength(value);
    if (length < REPORT_REASON_MIN_LENGTH) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: REPORT_REASON_TOO_SHORT_MESSAGE });
    } else if (length > REPORT_REASON_MAX_LENGTH) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: REPORT_REASON_TOO_LONG_MESSAGE });
    }
  });

export const deckReportInputSchema = z.object({
  deckId: z.string().uuid(),
  reason: reportReasonSchema,
});

export const collectionReportInputSchema = z.object({
  collectionId: z.string().uuid(),
  reason: reportReasonSchema,
});

function validationMessage(result: ReturnType<typeof reportReasonSchema.safeParse>) {
  return result.success ? null : (result.error.issues[0]?.message ?? REPORT_REASON_INVALID_MESSAGE);
}

export function getReportReasonValidationMessage(value: unknown) {
  return validationMessage(reportReasonSchema.safeParse(value));
}

function parseInput<T>(result: { success: true; data: T } | { success: false; error: z.ZodError }) {
  if (result.success) return result.data;
  throw new Error(result.error.issues[0]?.message ?? REPORT_REASON_INVALID_MESSAGE);
}

export function parseDeckReportInput(input: unknown) {
  return parseInput(deckReportInputSchema.safeParse(input));
}

export function parseCollectionReportInput(input: unknown) {
  return parseInput(collectionReportInputSchema.safeParse(input));
}

export function reportDatabaseErrorMessage(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  return code === "23514" ? REPORT_REASON_RANGE_MESSAGE : REPORT_SUBMISSION_FAILED_MESSAGE;
}

const SAFE_CLIENT_MESSAGES = new Set([
  REPORT_REASON_INVALID_MESSAGE,
  REPORT_REASON_TOO_SHORT_MESSAGE,
  REPORT_REASON_TOO_LONG_MESSAGE,
  REPORT_REASON_RANGE_MESSAGE,
  REPORT_SUBMISSION_FAILED_MESSAGE,
]);

export function safeReportClientErrorMessage(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error ? String(error.message) : "";
  return SAFE_CLIENT_MESSAGES.has(message) ? message : REPORT_SUBMISSION_FAILED_MESSAGE;
}
