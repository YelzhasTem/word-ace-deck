import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getDefinitionLanguageFor,
  getLearningLanguageOption,
  LEARNING_LANGUAGE_CODES,
  normalizeLearningLanguage,
  type LearningLanguage,
} from "@/lib/languages";

type DeckCard = { term: string; definition: string };
type DeckPayload = { name?: string; description?: string; cards?: DeckCard[] };
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite";
const MAX_DECK_NAME = 120;
const MAX_CARD_TERM = 160;
const MAX_CARD_DEFINITION = 300;
const MIN_DECK_CARDS = 4;
const MAX_DECK_CARDS = 100;
const MAX_TRANSLATION_OPTIONS = 1;
const MAX_MANUAL_IMPORT_TEXT = 6000;
const MAX_IMAGE_BASE64_LENGTH = 9_500_000;
const SUPPORTED_IMPORT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const LearningLanguageInput = z.enum(LEARNING_LANGUAGE_CODES).default("en");
const OptionalLearningLanguageInput = z.enum(LEARNING_LANGUAGE_CODES).optional();

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function firstTranslation(value: unknown, maxLength = MAX_CARD_DEFINITION) {
  const text = cleanText(value, maxLength);
  if (!text) return "";
  return (
    text
      .split(/\s*(?:[,;/|]|\bor\b|\bили\b)\s*/i)
      .map((part) => part.trim())
      .filter(Boolean)[0] ?? ""
  );
}

function hasCyrillic(value: string) {
  return /[\u0400-\u04ff]/.test(value);
}

function normalizeGeneratedDeckName(value: string) {
  return value
    .replace(/\b(vocabulary|words?|deck|flashcards?|cards?|list)\b/gi, " ")
    .replace(/\b(for|from|about|on)\b\s*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanGeneratedDeckName(value: unknown, fallbackName: string) {
  const name = normalizeGeneratedDeckName(cleanText(value, MAX_DECK_NAME));
  if (name && !hasCyrillic(name)) return name;
  const fallback = normalizeGeneratedDeckName(cleanText(fallbackName, MAX_DECK_NAME));
  if (fallback && !hasCyrillic(fallback)) return fallback;
  return "Untitled";
}

function cleanDeckPayload(parsed: DeckPayload, fallbackName: string, description = "") {
  const sourceCards = Array.isArray(parsed.cards) ? parsed.cards : [];
  const cards = sourceCards
    .map((card) => ({
      term: cleanText(card?.term, MAX_CARD_TERM),
      definition: firstTranslation(card?.definition),
    }))
    .filter((card) => card.term && card.definition)
    .slice(0, MAX_DECK_CARDS);

  return {
    name: cleanGeneratedDeckName(parsed.name, fallbackName),
    description: cleanText(description, 300),
    cards,
  };
}

function cleanImportedCards(cards: unknown) {
  const sourceCards = Array.isArray(cards) ? cards : [];
  const seen = new Set<string>();

  return sourceCards
    .map((card) => ({
      term: cleanText(card?.term, MAX_CARD_TERM),
      definition: firstTranslation(card?.definition),
    }))
    .filter((card) => card.term && card.definition)
    .filter((card) => {
      const key = `${card.term.toLocaleLowerCase("en-US")}::${card.definition.toLocaleLowerCase("en-US")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_DECK_CARDS);
}

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  return apiKey;
}

function stripJsonFence(raw: string) {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function getGeminiText(json: {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
}) {
  return (
    json.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

function getGeminiModels() {
  return Array.from(new Set([GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter(Boolean)));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGeminiStatus(status: number) {
  return status === 429 || status === 503;
}

async function callGeminiParts(
  system: string,
  parts: GeminiPart[],
  options?: { json?: boolean; temperature?: number },
) {
  const apiKey = getGeminiApiKey();
  let lastRetryableError = "";

  for (const model of getGeminiModels()) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: system }],
          },
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          generationConfig: {
            temperature: options?.temperature ?? 0.7,
            ...(options?.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });

      if (res.ok) {
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        };
        return getGeminiText(json);
      }

      const body = await res.text();
      if (res.status === 400) throw new Error(`Gemini rejected the request: ${body.slice(0, 220)}`);
      if (res.status === 401 || res.status === 403) {
        throw new Error("Gemini API key was rejected. Check GEMINI_API_KEY in the environment.");
      }

      if (isRetryableGeminiStatus(res.status)) {
        lastRetryableError = `Gemini API error ${res.status} (${model}): ${body.slice(0, 220)}`;
        if (attempt === 0) await wait(900);
        continue;
      }

      throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 220)}`);
    }
  }

  throw new Error(
    lastRetryableError ||
      "Gemini is temporarily unavailable. Try again in a few minutes or change GEMINI_MODEL.",
  );
}

async function callGemini(
  system: string,
  user: string,
  options?: { json?: boolean; temperature?: number },
) {
  return callGeminiParts(system, [{ text: user }], options);
}

function parseJsonResponse<T>(raw: string, errorMessage: string): T {
  try {
    return JSON.parse(stripJsonFence(raw)) as T;
  } catch {
    throw new Error(errorMessage);
  }
}

function uniqueTranslations(values: string[]) {
  const seen = new Set<string>();
  return values
    .flatMap((value) => cleanText(value, 80).split(/\s*(?:[,;/|]|\bor\b|\bили\b)\s*/i))
    .map((value) => cleanText(value, 80).toLowerCase())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, MAX_TRANSLATION_OPTIONS);
}

