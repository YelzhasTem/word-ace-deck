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
