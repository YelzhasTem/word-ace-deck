import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
  if (!apiKey) throw new Error("GEMINI_API_KEY не настроен");
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
      if (res.status === 400) throw new Error(`Gemini отклонил запрос: ${body.slice(0, 220)}`);
      if (res.status === 401 || res.status === 403) {
        throw new Error("Gemini API key не принят. Проверьте GEMINI_API_KEY в .env.");
      }

      if (isRetryableGeminiStatus(res.status)) {
        lastRetryableError = `Gemini API ошибка ${res.status} (${model}): ${body.slice(0, 220)}`;
        if (attempt === 0) await wait(900);
        continue;
      }

      throw new Error(`Gemini API ошибка ${res.status}: ${body.slice(0, 220)}`);
    }
  }

  throw new Error(
    lastRetryableError ||
      "Gemini временно недоступен. Попробуйте еще раз через несколько минут или смените GEMINI_MODEL.",
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

function getTranslationDirection(word: string) {
  const hasCyrillic = /[\u0400-\u04ff]/.test(word);
  return hasCyrillic
    ? { source: "ru", target: "en", label: "Russian to English" }
    : { source: "en", target: "ru", label: "English to Russian" };
}

function normalizeLookupWord(word: string) {
  return cleanText(word, 80).toLocaleLowerCase("en-US");
}

function getValidCorrection(inputWord: string, correctedWord: unknown, source: string) {
  const corrected = cleanText(correctedWord, 80);
  if (!corrected) return "";
  if (normalizeLookupWord(corrected) === normalizeLookupWord(inputWord)) return "";
  if (source === "en" && hasCyrillic(corrected)) return "";
  if (source === "ru" && hasCyrillic(inputWord) && !hasCyrillic(corrected)) return "";
  return corrected;
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
    }),
  )
  .handler(async ({ data }) => {
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

    const system =
      "You are an English teacher. Write short, natural, connected English texts for B1-B2 learners. The entire response must be in English only. Do not use Russian or Cyrillic characters.";

    const user =
      `Write ${variant} of about 110-160 words using every listed word or phrase at least once. ` +
      `Do not bold, highlight, wrap, or mark the listed words with Markdown asterisks. ` +
      `Use natural forms when needed: tense, number, articles, and word order may change naturally. ` +
      `Do not add translations, explanations, vocabulary lists, headings in Russian, or any Cyrillic text. Return only the English review text.\n\n` +
      `${data.deckName ? `Deck topic: ${data.deckName}.\n` : ""}` +
      `Words: ${data.words.join(", ")}.`;

    let text = await callGemini(system, user);
    if (hasCyrillic(text)) {
      text = await callGemini(
        "Rewrite the provided review text in English only. Do not use Russian or Cyrillic characters. Do not bold, highlight, wrap, or mark learning words with Markdown asterisks.",
        text,
      );
    }
    return { text };
  });

export const generateDeckWithAI = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      topic: z.string().min(1).max(200),
      description: z.string().max(300).default(""),
      level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
      count: z.number().int().min(MIN_DECK_CARDS).max(MAX_DECK_CARDS),
    }),
  )
  .handler(async ({ data }) => {
    const system =
      "Ты лексикограф для русскоязычных студентов английского. Сгенерируй колоду карточек для запоминания английских слов. Отвечай только валидным JSON без Markdown. Формат: " +
      '{"name":"English name","cards":[{"term":"english word","definition":"один перевод на русский"}]}. Для каждой карточки definition должен содержать ровно один самый частый перевод, без запятых, слэшей и дополнительных вариантов. Название колоды в поле name должно быть только на английском языке. Не добавляй слова вроде Deck, Vocabulary, Words, Flashcards, Cards или List.';

    const user =
      `Создай колоду из ${data.count} английских слов или выражений на тему "${data.topic}" уровня ${data.level}. ` +
      `Для каждого слова дай только один самый частый перевод на русский. Не добавляй второй перевод, синонимы, варианты через запятую, слэш или скобки. Название колоды должно быть только названием темы на английском, без добавленных слов вроде Deck, Vocabulary, Words, Flashcards, Cards или List. Не используй русский язык в названии колоды. ` +
      `Не создавай описание колоды. Отвечай строго JSON без комментариев.`;

    const raw = await callGemini(system, user, { json: true });
    const parsed = parseJsonResponse<DeckPayload>(
      raw,
      "ИИ вернул невалидный JSON. Попробуйте еще раз.",
    );

    const deck = cleanDeckPayload(parsed, data.topic, data.description);
    if (deck.cards.length < MIN_DECK_CARDS) {
      throw new Error("ИИ сгенерировал слишком мало карточек. Попробуйте другую тему.");
    }

    return deck;
  });

