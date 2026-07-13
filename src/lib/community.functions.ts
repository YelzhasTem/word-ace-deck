import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const DECK_CATEGORIES = [
  "General English",
  "Travel",
  "Business",
  "Academic",
  "IELTS",
  "TOEFL",
  "Technology",
  "Programming",
  "Medical",
  "Custom",
] as const;

const DeckVisibility = z.enum(["private", "unlisted", "public"]);
const DeckCategory = z.enum(DECK_CATEGORIES);

type CommunityDeckRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  visibility: "private" | "unlisted" | "public";
  category: (typeof DECK_CATEGORIES)[number];
  keywords: string[];
  learner_count: number;
  like_count: number;
  rating_sum: number;
  rating_count: number;
  view_count: number;
  copy_count: number;
  published_at: string | null;
  target_language?: string | null;
  definition_language?: string | null;
};

type ProfileRow = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  avatar_url?: string | null;
};

type CommunityCollectionRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  visibility: "private" | "unlisted" | "public";
  keywords: string[];
  learner_count: number;
  like_count: number;
  rating_sum: number;
  rating_count: number;
  view_count: number;
  copy_count: number;
  published_at: string | null;
};

function ratingFor(deck: Pick<CommunityDeckRow, "rating_sum" | "rating_count">) {
  return deck.rating_count ? Number((deck.rating_sum / deck.rating_count).toFixed(1)) : 0;
}

function authorName(profile?: ProfileRow) {
  return (
    profile?.username || profile?.display_name || profile?.email?.split("@")[0] || "Memora creator"
  );
}

function ratingForCollection(
  collection: Pick<CommunityCollectionRow, "rating_sum" | "rating_count">,
) {
  return collection.rating_count
    ? Number((collection.rating_sum / collection.rating_count).toFixed(1))
    : 0;
}

async function attachCommunityMeta(supabase: any, decks: CommunityDeckRow[], userId: string) {
  if (decks.length === 0) return [];
  const deckIds = decks.map((deck) => deck.id);
  const authorIds = Array.from(new Set(decks.map((deck) => deck.user_id)));

  const [profilesRes, cardsRes, likesRes, savesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("user_id, username, display_name, email, avatar_url")
      .in("user_id", authorIds),
    supabase.from("cards").select("deck_id").in("deck_id", deckIds),
    supabase.from("deck_likes").select("deck_id").eq("user_id", userId).in("deck_id", deckIds),
    supabase.from("deck_saves").select("deck_id").eq("user_id", userId).in("deck_id", deckIds),
  ]);

  if (profilesRes.error) throw new Error(profilesRes.error.message);
  if (cardsRes.error) throw new Error(cardsRes.error.message);
  if (likesRes.error) throw new Error(likesRes.error.message);
  if (savesRes.error) throw new Error(savesRes.error.message);

  const profiles = new Map<string, ProfileRow>(
    (profilesRes.data ?? []).map((p: ProfileRow) => [p.user_id, p]),
  );
  const cardCounts = new Map<string, number>();
  for (const card of cardsRes.data ?? []) {
    cardCounts.set(card.deck_id, (cardCounts.get(card.deck_id) ?? 0) + 1);
  }
  const liked = new Set<string>(
    (likesRes.data ?? []).map((row: { deck_id: string }) => row.deck_id),
  );
  const saved = new Set<string>(
    (savesRes.data ?? []).map((row: { deck_id: string }) => row.deck_id),
  );

  return decks.map((deck) => ({
    id: deck.id,
    title: deck.name,
    description: deck.description ?? "",
    authorId: deck.user_id,
    authorName: authorName(profiles.get(deck.user_id)),
    createdAt: deck.created_at,
    updatedAt: deck.updated_at,
    publishedAt: deck.published_at,
    visibility: deck.visibility,
    category: deck.category,
    keywords: deck.keywords ?? [],
    cardCount: cardCounts.get(deck.id) ?? 0,
    totalLearners: deck.learner_count,
    likes: deck.like_count,
    rating: ratingFor(deck),
    ratingCount: deck.rating_count,
    views: deck.view_count,
    copies: deck.copy_count,
    liked: liked.has(deck.id),
    saved: saved.has(deck.id),
  }));
}

