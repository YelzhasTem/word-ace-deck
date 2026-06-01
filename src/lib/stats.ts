import { useEffect, useState } from "react";

export type CardStat = {
  correct: number;
  wrong: number;
  lastSeen: number;
  mastery: number; // 0..1
  // SRS upgrade
  stage?: number; // 0=New, 1=Learning, 2=Review, 3=Strong, 4=Mastered
  due?: number; // ms timestamp when next due
  avgMs?: number; // exponential moving avg of response time
  totalMs?: number; // sum of response times
  samples?: number; // # of timed answers
  slowMisses?: number; // wrong OR slow > threshold
};

export type DeckStats = Record<string, CardStat>; // cardId -> stat

const KEY = "lingocards.stats.v1";

function loadAll(): Record<string, DeckStats> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveAll(data: Record<string, DeckStats>) {
  localStorage.setItem(KEY, JSON.stringify(data));
  window.dispatchEvent(new Event("stats:changed"));
}

// Stage names + intervals (ms) for SRS
export const STAGE_NAMES = ["Новое", "Изучение", "Повторение", "Уверенно", "Освоено"] as const;
const STAGE_INTERVALS = [
  1000 * 60 * 10, // New → 10 min
  1000 * 60 * 60 * 8, // Learning → 8 h
  1000 * 60 * 60 * 24 * 2, // Review → 2 d
  1000 * 60 * 60 * 24 * 7, // Strong → 7 d
  1000 * 60 * 60 * 24 * 21, // Mastered → 21 d
];
const SLOW_MS = 8000; // slower than this counts as "slow recall"

function stageFromMastery(m: number): number {
  if (m >= 0.95) return 4;
  if (m >= 0.75) return 3;
  if (m >= 0.45) return 2;
  if (m > 0) return 1;
  return 0;
}

export function recordAnswer(
  deckId: string,
  cardId: string,
  correct: boolean,
  responseMs?: number,
) {
  if (typeof window === "undefined") return;
  const all = loadAll();
  const deck = all[deckId] ?? {};
  const s: CardStat =
    deck[cardId] ?? { correct: 0, wrong: 0, lastSeen: 0, mastery: 0 };

  const slow = typeof responseMs === "number" && responseMs > SLOW_MS;

  if (correct) {
    s.correct += 1;
    // slow correct counts less
    s.mastery = Math.min(1, s.mastery + (slow ? 0.12 : 0.25));
  } else {
    s.wrong += 1;
    s.mastery = Math.max(0, s.mastery - 0.2);
    s.slowMisses = (s.slowMisses ?? 0) + 1;
  }
  if (slow && correct) s.slowMisses = (s.slowMisses ?? 0) + 1;

  if (typeof responseMs === "number" && responseMs > 0) {
    const prev = s.avgMs ?? responseMs;
    s.avgMs = Math.round(prev * 0.7 + responseMs * 0.3);
    s.totalMs = (s.totalMs ?? 0) + responseMs;
    s.samples = (s.samples ?? 0) + 1;
  }

  s.stage = stageFromMastery(s.mastery);
  // due interval; failure resets to learning
  const interval = correct ? STAGE_INTERVALS[s.stage] : STAGE_INTERVALS[0];
  s.due = Date.now() + interval;
  s.lastSeen = Date.now();

  deck[cardId] = s;
  all[deckId] = deck;
  saveAll(all);

  // session log
  logSessionAnswer(deckId, cardId, correct, responseMs);
}

export function getDeckStats(deckId: string): DeckStats {
  return loadAll()[deckId] ?? {};
}

export function useDeckStats(deckId: string) {
  const [stats, setStats] = useState<DeckStats>({});
  useEffect(() => {
    const reload = () => setStats(getDeckStats(deckId));
    reload();
    window.addEventListener("stats:changed", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("stats:changed", reload);
      window.removeEventListener("storage", reload);
    };
  }, [deckId]);
  return stats;
}

export function accuracyFor(stat?: CardStat) {
  if (!stat) return null;
  const total = stat.correct + stat.wrong;
  if (!total) return null;
  return Math.round((stat.correct / total) * 100);
}

export function weakCardIds(deckId: string): string[] {
  const stats = getDeckStats(deckId);
  return Object.entries(stats)
    .filter(([, s]) => (s.wrong > 0 || (s.slowMisses ?? 0) > 1) && s.mastery < 0.6)
    .sort((a, b) => a[1].mastery - b[1].mastery)
    .map(([id]) => id);
}

// SRS due queue: cards whose due timestamp has passed OR never reviewed
export function dueCardIds<T extends { id: string }>(deckId: string, cards: T[]): string[] {
  const stats = getDeckStats(deckId);
  const now = Date.now();
  const due: { id: string; score: number }[] = [];
  for (const c of cards) {
    const s = stats[c.id];
    if (!s) {
      due.push({ id: c.id, score: -1 }); // never seen → top
    } else if ((s.due ?? 0) <= now) {
      // overdue cards first, weighted by low mastery
      due.push({ id: c.id, score: s.mastery + (s.due ?? 0) / 1e13 });
    }
  }
  return due.sort((a, b) => a.score - b.score).map((x) => x.id);
}