export const getTranslations = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      word: z.string().min(1).max(80),
    }),
  )
  .handler(async ({ data }) => {
    const inputWord = cleanText(data.word, 80);
    const inputDirection = getTranslationDirection(inputWord);
    let correctedWord = "";
    let aiTranslations: string[] = [];

    const system =
      `${inputDirection.source === "ru" ? "Ты русско-английский словарь" : "Ты англо-русский словарь"}. ` +
      `Получаешь ${inputDirection.source === "ru" ? "русское" : "английское"} слово или выражение. ` +
      "Если в исходном слове есть очевидная опечатка и правильное слово можно уверенно понять, исправь его. Если не уверен, не исправляй. " +
      "correctedWord должен быть исходным словом на том же языке, а не переводом. " +
      `Верни ровно один самый частый перевод на ${inputDirection.target === "en" ? "английский" : "русский"} язык для исправленного слова или для исходного слова, если исправления нет. ` +
      "Не возвращай второй перевод, синонимы или варианты через запятую, слэш или скобки. " +
      "Отвечай только валидным JSON без Markdown. Формат: " +
      '{"correctedWord":"исправленное слово или пустая строка","translations":["один перевод"]}. Перевод короткий: 1-4 слова, без пояснений в скобках, без нумерации.';

    const user = `Слово: "${inputWord}". Верни только один самый частый перевод.`;

    try {
      const raw = await callGemini(system, user, { json: true, temperature: 0.2 });
      const parsed = parseJsonResponse<{ correctedWord?: string; translations?: string[] }>(
        raw,
        "ИИ вернул невалидный ответ. Попробуйте еще раз.",
      );

      correctedWord = getValidCorrection(inputWord, parsed.correctedWord, inputDirection.source);
      aiTranslations = uniqueTranslations(
        (parsed.translations ?? []).filter((translation) => typeof translation === "string"),
      );
    } catch {
      correctedWord = "";
      aiTranslations = [];
    }

    const lookupWord = correctedWord || inputWord;
    const direction = getTranslationDirection(lookupWord);
    const translatorOptions = await fetchTranslatorOptions(
      lookupWord,
      direction.source,
      direction.target,
    );
    const translations = translatorOptions.length > 0 ? translatorOptions : aiTranslations;

    if (translations.length === 0) {
      throw new Error("Не удалось получить переводы. Попробуйте другое слово.");
    }

    return {
      translations,
      direction: direction.label,
      correctedWord: correctedWord || undefined,
      originalWord: correctedWord ? inputWord : undefined,
    };
  });

export const importManualCardsFromText = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      text: z.string().min(1).max(MAX_MANUAL_IMPORT_TEXT),
    }),
  )
  .handler(async ({ data }) => {
    const sourceText = cleanText(data.text, MAX_MANUAL_IMPORT_TEXT);

    const system =
      "You prepare vocabulary flashcards for a Russian-speaking English learner. Return only valid JSON without Markdown. Format: " +
      '{"cards":[{"term":"word or phrase","definition":"one translation"}]}. ' +
      "Read the user's pasted list. Each line may contain only a word/phrase, or a word/phrase with its translation after a dash, colon, comma, semicolon, tab, or arrow. " +
      "If a translation is already present, keep that meaning as a single short definition. If a translation is missing, translate it: English terms get one Russian translation, Russian terms get one English translation. " +
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
    }),
  )
  .handler(async ({ data }) => {
    const imageBase64 = data.imageBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").trim();

    const system =
      "You are an OCR and vocabulary extraction assistant for a Russian-speaking English learner. Return only valid JSON without Markdown. Format: " +
      '{"cards":[{"term":"word or phrase","definition":"one translation"}]}. ' +
      "Extract visible vocabulary words or short phrases from the image. If the image already shows translations, use them as one short definition. If translations are missing, translate them: English terms get one Russian translation, Russian terms get one English translation. " +
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
    }),
  )
  .handler(async ({ data }) => {
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
      throw new Error("Не удалось загрузить страницу. Проверьте адрес.");
    }

    if (!pageRes.ok) {
      throw new Error(`Не удалось загрузить страницу (HTTP ${pageRes.status}).`);
    }

    const contentType = pageRes.headers.get("content-type") ?? "";
    const html = await pageRes.text();
    const text = contentType.includes("html") ? stripHtml(html) : html.replace(/\s+/g, " ").trim();

    if (text.length < 200) {
      throw new Error("На странице слишком мало текста для создания колоды.");
    }

    const excerpt = text.slice(0, 12000);
    const system =
      "Ты лексикограф для русскоязычных студентов английского. На основе фрагмента текста выбери самые полезные для изучения английские слова и выражения, которые действительно встречаются в тексте. Избегай имен собственных, чисел, дат, географических названий и слишком простых базовых слов. Отвечай только валидным JSON без Markdown. Формат: " +
      '{"name":"English name","cards":[{"term":"english word/expression","definition":"один перевод на русский"}]}. Для каждой карточки definition должен содержать ровно один самый частый перевод, без запятых, слэшей и дополнительных вариантов. Название колоды в поле name должно быть только на английском языке. Не добавляй слова вроде Deck, Vocabulary, Words, Flashcards, Cards или List.';

    const user =
      `Источник: ${data.url}\n` +
      `Выбери ровно ${data.count} разных слов или выражений из текста ниже и дай каждому только один короткий перевод на русский. Не добавляй второй перевод, синонимы, варианты через запятую, слэш или скобки. ` +
      `Название колоды — на английском, только краткая тема текста, без добавленных слов вроде Deck, Vocabulary, Words, Flashcards, Cards или List. Не используй русский язык в названии колоды. Не создавай описание колоды.\n\n` +
      `Текст:\n"""${excerpt}"""`;

    const raw = await callGemini(system, user, { json: true });
    const parsed = parseJsonResponse<DeckPayload>(
      raw,
      "ИИ вернул невалидный JSON. Попробуйте еще раз.",
    );

    let host = "";
    try {
      host = new URL(data.url).hostname.replace(/^www\./, "");
    } catch {
      host = "source";
    }

    const deck = cleanDeckPayload(parsed, host);
    if (deck.cards.length < MIN_DECK_CARDS) {
      throw new Error("Не удалось извлечь слова из текста. Попробуйте другой источник.");
    }

    return deck;
  });