async function attachCollectionMeta(
  supabase: any,
  collections: CommunityCollectionRow[],
  userId: string,
) {
  if (collections.length === 0) return [];
  const collectionIds = collections.map((collection) => collection.id);
  const authorIds = Array.from(new Set(collections.map((collection) => collection.user_id)));

  const [profilesRes, linksRes, likesRes, savesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("user_id, username, display_name, email, avatar_url")
      .in("user_id", authorIds),
    supabase
      .from("collection_decks")
      .select("collection_id, deck_id")
      .in("collection_id", collectionIds),
    supabase
      .from("collection_likes")
      .select("collection_id")
      .eq("user_id", userId)
      .in("collection_id", collectionIds),
    supabase
      .from("collection_saves")
      .select("collection_id")
      .eq("user_id", userId)
      .in("collection_id", collectionIds),
  ]);

  if (profilesRes.error) throw new Error(profilesRes.error.message);
  if (linksRes.error) throw new Error(linksRes.error.message);
  if (likesRes.error) throw new Error(likesRes.error.message);
  if (savesRes.error) throw new Error(savesRes.error.message);

  const profiles = new Map<string, ProfileRow>(
    (profilesRes.data ?? []).map((p: ProfileRow) => [p.user_id, p]),
  );
  const deckCounts = new Map<string, number>();
  for (const link of linksRes.data ?? []) {
    deckCounts.set(link.collection_id, (deckCounts.get(link.collection_id) ?? 0) + 1);
  }
  const liked = new Set<string>(
    (likesRes.data ?? []).map((row: { collection_id: string }) => row.collection_id),
  );
  const saved = new Set<string>(
    (savesRes.data ?? []).map((row: { collection_id: string }) => row.collection_id),
  );

  return collections.map((collection) => ({
    id: collection.id,
    title: collection.name,
    description: collection.description ?? "",
    authorId: collection.user_id,
    authorName: authorName(profiles.get(collection.user_id)),
    createdAt: collection.created_at,
    updatedAt: collection.updated_at,
    publishedAt: collection.published_at,
    visibility: collection.visibility,
    keywords: collection.keywords ?? [],
    deckCount: deckCounts.get(collection.id) ?? 0,
    totalLearners: collection.learner_count,
    likes: collection.like_count,
    rating: ratingForCollection(collection),
    ratingCount: collection.rating_count,
    views: collection.view_count,
    copies: collection.copy_count,
    liked: liked.has(collection.id),
    saved: saved.has(collection.id),
  }));
}

