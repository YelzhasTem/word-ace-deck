import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DEFAULT_COLLECTION_NAME = "Моя коллекция";

async function ensureDefaultCollectionId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: existing, error: findErr } = await supabase
    .from("collections")
    .select("id")
    .eq("user_id", userId)
    .eq("name", DEFAULT_COLLECTION_NAME)
    .limit(1)
    .maybeSingle();
  if (findErr) return null;
  if (existing?.id) return existing.id;
  const { data: created, error: createErr } = await supabase
    .from("collections")
    .insert({ user_id: userId, name: DEFAULT_COLLECTION_NAME, description: "" })
    .select("id")
    .single();
  if (createErr || !created) return null;
  return created.id;
}

async function addDeckToDefaultCollection(
  supabase: SupabaseClient,
  userId: string,
  deckId: string,
): Promise<void> {
  const collectionId = await ensureDefaultCollectionId(supabase, userId);
  if (!collectionId) return;
  const { count } = await supabase
    .from("collection_decks")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", collectionId)
    .eq("user_id", userId);
  await supabase.from("collection_decks").insert({
    collection_id: collectionId,
    deck_id: deckId,
    user_id: userId,
    position: count ?? 0,
  });
}

const CardInput = z.object({
  term: z.string().min(1).max(160),
  definition: z.string().min(1).max(300),
});

export const getMyDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [decksRes, cardsRes] = await Promise.all([
      supabase
        .from("decks")
        .select("id, name, description, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("cards")
        .select("id, deck_id, term, definition, known, position, created_at")
        .eq("user_id", userId)
        .order("position", { ascending: true }),
    ]);
    if (decksRes.error) throw new Error(decksRes.error.message);
    if (cardsRes.error) throw new Error(cardsRes.error.message);

    return { decks: decksRes.data ?? [], cards: cardsRes.data ?? [] };
  });


export const createDeckRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(300).default(""),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: deck, error } = await supabase
      .from("decks")
      .insert({ user_id: userId, name: data.name, description: data.description })
      .select("id")
      .single();
    if (error || !deck) throw new Error(error?.message ?? "Не удалось создать колоду");
    await addDeckToDefaultCollection(supabase, userId, deck.id);
    return { id: deck.id };
  });

export const createDeckWithCardsRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(300).default(""),
      cards: z.array(CardInput).min(0).max(100),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: deck, error } = await supabase
      .from("decks")
      .insert({ user_id: userId, name: data.name, description: data.description })
      .select("id")
      .single();
    if (error || !deck) throw new Error(error?.message ?? "Не удалось создать колоду");

    let cardIds: string[] = [];
    if (data.cards.length > 0) {
      const { data: insertedCards, error: cardsErr } = await supabase.from("cards").insert(
        data.cards.map((card, position) => ({
          deck_id: deck.id,
          user_id: userId,
          term: card.term,
          definition: card.definition,
          position,
        })),
      ).select("id");
      if (cardsErr) throw new Error(`Колода создана, но карточки не сохранились: ${cardsErr.message}`);
      cardIds = insertedCards?.map((card) => card.id) ?? [];
    }

    return { id: deck.id, cardIds };
  });

export const addCardRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      deckId: z.string().uuid(),
      term: z.string().min(1).max(160),
      definition: z.string().min(1).max(300),
      position: z.number().int().min(0).max(10000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: card, error } = await supabase
      .from("cards")
      .insert({ deck_id: data.deckId, user_id: userId, term: data.term, definition: data.definition, position: data.position })
      .select("id")
      .single();
    if (error || !card) throw new Error(error?.message ?? "Не удалось добавить карточку");
    return { id: card.id };
  });

export const deleteDeckRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("decks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCardRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("cards").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markCardRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), known: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("cards").update({ known: data.known }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetDeckProgressRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("cards").update({ known: false }).eq("deck_id", data.deckId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });