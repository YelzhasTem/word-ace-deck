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

export function getDefinitionLanguageFor(learningLanguage: LearningLanguage) {
  return learningLanguage === "en"
    ? getLearningLanguageOption("ru")
    : getLearningLanguageOption("en");
}
