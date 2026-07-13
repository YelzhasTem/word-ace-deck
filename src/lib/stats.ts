import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { accountLearningDb } from "@/lib/account-learning-db";

export type CardStat = {
  correct: number;
  wrong: number;
  lastSeen: number;
  mastery: number;
  stage?: number;
  due?: number;
  avgMs?: number;
  totalMs?: number;
  samples?: number;
  slowMisses?: number;
};

export type DeckStats = Record<string, CardStat>;

const LEGACY_STATS_KEY = "lingocards.stats.v1";
const LEGACY_SESSION_KEY = "lingocards.session.v1";
const LEGACY_SPEED_KEY = "lingocards.speed.v1";
const LEGACY_ASSOC_KEY = "lingocards.assoc.v1";
const MIGRATION_KEY = "lingocards.accountLearningMigrated.v1";
const SLOW_MS = 8000;

const statsCache: Record<string, DeckStats> = {};
let sessionCache: SessionAnswer[] = [];
let speedCache: SpeedRecord[] = [];
let assocCache: AssocMap = {};
let migrationStarted = false;

export const STAGE_NAMES = ["New", "Learning", "Reviewing", "Confident", "Mastered"] as const;
const STAGE_INTERVALS = [
  1000 * 60 * 10,
  1000 * 60 * 60 * 8,
  1000 * 60 * 60 * 24 * 2,
  1000 * 60 * 60 * 24 * 7,
  1000 * 60 * 60 * 24 * 21,
];

function stageFromMastery(m: number): number {
  if (m >= 0.95) return 4;
  if (m >= 0.75) return 3;
  if (m >= 0.45) return 2;
  if (m > 0) return 1;
  return 0;
}

function dispatch(name: "stats:changed" | "speed:changed" | "assoc:changed" | "session:changed") {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}

function isoFromMs(ms?: number) {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toISOString()
    : null;
}

function msFromIso(value?: string | null) {
  return value ? new Date(value).getTime() : undefined;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

function safeJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function rowToStat(row: {
  correct_count?: number;
  wrong_count?: number;
  last_seen_at?: string | null;
  mastery?: number | string;
  stage?: number;
  due_at?: string | null;
  avg_ms?: number | null;
  total_ms?: number | null;
  samples?: number | null;
  slow_misses?: number | null;
}): CardStat {
  return {
    correct: row.correct_count ?? 0,
    wrong: row.wrong_count ?? 0,
    lastSeen: msFromIso(row.last_seen_at) ?? 0,
    mastery: Number(row.mastery ?? 0),
    stage: row.stage ?? 0,
    due: msFromIso(row.due_at),
    avgMs: row.avg_ms ?? undefined,
    totalMs: row.total_ms ?? undefined,
    samples: row.samples ?? undefined,
    slowMisses: row.slow_misses ?? 0,
  };
}

function statToRow(userId: string, deckId: string, cardKey: string, stat: CardStat) {
  const mastery = Number.isFinite(Number(stat.mastery)) ? Number(stat.mastery) : 0;
  return {
    user_id: userId,
    deck_id: deckId,
    card_key: cardKey,
    card_id: isUuid(cardKey) ? cardKey : null,
    correct_count: stat.correct ?? 0,
    wrong_count: stat.wrong ?? 0,
    mastery,
    stage: stat.stage ?? stageFromMastery(mastery),
    due_at: isoFromMs(stat.due),
    avg_ms: stat.avgMs ?? null,
    total_ms: stat.totalMs ?? null,
    samples: stat.samples ?? null,
    slow_misses: stat.slowMisses ?? 0,
    last_seen_at: isoFromMs(stat.lastSeen),
    updated_at: new Date().toISOString(),
  };
}

async function migrateLegacyLearningData(userId: string) {
  if (typeof window === "undefined" || migrationStarted) return;
  if (localStorage.getItem(MIGRATION_KEY) === userId) return;
  migrationStarted = true;

  try {
    const legacyStats = safeJson<Record<string, DeckStats>>(LEGACY_STATS_KEY, {});
    const progressRows = Object.entries(legacyStats)
      .filter(([deckId]) => isUuid(deckId))
      .flatMap(([deckId, deckStats]) =>
        Object.entries(deckStats).map(([cardKey, stat]) =>
          statToRow(userId, deckId, cardKey, stat),
        ),
      );
    if (progressRows.length > 0) {
      const { error } = await accountLearningDb()
        .from("card_progress")
        .upsert(progressRows, { onConflict: "user_id,deck_id,card_key" });
      if (error) throw new Error(error.message);
    }

    const legacySessions = safeJson<SessionAnswer[]>(LEGACY_SESSION_KEY, []);
    const sessionRows = legacySessions
      .filter((event) => isUuid(event.deckId))
      .slice(-500)
      .map((event) => ({
        user_id: userId,
        deck_id: event.deckId,
        card_key: event.cardId,
        card_id: isUuid(event.cardId) ? event.cardId : null,
        correct: event.correct,
        response_ms: event.ms ?? null,
        answered_at: new Date(event.at).toISOString(),
      }));
    if (sessionRows.length > 0) {
      const { error } = await accountLearningDb().from("study_events").insert(sessionRows);
      if (error) throw new Error(error.message);
    }

    const legacySpeed = safeJson<SpeedRecord[]>(LEGACY_SPEED_KEY, []);
    const speedRows = legacySpeed
      .filter((run) => isUuid(run.deckId))
      .slice(-50)
      .map((run) => ({
        user_id: userId,
        deck_id: run.deckId,
        duration: run.duration,
        score: run.score,
        accuracy: run.accuracy,
        created_at: new Date(run.at).toISOString(),
      }));
    if (speedRows.length > 0) {
      const { error } = await accountLearningDb().from("speed_runs").insert(speedRows);
      if (error) throw new Error(error.message);
    }

    const legacyAssocs = safeJson<AssocMap>(LEGACY_ASSOC_KEY, {});
    const assocRows = Object.entries(legacyAssocs).flatMap(([cardId, list]) =>
      isUuid(cardId)
        ? list.map((assoc) => ({
            user_id: userId,
            card_id: cardId,
            text: assoc.text,
            source: assoc.source,
            favorite: assoc.favorite ?? false,
            created_at: new Date(assoc.at).toISOString(),
          }))
        : [],
    );
    if (assocRows.length > 0) {
      const { error } = await accountLearningDb().from("card_associations").insert(assocRows);
      if (error) throw new Error(error.message);
    }

    localStorage.setItem(MIGRATION_KEY, userId);
  } finally {
    migrationStarted = false;
  }
}

async function ensureMigrated() {
  const userId = await getUserId();
  if (!userId) return null;
  try {
    await migrateLegacyLearningData(userId);
  } catch (error) {
    console.warn("[Learning] Legacy migration skipped:", error);
  }
  return userId;
}

export async function hydrateDeckStats(deckId: string) {
  const userId = await ensureMigrated();
  if (!userId) {
    statsCache[deckId] = {};
    dispatch("stats:changed");
    return;
  }
  const { data, error } = await accountLearningDb()
    .from("card_progress")
    .select(
      "card_key, correct_count, wrong_count, last_seen_at, mastery, stage, due_at, avg_ms, total_ms, samples, slow_misses",
    )
    .eq("user_id", userId)
    .eq("deck_id", deckId);
  if (error) {
    console.warn("[Learning] Could not load progress:", error.message);
    return;
  }
  statsCache[deckId] = {};
  for (const row of data ?? []) {
    statsCache[deckId][row.card_key] = rowToStat(row);
  }
  dispatch("stats:changed");
}

export function recordAnswer(
  deckId: string,
  cardId: string,
  correct: boolean,
  responseMs?: number,
) {
  if (typeof window === "undefined") return;
  const deck = statsCache[deckId] ?? {};
  const s: CardStat = deck[cardId] ?? { correct: 0, wrong: 0, lastSeen: 0, mastery: 0 };
  const slow = typeof responseMs === "number" && responseMs > SLOW_MS;

  if (correct) {
    s.correct += 1;
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
  s.due = Date.now() + (correct ? STAGE_INTERVALS[s.stage] : STAGE_INTERVALS[0]);
  s.lastSeen = Date.now();
  deck[cardId] = s;
  statsCache[deckId] = deck;

  const event: SessionAnswer = { deckId, cardId, correct, ms: responseMs, at: Date.now() };
  sessionCache = [...sessionCache, event].slice(-500);
  dispatch("stats:changed");
  dispatch("session:changed");

  void (async () => {
    const userId = await ensureMigrated();
    if (!userId) return;
    const { error: progressError } = await accountLearningDb()
      .from("card_progress")
      .upsert(statToRow(userId, deckId, cardId, s), { onConflict: "user_id,deck_id,card_key" });
    if (progressError) console.warn("[Learning] Could not save progress:", progressError.message);

    const { error: eventError } = await accountLearningDb()
      .from("study_events")
      .insert({
        user_id: userId,
        deck_id: deckId,
        card_key: cardId,
        card_id: isUuid(cardId) ? cardId : null,
        correct,
        response_ms: responseMs ?? null,
        answered_at: new Date(event.at).toISOString(),
      });
    if (eventError) console.warn("[Learning] Could not save study event:", eventError.message);
  })();
}

export function getDeckStats(deckId: string): DeckStats {
  return statsCache[deckId] ?? {};
}

export function useDeckStats(deckId: string) {
  const [stats, setStats] = useState<DeckStats>({});
  useEffect(() => {
    const reload = () => setStats({ ...getDeckStats(deckId) });
    setStats({});
    void hydrateDeckStats(deckId);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void hydrateDeckStats(deckId);
      }
    });
    window.addEventListener("stats:changed", reload);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("stats:changed", reload);
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

export function dueCardIds<T extends { id: string }>(deckId: string, cards: T[]): string[] {
  const stats = getDeckStats(deckId);
  const now = Date.now();
  const due: { id: string; score: number }[] = [];
  for (const c of cards) {
    const s = stats[c.id];
    if (!s) due.push({ id: c.id, score: -1 });
    else if ((s.due ?? 0) <= now) due.push({ id: c.id, score: s.mastery + (s.due ?? 0) / 1e13 });
  }
  return due.sort((a, b) => a.score - b.score).map((x) => x.id);
}

export function prioritise<T extends { id: string }>(deckId: string, cards: T[]): T[] {
  const stats = getDeckStats(deckId);
  return [...cards].sort((a, b) => {
    const ma = stats[a.id]?.mastery ?? 0.5;
    const mb = stats[b.id]?.mastery ?? 0.5;
    return ma - mb;
  });
}

export function normalise(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,!?;:"'`()[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

export type SessionAnswer = {
  deckId: string;
  cardId: string;
  correct: boolean;
  ms?: number;
  at: number;
};

export async function hydrateSessionLog(deckId?: string, sinceMs = 1000 * 60 * 60 * 24) {
  const userId = await ensureMigrated();
  if (!userId) {
    sessionCache = [];
    dispatch("session:changed");
    return;
  }
  const cutoff = new Date(Date.now() - sinceMs).toISOString();
  let query = accountLearningDb()
    .from("study_events")
    .select("deck_id, card_key, correct, response_ms, answered_at")
    .eq("user_id", userId)
    .gte("answered_at", cutoff)
    .order("answered_at", { ascending: true });
  if (deckId) query = query.eq("deck_id", deckId);
  const { data, error } = await query;
  if (error) {
    console.warn("[Learning] Could not load study events:", error.message);
    return;
  }
  sessionCache = (data ?? []).map(
    (row: {
      deck_id: string;
      card_key: string;
      correct: boolean;
      response_ms?: number | null;
      answered_at: string;
    }) => ({
      deckId: row.deck_id,
      cardId: row.card_key,
      correct: row.correct,
      ms: row.response_ms ?? undefined,
      at: new Date(row.answered_at).getTime(),
    }),
  );
  dispatch("session:changed");
}

export function getSessionLog(deckId?: string, sinceMs = 1000 * 60 * 60 * 24): SessionAnswer[] {
  const cutoff = Date.now() - sinceMs;
  return sessionCache.filter((x) => x.at >= cutoff && (!deckId || x.deckId === deckId));
}

export function useSessionLog(deckId?: string, sinceMs = 1000 * 60 * 60 * 24) {
  const [list, setList] = useState<SessionAnswer[]>([]);
  useEffect(() => {
    const reload = () => setList(getSessionLog(deckId, sinceMs));
    setList([]);
    void hydrateSessionLog(deckId, sinceMs);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void hydrateSessionLog(deckId, sinceMs);
      }
    });
    window.addEventListener("session:changed", reload);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("session:changed", reload);
    };
  }, [deckId, sinceMs]);
  return list;
}