export const searchPublicDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        query: z.string().max(120).default(""),
        category: DeckCategory.optional().nullable(),
        sort: z
          .enum(["popular", "rating", "learners", "newest", "updated", "likes"])
          .default("popular"),
        author: z.string().max(80).default(""),
        savedOnly: z.boolean().default(false),
        followingOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(48).default(24),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let deckIdsFilter: string[] | null = null;
    if (data.savedOnly) {
      const { data: saves, error } = await (supabase as any)
        .from("deck_saves")
        .select("deck_id")
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      deckIdsFilter = (saves ?? []).map((row: { deck_id: string }) => row.deck_id);
      if (deckIdsFilter.length === 0) return { decks: [] };
    }

    if (data.followingOnly) {
      const { data: follows, error } = await (supabase as any)
        .from("creator_follows")
        .select("creator_id")
        .eq("follower_id", userId);
      if (error) throw new Error(error.message);
      const creatorIds = (follows ?? []).map((row: { creator_id: string }) => row.creator_id);
      if (creatorIds.length === 0) return { decks: [] };
      const { data: followedDecks, error: deckErr } = await (supabase as any)
        .from("decks")
        .select("id")
        .in("user_id", creatorIds)
        .eq("visibility", "public")
        .is("hidden_at", null);
      if (deckErr) throw new Error(deckErr.message);
      const followedIds = (followedDecks ?? []).map((row: { id: string }) => row.id);
      deckIdsFilter = deckIdsFilter
        ? deckIdsFilter.filter((id) => followedIds.includes(id))
        : followedIds;
      if (deckIdsFilter.length === 0) return { decks: [] };
    }

    let query = (supabase as any)
      .from("decks")
      .select(
        "id, user_id, name, description, target_language, definition_language, created_at, updated_at, visibility, category, keywords, learner_count, like_count, rating_sum, rating_count, view_count, copy_count, published_at",
      )
      .eq("visibility", "public")
      .is("hidden_at", null)
      .limit(data.limit);

    if (data.category) query = query.eq("category", data.category);
    if (deckIdsFilter) query = query.in("id", deckIdsFilter);

    const search = data.query.trim();
    if (search) {
      const safe = search.replace(/[%_,]/g, " ");
      const keywordClause = safe.includes(" ") ? "" : `,keywords.cs.{${safe}}`;
      query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%${keywordClause}`);
    }

    if (data.author.trim()) {
      const { data: profiles, error } = await (supabase as any)
        .from("profiles")
        .select("user_id")
        .or(
          `username.ilike.%${data.author.trim()}%,display_name.ilike.%${data.author.trim()}%,email.ilike.%${data.author.trim()}%`,
        );
      if (error) throw new Error(error.message);
      const ids = (profiles ?? []).map((p: { user_id: string }) => p.user_id);
      if (ids.length === 0) return { decks: [] };
      query = query.in("user_id", ids);
    }

    if (data.sort === "rating") query = query.order("rating_sum", { ascending: false });
    else if (data.sort === "learners") query = query.order("learner_count", { ascending: false });
    else if (data.sort === "newest")
      query = query.order("published_at", { ascending: false, nullsFirst: false });
    else if (data.sort === "updated") query = query.order("updated_at", { ascending: false });
    else if (data.sort === "likes") query = query.order("like_count", { ascending: false });
    else
      query = query
        .order("learner_count", { ascending: false })
        .order("like_count", { ascending: false });

    const { data: decks, error } = await query;
    if (error) throw new Error(error.message);

    return { decks: await attachCommunityMeta(supabase, decks ?? [], userId) };
  });

export const searchPublicCollections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        query: z.string().max(120).default(""),
        sort: z
          .enum(["popular", "rating", "learners", "newest", "updated", "likes"])
          .default("popular"),
        savedOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(48).default(24),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let collectionIdsFilter: string[] | null = null;
    if (data.savedOnly) {
      const { data: saves, error } = await (supabase as any)
        .from("collection_saves")
        .select("collection_id")
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      collectionIdsFilter = (saves ?? []).map(
        (row: { collection_id: string }) => row.collection_id,
      );
      if (collectionIdsFilter.length === 0) return { collections: [] };
    }

    let query = (supabase as any)
      .from("collections")
      .select(
        "id, user_id, name, description, created_at, updated_at, visibility, keywords, learner_count, like_count, rating_sum, rating_count, view_count, copy_count, published_at",
      )
      .eq("visibility", "public")
      .is("hidden_at", null)
      .limit(data.limit);

    if (collectionIdsFilter) query = query.in("id", collectionIdsFilter);

    const search = data.query.trim();
    if (search) {
      const safe = search.replace(/[%_,]/g, " ");
      const keywordClause = safe.includes(" ") ? "" : `,keywords.cs.{${safe}}`;
      query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%${keywordClause}`);
    }

    if (data.sort === "rating") query = query.order("rating_sum", { ascending: false });
    else if (data.sort === "learners") query = query.order("learner_count", { ascending: false });
    else if (data.sort === "newest")
      query = query.order("published_at", { ascending: false, nullsFirst: false });
    else if (data.sort === "updated") query = query.order("updated_at", { ascending: false });
    else if (data.sort === "likes") query = query.order("like_count", { ascending: false });
    else
      query = query
        .order("learner_count", { ascending: false })
        .order("like_count", { ascending: false });

    const { data: collections, error } = await query;
    if (error) throw new Error(error.message);

    return { collections: await attachCollectionMeta(supabase, collections ?? [], userId) };
  });

