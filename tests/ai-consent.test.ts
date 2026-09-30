import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  hasAiConsent,
  requestAiConsent,
  resolveAiConsent,
  subscribeAiConsent,
} from "../src/lib/ai-consent.ts";

const store = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
};
let unsubscribe = () => {};

function mountDialog() {
  const openStates: boolean[] = [];
  unsubscribe = subscribeAiConsent((open) => openStates.push(open));
  return openStates;
}

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage });
});

afterEach(() => {
  unsubscribe();
  unsubscribe = () => {};
  Reflect.deleteProperty(globalThis, "window");
});

test("asks once and remembers Allow", async () => {
  const openStates = mountDialog();
  const answer = requestAiConsent();
  assert.deepEqual(openStates, [true]);
  resolveAiConsent(true);
  assert.equal(await answer, true);
  assert.deepEqual(openStates, [true, false]);
  assert.equal(hasAiConsent(), true);

  assert.equal(await requestAiConsent(), true);
  assert.deepEqual(openStates, [true, false]);
});

test("Not now sends nothing and asks again next time", async () => {
  const openStates = mountDialog();
  const answer = requestAiConsent();
  resolveAiConsent(false);
  assert.equal(await answer, false);
  assert.equal(hasAiConsent(), false);

  void requestAiConsent();
  assert.deepEqual(openStates, [true, false, true]);
  resolveAiConsent(false);
});

test("requests made while the dialog is open share one answer", async () => {
  const openStates = mountDialog();
  const first = requestAiConsent();
  const second = requestAiConsent();
  resolveAiConsent(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(openStates.at(-1), false);
});

test("works without storage by asking every time", async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  mountDialog();
  const answer = requestAiConsent();
  resolveAiConsent(true);
  assert.equal(await answer, true);
  assert.equal(hasAiConsent(), false);
});

test("falls back to the browser prompt when the dialog is not mounted", async () => {
  const prompts: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      confirm: (message: string) => {
        prompts.push(message);
        return true;
      },
    },
  });
  assert.equal(await requestAiConsent(), true);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Gemini API/);
  assert.equal(hasAiConsent(), true);
});