export type SpeedRecord = {
  deckId: string;
  duration: number;
  score: number;
  accuracy: number;
  at: number;
};

export function recordSpeedRun(rec: SpeedRecord) {
  if (typeof window === "undefined") return;
  speedCache = [...speedCache, rec].sort((a, b) => b.score - a.score).slice(0, 50);
  dispatch("speed:changed");

  void (async () => {
    const userId = await ensureMigrated();
    if (!userId) return;
    const { error } = await accountLearningDb()
      .from("speed_runs")
      .insert({
        user_id: userId,
        deck_id: rec.deckId,
        duration: rec.duration,
        score: rec.score,
        accuracy: rec.accuracy,
        created_at: new Date(rec.at).toISOString(),
      });
    if (error) console.warn("[Learning] Could not save speed run:", error.message);
  })();
}

export async function hydrateSpeedRecords(deckId?: string) {
  const userId = await ensureMigrated();
  if (!userId) {
    speedCache = [];
    dispatch("speed:changed");
    return;
  }
  let query = accountLearningDb()
    .from("speed_runs")
    .select("deck_id, duration, score, accuracy, created_at")
    .eq("user_id", userId)
    .order("score", { ascending: false })
    .limit(50);
  if (deckId) query = query.eq("deck_id", deckId);
  const { data, error } = await query;
  if (error) {
    console.warn("[Learning] Could not load speed records:", error.message);
    return;
  }
  speedCache = (data ?? []).map(
    (row: {
      deck_id: string;
      duration: number;
      score: number;
      accuracy: number;
      created_at: string;
    }) => ({
      deckId: row.deck_id,
      duration: row.duration,
      score: row.score,
      accuracy: row.accuracy,
      at: new Date(row.created_at).getTime(),
    }),
  );
  dispatch("speed:changed");
}