export const getCommunityHome = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const baseSelect =
      "id, user_id, name, description, target_language, definition_language, created_at, updated_at, visibility, category, keywords, learner_count, like_count, rating_sum, rating_count, view_count, copy_count, published_at";

    async function section(order: "trending" | "popular" | "new" | "rated") {
      let q = (supabase as any)
        .from("decks")
        .select(baseSelect)
        .eq("visibility", "public")
        .is("hidden_at", null)
        .limit(6);
      if (order === "trending")
        q = q.order("view_count", { ascending: false }).order("like_count", { ascending: false });
      if (order === "popular")
        q = q
          .order("learner_count", { ascending: false })
          .order("copy_count", { ascending: false });
      if (order === "new") q = q.order("published_at", { ascending: false, nullsFirst: false });
      if (order === "rated")
        q = q.order("rating_sum", { ascending: false }).order("rating_count", { ascending: false });
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return attachCommunityMeta(supabase, data ?? [], userId);
    }

    const [trending, popular, newest, topRated, recommended] = await Promise.all([
      section("trending"),
      section("popular"),
      section("new"),
      section("rated"),
      section("popular"),
    ]);

    return { trending, popular, newest, topRated, recommended };
  });

export const getPublicDeckDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: deck, error } = await (supabase as any)
      .from("decks")
      .select(
        "id, user_id, name, description, target_language, definition_language, created_at, updated_at, visibility, category, keywords, learner_count, like_count, rating_sum, rating_count, view_count, copy_count, published_at",
      )
      .eq("id", data.deckId)
      .in("visibility", ["public", "unlisted"])
      .is("hidden_at", null)
      .single();
    if (error || !deck) throw new Error(error?.message ?? "Deck not found");

    await (supabase as any)
      .from("decks")
      .update({ view_count: (deck.view_count ?? 0) + 1 })
      .eq("id", deck.id);

    const [meta] = await attachCommunityMeta(supabase, [deck], userId);
    const { data: cards, error: cardsError } = await (supabase as any)
      .from("cards")
      .select("id, term, definition, position")
      .eq("deck_id", deck.id)
      .order("position", { ascending: true });
    if (cardsError) throw new Error(cardsError.message);

    return { deck: meta, cards: cards ?? [] };
  });

export const updateDeckPublishing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        deckId: z.string().uuid(),
        visibility: DeckVisibility,
        category: DeckCategory,
        keywords: z.array(z.string().min(1).max(40)).max(12).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const update = {
      visibility: data.visibility,
      category: data.category,
      keywords: data.keywords.map((word) => word.trim()).filter(Boolean),
      published_at: data.visibility === "public" ? new Date().toISOString() : null,
    };
    const { error } = await (supabase as any)
      .from("decks")
      .update(update)
      .eq("id", data.deckId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleDeckLike = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await (supabase as any)
      .from("deck_likes")
      .select("id")
      .eq("deck_id", data.deckId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await (supabase as any).from("deck_likes").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await (supabase as any)
        .from("deck_likes")
        .insert({ deck_id: data.deckId, user_id: userId });
      if (error) throw new Error(error.message);
    }
    const { count } = await (supabase as any)
      .from("deck_likes")
      .select("id", { count: "exact", head: true })
      .eq("deck_id", data.deckId);
    await (supabase as any)
      .from("decks")
      .update({ like_count: count ?? 0 })
      .eq("id", data.deckId);
    return { liked: !existing?.id, likes: count ?? 0 };
  });

