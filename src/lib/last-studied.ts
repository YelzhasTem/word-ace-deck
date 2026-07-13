import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { accountLearningDb } from "@/lib/account-learning-db";

const LEGACY_KEY = "lingocards.lastStudied.v1";
const MIGRATION_KEY = "lingocards.accountLastStudiedMigrated.v1";

type LastStudiedMap = Record<string, number>;

let cache: LastStudiedMap = {};
let hydrated = false;
let hydrationStarted = false;
let migrationStarted = false;

function dispatchChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("lastStudied:changed"));
}

function isoFromMs(ms?: number) {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toISOString()
    : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

async function getUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

function loadLegacy(): LastStudiedMap {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "{}") as LastStudiedMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function migrateLegacyLastStudied(userId: string) {
  if (typeof window === "undefined" || migrationStarted) return;
  if (localStorage.getItem(MIGRATION_KEY) === userId) return;
  migrationStarted = true;

  try {
    const rows = Object.entries(loadLegacy())
      .filter(([deckId, at]) => isUuid(deckId) && typeof at === "number")
      .map(([deckId, at]) => ({
        user_id: userId,
        deck_id: deckId,
        last_studied_at: isoFromMs(at) ?? new Date().toISOString(),
      }));

    if (rows.length > 0) {
      const { error } = await accountLearningDb().from("last_studied_decks").upsert(rows, {
        onConflict: "user_id,deck_id",
      });
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
    await migrateLegacyLastStudied(userId);
  } catch (error) {
    console.warn("[Last Studied] Legacy migration skipped:", error);
  }
  return userId;
}

export async function hydrateLastStudied() {
  if (hydrationStarted) return;
  hydrationStarted = true;
  const userId = await ensureMigrated();
  if (!userId) {
    cache = {};
    hydrated = true;
    hydrationStarted = false;
    dispatchChanged();
    return;
  }

  const { data, error } = await accountLearningDb()
    .from("last_studied_decks")
    .select("deck_id, last_studied_at")
    .eq("user_id", userId);

  if (error) {
    console.warn("[Last Studied] Could not load account data:", error.message);
    hydrationStarted = false;
    return;
  }

  cache = {};
  for (const row of data ?? []) {
    cache[row.deck_id] = new Date(row.last_studied_at).getTime();
  }

  hydrated = true;
  hydrationStarted = false;
  dispatchChanged();
}

export function markDeckStudied(deckId: string) {
  if (typeof window === "undefined" || !isUuid(deckId)) return;
  const at = Date.now();
  cache = { ...cache, [deckId]: at };
  dispatchChanged();

  void (async () => {
    const userId = await ensureMigrated();
    if (!userId) return;
    const { error } = await accountLearningDb()
      .from("last_studied_decks")
      .upsert(
        {
          user_id: userId,
          deck_id: deckId,
          last_studied_at: new Date(at).toISOString(),
        },
        { onConflict: "user_id,deck_id" },
      );
    if (error) console.warn("[Last Studied] Could not save account data:", error.message);
  })();
}

export function useLastStudied(): LastStudiedMap {
  const [map, setMap] = useState<LastStudiedMap>({});
  useEffect(() => {
    const sync = () => setMap(cache);
    sync();
    if (!hydrated) void hydrateLastStudied();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        hydrated = false;
        void hydrateLastStudied();
      }
    });
    window.addEventListener("lastStudied:changed", sync);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("lastStudied:changed", sync);
    };
  }, []);
  return map;
}
