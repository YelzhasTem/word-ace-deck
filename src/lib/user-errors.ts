type ValidationIssue = {
  code?: string;
  minimum?: number;
  maximum?: number;
  path?: Array<string | number>;
  message?: string;
};

function parseValidationIssues(message: string): ValidationIssue[] | null {
  const trimmed = message.trim();
  const jsonStart = trimmed.indexOf("[");
  const candidate = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    return Array.isArray(parsed) ? (parsed as ValidationIssue[]) : null;
  } catch {
    return null;
  }
}

function describeValidationIssue(issue: ValidationIssue) {
  const path = issue.path?.join(".");

  if (path === "count") {
    if (issue.code === "too_small" && typeof issue.minimum === "number") {
      return `Choose at least ${issue.minimum} words for the deck.`;
    }
    if (issue.code === "too_big" && typeof issue.maximum === "number") {
      return `Choose no more than ${issue.maximum} words for the deck.`;
    }
    return "Choose a valid number of words for the deck.";
  }

  if (path === "cards") {
    if (issue.code === "too_small" && typeof issue.minimum === "number") {
      return `Add at least ${issue.minimum} words to create a deck.`;
    }
    if (issue.code === "too_big" && typeof issue.maximum === "number") {
      return `A deck can have at most ${issue.maximum} cards.`;
    }
  }

  if (issue.message && !issue.message.includes("{") && !issue.message.includes("[")) {
    return issue.message;
  }

  return "Please check the entered values and try again.";
}

const NETWORK_ERROR_RE = /failed to fetch|load failed|networkerror|network request failed/i;
const SESSION_ERROR_RE =
  /^HTTP 401\b|jwt expired|invalid jwt|unauthorized|authentication required/i;

// Browser and transport errors are not written for people; say what happened instead.
function friendlyTransportMessage(message: string) {
  if (NETWORK_ERROR_RE.test(message)) {
    return "No connection to the server. Check your internet connection and try again.";
  }
  if (SESSION_ERROR_RE.test(message)) {
    return "Your session has expired. Please sign in again.";
  }
  return null;
}

export function getUserErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return fallback;

  const issues = parseValidationIssues(message);
  if (issues?.length) return describeValidationIssue(issues[0]);

  return friendlyTransportMessage(message) ?? message.replace(/^HTTP \d{3}:\s*/, "");
}
