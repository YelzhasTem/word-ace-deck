import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { accountLearningDb } from "@/lib/account-learning-db";

const MIGRATION_KEY = "lingocards.accountStreakMigrated.v1";

type StreakData = {
  // ISO date strings (YYYY-MM-DD) of days with activity
  days: string[];
};

let daysCache: string[] = [];
let hydrated = false;
let hydrationStarted = false;
let migrationStarted = false;

function dispatchChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("streak:changed"));
}

function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeDays(days: string[]) {
  return Array.from(new Set(days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))).sort();
}

async function getUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

async function migrateLegacyStreak(userId: string) {
  if (typeof window === "undefined" || migrationStarted) return;
  if (localStorage.getItem(MIGRATION_KEY) === userId) return;
  migrationStarted = true;

  try {
    // Activity days are server-generated from accepted study events. Mutable
    // legacy browser dates are intentionally not imported into trusted streaks.
    localStorage.setItem(MIGRATION_KEY, userId);
  } finally {
    migrationStarted = false;
  }
}

async function ensureMigrated() {
  const userId = await getUserId();
  if (!userId) return null;
  try {
    await migrateLegacyStreak(userId);
  } catch (error) {
    console.warn("[Streak] Legacy migration skipped:", error);
  }
  return userId;
}

async function hydrateStreakDays() {
  if (hydrationStarted) return;
  hydrationStarted = true;
  const userId = await ensureMigrated();
  if (!userId) {
    daysCache = [];
    hydrated = true;
    hydrationStarted = false;
    dispatchChanged();
    return;
  }

  const { data, error } = await accountLearningDb()
    .from("streak_days")
    .select("day")
    .eq("user_id", userId)
    .order("day", { ascending: true });

  if (error) {
    console.warn("[Streak] Could not load account streak days:", error.message);
    hydrationStarted = false;
    return;
  }

  daysCache = normalizeDays(
    (data ?? [])
      .map((row: { day?: string }) => row.day)
      .filter((day: unknown): day is string => typeof day === "string"),
  );
  hydrated = true;
  hydrationStarted = false;
  dispatchChanged();
}

function diffDays(a: string, b: string): number {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function computeCurrentStreak(days: string[]): number {
  if (days.length === 0) return 0;
  const set = new Set(days);
  const today = todayKey();
  const yesterday = todayKey(new Date(Date.now() - 86400000));
  // streak counts only if today or yesterday is present
  let cursor: string;
  if (set.has(today)) cursor = today;
  else if (set.has(yesterday)) cursor = yesterday;
  else return 0;

  let count = 0;
  while (set.has(cursor)) {
    count++;
    const prev = new Date(cursor + "T00:00:00");
    prev.setDate(prev.getDate() - 1);
    cursor = todayKey(prev);
  }
  return count;
}

function computeLongest(days: string[]): number {
  if (days.length === 0) return 0;
  const sorted = [...days].sort();
  let best = 1;
  let cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (diffDays(sorted[i - 1], sorted[i]) === 1) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 1;
    }
  }
  return best;
}

export type WeekDay = {
  date: string;
  label: string; // Mon, Tue...
  dayNum: number;
  active: boolean;
  isToday: boolean;
  isFuture: boolean;
};

// Returns 7 entries for the current week (Mon..Sun)
function buildWeek(days: string[]): WeekDay[] {
  const set = new Set(days);
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const today = new Date();
  const todayK = todayKey(today);
  // Monday of current week
  const dow = today.getDay(); // 0 Sun..6 Sat
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + offsetToMonday);

  return labels.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = todayKey(d);
    return {
      date: key,
      label,
      dayNum: d.getDate(),
      active: set.has(key),
      isToday: key === todayK,
      isFuture: d.getTime() > today.getTime() && key !== todayK,
    };
  });
}

export function useStreak() {
  const [data, setData] = useState<StreakData>({ days: [] });

  useEffect(() => {
    const sync = () => setData({ days: daysCache });
    sync();
    if (!hydrated) void hydrateStreakDays();
    const h = () => void hydrateStreakDays();
    const authSub = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        hydrated = false;
        void hydrateStreakDays();
      }
    });
    window.addEventListener("streak:changed", sync);
    window.addEventListener("focus", h);
    return () => {
      authSub.data.subscription.unsubscribe();
      window.removeEventListener("streak:changed", sync);
      window.removeEventListener("focus", h);
    };
  }, []);

  const recordToday = useCallback(() => {
    const today = todayKey();
    if (!daysCache.includes(today)) {
      daysCache = normalizeDays([...daysCache, today]);
      dispatchChanged();
    }
  }, []);

  return {
    current: computeCurrentStreak(data.days),
    longest: computeLongest(data.days),
    totalDays: data.days.length,
    week: buildWeek(data.days),
    recordToday,
  };
}

// Safe to call outside React (e.g. in handlers without hook)
export function recordStreakToday() {
  if (typeof window === "undefined") return;
  const today = todayKey();
  if (!daysCache.includes(today)) {
    daysCache = normalizeDays([...daysCache, today]);
    dispatchChanged();
  }
}
