export const LEARNING_LANGUAGE_CODES = [
  "en",
  "es",
  "fr",
  "de",
  "zh-CN",
  "ja",
  "ko",
  "ru",
  "pt",
  "it",
] as const;

export type LearningLanguage = (typeof LEARNING_LANGUAGE_CODES)[number];

export type LearningLanguageOption = {
  code: LearningLanguage;
  label: string;
};

export const LEARNING_LANGUAGE_OPTIONS: LearningLanguageOption[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "zh-CN", label: "Chinese (Mandarin)" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ru", label: "Russian" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
];

const languageMap = new Map(LEARNING_LANGUAGE_OPTIONS.map((option) => [option.code, option]));

export function normalizeLearningLanguage(value?: string | null): LearningLanguage {
  return LEARNING_LANGUAGE_CODES.includes(value as LearningLanguage)
    ? (value as LearningLanguage)
    : "en";
}

export function getLearningLanguageOption(value?: string | null): LearningLanguageOption {
  return languageMap.get(normalizeLearningLanguage(value)) ?? LEARNING_LANGUAGE_OPTIONS[0];
}

function isLearningLanguage(value: unknown): value is LearningLanguage {
  return LEARNING_LANGUAGE_CODES.includes(value as LearningLanguage);
}

/** Matches a browser language tag such as "en-US", "pt-BR" or "zh-Hans-CN" to a supported language. */
export function matchLearningLanguage(tag: string | null | undefined): LearningLanguage | null {
  const primary = tag?.trim().toLowerCase().split(/[-_]/)[0];
  if (!primary) return null;
  if (primary === "zh") return "zh-CN";
  return isLearningLanguage(primary) ? primary : null;
}

export type DeckLanguagePair = {
  targetLanguage: LearningLanguage;
  definitionLanguage: LearningLanguage;
};

/**
 * Languages a new deck starts with, guessed from the device's preferred languages: people learn
 * English with definitions in their own language, and English speakers learn Spanish. Devices
 * with no supported language keep the original English-Russian default.
 */
export function getDefaultDeckLanguages(preferredLanguages: readonly string[]): DeckLanguagePair {
  const matches = preferredLanguages.map(matchLearningLanguage);
  const ownLanguage = matches.find(
    (code): code is LearningLanguage => code !== null && code !== "en",
  );
  if (ownLanguage) return { targetLanguage: "en", definitionLanguage: ownLanguage };
  if (matches.includes("en")) return { targetLanguage: "es", definitionLanguage: "en" };
  return { targetLanguage: "en", definitionLanguage: getDefaultDefinitionLanguageFor("en").code };
}

/** Validates a stored language pair; returns null for anything else. */
export function parseDeckLanguages(value: unknown): DeckLanguagePair | null {
  if (!value || typeof value !== "object") return null;
  const { targetLanguage, definitionLanguage } = value as Record<string, unknown>;
  if (!isLearningLanguage(targetLanguage) || !isLearningLanguage(definitionLanguage)) return null;
  if (targetLanguage === definitionLanguage) return null;
  return { targetLanguage, definitionLanguage };
}

export function getDefaultDefinitionLanguageFor(learningLanguage: LearningLanguage) {
  return learningLanguage === "en"
    ? getLearningLanguageOption("ru")
    : getLearningLanguageOption("en");
}

export function normalizeDefinitionLanguage(
  value: string | null | undefined,
  learningLanguage: LearningLanguage,
): LearningLanguage {
  const normalized = normalizeLearningLanguage(value);
  return normalized === learningLanguage
    ? getDefaultDefinitionLanguageFor(learningLanguage).code
    : normalized;
}

export function getDefinitionLanguageFor(
  learningLanguage: LearningLanguage,
  definitionLanguage?: string | null,
) {
  if (definitionLanguage) {
    return getLearningLanguageOption(
      normalizeDefinitionLanguage(definitionLanguage, learningLanguage),
    );
  }

  return getDefaultDefinitionLanguageFor(learningLanguage);
}