export const generateClozeSentence = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      term: z.string().min(1).max(80),
      definition: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }) => {
    const system =
      "Ты помогаешь учить английские слова. Возвращай только JSON без Markdown. Формат: " +
      '{"sentence":"...","explanation":"..."}. sentence — короткое естественное английское предложение уровня B1 на 8-16 слов, где обязательно встречается заданное слово в базовой или естественной форме. explanation — короткое пояснение на русском, почему слово уместно.';

    const user = `Слово: "${data.term}" (перевод: ${data.definition}). Сделай предложение и пояснение.`;
    const raw = await callGemini(system, user, { json: true });
    const parsed = parseJsonResponse<{ sentence?: string; explanation?: string }>(
      raw,
      "ИИ вернул невалидный ответ.",
    );

    if (!parsed.sentence) throw new Error("Не удалось сгенерировать предложение.");
    return { sentence: parsed.sentence, explanation: parsed.explanation ?? "" };
  });

export const generateAssociation = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      term: z.string().min(1).max(80),
      definition: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }) => {
    const system =
      "Ты создаешь яркие мнемонические ассоциации на русском, чтобы помочь запомнить английские слова. Отвечай только JSON без Markdown. Формат: " +
      '{"association":"...","story":"..."}. association — 1-2 предложения: на что похоже звучание слова, какой образ возникает. story — короткая история-мнемоника на 2-3 предложения, связывающая образ с переводом.';

    const user = `Слово: "${data.term}" — перевод: "${data.definition}".`;
    const raw = await callGemini(system, user, { json: true });
    const parsed = parseJsonResponse<{ association?: string; story?: string }>(
      raw,
      "ИИ вернул невалидный ответ.",
    );

    if (!parsed.association && !parsed.story) {
      throw new Error("Не удалось сгенерировать ассоциацию.");
    }

    return { association: parsed.association ?? "", story: parsed.story ?? "" };
  });

export const generateSessionFeedback = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      deckName: z.string().max(120).optional(),
      totals: z.object({
        answered: z.number().int().min(0),
        correct: z.number().int().min(0),
        wrong: z.number().int().min(0),
        avgMs: z.number().min(0).optional(),
      }),
      mastered: z.array(z.string().max(80)).max(50),
      weak: z
        .array(
          z.object({
            term: z.string().max(80),
            definition: z.string().max(200),
            accuracy: z.number().min(0).max(100),
            avgMs: z.number().min(0).optional(),
          }),
        )
        .max(20),
      confusions: z.array(z.object({ a: z.string().max(80), b: z.string().max(80) })).max(10),
    }),
  )
  .handler(async ({ data }) => {
    const system =
      "Ты персональный AI-тренер по английской лексике для русскоязычного студента. На основе статистики сессии дай теплый, конкретный и краткий разбор по-русски. Отвечай только JSON без Markdown. Формат: " +
      '{"summary":"...","weakAnalysis":"...","confusions":[{"pair":"borrow vs lend","note":"..."}],"focus":["..."],"plan":"...","trend":"..."}. summary — 1-2 предложения с общей оценкой. weakAnalysis — что объединяет слабые слова и как с ними работать. confusions — короткие пояснения частых путаниц похожих слов. focus — массив из 2-4 коротких пунктов на завтра. plan — рекомендация по режимам и количеству карточек. trend — короткая фраза о динамике.';

    const raw = await callGemini(system, JSON.stringify(data), { json: true });
    const parsed = parseJsonResponse<{
      summary?: string;
      weakAnalysis?: string;
      confusions?: { pair: string; note: string }[];
      focus?: string[];
      plan?: string;
      trend?: string;
    }>(raw, "ИИ вернул невалидный ответ.");

    return {
      summary: parsed.summary ?? "",
      weakAnalysis: parsed.weakAnalysis ?? "",
      confusions: Array.isArray(parsed.confusions) ? parsed.confusions.slice(0, 8) : [],
      focus: Array.isArray(parsed.focus) ? parsed.focus.slice(0, 6) : [],
      plan: parsed.plan ?? "",
      trend: parsed.trend ?? "",
    };
  });
