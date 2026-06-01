import { useEffect, useState } from "react";

export type CardStat = {
  correct: number;
  wrong: number;
  lastSeen: number;
  mastery: number; // 0..1
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

export function recordAnswer(deckId: string, cardId: string, correct: boolean) {
  if (typeof window === "undefined") return;
  const all = loadAll();
  const deck = all[deckId] ?? {};
  const s = deck[cardId] ?? { correct: 0, wrong: 0, lastSeen: 0, mastery: 0 };
  if (correct) {
    s.correct += 1;
    s.mastery = Math.min(1, s.mastery + 0.25);
  } else {
    s.wrong += 1;
    s.mastery = Math.max(0, s.mastery - 0.2);
  }
  s.lastSeen = Date.now();
  deck[cardId] = s;
  all[deckId] = deck;
  saveAll(all);
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
    .filter(([, s]) => s.wrong > 0 && s.mastery < 0.6)
    .sort((a, b) => a[1].mastery - b[1].mastery)
    .map(([id]) => id);
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

// Accepts close answers. Returns true if exact match against any of
// `accepted` (comma-separated variants supported) within a fuzzy threshold.
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

// Speed challenge leaderboard (local)
const SPEED_KEY = "lingocards.speed.v1";
export type SpeedRecord = { deckId: string; duration: number; score: number; accuracy: number; at: number };

export function recordSpeedRun(rec: SpeedRecord) {
  if (typeof window === "undefined") return;
  let list: SpeedRecord[] = [];
  try {
    list = JSON.parse(localStorage.getItem(SPEED_KEY) ?? "[]");
  } catch {
    list = [];
  }
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

// Memory associations (user + AI saved)
const ASSOC_KEY = "lingocards.assoc.v1";
export type Assoc = { text: string; source: "ai" | "user"; favorite?: boolean; at: number };
type AssocMap = Record<string, Assoc[]>; // cardId -> list

function loadAssocs(): AssocMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(ASSOC_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function saveAssocs(m: AssocMap) {
  localStorage.setItem(ASSOC_KEY, JSON.stringify(m));
  window.dispatchEvent(new Event("assoc:changed"));
}

export function getAssocs(cardId: string): Assoc[] {
  return loadAssocs()[cardId] ?? [];
}
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
