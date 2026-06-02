import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { scheduleNewCard } from "@/lib/delayed-recall";

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
};

type DbDeck = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
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

async function fetchDecks(): Promise<Deck[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data: decks, error: decksErr } = await supabase
    .from("decks")
    .select("id, name, description, created_at")
    .order("created_at", { ascending: false });
  if (decksErr || !decks) return [];

  const { data: cards, error: cardsErr } = await supabase
    .from("cards")
    .select("id, deck_id, term, definition, known, position, created_at")
    .order("position", { ascending: true });
  if (cardsErr) return [];

  const cardsByDeck = new Map<string, Card[]>();
  (cards as DbCard[] | null)?.forEach((c) => {
    const arr = cardsByDeck.get(c.deck_id) ?? [];
    arr.push({ id: c.id, term: c.term, definition: c.definition, known: c.known });
    cardsByDeck.set(c.deck_id, arr);
  });

  return (decks as DbDeck[]).map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description ?? "",
    cards: cardsByDeck.get(d.id) ?? [],
    createdAt: new Date(d.created_at).getTime(),
  }));
}

function emitChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("decks:changed"));
  }
}

export function useDecks() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const decksRef = useRef<Deck[]>([]);

  const reload = useCallback(async () => {
    const next = await fetchDecks();
    decksRef.current = next;
    setDecks(next);
  }, []);

  useEffect(() => {
    reload();
    const handler = () => reload();
    window.addEventListener("decks:changed", handler);
    const { data: sub } = supabase.auth.onAuthStateChange(() => reload());
    return () => {
      window.removeEventListener("decks:changed", handler);
      sub.subscription.unsubscribe();
    };
  }, [reload]);

  const requireUser = async () => {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  };

  return {
    decks,
    createDeck: (name: string, description: string) => {
      const tempId = crypto.randomUUID();
      (async () => {
        const userId = await requireUser();
        if (!userId) return;
        await supabase.from("decks").insert({ user_id: userId, name, description });
        emitChange();
      })();
      return tempId;
    },
    deleteDeck: (id: string) => {
      (async () => {
        await supabase.from("decks").delete().eq("id", id);
        emitChange();
      })();
    },
    addCard: (deckId: string, term: string, definition: string) => {
      (async () => {
        const userId = await requireUser();
        if (!userId) return;
        const deck = decksRef.current.find((d) => d.id === deckId);
        const position = deck ? deck.cards.length : 0;
        const { data } = await supabase
          .from("cards")
          .insert({ deck_id: deckId, user_id: userId, term, definition, position })
          .select("id")
          .single();
        if (data?.id) scheduleNewCard(deckId, data.id);
        emitChange();
      })();
    },
    deleteCard: (_deckId: string, cardId: string) => {
      (async () => {
        await supabase.from("cards").delete().eq("id", cardId);
        emitChange();
      })();
    },
    markCard: (_deckId: string, cardId: string, known: boolean) => {
      // Optimistic local update for snappy UI
      decksRef.current = decksRef.current.map((d) => ({
        ...d,
        cards: d.cards.map((c) => (c.id === cardId ? { ...c, known } : c)),
      }));
      setDecks(decksRef.current);
      (async () => {
        await supabase.from("cards").update({ known }).eq("id", cardId);
      })();
    },
    resetProgress: (deckId: string) => {
      (async () => {
        await supabase.from("cards").update({ known: false }).eq("deck_id", deckId);
        emitChange();
      })();
    },
    createDeckWithCards: (
      name: string,
      description: string,
      cards: { term: string; definition: string }[],
    ) => {
      const tempId = crypto.randomUUID();
      (async () => {
        const userId = await requireUser();
        if (!userId) return;
        const { data, error } = await supabase
          .from("decks")
          .insert({ user_id: userId, name, description })
          .select("id")
          .single();
        if (error || !data) return;
        if (cards.length > 0) {
          await supabase.from("cards").insert(
            cards.map((c, i) => ({
              deck_id: data.id,
              user_id: userId,
              term: c.term,
              definition: c.definition,
              position: i,
            })),
          );
        }
        emitChange();
      })();
      return tempId;
    },
  };
}

export function useDeck(id: string) {
  const { decks, ...rest } = useDecks();
  return { deck: decks.find((d) => d.id === id), ...rest };
}