export const toggleDeckSave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await (supabase as any)
      .from("deck_saves")
      .select("id")
      .eq("deck_id", data.deckId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await (supabase as any).from("deck_saves").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await (supabase as any)
        .from("deck_saves")
        .insert({ deck_id: data.deckId, user_id: userId });
      if (error) throw new Error(error.message);
    }
    return { saved: !existing?.id };
  });

export const rateDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ deckId: z.string().uuid(), rating: z.number().int().min(1).max(5) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any)
      .from("deck_ratings")
      .upsert(
        { deck_id: data.deckId, user_id: userId, rating: data.rating },
        { onConflict: "deck_id,user_id" },
      );
    if (error) throw new Error(error.message);
    const { data: ratings, error: ratingsError } = await (supabase as any)
      .from("deck_ratings")
      .select("rating")
      .eq("deck_id", data.deckId);
    if (ratingsError) throw new Error(ratingsError.message);
    const rating_sum = (ratings ?? []).reduce(
      (sum: number, row: { rating: number }) => sum + row.rating,
      0,
    );
    const rating_count = ratings?.length ?? 0;
    await (supabase as any)
      .from("decks")
      .update({ rating_sum, rating_count })
      .eq("id", data.deckId);
    return { rating: rating_count ? rating_sum / rating_count : 0, ratingCount: rating_count };
  });

export const rateCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ collectionId: z.string().uuid(), rating: z.number().int().min(1).max(5) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any)
      .from("collection_ratings")
      .upsert(
        { collection_id: data.collectionId, user_id: userId, rating: data.rating },
        { onConflict: "collection_id,user_id" },
      );
    if (error) throw new Error(error.message);
    const { data: ratings, error: ratingsError } = await (supabase as any)
      .from("collection_ratings")
      .select("rating")
      .eq("collection_id", data.collectionId);
    if (ratingsError) throw new Error(ratingsError.message);
    const rating_sum = (ratings ?? []).reduce(
      (sum: number, row: { rating: number }) => sum + row.rating,
      0,
    );
    const rating_count = ratings?.length ?? 0;
    await (supabase as any)
      .from("collections")
      .update({ rating_sum, rating_count })
      .eq("id", data.collectionId);
    return { rating: rating_count ? rating_sum / rating_count : 0, ratingCount: rating_count };
  });

export const reportDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ deckId: z.string().uuid(), reason: z.string().min(3).max(400) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("deck_reports")
      .insert({ deck_id: data.deckId, reporter_id: context.userId, reason: data.reason });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicatePublicDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: deck, error } = await (supabase as any)
      .from("decks")
      .select(
        "id, name, description, target_language, definition_language, category, keywords, copy_count, learner_count",
      )
      .eq("id", data.deckId)
      .in("visibility", ["public", "unlisted"])
      .is("hidden_at", null)
      .single();
    if (error || !deck) throw new Error(error?.message ?? "Deck not found");
    const { data: cards, error: cardsError } = await (supabase as any)
      .from("cards")
      .select("term, definition, position")
      .eq("deck_id", deck.id)
      .order("position", { ascending: true });
    if (cardsError) throw new Error(cardsError.message);
    const copiedTargetLanguage = deck.target_language ?? "en";
    const copiedDefinitionLanguage =
      deck.definition_language ?? (copiedTargetLanguage === "en" ? "ru" : "en");
    const { data: newDeck, error: createError } = await (supabase as any)
      .from("decks")
      .insert({
        user_id: userId,
        name: `${deck.name} (copy)`,
        description: deck.description ?? "",
        category: deck.category,
        keywords: deck.keywords ?? [],
        target_language: copiedTargetLanguage,
        definition_language: copiedDefinitionLanguage,
        source_deck_id: deck.id,
        visibility: "private",
      })
      .select("id")
      .single();
    if (createError || !newDeck)
      throw new Error(createError?.message ?? "Failed to duplicate deck");
    if ((cards ?? []).length > 0) {
      const { error: insertCardsError } = await (supabase as any).from("cards").insert(
        cards.map(
          (card: { term: string; definition: string; position: number }, position: number) => ({
            deck_id: newDeck.id,
            user_id: userId,
            term: card.term,
            definition: card.definition,
            position,
          }),
        ),
      );
      if (insertCardsError) throw new Error(insertCardsError.message);
    }
    await (supabase as any)
      .from("decks")
      .update({
        copy_count: (deck.copy_count ?? 0) + 1,
        learner_count: (deck.learner_count ?? 0) + 1,
      })
      .eq("id", deck.id);
    return { id: newDeck.id };
  });