function getLanguagePair(targetLanguage?: string | null, definitionLanguage?: string | null) {
  const learning = getLearningLanguageOption(normalizeLearningLanguage(targetLanguage));
  const definition = getDefinitionLanguageFor(learning.code, definitionLanguage);
  return { learning, definition };
}

type LanguageDirection = { source: string; target: string; label: string };

function languageLabelFor(
  code: string,
  learning: ReturnType<typeof getLearningLanguageOption>,
  definition: ReturnType<typeof getLearningLanguageOption>,
) {
  if (code === learning.code) return learning.label;
  if (code === definition.code) return definition.label;
  return code;
}

function getDefaultTranslationDirection(
  word: string,
  learningLanguage: LearningLanguage,
  definitionLanguage?: LearningLanguage,
) {
  const { learning, definition } = getLanguagePair(learningLanguage, definitionLanguage);

  const hasCyrillic = /[\u0400-\u04ff]/.test(word);
  if (learning.code === "en" && definition.code === "ru" && hasCyrillic) {
    return { source: "ru", target: "en", label: "Russian to English" };
  }

  return {
    source: learning.code,
    target: definition.code,
    label: `${learning.label} to ${definition.label}`,
  };
}

function normalizeLookupWord(word: string) {
  return cleanText(word, 80).toLocaleLowerCase("en-US");
}

function getValidCorrection(inputWord: string, correctedWord: unknown) {
  const corrected = cleanText(correctedWord, 80);
  if (!corrected) return "";
  if (normalizeLookupWord(corrected) === normalizeLookupWord(inputWord)) return "";
  return corrected;
}

function isSameTranslation(input: string, translation: string) {
  return normalizeLookupWord(input) === normalizeLookupWord(translation);
}

async function fetchTranslatorOptions(word: string, source: string, target: string) {
  const endpoint = new URL("https://translate.googleapis.com/translate_a/single");
  endpoint.searchParams.set("client", "gtx");
  endpoint.searchParams.set("sl", source);
  endpoint.searchParams.set("tl", target);
  endpoint.searchParams.set("dt", "t");
  endpoint.searchParams.set("q", word);

  const res = await fetch(endpoint);
  if (!res.ok) return [];

  const json = (await res.json()) as unknown;
  if (!Array.isArray(json) || !Array.isArray(json[0])) return [];

  const translations = json[0]
    .map((part) => (Array.isArray(part) && typeof part[0] === "string" ? part[0] : ""))
    .join(" ")
    .split(/[,;]\s*|\s+\/\s+/);

  return uniqueTranslations(translations);
}

