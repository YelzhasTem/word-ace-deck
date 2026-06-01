import { useEffect, useState } from "react";

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

const STORAGE_KEY = "lingocards.decks.v2";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const seedDecks = (): Deck[] => [
  {
    id: uid(),
    name: "Повседневные слова",
    description: "Базовая лексика для каждого дня.",
    createdAt: Date.now(),
    cards: [
      { id: uid(), term: "breakfast", definition: "завтрак", known: false },
      { id: uid(), term: "neighbour", definition: "сосед", known: false },
      { id: uid(), term: "weather", definition: "погода", known: false },
      { id: uid(), term: "tomorrow", definition: "завтра (нареч.)", known: false },
      { id: uid(), term: "to remember", definition: "помнить, вспоминать", known: false },
      { id: uid(), term: "busy", definition: "занятой", known: false },
    ],
  },
  {
    id: uid(),
    name: "Бизнес-английский",
    description: "Слова для встреч, писем и презентаций.",
    createdAt: Date.now(),
    cards: [
      { id: uid(), term: "deadline", definition: "крайний срок", known: false },
      { id: uid(), term: "stakeholder", definition: "заинтересованная сторона", known: false },
      { id: uid(), term: "to leverage", definition: "использовать с выгодой", known: false },
      { id: uid(), term: "deliverable", definition: "результат работы, продукт сдачи", known: false },
      { id: uid(), term: "to outsource", definition: "передавать на аутсорс", known: false },
    ],
  },
  {
    id: uid(),
    name: "Продвинутая лексика (C1)",
    description: "Слова, которые встретятся в книгах и сериалах.",
    createdAt: Date.now(),
    cards: [
      { id: uid(), term: "ubiquitous", definition: "вездесущий, повсеместный", known: false },
      { id: uid(), term: "ephemeral", definition: "мимолётный, недолговечный", known: false },
      { id: uid(), term: "resilient", definition: "стойкий, быстро восстанавливающийся", known: false },
      { id: uid(), term: "meticulous", definition: "дотошный, скрупулёзный", known: false },
      { id: uid(), term: "serendipity", definition: "счастливая случайность", known: false },
    ],
  },
];


function load(): Deck[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = seedDecks();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw) as Deck[];
  } catch {
    return [];
  }
}

function save(decks: Deck[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
  window.dispatchEvent(new Event("decks:changed"));
}

export function useDecks() {
  const [decks, setDecks] = useState<Deck[]>([]);

  useEffect(() => {
    setDecks(load());
    const handler = () => setDecks(load());
    window.addEventListener("decks:changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("decks:changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  return {
    decks,
    createDeck: (name: string, description: string) => {
      const deck: Deck = { id: uid(), name, description, cards: [], createdAt: Date.now() };
      save([deck, ...load()]);
      return deck.id;
    },
    deleteDeck: (id: string) => save(load().filter((d) => d.id !== id)),
    addCard: (deckId: string, term: string, definition: string) => {
      const next = load().map((d) =>
        d.id === deckId
          ? { ...d, cards: [...d.cards, { id: uid(), term, definition, known: false }] }
          : d,
      );
      save(next);
    },
    deleteCard: (deckId: string, cardId: string) => {
      const next = load().map((d) =>
        d.id === deckId ? { ...d, cards: d.cards.filter((c) => c.id !== cardId) } : d,
      );
      save(next);
    },
    markCard: (deckId: string, cardId: string, known: boolean) => {
      const next = load().map((d) =>
        d.id === deckId
          ? { ...d, cards: d.cards.map((c) => (c.id === cardId ? { ...c, known } : c)) }
          : d,
      );
      save(next);
    },
    resetProgress: (deckId: string) => {
      const next = load().map((d) =>
        d.id === deckId ? { ...d, cards: d.cards.map((c) => ({ ...c, known: false })) } : d,
      );
      save(next);
    },
    createDeckWithCards: (name: string, description: string, cards: { term: string; definition: string }[]) => {
      const deck: Deck = {
        id: uid(),
        name,
        description,
        cards: cards.map((c) => ({ id: uid(), term: c.term, definition: c.definition, known: false })),
        createdAt: Date.now(),
      };
      save([deck, ...load()]);
      return deck.id;
    },
  };
}

export function useDeck(id: string) {
  const { decks, ...rest } = useDecks();
  return { deck: decks.find((d) => d.id === id), ...rest };
}
