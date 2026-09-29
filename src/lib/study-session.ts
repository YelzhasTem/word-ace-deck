import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type StudyMode = "study" | "type" | "reverse" | "speed" | "recall" | "assoc" | "deep";
export type StudyDirection = "term_to_definition" | "definition_to_term";
export type TextStudyMode = "type" | "recall";
export type MultipleChoiceStudyMode = "speed" | "deep";
export type SelfReportedStudyMode = "study" | "reverse" | "assoc";

type SessionHandle = {
  id: string;
  deckId: string;
  mode: StudyMode;
  durationSeconds?: 30 | 60 | 120;
};

export type StudyQuestionOption = { id: string; text: string };

export type IssuedStudyQuestion = {
  id: string;
  cardId: string;
  prompt: string;
  answerKind: "text" | "multiple_choice" | "self_reported";
  verificationType: "server_verified" | "self_reported";
  direction: StudyDirection;
  cardVersion: string;
  options: StudyQuestionOption[];
};

export type StudyAnswerResult =
  Database["public"]["Functions"]["record_study_answer"]["Returns"][number];

export type CompletedStudySession =
  Database["public"]["Functions"]["complete_study_session"]["Returns"][number];

const sessions = new Map<string, Promise<SessionHandle>>();
// Cards the server snapshotted when each cached session started, so a session
// is replaced when cards are added, removed or edited after it began.
const sessionContentVersions = new Map<string, string>();
const queues = new Map<string, Promise<unknown>>();
const completions = new Map<string, Promise<CompletedStudySession>>();

function sessionKey(deckId: string, mode: StudyMode) {
  return `${deckId}:${mode}`;
}

/** A cheap fingerprint of the cards a session is started with. */
export function studyContentVersion(cards: { id: string; term: string; definition: string }[]) {
  let hash = 0;
  for (const card of cards) {
    const text = `${card.id}\u0000${card.term}\u0000${card.definition}\u0001`;
    for (let i = 0; i < text.length; i += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  }
  return `${cards.length}:${hash >>> 0}`;
}

function newKey() {
  return crypto.randomUUID();
}

function isRetryable(message: string) {
  return /fetch|network|timeout|connection|load failed/i.test(message);
}

async function createSession(
  deckId: string,
  mode: StudyMode,
  durationSeconds?: 30 | 60 | 120,
): Promise<SessionHandle> {
  const clientSessionKey = newKey();
  const invoke = () =>
    supabase
      .rpc("start_study_session", {
        p_client_session_key: clientSessionKey,
        p_deck_id: deckId,
        p_mode: mode,
        p_duration_seconds: durationSeconds,
      })
      .single();

  let response = await invoke();
  if (response.error && isRetryable(response.error.message)) response = await invoke();
  if (response.error) throw new Error(response.error.message);
  return { id: response.data.session_id, deckId, mode, durationSeconds };
}

export function beginStudySession(
  deckId: string,
  mode: StudyMode,
  durationSeconds?: 30 | 60 | 120,
  contentVersion?: string,
) {
  const key = sessionKey(deckId, mode);
  const session = createSession(deckId, mode, durationSeconds);
  sessions.set(key, session);
  if (contentVersion) sessionContentVersions.set(key, contentVersion);
  else sessionContentVersions.delete(key);
  queues.set(key, Promise.resolve());
  completions.delete(key);
  // Do not cache a failed start: the next attempt should try again.
  session.catch(() => {
    if (sessions.get(key) === session) {
      sessions.delete(key);
      sessionContentVersions.delete(key);
    }
  });
  return session;
}

/**
 * Returns the cached session for this deck and mode, or starts one. Pass
 * contentVersion (see studyContentVersion) from pages that know the current
 * cards, so a session started before cards changed is replaced.
 */
export function prepareStudySession(
  deckId: string,
  mode: StudyMode,
  durationSeconds?: 30 | 60 | 120,
  contentVersion?: string,
) {
  const key = sessionKey(deckId, mode);
  const existing = sessions.get(key);
  const stale =
    contentVersion !== undefined &&
    sessionContentVersions.has(key) &&
    sessionContentVersions.get(key) !== contentVersion;
  if (existing && !stale) {
    if (contentVersion && !sessionContentVersions.has(key)) {
      sessionContentVersions.set(key, contentVersion);
    }
    return existing;
  }
  return beginStudySession(deckId, mode, durationSeconds, contentVersion);
}

function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  queues.set(key, current);
  return current;
}

function isQuestionOption(value: unknown): value is StudyQuestionOption {
  if (!value || typeof value !== "object") return false;
  return (
    "id" in value &&
    "text" in value &&
    typeof value.id === "string" &&
    typeof value.text === "string"
  );
}

function isAnswerKind(value: string): value is IssuedStudyQuestion["answerKind"] {
  return value === "text" || value === "multiple_choice" || value === "self_reported";
}

function isVerificationType(value: string): value is IssuedStudyQuestion["verificationType"] {
  return value === "server_verified" || value === "self_reported";
}

function isStudyDirection(value: string): value is StudyDirection {
  return value === "term_to_definition" || value === "definition_to_term";
}

