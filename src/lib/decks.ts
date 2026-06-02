import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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

  const notAuth = () =>
    toast.error("Войдите в аккаунт, чтобы создавать колоды и карточки");

  return {
    decks,
    createDeck: (name: string, description: string) => {
      const tempId = crypto.randomUUID();
      (async () => {
        const userId = await requireUser();
        if (!userId) return notAuth();
        const { error } = await supabase.from("decks").insert({ user_id: userId, name, description });
        if (error) { toast.error(`Не удалось создать колоду: ${error.message}`); return; }
        emitChange();
      })();
      return tempId;
    },
    deleteDeck: (id: string) => {
      (async () => {
        const { error } = await supabase.from("decks").delete().eq("id", id);
        if (error) { toast.error(`Не удалось удалить: ${error.message}`); return; }
        emitChange();
      })();
    },
    addCard: (deckId: string, term: string, definition: string) => {
      (async () => {
        const userId = await requireUser();
        if (!userId) return notAuth();
        const deck = decksRef.current.find((d) => d.id === deckId);
        const position = deck ? deck.cards.length : 0;
        const { data, error } = await supabase
          .from("cards")
          .insert({ deck_id: deckId, user_id: userId, term, definition, position })
          .select("id")
          .single();
        if (error) { toast.error(`Не удалось добавить карточку: ${error.message}`); return; }
        if (data?.id) scheduleNewCard(deckId, data.id);
        emitChange();
      })();
    },
    deleteCard: (_deckId: string, cardId: string) => {
      (async () => {
        const { error } = await supabase.from("cards").delete().eq("id", cardId);
        if (error) { toast.error(`Не удалось удалить карточку: ${error.message}`); return; }
        emitChange();
      })();
    },
    markCard: (_deckId: string, cardId: string, known: boolean) => {
      decksRef.current = decksRef.current.map((d) => ({
        ...d,
        cards: d.cards.map((c) => (c.id === cardId ? { ...c, known } : c)),
      }));
      setDecks(decksRef.current);
      (async () => {
        const { error } = await supabase.from("cards").update({ known }).eq("id", cardId);
        if (error) toast.error(`Не удалось сохранить прогресс: ${error.message}`);
      })();
    },
    resetProgress: (deckId: string) => {
      (async () => {
        const { error } = await supabase.from("cards").update({ known: false }).eq("deck_id", deckId);
        if (error) { toast.error(`Не удалось сбросить: ${error.message}`); return; }
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
        if (!userId) return notAuth();
        const { data, error } = await supabase
          .from("decks")
          .insert({ user_id: userId, name, description })
          .select("id")
          .single();
        if (error || !data) {
          toast.error(`Не удалось создать колоду: ${error?.message ?? "неизвестная ошибка"}`);
          return;
        }
        if (cards.length > 0) {
          const { error: cardsErr } = await supabase.from("cards").insert(
            cards.map((c, i) => ({
              deck_id: data.id,
              user_id: userId,
              term: c.term,
              definition: c.definition,
              position: i,
            })),
          );
          if (cardsErr) {
            toast.error(`Колода создана, но карточки не сохранились: ${cardsErr.message}`);
          }
        }
        toast.success("Колода создана");
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
