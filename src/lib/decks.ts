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
  const fetchMyDecks = useServerFn(getMyDecks);
  const createDeckFn = useServerFn(createDeckRecord);
  const createDeckWithCardsFn = useServerFn(createDeckWithCardsRecord);
  const addCardFn = useServerFn(addCardRecord);
  const deleteDeckFn = useServerFn(deleteDeckRecord);
  const deleteCardFn = useServerFn(deleteCardRecord);
  const markCardFn = useServerFn(markCardRecord);
  const resetDeckProgressFn = useServerFn(resetDeckProgressRecord);

  const reload = useCallback(async () => {
    try {
      const result = await fetchMyDecks();
      const next = mapDecks(result.decks as DbDeck[], result.cards as DbCard[]);
      decksRef.current = next;
      setDecks(next);
    } catch (error) {
      decksRef.current = [];
      setDecks([]);
      if (error instanceof Error && !error.message.includes("Unauthorized")) {
        toast.error(`Не удалось загрузить колоды: ${error.message}`);
      }
    }
  }, [fetchMyDecks]);

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

  const notAuth = () =>
    toast.error("Войдите в аккаунт, чтобы создавать колоды и карточки");

  return {
    decks,
    createDeck: (name: string, description: string) => {
      const tempId = crypto.randomUUID();
      (async () => {
        try {
          await createDeckFn({ data: { name, description } });
          toast.success("Колода создана");
          emitChange();
        } catch (error) {
          if (error instanceof Error && error.message.includes("Unauthorized")) return notAuth();
          toast.error(`Не удалось создать колоду: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
        }
      })();
      return tempId;
    },
    deleteDeck: (id: string) => {
      (async () => {
        try {
          await deleteDeckFn({ data: { id } });
          emitChange();
        } catch (error) {
          toast.error(`Не удалось удалить: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
        }
      })();
    },
    addCard: (deckId: string, term: string, definition: string) => {
      (async () => {
        const deck = decksRef.current.find((d) => d.id === deckId);
        const position = deck ? deck.cards.length : 0;
        try {
          const data = await addCardFn({ data: { deckId, term, definition, position } });
          if (data?.id) scheduleNewCard(deckId, data.id);
          emitChange();
        } catch (error) {
          if (error instanceof Error && error.message.includes("Unauthorized")) return notAuth();
          toast.error(`Не удалось добавить карточку: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
        }
      })();
    },
    deleteCard: (_deckId: string, cardId: string) => {
      (async () => {
        try {
          await deleteCardFn({ data: { id: cardId } });
          emitChange();
        } catch (error) {
          toast.error(`Не удалось удалить карточку: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
        }
      })();
    },
    markCard: (_deckId: string, cardId: string, known: boolean) => {
      decksRef.current = decksRef.current.map((d) => ({
        ...d,
        cards: d.cards.map((c) => (c.id === cardId ? { ...c, known } : c)),
      }));
      setDecks(decksRef.current);
      (async () => {
        try {
          await markCardFn({ data: { id: cardId, known } });
        } catch (error) {
          toast.error(`Не удалось сохранить прогресс: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
        }
      })();
    },
    resetProgress: (deckId: string) => {
      (async () => {
        try {
          await resetDeckProgressFn({ data: { deckId } });
          emitChange();
        } catch (error) {
          toast.error(`Не удалось сбросить: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
        }
      })();
    },
    createDeckWithCards: (
      name: string,
      description: string,
      cards: { term: string; definition: string }[],
    ) => {
      const tempId = crypto.randomUUID();
      (async () => {
        try {
          const data = await createDeckWithCardsFn({ data: { name, description, cards } });
          data.cardIds?.forEach((cardId) => scheduleNewCard(data.id, cardId));
          toast.success("Колода создана");
          emitChange();
        } catch (error) {
          if (error instanceof Error && error.message.includes("Unauthorized")) return notAuth();
          toast.error(`Не удалось создать колоду: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
        }
      })();
      return tempId;
    },
  };
}

export function useDeck(id: string) {
  const { decks, ...rest } = useDecks();
  return { deck: decks.find((d) => d.id === id), ...rest };
}
