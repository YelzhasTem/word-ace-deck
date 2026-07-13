import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { accountLearningDb } from "@/lib/account-learning-db";

const shuffleDeckIds = new Set<string>();
let hydrationStarted = false;

function dispatchChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("deckShuffle:changed"));
}

async function getUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function hydrateDeckShuffleSettings() {
  if (hydrationStarted) return;
  hydrationStarted = true;

  try {
    const userId = await getUserId();
    if (!userId) {
      shuffleDeckIds.clear();
      dispatchChanged();
      return;
    }

    const { data, error } = await accountLearningDb()
      .from<{
        deck_id: string;
        shuffle_enabled: boolean;
      }>("deck_learning_settings")
      .select("deck_id, shuffle_enabled")
      .eq("user_id", userId)
      .eq("shuffle_enabled", true);

    if (error) {
      console.warn("[Shuffle] Could not load deck shuffle settings:", error.message);
      return;
    }

    shuffleDeckIds.clear();
    for (const row of data ?? []) {
      if (row.shuffle_enabled) shuffleDeckIds.add(row.deck_id);
    }
    dispatchChanged();
  } finally {
    hydrationStarted = false;
  }
}

export function isDeckShuffleEnabled(deckId: string): boolean {
  return shuffleDeckIds.has(deckId);
}

export function setDeckShuffleEnabled(deckId: string, on: boolean) {
  if (on) shuffleDeckIds.add(deckId);
  else shuffleDeckIds.delete(deckId);
  dispatchChanged();

  void (async () => {
    const userId = await getUserId();
    if (!userId) return;

    const { error } = await accountLearningDb().from("deck_learning_settings").upsert(
      {
        user_id: userId,
        deck_id: deckId,
        shuffle_enabled: on,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,deck_id" },
    );

    if (error) console.warn("[Shuffle] Could not save deck shuffle setting:", error.message);
  })();
}

export function useDeckShuffleEnabled(deckId: string): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => isDeckShuffleEnabled(deckId));

  useEffect(() => {
    const sync = () => setOn(isDeckShuffleEnabled(deckId));
    sync();
    void hydrateDeckShuffleSettings();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void hydrateDeckShuffleSettings();
      }
    });

    window.addEventListener("deckShuffle:changed", sync);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("deckShuffle:changed", sync);
    };
  }, [deckId]);

  return [on, (value: boolean) => setDeckShuffleEnabled(deckId, value)];
}
