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

const STORAGE_KEY = "lingocards.decks.v1";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const seedDecks = (): Deck[] => [
  {
    id: uid(),
    name: "Everyday Essentials",
    description: "Words you'll use every single day.",
    createdAt: Date.now(),
    cards: [
      { id: uid(), term: "ubiquitous", definition: "Present everywhere", known: false },
      { id: uid(), term: "ephemeral", definition: "Lasting for a very short time", known: false },
      { id: uid(), term: "candid", definition: "Truthful and straightforward", known: false },
      { id: uid(), term: "resilient", definition: "Able to recover quickly", known: false },
      { id: uid(), term: "meticulous", definition: "Showing great attention to detail", known: false },
    ],
  },
  {
    id: uid(),
    name: "Business English",
    description: "Vocabulary for meetings, emails and pitches.",
    createdAt: Date.now(),
    cards: [
      { id: uid(), term: "leverage", definition: "Use something to maximum advantage", known: false },
      { id: uid(), term: "stakeholder", definition: "A person with an interest in a project", known: false },
      { id: uid(), term: "deliverable", definition: "A product or result that must be provided", known: false },
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
  };
}

export function useDeck(id: string) {
  const { decks, ...rest } = useDecks();
  return { deck: decks.find((d) => d.id === id), ...rest };
}
