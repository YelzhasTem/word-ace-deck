import { createContext, useContext, useEffect, type ReactNode } from "react";

export type Lang = "en";

const dict = {
  en: {
    "nav.decks": "Decks",
    "nav.collections": "Collections",
    "nav.settings": "Settings",
    "nav.login": "Sign in",
    "nav.logout": "Sign out",
    "nav.theme": "Toggle theme",
    "nav.search": "Find a deck or word…",

    "home.kicker": "Calm learning",
    "home.title.1": "Learn English",
    "home.title.2": "focused",
    "home.title.3": "and without noise.",
    "home.subtitle": "Build decks, track progress, and train your memory — an interface designed for long, comfortable sessions.",
    "home.newDeck": "New deck",
    "home.continue": "Continue",
    "home.stats.decks": "Decks",
    "home.stats.cards": "Cards",
    "home.stats.known": "Learned",
    "home.yourDecks": "Your decks",
    "home.empty": "No decks yet. Create your first above.",
    "home.searchFound": "Found",
    "home.searchNothing": "Nothing found",
    "home.study": "Study",
    "home.deleteDeck": "Delete deck",
    "home.settings": "Settings",
    "home.toCollections": "Go to collections",
    "home.deleteDeckTitle": "Delete this deck?",
    "home.deleteDeckDescGeneric": "The deck and all its cards will be permanently removed.",
    "home.cards.suffix": "cards",
    "home.decks.suffix": "decks",
    "home.modes": "Modes",
    "home.footer": "Calm. Focused. At your own pace.",

    "streak.title": "Study streak",
    "streak.daysSuffix": "in a row",
    "streak.day.one": "day",
    "streak.day.few": "days",
    "streak.day.many": "days",
    "streak.record": "Record",
    "streak.total": "Total days",
    "streak.empty": "Study today to start a streak 🔥",
    "streak.dow.mon": "Mon",
    "streak.dow.tue": "Tue",
    "streak.dow.wed": "Wed",
    "streak.dow.thu": "Thu",
    "streak.dow.fri": "Fri",
    "streak.dow.sat": "Sat",
    "streak.dow.sun": "Sun",

    "create.title": "Create a deck",
    "create.desc": "Choose how to create it: manually or with AI.",
    "create.tab.manual": "Manual",
    "create.tab.ai": "AI",
    "create.tab.url": "From link",
    "create.name": "Deck name",
    "create.namePh": "e.g. IELTS — Speaking",
    "create.descLabel": "Description (Optional)",
    "create.descPh": "Add a description for your deck...",
    "create.addWord": "Add a word",
    "create.wordPh": "Type an English or Russian word",
    "create.findTr": "Find",
    "create.corrected": "Corrected",
    "create.correctedTo": "to",
    "create.pickTr": "Pick a translation for",
    "create.cancel": "Cancel",
    "create.cardsIn": "Words in deck",
    "create.remove": "Remove",
    "create.confirm": "Create",
    "create.ai.topic": "Deck topic",
    "create.ai.topicPh": "e.g. travel, cooking, IT",
    "create.ai.level": "Level",
    "create.ai.count": "Cards",
    "create.ai.generating": "Generating…",
    "create.ai.generate": "Generate",
    "create.url.label": "Source link",
    "create.url.hint": "Paste an article URL (e.g. Wikipedia) — AI will extract useful words from it.",
    "create.url.extracting": "Extracting words…",
    "create.url.create": "Create deck",
    "create.errLookup": "Failed to fetch translations",
    "create.errCreate": "Failed to create the deck",
    "create.collection": "Collection",
    "create.collectionDefault": "My collection (default)",
    "create.prev": "← Prev",
    "create.next": "Next →",

    "settings.back": "Back home",
    "settings.title": "Settings",
    "settings.desc": "Manage learning modes and app behavior.",
    "settings.recall.title": "Delayed Recall",
    "settings.recall.desc": "Improve long-term memory — review words at growing intervals instead of cramming.",
    "settings.on": "ON",
    "settings.off": "OFF",
    "settings.recall.onNote": "New cards are automatically scheduled for review. Progress is saved even if you disable the mode.",
    "settings.recall.offNote": "When the mode is off, the app works as usual — no reminders or delayed sessions. Saved progress is kept.",

    "col.title": "Collections",
    "col.subtitle": "Group your decks into themed collections",
    "col.new": "New collection",
    "col.create": "Create a collection",
    "col.name": "Name",
    "col.descPh": "Description (optional)",
    "col.confirm": "Create",
    "col.empty": "You have no collections yet",
    "col.decksCount": "decks",
    "col.pickDecks": "Pick decks",
    "col.pickerTitle": "Pick decks",
    "col.noDecks": "Create decks first",
    "col.cancel": "Cancel",
    "col.save": "Save",
    "col.delete": "Delete",
    "col.deleteTitle": "Delete this collection?",
    "col.deleteDescGeneric": "The collection will be removed. Decks inside it will remain.",
    "col.cards": "cards",
    "col.settings": "Settings",
    "col.settingsTitle": "Collection settings",

    "dr.title": "Delayed Recall",
    "dr.offDesc": "Turn on the mode to move words from short-term to long-term memory through growing intervals.",
    "dr.openSettings": "Open settings",
    "dr.settings": "Settings",
    "dr.ready": "To review",
    "dr.upcoming": "Upcoming",
    "dr.retention": "Retention",
    "dr.mastered": "Mastered",
    "dr.wordReady": "word ready",
    "dr.wordsReady": "words ready",
    "dr.toRecall": "to recall",
    "dr.decksSuffix": "decks",
    "dr.startSession": "Start session",
    "dr.nextReviewPrefix": "Next review",
    "dr.nextReviewSuffix": ". Check back later — we'll remind you.",
    "dr.empty": "No scheduled words yet. Add cards — they'll automatically join the queue.",
  },
} as const;

type Key = keyof (typeof dict)["en"];

const LangCtx = createContext<{ lang: Lang }>({
  lang: "en",
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("lang", "en");
    if (typeof document !== "undefined") document.documentElement.lang = "en";
  }, []);

  return <LangCtx.Provider value={{ lang: "en" }}>{children}</LangCtx.Provider>;
}

export function useT() {
  const { lang } = useContext(LangCtx);
  return (key: Key) => (dict[lang][key] ?? key) as string;
}
