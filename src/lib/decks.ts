import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { scheduleNewCard } from "@/lib/delayed-recall";
import {
  addCardRecord,
  createDeckRecord,
  createDeckWithCardsRecord,
  deleteCardRecord,
  deleteDeckRecord,
  getMyDecks,
  markCardRecord,
  resetDeckProgressRecord,
} from "@/lib/decks.functions";

export type Card = {
  id: string;
  term: string;
  definition: string;
  known: boolean;
};

export type Deck = {
  id: string;
  name: string;
  description: string;
  cards: Card[];
  createdAt: number;
  updatedAt: number;
  visibility: "private" | "unlisted" | "public";
  category: string;
  keywords: string[];
  totalLearners: number;
  likes: number;
  rating: number;
  publishedAt: string | null;
  sourceDeckId: string | null;
};

type DbDeck = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at?: string;
  visibility?: "private" | "unlisted" | "public";
  category?: string;
  keywords?: string[];
  learner_count?: number;
  like_count?: number;
  rating_sum?: number;
  rating_count?: number;
  published_at?: string | null;
  source_deck_id?: string | null;
};

type DbCard = {
  id: string;
  deck_id: string;
  term: string;
  definition: string;
  known: boolean;
  position: number;
  created_at: string;
};

function mapDecks(decks: DbDeck[], cards: DbCard[]): Deck[] {
  const cardsByDeck = new Map<string, Card[]>();
  cards.forEach((c) => {
    const arr = cardsByDeck.get(c.deck_id) ?? [];
    arr.push({ id: c.id, term: c.term, definition: c.definition, known: c.known });
    cardsByDeck.set(c.deck_id, arr);
  });

  return decks.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description ?? "",
    cards: cardsByDeck.get(d.id) ?? [],
    createdAt: new Date(d.created_at).getTime(),
    updatedAt: new Date(d.updated_at ?? d.created_at).getTime(),
    visibility: d.visibility ?? "private",
    category: d.category ?? "General English",
    keywords: d.keywords ?? [],
    totalLearners: d.learner_count ?? 0,
    likes: d.like_count ?? 0,
    rating: d.rating_count ? Number(((d.rating_sum ?? 0) / d.rating_count).toFixed(1)) : 0,
    publishedAt: d.published_at ?? null,
    sourceDeckId: d.source_deck_id ?? null,
  }));
}

const DECKS_KEY = ["my-decks"] as const;

