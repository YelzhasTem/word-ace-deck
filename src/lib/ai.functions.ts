import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const generateStudyText = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      words: z.array(z.string().min(1).max(80)).min(1).max(50),
      deckName: z.string().max(120).optional(),
      seed: z.number().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY не настроен");

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
      "Ты — преподаватель английского для русскоязычных студентов. " +
      "Пишешь короткие связные тексты на английском уровня B1–B2, " +
      "которые помогают активно повторять заданные слова в естественном контексте.";

    const user =
      `Напиши на английском ${variant} (~110–160 слов), используя ВСЕ перечисленные слова и выражения. ` +
      `Каждое из этих слов должно встретиться хотя бы один раз и быть выделено жирным с помощью **звёздочек** (Markdown). ` +
      `Сохраняй формы слов естественными (спряжения, число и т.п.). ` +
      `После текста добавь раздел "**Перевод ключевых слов:**" со списком "- **word** — перевод" для каждого слова.\n\n` +
      `${data.deckName ? `Тема колоды: ${data.deckName}.\n` : ""}` +
      `Слова: ${data.words.join(", ")}.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Слишком много запросов. Попробуйте чуть позже.");
      if (res.status === 402)
        throw new Error("Закончились кредиты Lovable AI. Пополните баланс в настройках.");
      throw new Error(`AI Gateway ошибка ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
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
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY не настроен");

    const system =
      "Ты — лексикограф для русскоязычных студентов английского. " +
      "Твоя задача — сгенерировать колоду карточек для запоминания английских слов. " +
      "Отвечай ТОЛЬКО валидным JSON без Markdown-разметки. Формат:\n" +
      '{"name":"Название колоды","description":"Краткое описание","cards":[{"term":"английское слово","definition":"перевод на русский"}]}';

    const user =
      `Создай колоду из ${data.count} английских слов/выражений на тему «${data.topic}» уровня ${data.level}. ` +
      `Для каждого слова дай перевод на русский. ` +
      `Название колоды должно быть на русском, краткое и ёмкое. ` +
      `Описание — одно предложение на русском. ` +
      `Отвечай строго JSON без комментариев, без Markdown.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Слишком много запросов. Попробуйте чуть позже.");
      if (res.status === 402)
        throw new Error("Закончились кредиты Lovable AI. Пополните баланс в настройках.");
      throw new Error(`AI Gateway ошибка ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";

    // Strip markdown fences if present
    const cleaned = raw.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();

    let parsed: { name?: string; description?: string; cards?: { term: string; definition: string }[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("ИИ вернул невалидный JSON. Попробуйте ещё раз.");
    }

    if (!parsed.cards || !Array.isArray(parsed.cards) || parsed.cards.length === 0) {
      throw new Error("ИИ не сгенерировал карточки. Попробуйте другую тему.");
    }

    return {
      name: parsed.name ?? data.topic,
      description: parsed.description ?? `Колода по теме «${data.topic}»`,
      cards: parsed.cards.filter((c) => c.term && c.definition),
    };
  });

export const getTranslations = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      word: z.string().min(1).max(80),
    }),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY не настроен");

    const system =
      "Ты — англо-русский словарь. Получаешь английское слово или выражение и возвращаешь до 5 наиболее частых переводов на русский язык. " +
      "Отвечай ТОЛЬКО валидным JSON без Markdown. Формат: " +
      '{"translations":["перевод 1","перевод 2","перевод 3"]}. ' +
      "Каждый перевод — короткий (1–4 слова), без пояснений в скобках, без нумерации.";

    const user = `Слово: «${data.word}». Дай разные значения и оттенки смысла, если они есть.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Слишком много запросов. Попробуйте чуть позже.");
      if (res.status === 402)
        throw new Error("Закончились кредиты Lovable AI. Пополните баланс в настройках.");
      throw new Error(`AI Gateway ошибка ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();

    let parsed: { translations?: string[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("ИИ вернул невалидный ответ. Попробуйте ещё раз.");
    }

    const translations = (parsed.translations ?? [])
      .filter((t) => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim())
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
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY не настроен");

    // Fetch the source page
    let pageRes: Response;
    try {
      pageRes = await fetch(data.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; LingoCardsBot/1.0; +https://lovable.dev)",
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
    const ct = pageRes.headers.get("content-type") ?? "";
    const html = await pageRes.text();
    const text = ct.includes("html") ? stripHtml(html) : html.replace(/\s+/g, " ").trim();

    if (text.length < 200) {
      throw new Error("На странице слишком мало текста для создания колоды.");
    }

    // Limit context to keep token usage sane
    const excerpt = text.slice(0, 12000);

    const system =
      "Ты — лексикограф для русскоязычных студентов английского. " +
      "На основе предоставленного фрагмента текста выбери самые полезные для изучения английские слова и выражения " +
      "(существительные, глаголы, прилагательные, устойчивые выражения), которые действительно встречаются в тексте. " +
      "Избегай имён собственных, чисел, дат, географических названий и слишком простых базовых слов (the, is, and и т. п.). " +
      "Отвечай ТОЛЬКО валидным JSON без Markdown. Формат:\n" +
      '{"name":"Название колоды","description":"Краткое описание","cards":[{"term":"слово/выражение","definition":"перевод на русский"}]}';

    const user =
      `Источник: ${data.url}\n` +
      `Выбери ровно ${data.count} разных слов/выражений из текста ниже и дай каждому короткий перевод на русский. ` +
      `Название колоды — на русском, краткое, по теме текста. Описание — одно предложение на русском.\n\n` +
      `Текст:\n"""${excerpt}"""`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Слишком много запросов. Попробуйте чуть позже.");
      if (res.status === 402)
        throw new Error("Закончились кредиты Lovable AI. Пополните баланс в настройках.");
      throw new Error(`AI Gateway ошибка ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();

    let parsed: { name?: string; description?: string; cards?: { term: string; definition: string }[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("ИИ вернул невалидный JSON. Попробуйте ещё раз.");
    }

    const cards = (parsed.cards ?? []).filter((c) => c && c.term && c.definition);
    if (cards.length === 0) {
      throw new Error("Не удалось извлечь слова из текста. Попробуйте другой источник.");
    }

    let host = "";
    try {
      host = new URL(data.url).hostname.replace(/^www\./, "");
    } catch {
      host = "источника";
    }

    return {
      name: parsed.name ?? `Слова из ${host}`,
      description: parsed.description ?? `Лексика, извлечённая из ${host}.`,
      cards,
    };
  });