// Sort cards prioritising weak ones (used by all modes)
export function prioritise<T extends { id: string }>(deckId: string, cards: T[]): T[] {
  const stats = getDeckStats(deckId);
  return [...cards].sort((a, b) => {
    const ma = stats[a.id]?.mastery ?? 0.5;
    const mb = stats[b.id]?.mastery ?? 0.5;
    return ma - mb;
  });
}

// Simple normalisation: lowercase, trim, strip diacritics, collapse spaces
export function normalise(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,!?;:"'`()\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Levenshtein distance for fuzzy matching
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function isCloseMatch(input: string, expected: string) {
  const got = normalise(input);
  if (!got) return false;
  const variants = expected
    .split(/[,/;]/)
    .map((v) => normalise(v))
    .filter(Boolean);
  for (const v of variants) {
    if (v === got) return true;
    const tol = v.length <= 4 ? 1 : v.length <= 8 ? 2 : 3;
    if (levenshtein(v, got) <= tol) return true;
  }
  return false;
}

// ---------- Session logging (for AI feedback) ----------

const SESSION_KEY = "lingocards.session.v1";
export type SessionAnswer = { deckId: string; cardId: string; correct: boolean; ms?: number; at: number };

function logSessionAnswer(deckId: string, cardId: string, correct: boolean, ms?: number) {
  if (typeof window === "undefined") return;
  let list: SessionAnswer[] = [];
  try { list = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "[]"); } catch { list = []; }
  list.push({ deckId, cardId, correct, ms, at: Date.now() });
  // keep last 500
  if (list.length > 500) list = list.slice(-500);
  localStorage.setItem(SESSION_KEY, JSON.stringify(list));
}

export function getSessionLog(deckId?: string, sinceMs = 1000 * 60 * 60 * 24): SessionAnswer[] {
  if (typeof window === "undefined") return [];
  try {
    const list: SessionAnswer[] = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "[]");
    const cutoff = Date.now() - sinceMs;
    return list.filter((x) => x.at >= cutoff && (!deckId || x.deckId === deckId));
  } catch {
    return [];
  }
}

// ---------- Speed challenge leaderboard ----------
const SPEED_KEY = "lingocards.speed.v1";
export type SpeedRecord = { deckId: string; duration: number; score: number; accuracy: number; at: number };

export function recordSpeedRun(rec: SpeedRecord) {
  if (typeof window === "undefined") return;
  let list: SpeedRecord[] = [];
  try { list = JSON.parse(localStorage.getItem(SPEED_KEY) ?? "[]"); } catch { list = []; }
  list.push(rec);
  list = list.sort((a, b) => b.score - a.score).slice(0, 50);
  localStorage.setItem(SPEED_KEY, JSON.stringify(list));
}

export function getSpeedRecords(deckId?: string): SpeedRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const list: SpeedRecord[] = JSON.parse(localStorage.getItem(SPEED_KEY) ?? "[]");
    return deckId ? list.filter((r) => r.deckId === deckId) : list;
  } catch {
    return [];
  }
}

// ---------- Memory associations ----------
const ASSOC_KEY = "lingocards.assoc.v1";
export type Assoc = { text: string; source: "ai" | "user"; favorite?: boolean; at: number };
type AssocMap = Record<string, Assoc[]>;

function loadAssocs(): AssocMap {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(ASSOC_KEY) ?? "{}"); } catch { return {}; }
}
function saveAssocs(m: AssocMap) {
  localStorage.setItem(ASSOC_KEY, JSON.stringify(m));
  window.dispatchEvent(new Event("assoc:changed"));
}

export function getAssocs(cardId: string): Assoc[] { return loadAssocs()[cardId] ?? []; }
export function addAssoc(cardId: string, a: Assoc) {
  const m = loadAssocs();
  m[cardId] = [a, ...(m[cardId] ?? [])].slice(0, 10);
  saveAssocs(m);
}
export function toggleFavoriteAssoc(cardId: string, idx: number) {
  const m = loadAssocs();
  const list = m[cardId] ?? [];
  if (!list[idx]) return;
  list[idx].favorite = !list[idx].favorite;
  m[cardId] = list;
  saveAssocs(m);
}
export function removeAssoc(cardId: string, idx: number) {
  const m = loadAssocs();
  const list = m[cardId] ?? [];
  list.splice(idx, 1);
  m[cardId] = list;
  saveAssocs(m);
}

export function useAssocs(cardId: string) {
  const [list, setList] = useState<Assoc[]>([]);
  useEffect(() => {
    const reload = () => setList(getAssocs(cardId));
    reload();
    window.addEventListener("assoc:changed", reload);
    return () => window.removeEventListener("assoc:changed", reload);
  }, [cardId]);
  return list;
}