function parseQuestion(
  row: Database["public"]["Functions"]["issue_study_question"]["Returns"][number],
): IssuedStudyQuestion {
  if (
    !isAnswerKind(row.answer_kind) ||
    !isVerificationType(row.verification_type) ||
    !isStudyDirection(row.question_direction)
  ) {
    throw new Error("The server returned an unsupported study question");
  }

  const options = Array.isArray(row.options) ? row.options.filter(isQuestionOption) : [];
  if (row.answer_kind === "multiple_choice" && options.length < 2) {
    throw new Error("The server returned an incomplete multiple-choice question");
  }

  return {
    id: row.question_id,
    cardId: row.question_card_id,
    prompt: row.prompt_text,
    answerKind: row.answer_kind,
    verificationType: row.verification_type,
    direction: row.question_direction,
    cardVersion: row.card_version,
    options,
  };
}

export async function issueStudyQuestion(input: {
  deckId: string;
  cardId: string;
  mode: StudyMode;
  direction: StudyDirection;
  durationSeconds?: 30 | 60 | 120;
  questionKey?: string;
}): Promise<IssuedStudyQuestion> {
  const questionKey = input.questionKey ?? newKey();
  const session = await prepareStudySession(input.deckId, input.mode, input.durationSeconds);
  const invoke = () =>
    supabase
      .rpc("issue_study_question", {
        p_client_question_key: questionKey,
        p_session_id: session.id,
        p_card_id: input.cardId,
        p_direction: input.direction,
      })
      .single();

  let response = await invoke();
  if (response.error && isRetryable(response.error.message)) response = await invoke();
  if (response.error) throw new Error(response.error.message);
  return parseQuestion(response.data);
}

async function recordIssuedAnswer(input: {
  deckId: string;
  mode: StudyMode;
  question: IssuedStudyQuestion;
  submittedAnswer?: string;
  selectedOptionId?: string;
  selfReportedResult?: boolean;
  responseMs?: number;
  idempotencyKey?: string;
}): Promise<StudyAnswerResult> {
  const key = sessionKey(input.deckId, input.mode);
  const idempotencyKey = input.idempotencyKey ?? newKey();

  return enqueue(key, async () => {
    const invoke = () =>
      supabase
        .rpc("record_study_answer", {
          p_idempotency_key: idempotencyKey,
          p_question_id: input.question.id,
          p_submitted_answer: input.submittedAnswer,
          p_selected_option_id: input.selectedOptionId,
          p_self_reported_result: input.selfReportedResult,
          p_response_ms: input.responseMs,
        })
        .single();

    let response = await invoke();
    if (response.error && isRetryable(response.error.message)) response = await invoke();
    if (response.error) throw new Error(response.error.message);
    return response.data;
  });
}

export async function submitTextStudyAnswer(input: {
  deckId: string;
  cardId: string;
  mode: TextStudyMode;
  direction: StudyDirection;
  submittedAnswer: string;
  responseMs?: number;
  questionKey?: string;
  idempotencyKey?: string;
}) {
  const question = await issueStudyQuestion(input);
  if (question.answerKind !== "text" || question.verificationType !== "server_verified") {
    throw new Error("The server did not issue a server-verified text question");
  }
  return recordIssuedAnswer({
    ...input,
    question,
    submittedAnswer: input.submittedAnswer,
  });
}

export function submitMultipleChoiceStudyAnswer(input: {
  deckId: string;
  mode: MultipleChoiceStudyMode;
  question: IssuedStudyQuestion;
  selectedOptionId: string;
  responseMs?: number;
  idempotencyKey?: string;
}) {
  if (
    input.question.answerKind !== "multiple_choice" ||
    input.question.verificationType !== "server_verified"
  ) {
    return Promise.reject(new Error("The question is not server-verified multiple choice"));
  }
  return recordIssuedAnswer(input);
}

export async function submitSelfReportedStudyAnswer(input: {
  deckId: string;
  cardId: string;
  mode: SelfReportedStudyMode;
  direction: StudyDirection;
  selfReportedResult: boolean;
  responseMs?: number;
  questionKey?: string;
  idempotencyKey?: string;
}) {
  const question = await issueStudyQuestion(input);
  if (question.answerKind !== "self_reported" || question.verificationType !== "self_reported") {
    throw new Error("The server did not issue a self-reported question");
  }
  return recordIssuedAnswer({ ...input, question });
}

export function completeStudySession(
  deckId: string,
  mode: StudyMode,
): Promise<CompletedStudySession> {
  const key = sessionKey(deckId, mode);
  const existing = completions.get(key);
  if (existing) return existing;

  const completionKey = newKey();
  const completion = enqueue(key, async () => {
    const session = await prepareStudySession(deckId, mode);
    const invoke = () =>
      supabase
        .rpc("complete_study_session", {
          p_session_id: session.id,
          p_completion_key: completionKey,
        })
        .single();

    let response = await invoke();
    if (response.error && isRetryable(response.error.message)) response = await invoke();
    if (response.error) throw new Error(response.error.message);
    return response.data;
  });

  completions.set(key, completion);
  completion.catch(() => {
    if (completions.get(key) === completion) completions.delete(key);
  });
  return completion;
}

export function clearStudySession(deckId: string, mode: StudyMode) {
  const key = sessionKey(deckId, mode);
  sessions.delete(key);
  sessionContentVersions.delete(key);
  queues.delete(key);
  completions.delete(key);
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    sessions.clear();
    queues.clear();
    completions.clear();
  }
});
