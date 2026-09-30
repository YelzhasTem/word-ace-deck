import {
  getDefaultDeckLanguages,
  parseDeckLanguages,
  type DeckLanguagePair,
} from "@/lib/languages";

const STORAGE_KEY = "lingocards.newDeckLanguages.v1";

/**
 * Languages the create-deck form starts with: the last pair chosen on this device, otherwise a
 * guess from the device languages. Browser only.
 */
export function loadDeckLanguagePreference(): DeckLanguagePair {
  try {
    const stored = parseDeckLanguages(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
    if (stored) return stored;
  } catch {
    // Storage can be unavailable (private mode) or hold something unreadable.
  }
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return getDefaultDeckLanguages(languages);
}

export function saveDeckLanguagePreference(pair: DeckLanguagePair) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pair));
  } catch {
    // Not remembering the choice is fine.
  }
}