export function useDecks() {
  const queryClient = useQueryClient();
  const fetchMyDecks = useServerFn(getMyDecks);
  const createDeckFn = useServerFn(createDeckRecord);
  const createDeckWithCardsFn = useServerFn(createDeckWithCardsRecord);
  const addCardFn = useServerFn(addCardRecord);
  const deleteDeckFn = useServerFn(deleteDeckRecord);
  const deleteCardFn = useServerFn(deleteCardRecord);
  const markCardFn = useServerFn(markCardRecord);
  const resetDeckProgressFn = useServerFn(resetDeckProgressRecord);

  // Only fetch when authenticated to avoid "Unauthorized" 401s during SSR / after sign-out.
  const [hasSession, setHasSession] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
      setAuthReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const query = useQuery({
    queryKey: DECKS_KEY,
    enabled: authReady && hasSession,
    queryFn: async () => {
      const result = await fetchMyDecks();
      return mapDecks(result.decks as DbDeck[], result.cards as DbCard[]);
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("Unauthorized")) return false;
      return failureCount < 1;
    },
  });

  // Invalidate on real auth state changes (skip INITIAL_SESSION noise).
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        queryClient.invalidateQueries({ queryKey: DECKS_KEY });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const decks = query.data ?? [];

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: DECKS_KEY }),
    [queryClient],
  );

  const notAuth = () =>
    toast.error("Sign in to create decks and cards");

  const onError = (msg: string) => (error: unknown) => {
    if (error instanceof Error && error.message.includes("Unauthorized")) return notAuth();
    toast.error(`${msg}: ${error instanceof Error ? error.message : "unknown error"}`);
  };

  const createDeckMut = useMutation({
    mutationFn: (vars: { name: string; description: string; collectionId?: string | null }) =>
      createDeckFn({ data: vars }),
    onSuccess: () => {
      toast.success("Deck created");
      invalidate();
    },
    onError: onError("Could not create deck"),
  });

  const createDeckWithCardsMut = useMutation({
    mutationFn: (vars: {
      name: string;
      description: string;
      cards: { term: string; definition: string }[];
      collectionId?: string | null;
    }) => createDeckWithCardsFn({ data: vars }),
    onSuccess: (data) => {
      data.cardIds?.forEach((cardId) => scheduleNewCard(data.id, cardId));
      toast.success("Deck created");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["my-collections"] });
    },
    onError: onError("Could not create deck"),
  });

  const deleteDeckMut = useMutation({
    mutationFn: (id: string) => deleteDeckFn({ data: { id } }),
    onSuccess: invalidate,
    onError: onError("Could not delete"),
  });

  const addCardMut = useMutation({
    mutationFn: (vars: { deckId: string; term: string; definition: string; position: number }) =>
      addCardFn({ data: vars }),
    onSuccess: (data, vars) => {
      if (data?.id) scheduleNewCard(vars.deckId, data.id);
      invalidate();
    },
    onError: onError("Could not add card"),
  });

  const deleteCardMut = useMutation({
    mutationFn: (cardId: string) => deleteCardFn({ data: { id: cardId } }),
    onSuccess: invalidate,
    onError: onError("Could not delete card"),
  });

  const markCardMut = useMutation({
    mutationFn: (vars: { cardId: string; known: boolean }) =>
      markCardFn({ data: { id: vars.cardId, known: vars.known } }),
    // Optimistic update so the UI flips immediately without a refetch round-trip.
    onMutate: async ({ cardId, known }) => {
      await queryClient.cancelQueries({ queryKey: DECKS_KEY });
      const prev = queryClient.getQueryData<Deck[]>(DECKS_KEY);
      if (prev) {
        queryClient.setQueryData<Deck[]>(
          DECKS_KEY,
          prev.map((d) => ({
            ...d,
            cards: d.cards.map((c) => (c.id === cardId ? { ...c, known } : c)),
          })),
        );
      }
      return { prev };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(DECKS_KEY, ctx.prev);
      onError("Could not save progress")(error);
    },
  });

  const resetProgressMut = useMutation({
    mutationFn: (deckId: string) => resetDeckProgressFn({ data: { deckId } }),
    onSuccess: invalidate,
    onError: onError("Could not reset"),
  });

  return {
    decks,
    isLoading: !authReady || (hasSession && query.isLoading),
    createDeck: (name: string, description: string, collectionId?: string | null) => {
      return createDeckMut.mutateAsync({ name, description, collectionId });
    },
    createDeckWithCards: (
      name: string,
      description: string,
      cards: { term: string; definition: string }[],
      collectionId?: string | null,
    ) => {
      return createDeckWithCardsMut.mutateAsync({ name, description, cards, collectionId });
    },
    deleteDeck: (id: string) => deleteDeckMut.mutate(id),
    addCard: (deckId: string, term: string, definition: string) => {
      const deck = decks.find((d) => d.id === deckId);
      const position = deck ? deck.cards.length : 0;
      addCardMut.mutate({ deckId, term, definition, position });
    },
    deleteCard: (_deckId: string, cardId: string) => deleteCardMut.mutate(cardId),
    markCard: (_deckId: string, cardId: string, known: boolean) =>
      markCardMut.mutate({ cardId, known }),
    resetProgress: (deckId: string) => resetProgressMut.mutate(deckId),
  };
}

export function useDeck(id: string) {
  const { decks, ...rest } = useDecks();
  const deck = useMemo(() => decks.find((d) => d.id === id), [decks, id]);
  return { deck, ...rest };
}
