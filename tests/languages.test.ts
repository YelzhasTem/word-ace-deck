import assert from "node:assert/strict";
import test from "node:test";
import {
  getDefaultDeckLanguages,
  matchLearningLanguage,
  parseDeckLanguages,
} from "../src/lib/languages.ts";

test("browser language tags map to supported languages", () => {
  assert.equal(matchLearningLanguage("en-US"), "en");
  assert.equal(matchLearningLanguage("pt-BR"), "pt");
  assert.equal(matchLearningLanguage("RU"), "ru");
  assert.equal(matchLearningLanguage("zh-Hans-CN"), "zh-CN");
  assert.equal(matchLearningLanguage("zh_TW"), "zh-CN");
  assert.equal(matchLearningLanguage("kk-KZ"), null);
  assert.equal(matchLearningLanguage(""), null);
  assert.equal(matchLearningLanguage(undefined), null);
});

test("people learn English with definitions in their own language", () => {
  assert.deepEqual(getDefaultDeckLanguages(["de-DE"]), {
    targetLanguage: "en",
    definitionLanguage: "de",
  });
  assert.deepEqual(getDefaultDeckLanguages(["kk-KZ", "ru-KZ"]), {
    targetLanguage: "en",
    definitionLanguage: "ru",
  });
  assert.deepEqual(getDefaultDeckLanguages(["en-US", "ru-RU"]), {
    targetLanguage: "en",
    definitionLanguage: "ru",
  });
});

test("English speakers learn Spanish with English definitions", () => {
  assert.deepEqual(getDefaultDeckLanguages(["en-US"]), {
    targetLanguage: "es",
    definitionLanguage: "en",
  });
  assert.deepEqual(getDefaultDeckLanguages(["tr-TR", "en-GB"]), {
    targetLanguage: "es",
    definitionLanguage: "en",
  });
});

test("devices with no supported language keep the English-Russian default", () => {
  assert.deepEqual(getDefaultDeckLanguages(["kk-KZ"]), {
    targetLanguage: "en",
    definitionLanguage: "ru",
  });
  assert.deepEqual(getDefaultDeckLanguages([]), {
    targetLanguage: "en",
    definitionLanguage: "ru",
  });
});

test("stored language pairs are validated", () => {
  assert.deepEqual(parseDeckLanguages({ targetLanguage: "fr", definitionLanguage: "en" }), {
    targetLanguage: "fr",
    definitionLanguage: "en",
  });
  assert.equal(parseDeckLanguages({ targetLanguage: "en", definitionLanguage: "en" }), null);
  assert.equal(parseDeckLanguages({ targetLanguage: "xx", definitionLanguage: "en" }), null);
  assert.equal(parseDeckLanguages("en"), null);
  assert.equal(parseDeckLanguages(null), null);
});