export const generateStudyText = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      words: z.array(z.string().min(1).max(80)).min(1).max(50),
      deckName: z.string().max(120).optional(),
      seed: z.number().optional(),
      targetLanguage: LearningLanguageInput,
      definitionLanguage: OptionalLearningLanguageInput,
    }),
  )
  .handler(async ({ data }) => {
    const { learning } = getLanguagePair(data.targetLanguage, data.definitionLanguage);
    const variations = [
      "a short story",
      "a dialogue between two friends",
      "a short news-style note",
      "a letter to a friend",
      "a diary entry",
      "a first-person monologue",
      "a realistic everyday situation",
    ];
    const variant = variations[(data.seed ?? 0) % variations.length];

    const system = `You are a ${learning.label} teacher. Write short, natural, connected ${learning.label} texts for language learners. Return only the review text.`;

    const user =
      `Write ${variant} of about 110-160 words using every listed word or phrase at least once. ` +
      `Do not bold, highlight, wrap, or mark the listed words with Markdown asterisks. ` +
      `Use natural forms when needed: tense, number, articles, and word order may change naturally. ` +
      `Write only in ${learning.label}. Do not add translations, explanations, vocabulary lists, or headings.\n\n` +
      `${data.deckName ? `Deck topic: ${data.deckName}.\n` : ""}` +
      `Words: ${data.words.join(", ")}.`;

    const text = await callGemini(system, user);
    return { text };
  });

export const generateDeckWithAI = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      topic: z.string().min(1).max(200),
      description: z.string().max(300).default(""),
      level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
      count: z.number().int().min(MIN_DECK_CARDS).max(MAX_DECK_CARDS),
      targetLanguage: LearningLanguageInput,
      definitionLanguage: OptionalLearningLanguageInput,
    }),
  )
  .handler(async ({ data }) => {
    const { learning, definition } = getLanguagePair(data.targetLanguage, data.definitionLanguage);
    const system =
      `You are a lexicographer creating vocabulary flashcards for ${learning.label} learners. Return only valid JSON without Markdown. Format: ` +
      `{"name":"English deck name","cards":[{"term":"${learning.label} word or phrase","definition":"one ${definition.label} translation"}]}. ` +
      `Every card term must be in ${learning.label}. Every definition must be exactly one common translation in ${definition.label}, with no commas, slashes, synonyms, examples, parentheses, or extra variants. The deck name must be in English only. Do not add words like Deck, Vocabulary, Words, Flashcards, Cards, or List.`;

    const user =
      `Create a deck of exactly ${data.count} ${learning.label} words or phrases about "${data.topic}" at level ${data.level}. ` +
      `For every card, return only one short ${definition.label} translation. Do not include second meanings, synonyms, slash-separated variants, comma-separated variants, or parentheses. The deck name must be only the concise topic name in English, without added words like Deck, Vocabulary, Words, Flashcards, Cards, or List. Do not create a deck description. Return strict JSON only.`;

    const raw = await callGemini(system, user, { json: true });
    const parsed = parseJsonResponse<DeckPayload>(raw, "AI returned invalid JSON. Try again.");

    const deck = cleanDeckPayload(parsed, data.topic, data.description);
    if (deck.cards.length < MIN_DECK_CARDS) {
      throw new Error("AI generated too few cards. Try another topic.");
    }

    return deck;
  });