export const duplicatePublicCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ collectionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: collection, error } = await (supabase as any)
      .from("collections")
      .select("id, name, description, keywords, copy_count, learner_count")
      .eq("id", data.collectionId)
      .in("visibility", ["public", "unlisted"])
      .is("hidden_at", null)
      .single();
    if (error || !collection) throw new Error(error?.message ?? "Collection not found");

    const { data: links, error: linksError } = await (supabase as any)
      .from("collection_decks")
      .select("deck_id, position")
      .eq("collection_id", collection.id)
      .order("position", { ascending: true });
    if (linksError) throw new Error(linksError.message);

    const sourceDeckIds = (links ?? []).map((link: { deck_id: string }) => link.deck_id);
    const { data: sourceDecks, error: deckError } = sourceDeckIds.length
      ? await (supabase as any)
          .from("decks")
          .select(
            "id, name, description, target_language, definition_language, category, keywords, copy_count, learner_count",
          )
          .in("id", sourceDeckIds)
      : { data: [], error: null };
    if (deckError) throw new Error(deckError.message);

    const { data: newCollection, error: createCollectionError } = await (supabase as any)
      .from("collections")
      .insert({
        user_id: userId,
        name: `${collection.name} (copy)`,
        description: collection.description ?? "",
        keywords: collection.keywords ?? [],
        source_collection_id: collection.id,
        visibility: "private",
      })
      .select("id")
      .single();
    if (createCollectionError || !newCollection) {
      throw new Error(createCollectionError?.message ?? "Failed to duplicate collection");
    }

    const decksById = new Map((sourceDecks ?? []).map((deck: any) => [deck.id, deck]));
    const newLinks: {
      collection_id: string;
      deck_id: string;
      user_id: string;
      position: number;
    }[] = [];

    for (const [position, sourceDeckId] of sourceDeckIds.entries()) {
      const deck = decksById.get(sourceDeckId);
      if (!deck) continue;
      const { data: cards, error: cardsError } = await (supabase as any)
        .from("cards")
        .select("term, definition, position")
        .eq("deck_id", deck.id)
        .order("position", { ascending: true });
      if (cardsError) throw new Error(cardsError.message);
      const copiedTargetLanguage = deck.target_language ?? "en";
      const copiedDefinitionLanguage =
        deck.definition_language ?? (copiedTargetLanguage === "en" ? "ru" : "en");

      const { data: newDeck, error: createDeckError } = await (supabase as any)
        .from("decks")
        .insert({
          user_id: userId,
          name: `${deck.name} (copy)`,
          description: deck.description ?? "",
          category: deck.category,
          keywords: deck.keywords ?? [],
          target_language: copiedTargetLanguage,
          definition_language: copiedDefinitionLanguage,
          source_deck_id: deck.id,
          visibility: "private",
        })
        .select("id")
        .single();
      if (createDeckError || !newDeck)
        throw new Error(createDeckError?.message ?? "Failed to duplicate deck");

      if ((cards ?? []).length > 0) {
        const { error: insertCardsError } = await (supabase as any).from("cards").insert(
          cards.map(
            (
              card: { term: string; definition: string; position: number },
              cardPosition: number,
            ) => ({
              deck_id: newDeck.id,
              user_id: userId,
              term: card.term,
              definition: card.definition,
              position: cardPosition,
            }),
          ),
        );
        if (insertCardsError) throw new Error(insertCardsError.message);
      }

      await (supabase as any)
        .from("decks")
        .update({
          copy_count: (deck.copy_count ?? 0) + 1,
          learner_count: (deck.learner_count ?? 0) + 1,
        })
        .eq("id", deck.id);
      newLinks.push({
        collection_id: newCollection.id,
        deck_id: newDeck.id,
        user_id: userId,
        position,
      });
    }

    if (newLinks.length > 0) {
      const { error: linkError } = await (supabase as any)
        .from("collection_decks")
        .insert(newLinks);
      if (linkError) throw new Error(linkError.message);
    }

    await (supabase as any)
      .from("collections")
      .update({
        copy_count: (collection.copy_count ?? 0) + 1,
        learner_count: (collection.learner_count ?? 0) + 1,
      })
      .eq("id", collection.id);

    return { id: newCollection.id };
  });

