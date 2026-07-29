import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DECK_COVER_COLOR_VALUES, type DeckCoverColor } from "@/lib/deck-colors";
import {
  getDefinitionLanguageFor,
  LEARNING_LANGUAGE_CODES,
  normalizeDefinitionLanguage,
  type LearningLanguage,
} from "@/lib/languages";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DEFAULT_COLLECTION_NAME = "My collection";
const MIN_DECK_CARDS = 4;
const MAX_DECK_CARDS = 100;

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

async function addDeckToCollection(
  supabase: SupabaseClient,
  userId: string,
  deckId: string,
  collectionId?: string | null,
): Promise<void> {
  let targetId: string | null = null;
  if (collectionId) {
    const { data: owned } = await supabase
      .from("collections")
      .select("id")
      .eq("id", collectionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (owned?.id) targetId = owned.id;
  }
  if (!targetId) targetId = await ensureDefaultCollectionId(supabase, userId);
  if (!targetId) return;
  const { count } = await supabase
    .from("collection_decks")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", targetId)
    .eq("user_id", userId);
  await supabase.from("collection_decks").insert({
    collection_id: targetId,
    deck_id: deckId,
    user_id: userId,
    position: count ?? 0,
  });
}

const CardInput = z.object({
  term: z.string().min(1).max(160),
  definition: z.string().min(1).max(300),
});
const DeckCoverColorInput = z.enum(DECK_COVER_COLOR_VALUES).optional().nullable();
const LearningLanguageInput = z.enum(LEARNING_LANGUAGE_CODES).default("en");

async function createDeckRow(
  supabase: SupabaseClient,
  userId: string,
  data: {
    name: string;
    description: string;
    coverColor?: DeckCoverColor | null;
    targetLanguage?: LearningLanguage;
    definitionLanguage?: LearningLanguage;
  },
) {
  const targetLanguage = data.targetLanguage ?? "en";
  const baseInsert = {
    user_id: userId,
    name: data.name,
    description: data.description,
    target_language: targetLanguage,
    definition_language: data.definitionLanguage
      ? normalizeDefinitionLanguage(data.definitionLanguage, targetLanguage)
      : getDefinitionLanguageFor(targetLanguage).code,
  };
  const coverColor = data.coverColor ?? null;
  let result = await supabase
    .from("decks")
    .insert({ ...baseInsert, cover_color: coverColor })
    .select("id")
    .single();

  if (result.error?.code === "42703") {
    result = await supabase
      .from("decks")
      .insert({
        user_id: userId,
        name: data.name,
        description: data.description,
      })
      .select("id")
      .single();
  }

  return result;
}

export const getMyDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const decksRes = await supabase
      .from("decks")
      .select(
        "id, name, description, cover_color, target_language, definition_language, created_at, updated_at, visibility, category, keywords, learner_count, like_count, rating_sum, rating_count, published_at, source_deck_id",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const cardsRes = await supabase
      .from("cards")
      .select("id, deck_id, term, definition, known, position, created_at")
      .eq("user_id", userId)
      .order("position", { ascending: true });

    if (decksRes.error) throw new Error(decksRes.error.message);
    if (cardsRes.error) throw new Error(cardsRes.error.message);

    return { decks: decksRes.data ?? [], cards: cardsRes.data ?? [] };
  });

export const createDeckRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(1).max(120),
        description: z.string().max(300).default(""),
        coverColor: DeckCoverColorInput,
        targetLanguage: LearningLanguageInput,
        definitionLanguage: LearningLanguageInput.optional(),
        collectionId: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: deck, error } = await createDeckRow(supabase, userId, data);
    if (error || !deck) throw new Error(error?.message ?? "Could not create deck");
    await addDeckToCollection(supabase, userId, deck.id, data.collectionId);
    return { id: deck.id };
  });

export const createDeckWithCardsRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(1).max(120),
        description: z.string().max(300).default(""),
        coverColor: DeckCoverColorInput,
        targetLanguage: LearningLanguageInput,
        definitionLanguage: LearningLanguageInput.optional(),
        cards: z.array(CardInput).min(MIN_DECK_CARDS).max(MAX_DECK_CARDS),
        collectionId: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: deck, error } = await createDeckRow(supabase, userId, data);
    if (error || !deck) throw new Error(error?.message ?? "Could not create deck");
    await addDeckToCollection(supabase, userId, deck.id, data.collectionId);

    let cardIds: string[] = [];
    if (data.cards.length > 0) {
      const { data: insertedCards, error: cardsErr } = await supabase
        .from("cards")
        .insert(
          data.cards.map((card, position) => ({
            deck_id: deck.id,
            user_id: userId,
            term: card.term,
            definition: card.definition,
            position,
          })),
        )
        .select("id");
      if (cardsErr)
        throw new Error(`Deck was created, but cards were not saved: ${cardsErr.message}`);
      cardIds = insertedCards?.map((card) => card.id) ?? [];
    }

    return { id: deck.id, cardIds };
  });

export const addCardRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        deckId: z.string().uuid(),
        term: z.string().min(1).max(160),
        definition: z.string().min(1).max(300),
        position: z.number().int().min(0).max(10000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { count, error: countError } = await supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("deck_id", data.deckId)
      .eq("user_id", userId);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= MAX_DECK_CARDS) {
      throw new Error(`A deck can have at most ${MAX_DECK_CARDS} cards`);
    }

    const { data: card, error } = await supabase
      .from("cards")
      .insert({
        deck_id: data.deckId,
        user_id: userId,
        term: data.term,
        definition: data.definition,
        position: data.position,
      })
      .select("id")
      .single();
    if (error || !card) throw new Error(error?.message ?? "Could not add card");
    return { id: card.id };
  });

export const updateDeckRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120),
        description: z.string().max(300).default(""),
        coverColor: DeckCoverColorInput,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const update = {
      name: data.name,
      description: data.description,
      cover_color: data.coverColor ?? null,
    };
    let result = await context.supabase
      .from("decks")
      .update(update)
      .eq("id", data.id)
      .eq("user_id", context.userId);

    if (result.error?.code === "42703") {
      result = await context.supabase
        .from("decks")
        .update({ name: data.name, description: data.description })
        .eq("id", data.id)
        .eq("user_id", context.userId);
    }

    const { error } = result;
    if (error) throw new Error(error.message);
    return { ok: true };
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
    const { error } = await context.supabase.rpc("set_card_known", {
      p_card_id: data.id,
      p_known: data.known,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetDeckProgressRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("reset_deck_known", {
      p_deck_id: data.deckId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