export const getTranslations = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      word: z.string().min(1).max(80),
      targetLanguage: LearningLanguageInput,
      definitionLanguage: OptionalLearningLanguageInput,
    }),
  )
  .handler(async ({ data }) => {
    const inputWord = cleanText(data.word, 80);
    const { learning, definition } = getLanguagePair(data.targetLanguage, data.definitionLanguage);
    const defaultDirection = getDefaultTranslationDirection(
      inputWord,
      learning.code,
      definition.code,
    );
    let correctedWord = "";
    let aiTranslations: string[] = [];
    let aiDirection = "";
    let aiLanguageDirection: LanguageDirection | null = null;

    const system =
      `You are a bilingual dictionary for a deck where the learning language is ${learning.label} and the definition language is ${definition.label}. ` +
      `The user may enter either a ${learning.label} word/phrase or a ${definition.label} word/phrase. If the input is in ${learning.label}, return one common ${definition.label} translation. If the input is in ${definition.label}, return one common ${learning.label} translation. ` +
      "If there is an obvious typo and the intended word is clear, correct it. If unsure, do not correct it. correctedWord must stay in the same language as the original input, not the translation. " +
      "Do not return a second translation, synonyms, comma-separated variants, slash-separated variants, parentheses, explanations, numbering, or examples. Return only valid JSON without Markdown. Format: " +
      `{"correctedWord":"corrected original word or empty string","translations":["one translation"],"sourceLanguage":"${learning.code} or ${definition.code}","targetLanguage":"${learning.code} or ${definition.code}","direction":"Source language to target language"}. Translation length: 1-4 words.`;

    const user = `Word or phrase: "${inputWord}". Return exactly one most common translation.`;

    try {
      const raw = await callGemini(system, user, { json: true, temperature: 0.2 });
      const parsed = parseJsonResponse<{
        correctedWord?: string;
        translations?: string[];
        sourceLanguage?: string;
        targetLanguage?: string;
        direction?: string;
      }>(raw, "AI returned an invalid response. Try again.");

      correctedWord = getValidCorrection(inputWord, parsed.correctedWord);
      aiTranslations = uniqueTranslations(
        (parsed.translations ?? []).filter((translation) => typeof translation === "string"),
      );
      aiDirection = typeof parsed.direction === "string" ? cleanText(parsed.direction, 80) : "";
      const validLanguageCodes = new Set<string>([learning.code, definition.code]);
      if (
        validLanguageCodes.has(parsed.sourceLanguage ?? "") &&
        validLanguageCodes.has(parsed.targetLanguage ?? "") &&
        parsed.sourceLanguage !== parsed.targetLanguage
      ) {
        const source = parsed.sourceLanguage ?? defaultDirection.source;
        const target = parsed.targetLanguage ?? defaultDirection.target;
        aiLanguageDirection = {
          source,
          target,
          label:
            aiDirection ||
            `${languageLabelFor(source, learning, definition)} to ${languageLabelFor(
              target,
              learning,
              definition,
            )}`,
        };
      }
    } catch {
      correctedWord = "";
      aiTranslations = [];
    }

    const lookupWord = correctedWord || inputWord;
    const reverseDirection = {
      source: definition.code,
      target: learning.code,
      label: `${definition.label} to ${learning.label}`,
    };
    const fallbackDirections = [aiLanguageDirection ?? defaultDirection, reverseDirection].filter(
      (direction, index, directions) =>
        directions.findIndex(
          (item) => item.source === direction.source && item.target === direction.target,
        ) === index,
    );

    let translatorOptions: string[] = [];
    let direction = fallbackDirections[0];
    for (const option of fallbackDirections) {
      const options = await fetchTranslatorOptions(lookupWord, option.source, option.target);
      const usefulOptions = options.filter(
        (translation) => !isSameTranslation(lookupWord, translation),
      );
      if (usefulOptions.length > 0) {
        translatorOptions = usefulOptions;
        direction = option;
        break;
      }
    }

    const translations = translatorOptions.length > 0 ? translatorOptions : aiTranslations;

    if (translations.length === 0) {
      throw new Error("Could not get a translation. Try another word.");
    }

    return {
      translations,
      direction: translatorOptions.length > 0 ? direction.label : aiDirection || direction.label,
      sourceLanguage:
        translatorOptions.length > 0
          ? direction.source
          : (aiLanguageDirection?.source ?? direction.source),
      targetLanguage:
        translatorOptions.length > 0
          ? direction.target
          : (aiLanguageDirection?.target ?? direction.target),
      correctedWord: correctedWord || undefined,
      originalWord: correctedWord ? inputWord : undefined,
    };
  });

export const importManualCardsFromText = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      text: z.string().min(1).max(MAX_MANUAL_IMPORT_TEXT),
      targetLanguage: LearningLanguageInput,
      definitionLanguage: OptionalLearningLanguageInput,
    }),
  )
  .handler(async ({ data }) => {
    const sourceText = cleanText(data.text, MAX_MANUAL_IMPORT_TEXT);
    const { learning, definition } = getLanguagePair(data.targetLanguage, data.definitionLanguage);

    const system =
      `You prepare ${learning.label} vocabulary flashcards. Return only valid JSON without Markdown. Format: ` +
      '{"cards":[{"term":"word or phrase","definition":"one translation"}]}. ' +
      "Read the user's pasted list. Each line may contain only a word/phrase, or a word/phrase with its translation after a dash, colon, comma, semicolon, tab, or arrow. " +
      `Every card term must be in ${learning.label}. Every definition must be one short ${definition.label} translation. If a translation is already present, keep that meaning as one short definition in ${definition.label}. If a line is in ${definition.label} with no ${learning.label} term, translate it into ${learning.label}. ` +
      "Do not add explanations, numbering, synonyms, second meanings, parentheses, or multiple variants.";

    const user =
      `Convert this pasted list into up to ${MAX_DECK_CARDS} flashcards. ` +
      "Ignore empty lines, comments, page numbers, and duplicate entries. Return only JSON.\n\n" +
      sourceText;

    const raw = await callGemini(system, user, { json: true, temperature: 0.2 });
    const parsed = parseJsonResponse<{ cards?: DeckCard[] }>(
      raw,
      "Could not read this word list. Try simplifying it.",
    );
    const cards = cleanImportedCards(parsed.cards);

    if (cards.length === 0) {
      throw new Error("No usable words were found in this list.");
    }

    return { cards };
  });

