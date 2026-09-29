import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewForecast,
  forecastHorizon,
  type ForecastItem,
} from "../src/lib/review-forecast.ts";

const HOUR = 60 * 60 * 1000;
// Noon local time keeps the fixtures clear of midnight regardless of the test machine's zone.
const now = new Date(2026, 8, 29, 12, 0, 0).getTime();
const dayAt = (offset: number, hour = 9) => new Date(2026, 8, 29 + offset, hour, 0, 0).getTime();

test("overdue and later-today items count toward today", () => {
  const items: ForecastItem[] = [
    { source: "review", deckId: "a", cardId: "1", due: now - 30 * 24 * HOUR },
    { source: "review", deckId: "a", cardId: "2", due: dayAt(0, 23) },
    { source: "recall", deckId: "b", cardId: "3", due: now - HOUR },
  ];
  const forecast = buildReviewForecast(items, now);
  assert.equal(forecast.days.length, 8);
  assert.deepEqual(
    {
      review: forecast.days[0].review,
      recall: forecast.days[0].recall,
      total: forecast.days[0].total,
    },
    { review: 2, recall: 1, total: 3 },
  );
});

test("items land on their local calendar day and past the window are dropped", () => {
  const items: ForecastItem[] = [
    { source: "review", deckId: "a", cardId: "1", due: dayAt(1, 0) },
    { source: "review", deckId: "a", cardId: "2", due: dayAt(3) },
    { source: "review", deckId: "a", cardId: "3", due: dayAt(7, 23) },
    { source: "review", deckId: "a", cardId: "4", due: dayAt(8, 0) },
  ];
  const forecast = buildReviewForecast(items, now);
  assert.deepEqual(
    forecast.days.map((d) => d.total),
    [0, 1, 0, 1, 0, 0, 0, 1],
  );
  assert.equal(forecast.weekTotal, 3);
  assert.equal(forecastHorizon(now), dayAt(8, 0));
});

test("a card due in both directions counts once, at its earliest due day", () => {
  const items: ForecastItem[] = [
    { source: "review", deckId: "a", cardId: "1", due: dayAt(2) },
    { source: "review", deckId: "a", cardId: "1", due: dayAt(0) },
    { source: "recall", deckId: "a", cardId: "1", due: dayAt(2) },
  ];
  const forecast = buildReviewForecast(items, now);
  assert.equal(forecast.days[0].review, 1);
  assert.equal(forecast.days[2].review, 0);
  assert.equal(forecast.days[2].recall, 1);
});

test("top deck today picks the deck and mode with the most due items", () => {
  const items: ForecastItem[] = [
    { source: "review", deckId: "a", cardId: "1", due: dayAt(0) },
    { source: "recall", deckId: "b", cardId: "2", due: dayAt(0) },
    { source: "recall", deckId: "b", cardId: "3", due: dayAt(0) },
    { source: "review", deckId: "c", cardId: "4", due: dayAt(1) },
    { source: "review", deckId: "c", cardId: "5", due: dayAt(1) },
    { source: "review", deckId: "c", cardId: "6", due: dayAt(1) },
  ];
  assert.deepEqual(buildReviewForecast(items, now).topDeckToday, {
    deckId: "b",
    source: "recall",
    count: 2,
  });
  assert.equal(buildReviewForecast([], now).topDeckToday, null);
});
