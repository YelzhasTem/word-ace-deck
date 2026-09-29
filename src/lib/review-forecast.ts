// Pure helpers for the dashboard review forecast. Kept free of Supabase/React imports
// so they can be unit-tested with plain Node.

export const FORECAST_DAYS = 8; // today + the next 7 days

export type ForecastSource = "review" | "recall";

export type ForecastItem = {
  source: ForecastSource;
  deckId: string;
  cardId: string;
  due: number; // epoch ms
};

export type ForecastDay = {
  date: string; // local YYYY-MM-DD
  start: number; // local midnight, epoch ms
  review: number;
  recall: number;
  total: number;
};

export type ReviewForecast = {
  days: ForecastDay[];
  // Deck (and mode) with the most items due by the end of today, for the "Start review" shortcut.
  topDeckToday: { deckId: string; source: ForecastSource; count: number } | null;
  weekTotal: number;
};

function localDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addLocalDays(startMs: number, days: number) {
  const d = new Date(startMs);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** End (exclusive) of the forecast window: local midnight after the last forecast day. */
export function forecastHorizon(now: number, days = FORECAST_DAYS) {
  return addLocalDays(startOfLocalDay(now), days);
}

/**
 * Buckets due items into local calendar days. Overdue items count toward today.
 * Each card is counted once per source (a card due in both study directions is one card),
 * at its earliest due time.
 */
export function buildReviewForecast(
  items: ForecastItem[],
  now: number,
  days = FORECAST_DAYS,
): ReviewForecast {
  const todayStart = startOfLocalDay(now);
  const starts = Array.from({ length: days + 1 }, (_, i) => addLocalDays(todayStart, i));
  const horizon = starts[days];

  const earliest = new Map<string, ForecastItem>();
  for (const item of items) {
    if (!Number.isFinite(item.due) || item.due >= horizon) continue;
    const key = `${item.source}:${item.deckId}:${item.cardId}`;
    const current = earliest.get(key);
    if (!current || item.due < current.due) earliest.set(key, item);
  }

  const buckets: ForecastDay[] = starts.slice(0, days).map((start) => ({
    date: localDateKey(new Date(start)),
    start,
    review: 0,
    recall: 0,
    total: 0,
  }));

  const todayByDeck = new Map<string, number>();
  for (const item of earliest.values()) {
    let index = 0;
    if (item.due >= starts[1]) {
      index = starts.findIndex(
        (start, i) => i < days && item.due >= start && item.due < starts[i + 1],
      );
      if (index < 0) continue;
    }
    const bucket = buckets[index];
    bucket[item.source] += 1;
    bucket.total += 1;
    if (index === 0) {
      const key = `${item.source}:${item.deckId}`;
      todayByDeck.set(key, (todayByDeck.get(key) ?? 0) + 1);
    }
  }

  let topDeckToday: ReviewForecast["topDeckToday"] = null;
  for (const [key, count] of todayByDeck) {
    if (topDeckToday && count <= topDeckToday.count) continue;
    const [source, deckId] = key.split(":") as [ForecastSource, string];
    topDeckToday = { deckId, source, count };
  }

  return {
    days: buckets,
    topDeckToday,
    weekTotal: buckets.reduce((sum, day) => sum + day.total, 0),
  };
}
