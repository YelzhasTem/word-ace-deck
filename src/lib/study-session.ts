import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type StudyMode = "study" | "type" | "reverse" | "speed" | "recall" | "assoc";

type SessionHandle = {
  id: string;
  deckId: string;
  mode: StudyMode;
  durationSeconds?: 30 | 60 | 120;
};

export type StudyAnswerResult =
  Database["public"]["Functions"]["record_study_answer"]["Returns"][number];

export type CompletedStudySession =
  Database["public"]["Functions"]["complete_study_session"]["Returns"][number];

const sessions = new Map<string, Promise<SessionHandle>>();
const queues = new Map<string, Promise<unknown>>();
const completions = new Map<string, Promise<CompletedStudySession>>();

function sessionKey(deckId: string, mode: StudyMode) {
  return `${deckId}:${mode}`;
}

function newKey() {
  return crypto.randomUUID();
}

async function createSession(
  deckId: string,
  mode: StudyMode,
  durationSeconds?: 30 | 60 | 120,
): Promise<SessionHandle> {
  const { data, error } = await supabase
    .rpc("start_study_session", {
      p_client_session_key: newKey(),
      p_deck_id: deckId,
      p_mode: mode,
      p_duration_seconds: durationSeconds,
    })
    .single();

  if (error) throw new Error(error.message);
  return { id: data.session_id, deckId, mode, durationSeconds };
}

export function beginStudySession(
  deckId: string,
  mode: StudyMode,
  durationSeconds?: 30 | 60 | 120,
) {
  const key = sessionKey(deckId, mode);
  const session = createSession(deckId, mode, durationSeconds);
  sessions.set(key, session);
  queues.set(key, Promise.resolve());
  completions.delete(key);
  return session;
}

function ensureStudySession(deckId: string, mode: StudyMode, durationSeconds?: 30 | 60 | 120) {
  const key = sessionKey(deckId, mode);
  const existing = sessions.get(key);
  if (existing) return existing;
  return beginStudySession(deckId, mode, durationSeconds);
}

function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  queues.set(key, current);
  return current;
}

export function submitStudyAnswer(input: {
  deckId: string;
  cardId: string;
  mode: StudyMode;
  result: boolean;
  responseMs?: number;
  progressKey?: string;
  durationSeconds?: 30 | 60 | 120;
  idempotencyKey?: string;
}): Promise<StudyAnswerResult> {
  const key = sessionKey(input.deckId, input.mode);
  const idempotencyKey = input.idempotencyKey ?? newKey();

  return enqueue(key, async () => {
    const session = await ensureStudySession(input.deckId, input.mode, input.durationSeconds);
    const invoke = () =>
      supabase
        .rpc("record_study_answer", {
          p_idempotency_key: idempotencyKey,
          p_session_id: session.id,
          p_card_id: input.cardId,
          p_result: input.result,
          p_response_ms: input.responseMs,
          p_progress_key: input.progressKey,
        })
        .single();

    let response = await invoke();
    if (response.error && /fetch|network|timeout/i.test(response.error.message)) {
      response = await invoke();
    }
    if (response.error) throw new Error(response.error.message);
    return response.data;
  });
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
    const session = await ensureStudySession(deckId, mode);
    const invoke = () =>
      supabase
        .rpc("complete_study_session", {
          p_session_id: session.id,
          p_completion_key: completionKey,
        })
        .single();

    let response = await invoke();
    if (response.error && /fetch|network|timeout/i.test(response.error.message)) {
      response = await invoke();
    }
    if (response.error) throw new Error(response.error.message);
    return response.data;
  });

  completions.set(key, completion);
  return completion;
}

export function clearStudySession(deckId: string, mode: StudyMode) {
  const key = sessionKey(deckId, mode);
  sessions.delete(key);
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
