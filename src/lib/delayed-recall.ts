import { useEffect, useState } from "react";

// ===== Settings =====
const SETTINGS_KEY = "lingocards.delayedRecall.enabled";

export function isDelayedRecallEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SETTINGS_KEY) === "1";
}

export function setDelayedRecallEnabled(on: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SETTINGS_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event("delayedRecall:changed"));
}

export function useDelayedRecallEnabled(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(false);
  useEffect(() => {
    const sync = () => setOn(isDelayedRecallEnabled());
    sync();
    window.addEventListener("delayedRecall:changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("delayedRecall:changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [on, (v: boolean) => setDelayedRecallEnabled(v)];
}

// ===== Schedule + memory model =====
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Configurable intervals (in ms) for stages 0..5
export const RECALL_INTERVALS = [
  10 * MIN,
  1 * DAY,
  3 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
];

export const RECALL_STAGES = ["Новое", "Учится", "Запомнено", "Уверенно", "Освоено"] as const;
export type RecallStageIdx = 0 | 1 | 2 | 3 | 4;

export type RecallEntry = {
  cardId: string;
  deckId: string;
  score: number; // 0..100
  stageIdx: RecallStageIdx;
  intervalIdx: number; // index into RECALL_INTERVALS
  due: number; // ms timestamp
  correct: number;
  wrong: number;
  createdAt: number;
  lastReview?: number;
};

const STATE_KEY = "lingocards.delayedRecall.state.v1";
type State = Record<string, RecallEntry>; // key = `${deckId}:${cardId}`

function loadState(): State {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}"); } catch { return {}; }
}
function saveState(s: State) {
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
  window.dispatchEvent(new Event("delayedRecall:changed"));
}
const k = (d: string, c: string) => `${d}:${c}`;

function stageFromScore(score: number): RecallStageIdx {
  if (score >= 90) return 4;
  if (score >= 70) return 3;
  if (score >= 45) return 2;
  if (score > 0) return 1;
  return 0;
}

export function scheduleNewCard(deckId: string, cardId: string) {
  if (!isDelayedRecallEnabled()) return;
  const state = loadState();
  const key = k(deckId, cardId);
  if (state[key]) return;
  state[key] = {
    cardId, deckId,
    score: 0,
    stageIdx: 0,
    intervalIdx: 0,
    due: Date.now() + RECALL_INTERVALS[0],
    correct: 0, wrong: 0,
    createdAt: Date.now(),
  };
  saveState(state);
}

export function recordRecallAnswer(deckId: string, cardId: string, correct: boolean) {
  const state = loadState();
  const key = k(deckId, cardId);
  const e: RecallEntry = state[key] ?? {
    cardId, deckId, score: 0, stageIdx: 0, intervalIdx: 0,
    due: Date.now(), correct: 0, wrong: 0, createdAt: Date.now(),
  };
  if (correct) {
    e.correct += 1;
    e.score = Math.min(100, e.score + 15);
    e.intervalIdx = Math.min(RECALL_INTERVALS.length - 1, e.intervalIdx + 1);
  } else {
    e.wrong += 1;
    e.score = Math.max(0, e.score - 20);
    e.intervalIdx = 0; // earlier review
  }
  e.stageIdx = stageFromScore(e.score);
  e.lastReview = Date.now();
  e.due = Date.now() + RECALL_INTERVALS[e.intervalIdx];
  state[key] = e;
  saveState(state);
}

export function getDeckRecall(deckId: string): RecallEntry[] {
  const state = loadState();
  return Object.values(state).filter((e) => e.deckId === deckId);
}

export function dueRecallEntries(deckId: string): RecallEntry[] {
  const now = Date.now();
  return getDeckRecall(deckId).filter((e) => e.due <= now);
}

export function upcomingRecallEntries(deckId: string): RecallEntry[] {
  const now = Date.now();
  return getDeckRecall(deckId)
    .filter((e) => e.due > now)
    .sort((a, b) => a.due - b.due);
}

export type RecallSummary = {
  ready: number;
  upcoming: number;
  mastered: number;
  retention: number | null; // percent or null
  total: number;
};

export function summariseRecall(deckId: string): RecallSummary {
  const entries = getDeckRecall(deckId);
  const now = Date.now();
  const ready = entries.filter((e) => e.due <= now).length;
  const upcoming = entries.filter((e) => e.due > now).length;
  const mastered = entries.filter((e) => e.stageIdx === 4).length;
  const totalAns = entries.reduce((s, e) => s + e.correct + e.wrong, 0);
  const totalCorrect = entries.reduce((s, e) => s + e.correct, 0);
  const retention = totalAns > 0 ? Math.round((totalCorrect / totalAns) * 100) : null;
  return { ready, upcoming, mastered, retention, total: entries.length };
}

export function useDeckRecallSummary(deckId: string): RecallSummary {
  const [s, setS] = useState<RecallSummary>(() => ({ ready: 0, upcoming: 0, mastered: 0, retention: null, total: 0 }));
  useEffect(() => {
    const reload = () => setS(summariseRecall(deckId));
    reload();
    const id = window.setInterval(reload, 30000);
    window.addEventListener("delayedRecall:changed", reload);
    window.addEventListener("storage", reload);
    return () => {
      clearInterval(id);
      window.removeEventListener("delayedRecall:changed", reload);
      window.removeEventListener("storage", reload);
    };
  }, [deckId]);
  return s;
}

export function formatDueIn(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "сейчас";
  if (diff < HOUR) return `через ${Math.max(1, Math.round(diff / MIN))} мин`;
  if (diff < DAY) return `через ${Math.round(diff / HOUR)} ч`;
  return `через ${Math.round(diff / DAY)} д`;
}