export const getCreatorProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile, error: profileError } = await (supabase as any)
      .from("profiles")
      .select("user_id, username, display_name, email, avatar_url")
      .eq("user_id", data.userId)
      .single();
    if (profileError) throw new Error(profileError.message);

    const { data: decks, error: decksError } = await (supabase as any)
      .from("decks")
      .select(
        "id, user_id, name, description, target_language, definition_language, created_at, updated_at, visibility, category, keywords, learner_count, like_count, rating_sum, rating_count, view_count, copy_count, published_at",
      )
      .eq("user_id", data.userId)
      .eq("visibility", "public")
      .is("hidden_at", null)
      .order("published_at", { ascending: false });
    if (decksError) throw new Error(decksError.message);

    const { count: followers } = await (supabase as any)
      .from("creator_follows")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", data.userId);
    const { data: followed } = await (supabase as any)
      .from("creator_follows")
      .select("id")
      .eq("creator_id", data.userId)
      .eq("follower_id", userId)
      .maybeSingle();

    const publicDecks = await attachCommunityMeta(supabase, decks ?? [], userId);
    return {
      profile: {
        userId: data.userId,
        username: authorName(profile),
        avatarUrl: profile?.avatar_url ?? null,
        totalLearners: publicDecks.reduce((sum, deck) => sum + deck.totalLearners, 0),
        totalLikes: publicDecks.reduce((sum, deck) => sum + deck.likes, 0),
        followers: followers ?? 0,
        followed: !!followed,
      },
      decks: publicDecks,
    };
  });

export const toggleCreatorFollow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ creatorId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    if (data.creatorId === context.userId) return { followed: false };
    const { data: existing } = await (context.supabase as any)
      .from("creator_follows")
      .select("id")
      .eq("creator_id", data.creatorId)
      .eq("follower_id", context.userId)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await (context.supabase as any)
        .from("creator_follows")
        .delete()
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { followed: false };
    }
    const { error } = await (context.supabase as any)
      .from("creator_follows")
      .insert({ creator_id: data.creatorId, follower_id: context.userId });
    if (error) throw new Error(error.message);
    return { followed: true };
  });

export const getModerationQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("deck_reports")
      .select("id, deck_id, reporter_id, reason, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { reports: data ?? [] };
  });

export const reviewDeckReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        reportId: z.string().uuid(),
        deckId: z.string().uuid(),
        action: z.enum(["hide", "dismiss"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.action === "hide") {
      const { error: deckError } = await (context.supabase as any)
        .from("decks")
        .update({ hidden_at: new Date().toISOString() })
        .eq("id", data.deckId);
      if (deckError) throw new Error(deckError.message);
    }
    const { error } = await (context.supabase as any)
      .from("deck_reports")
      .update({
        status: data.action === "hide" ? "hidden" : "dismissed",
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.reportId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