export function getSpeedRecords(deckId?: string): SpeedRecord[] {
  return deckId ? speedCache.filter((r) => r.deckId === deckId) : speedCache;
}

export function useSpeedRecords(deckId?: string) {
  const [records, setRecords] = useState<SpeedRecord[]>([]);
  useEffect(() => {
    const reload = () => setRecords(getSpeedRecords(deckId));
    setRecords([]);
    void hydrateSpeedRecords(deckId);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void hydrateSpeedRecords(deckId);
      }
    });
    window.addEventListener("speed:changed", reload);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("speed:changed", reload);
    };
  }, [deckId]);
  return records;
}

export type Assoc = { text: string; source: "ai" | "user"; favorite?: boolean; at: number };
type AssocMap = Record<string, Assoc[]>;

export async function hydrateAssocs(cardId: string) {
  if (!cardId || !isUuid(cardId)) return;
  const userId = await ensureMigrated();
  if (!userId) {
    assocCache = { ...assocCache, [cardId]: [] };
    dispatch("assoc:changed");
    return;
  }
  const { data, error } = await accountLearningDb()
    .from("card_associations")
    .select("text, source, favorite, created_at")
    .eq("user_id", userId)
    .eq("card_id", cardId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.warn("[Learning] Could not load associations:", error.message);
    return;
  }
  assocCache = {
    ...assocCache,
    [cardId]: (data ?? []).map(
      (row: { text: string; source: "ai" | "user"; favorite?: boolean; created_at: string }) => ({
        text: row.text,
        source: row.source,
        favorite: row.favorite,
        at: new Date(row.created_at).getTime(),
      }),
    ),
  };
  dispatch("assoc:changed");
}

export function getAssocs(cardId: string): Assoc[] {
  return assocCache[cardId] ?? [];
}

export function addAssoc(cardId: string, a: Assoc) {
  assocCache = {
    ...assocCache,
    [cardId]: [a, ...(assocCache[cardId] ?? [])].slice(0, 10),
  };
  dispatch("assoc:changed");

  void (async () => {
    if (!isUuid(cardId)) return;
    const userId = await ensureMigrated();
    if (!userId) return;
    const { error } = await accountLearningDb()
      .from("card_associations")
      .insert({
        user_id: userId,
        card_id: cardId,
        text: a.text,
        source: a.source,
        favorite: a.favorite ?? false,
        created_at: new Date(a.at).toISOString(),
      });
    if (error) console.warn("[Learning] Could not save association:", error.message);
  })();
}

export function toggleFavoriteAssoc(cardId: string, idx: number) {
  const list = [...(assocCache[cardId] ?? [])];
  if (!list[idx]) return;
  list[idx] = { ...list[idx], favorite: !list[idx].favorite };
  assocCache = { ...assocCache, [cardId]: list };
  dispatch("assoc:changed");

  void (async () => {
    if (!isUuid(cardId)) return;
    const userId = await ensureMigrated();
    if (!userId) return;
    const target = list[idx];
    const { error } = await accountLearningDb()
      .from("card_associations")
      .update({ favorite: target.favorite ?? false })
      .eq("user_id", userId)
      .eq("card_id", cardId)
      .eq("text", target.text);
    if (error) console.warn("[Learning] Could not update association:", error.message);
  })();
}

export function removeAssoc(cardId: string, idx: number) {
  const list = [...(assocCache[cardId] ?? [])];
  const [removed] = list.splice(idx, 1);
  assocCache = { ...assocCache, [cardId]: list };
  dispatch("assoc:changed");

  void (async () => {
    if (!removed || !isUuid(cardId)) return;
    const userId = await ensureMigrated();
    if (!userId) return;
    const { error } = await accountLearningDb()
      .from("card_associations")
      .delete()
      .eq("user_id", userId)
      .eq("card_id", cardId)
      .eq("text", removed.text);
    if (error) console.warn("[Learning] Could not delete association:", error.message);
  })();
}

export function useAssocs(cardId: string) {
  const [list, setList] = useState<Assoc[]>([]);
  useEffect(() => {
    const reload = () => setList(getAssocs(cardId));
    setList([]);
    void hydrateAssocs(cardId);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void hydrateAssocs(cardId);
      }
    });
    window.addEventListener("assoc:changed", reload);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("assoc:changed", reload);
    };
  }, [cardId]);
  return list;
}
