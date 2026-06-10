import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "lingocards.streak.v1";

type StreakData = {
  // ISO date strings (YYYY-MM-DD) of days with activity
  days: string[];
};

function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function load(): StreakData {
  if (typeof window === "undefined") return { days: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { days: [] };
    const parsed = JSON.parse(raw) as StreakData;
    return { days: Array.isArray(parsed.days) ? parsed.days : [] };
  } catch {
    return { days: [] };
  }
}

function save(data: StreakData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event("streak:changed"));
}

function normalizeDays(days: string[]) {
  return Array.from(new Set(days)).sort();
}

async function loadAccountDays(): Promise<string[] | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;

  const { data, error } = await (supabase as any)
    .from("streak_days")
    .select("day")
    .eq("user_id", userId)
    .order("day", { ascending: true });

  if (error) {
    console.warn("[Streak] Could not load account streak days:", error.message);
    return null;
  }

  return normalizeDays(
    (data ?? [])
      .map((row: { day?: string }) => row.day)
      .filter((day: unknown): day is string => typeof day === "string"),
  );
}

async function saveAccountDay(day: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return;

  const { error } = await (supabase as any)
    .from("streak_days")
    .upsert({ user_id: userId, day }, { onConflict: "user_id,day" });

  if (error) {
    console.warn("[Streak] Could not save account streak day:", error.message);
    return;
  }
  window.dispatchEvent(new Event("streak:changed"));
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
    let cancelled = false;

    const refresh = async () => {
      const local = load();
      setData(local);

      const accountDays = await loadAccountDays();
      if (!cancelled && accountDays) {
        setData({ days: accountDays });
      }
    };

    void refresh();
    const h = () => void refresh();
    const authSub = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void refresh();
      }
    });
    window.addEventListener("streak:changed", h);
    window.addEventListener("storage", h);
    return () => {
      cancelled = true;
      authSub.data.subscription.unsubscribe();
      window.removeEventListener("streak:changed", h);
      window.removeEventListener("storage", h);
    };
  }, []);

  const recordToday = useCallback(() => {
    const today = todayKey();
    const cur = load();
    if (!cur.days.includes(today)) {
      save({ days: normalizeDays([...cur.days, today]) });
    }
    void saveAccountDay(today);
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
  const cur = load();
  if (!cur.days.includes(today)) {
    save({ days: normalizeDays([...cur.days, today]) });
  }
  void saveAccountDay(today);
}