export const importManualCardsFromImage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      imageBase64: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
      mimeType: z.enum(SUPPORTED_IMPORT_IMAGE_TYPES),
      targetLanguage: LearningLanguageInput,
      definitionLanguage: OptionalLearningLanguageInput,
    }),
  )
  .handler(async ({ data }) => {
    const imageBase64 = data.imageBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").trim();
    const { learning, definition } = getLanguagePair(data.targetLanguage, data.definitionLanguage);

    const system =
      `You are an OCR and vocabulary extraction assistant for ${learning.label} learners. Return only valid JSON without Markdown. Format: ` +
      '{"cards":[{"term":"word or phrase","definition":"one translation"}]}. ' +
      `Extract visible vocabulary words or short phrases from the image. Every card term must be in ${learning.label}. Every definition must be one short ${definition.label} translation. If the image already shows translations, use them as one short definition in ${definition.label}. If translations are missing, translate into ${definition.label}. ` +
      "Ignore decorative text, page numbers, headers, watermarks, and duplicates. Do not add explanations, synonyms, second meanings, parentheses, or multiple variants.";

    const raw = await callGeminiParts(
      system,
      [
        {
          text:
            `Extract up to ${MAX_DECK_CARDS} vocabulary flashcards from this image. ` +
            "Return only JSON.",
        },
        {
          inlineData: {
            mimeType: data.mimeType,
            data: imageBase64,
          },
        },
      ],
      { json: true, temperature: 0.2 },
    );
    const parsed = parseJsonResponse<{ cards?: DeckCard[] }>(
      raw,
      "Could not read words from this image. Try a clearer photo.",
    );
    const cards = cleanImportedCards(parsed.cards);

    if (cards.length === 0) {
      throw new Error("No usable words were found in this image.");
    }

    return { cards };
  });

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export const generateDeckFromUrl = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      url: z.string().url().max(2000),
      count: z.number().int().min(MIN_DECK_CARDS).max(MAX_DECK_CARDS),
      targetLanguage: LearningLanguageInput,
      definitionLanguage: OptionalLearningLanguageInput,
    }),
  )
  .handler(async ({ data }) => {
    const { learning, definition } = getLanguagePair(data.targetLanguage, data.definitionLanguage);
    let pageRes: Response;
    try {
      pageRes = await fetch(data.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MemoraBot/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
    } catch {
      throw new Error("Could not load the page. Check the URL.");
    }

    if (!pageRes.ok) {
      throw new Error(`Could not load the page (HTTP ${pageRes.status}).`);
    }

    const contentType = pageRes.headers.get("content-type") ?? "";
    const html = await pageRes.text();
    const text = contentType.includes("html") ? stripHtml(html) : html.replace(/\s+/g, " ").trim();

    if (text.length < 200) {
      throw new Error("This page has too little text to create a deck.");
    }

    const excerpt = text.slice(0, 12000);
    const system =
      `You are a lexicographer for ${learning.label} learners. Based on the text excerpt, choose the most useful ${learning.label} words and phrases that actually appear in the text. Avoid proper names, numbers, dates, geographic names, and very basic words. Return only valid JSON without Markdown. Format: ` +
      `{"name":"English deck name","cards":[{"term":"${learning.label} word/expression","definition":"one ${definition.label} translation"}]}. Every definition must contain exactly one common ${definition.label} translation, with no commas, slashes, synonyms, parentheses, or extra variants. The deck name must be in English only. Do not add words like Deck, Vocabulary, Words, Flashcards, Cards, or List.`;

    const user =
      `Source: ${data.url}\n` +
      `Choose exactly ${data.count} different ${learning.label} words or phrases from the text below and give each one only one short ${definition.label} translation. Do not add second meanings, synonyms, comma-separated variants, slash-separated variants, or parentheses. ` +
      `The deck name must be only a short topic name in English, without added words like Deck, Vocabulary, Words, Flashcards, Cards, or List. Do not create a deck description.\n\n` +
      `Text:\n"""${excerpt}"""`;

    const raw = await callGemini(system, user, { json: true });
    const parsed = parseJsonResponse<DeckPayload>(raw, "AI returned invalid JSON. Try again.");

    let host = "";
    try {
      host = new URL(data.url).hostname.replace(/^www\./, "");
    } catch {
      host = "source";
    }

    const deck = cleanDeckPayload(parsed, host);
    if (deck.cards.length < MIN_DECK_CARDS) {
      throw new Error("Could not extract enough words from the text. Try another source.");
    }

    return deck;
  });

export const generateClozeSentence = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      term: z.string().min(1).max(80),
      definition: z.string().min(1).max(200),
      targetLanguage: LearningLanguageInput,
      definitionLanguage: OptionalLearningLanguageInput,
    }),
  )
  .handler(async ({ data }) => {
    const { learning, definition } = getLanguagePair(data.targetLanguage, data.definitionLanguage);
    const system =
      `You help learners practice ${learning.label} vocabulary. Return only JSON without Markdown. Format: ` +
      `{"sentence":"...","explanation":"..."}. sentence is a short natural ${learning.label} sentence at about B1 level, 8-16 words when possible, and it must include the given word in its base or a natural inflected form. explanation is a short English note explaining why the word fits.`;

    const user = `${learning.label} word: "${data.term}" (${definition.label} translation: ${data.definition}). Create the sentence and explanation.`;
    const raw = await callGemini(system, user, { json: true });
    const parsed = parseJsonResponse<{ sentence?: string; explanation?: string }>(
      raw,
      "AI returned an invalid response.",
    );

    if (!parsed.sentence) throw new Error("Could not generate a sentence.");
    return { sentence: parsed.sentence, explanation: parsed.explanation ?? "" };
  });

export const generateAssociation = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      term: z.string().min(1).max(80),
      definition: z.string().min(1).max(200),
      targetLanguage: LearningLanguageInput,
      definitionLanguage: OptionalLearningLanguageInput,
    }),
  )
  .handler(async ({ data }) => {
    const { learning, definition } = getLanguagePair(data.targetLanguage, data.definitionLanguage);
    const system =
      `You create vivid mnemonic associations in English to help remember ${learning.label} words. Return only JSON without Markdown. Format: ` +
      '{"association":"...","story":"..."}. association is 1-2 sentences about sound, shape, or imagery. story is a short 2-3 sentence mnemonic linking the image to the meaning.';

    const user = `${learning.label} word: "${data.term}" — ${definition.label} translation: "${data.definition}".`;
    const raw = await callGemini(system, user, { json: true });
    const parsed = parseJsonResponse<{ association?: string; story?: string }>(
      raw,
      "AI returned an invalid response.",
    );

    if (!parsed.association && !parsed.story) {
      throw new Error("Could not generate an association.");
    }

    return { association: parsed.association ?? "", story: parsed.story ?? "" };
  });
