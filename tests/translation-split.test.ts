import assert from "node:assert/strict";
import test from "node:test";

import { splitTranslationAlternatives } from "../src/lib/translation-split.ts";

test("splits Russian and English alternatives", () => {
  assert.deepEqual(splitTranslationAlternatives("дом или здание"), ["дом", "здание"]);
  assert.deepEqual(splitTranslationAlternatives("house or building"), ["house", "building"]);
  assert.deepEqual(splitTranslationAlternatives("house, building; home | hut"), [
    "house",
    "building",
    "home",
    "hut",
  ]);
  assert.deepEqual(splitTranslationAlternatives("big / large"), ["big", "large"]);
});

test("keeps values that only look like separators", () => {
  assert.deepEqual(splitTranslationAlternatives("or"), ["or"]);
  assert.deepEqual(splitTranslationAlternatives("km/h"), ["km/h"]);
  assert.deepEqual(splitTranslationAlternatives("1,000"), ["1,000"]);
  assert.deepEqual(splitTranslationAlternatives("order"), ["order"]);
  assert.deepEqual(splitTranslationAlternatives("корова"), ["корова"]);
  assert.deepEqual(splitTranslationAlternatives("вилы"), ["вилы"]);
  assert.deepEqual(splitTranslationAlternatives("  "), []);
});
