import { useEffect, useState } from "react";

const KEY = "lingocards.lastStudied.v1";
type Map = Record<string, number>;

function load(): Map {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}

export function markDeckStudied(deckId: string) {
  if (typeof window === "undefined") return;
  const m = load();
  m[deckId] = Date.now();
  localStorage.setItem(KEY, JSON.stringify(m));
  window.dispatchEvent(new Event("lastStudied:changed"));
}

export function useLastStudied(): Map {
  const [m, setM] = useState<Map>({});
  useEffect(() => {
    const sync = () => setM(load());
    sync();
    window.addEventListener("lastStudied:changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("lastStudied:changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return m;
}
