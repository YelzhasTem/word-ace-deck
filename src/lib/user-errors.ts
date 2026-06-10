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

export function getUserErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return fallback;

  const issues = parseValidationIssues(message);
  if (issues?.length) return describeValidationIssue(issues[0]);

  return message;
}
