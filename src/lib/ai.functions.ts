import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type DeckCard = { term: string; definition: string };
type DeckPayload = { name?: string; description?: string; cards?: DeckCard[] };

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const MAX_DECK_NAME = 120;
const MAX_DECK_DESCRIPTION = 300;
const MAX_CARD_TERM = 160;
const MAX_CARD_DEFINITION = 300;

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanDeckPayload(parsed: DeckPayload, fallbackName: string, fallbackDescription: string) {
  const cards = (parsed.cards ?? [])
    .map((card) => ({
      term: cleanText(card?.term, MAX_CARD_TERM),
      definition: cleanText(card?.definition, MAX_CARD_DEFINITION),
    }))
    .filter((card) => card.term && card.definition);

  return {
    name: cleanText(parsed.name, MAX_DECK_NAME) || cleanText(fallbackName, MAX_DECK_NAME),
    description: cleanText(parsed.description, MAX_DECK_DESCRIPTION) || cleanText(fallbackDescription, MAX_DECK_DESCRIPTION),
    cards,
  };
}

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY не настроен");
  return apiKey;
}

function stripJsonFence(raw: string) {
  return raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
}

function getGeminiText(json: {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
}) {
  return json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
}

async function callGemini(system: string, user: string, options?: { json?: boolean }) {
  const apiKey = getGeminiApiKey();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
          parts: [{ text: user }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        ...(options?.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400) throw new Error(`Gemini отклонил запрос: ${body.slice(0, 220)}`);
    if (res.status === 401 || res.status === 403) {
      throw new Error("Gemini API key не принят. Проверьте GEMINI_API_KEY в .env.");
    }
    if (res.status === 429) throw new Error("Слишком много запросов к Gemini. Попробуйте чуть позже.");
    throw new Error(`Gemini API ошибка ${res.status}: ${body.slice(0, 220)}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  return getGeminiText(json);
}

function parseJsonResponse<T>(raw: string, errorMessage: string): T {
  try {
    return JSON.parse(stripJsonFence(raw)) as T;
  } catch {
    throw new Error(errorMessage);
  }
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
      "короткая история",
      "диалог двух друзей",
      "новостная заметка",
      "письмо другу",
      "запись в дневнике",
      "монолог от первого лица",
      "забавный случай из жизни",
    ];
    const variant = variations[(data.seed ?? 0) % variations.length];

    const system =
      "Ты преподаватель английского для русскоязычных студентов. Пиши короткие связные тексты на английском уровня B1-B2, которые помогают активно повторять заданные слова в естественном контексте.";

    const user =
      `Напиши на английском ${variant} примерно на 110-160 слов, используя все перечисленные слова и выражения. ` +
      `Каждое из этих слов должно встретиться хотя бы один раз и быть выделено жирным с помощью Markdown-звездочек. ` +
      `Сохраняй формы слов естественными: спряжения, число и т.п. ` +
      `После текста добавь раздел "**Перевод ключевых слов:**" со списком "- **word** — перевод" для каждого слова.\n\n` +
      `${data.deckName ? `Тема колоды: ${data.deckName}.\n` : ""}` +
      `Слова: ${data.words.join(", ")}.`;

    const text = await callGemini(system, user);
    return { text };
  });

export const generateDeckWithAI = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      topic: z.string().min(1).max(200),
      level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
      count: z.number().int().min(3).max(30),
    }),
  )
  .handler(async ({ data }) => {
    const system =
      "Ты лексикограф для русскоязычных студентов английского. Сгенерируй колоду карточек для запоминания английских слов. Отвечай только валидным JSON без Markdown. Формат: " +
      '{"name":"Название колоды","description":"Краткое описание","cards":[{"term":"english word","definition":"перевод на русский"}]}';

    const user =
      `Создай колоду из ${data.count} английских слов или выражений на тему "${data.topic}" уровня ${data.level}. ` +
      `Для каждого слова дай перевод на русский. Название колоды должно быть на русском, краткое и емкое. ` +
      `Описание — одно предложение на русском. Отвечай строго JSON без комментариев.`;

    const raw = await callGemini(system, user, { json: true });
    const parsed = parseJsonResponse<DeckPayload>(
      raw,
      "ИИ вернул невалидный JSON. Попробуйте еще раз.",
    );

    const deck = cleanDeckPayload(parsed, data.topic, `Колода по теме "${data.topic}"`);
    if (deck.cards.length === 0) {
      throw new Error("ИИ не сгенерировал карточки. Попробуйте другую тему.");
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
    const system =
      "Ты англо-русский словарь. Получаешь английское слово или выражение и возвращаешь до 5 наиболее частых переводов на русский язык. Отвечай только валидным JSON без Markdown. Формат: " +
      '{"translations":["перевод 1","перевод 2","перевод 3"]}. Каждый перевод короткий: 1-4 слова, без пояснений в скобках, без нумерации.';

    const user = `Слово: "${data.word}". Дай разные значения и оттенки смысла, если они есть.`;

    const raw = await callGemini(system, user, { json: true });
    const parsed = parseJsonResponse<{ translations?: string[] }>(
      raw,
      "ИИ вернул невалидный ответ. Попробуйте еще раз.",
    );

    const translations = (parsed.translations ?? [])
      .filter((translation) => typeof translation === "string" && translation.trim().length > 0)
      .map((translation) => translation.trim())
      .slice(0, 5);

    if (translations.length === 0) {
      throw new Error("Не удалось получить переводы. Попробуйте другое слово.");
    }

    return { translations };
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
      count: z.number().int().min(3).max(40),
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
      '{"name":"Название колоды","description":"Краткое описание","cards":[{"term":"слово/выражение","definition":"перевод на русский"}]}';

    const user =
      `Источник: ${data.url}\n` +
      `Выбери ровно ${data.count} разных слов или выражений из текста ниже и дай каждому короткий перевод на русский. ` +
      `Название колоды — на русском, краткое, по теме текста. Описание — одно предложение на русском.\n\n` +
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
      host = "источника";
    }

    const deck = cleanDeckPayload(parsed, `Слова из ${host}`, `Лексика, извлеченная из ${host}.`);
    if (deck.cards.length === 0) {
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
