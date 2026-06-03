import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "ru" | "en";

const dict = {
  ru: {
    // nav
    "nav.decks": "Колоды",
    "nav.collections": "Коллекции",
    "nav.settings": "Настройки",
    "nav.login": "Войти",
    "nav.logout": "Выйти",
    "nav.theme": "Переключить тему",
    "nav.search": "Найти колоду или слово…",
    "nav.lang": "Язык интерфейса",

    // home / hero
    "home.kicker": "Спокойное обучение",
    "home.title.1": "Учите английский",
    "home.title.2": "фокусированно",
    "home.title.3": "и без шума.",
    "home.subtitle": "Создавайте колоды, отслеживайте прогресс и тренируйте память — интерфейс продуман для долгих, комфортных сессий.",
    "home.newDeck": "Новая колода",
    "home.continue": "Продолжить",
    "home.stats.decks": "Колод",
    "home.stats.cards": "Карточек",
    "home.stats.known": "Выучено",
    "home.yourDecks": "Ваши колоды",
    "home.empty": "Пока нет колод. Создайте первую выше.",
    "home.study": "Учить",
    "home.deleteDeck": "Удалить колоду",
    "home.toCollections": "Перейти к коллекциям",
    "home.deleteDeckTitle": "Удалить колоду?",
    "home.deleteDeckDescGeneric": "Колода и все её карточки будут удалены безвозвратно.",
    "home.cards.suffix": "карточек",
    "home.decks.suffix": "колод",
    "home.done": "готово",
    "home.footer": "Спокойно. Сосредоточенно. В своём ритме.",

    // create deck dialog
    "create.title": "Создать колоду",
    "create.desc": "Выберите способ создания: вручную или с помощью ИИ.",
    "create.tab.manual": "Вручную",
    "create.tab.ai": "ИИ",
    "create.tab.url": "По ссылке",
    "create.name": "Название колоды",
    "create.namePh": "Например: IELTS — Speaking",
    "create.descLabel": "Описание (необязательно)",
    "create.descPh": "О чём эта колода?",
    "create.addWord": "Добавить слово",
    "create.wordPh": "Введите английское слово",
    "create.find": "Найти",
    "create.pickTr": "Выберите перевод для",
    "create.cancel": "Отмена",
    "create.cardsIn": "Слова в колоде",
    "create.remove": "Удалить",
    "create.confirm": "Создать",
    "create.ai.topic": "Тема колоды",
    "create.ai.topicPh": "Например: путешествия, кулинария, IT",
    "create.ai.level": "Уровень",
    "create.ai.count": "Карточек",
    "create.ai.generating": "Генерация…",
    "create.ai.generate": "Сгенерировать",
    "create.url.label": "Ссылка на материал",
    "create.url.hint": "Вставьте адрес статьи (например, Wikipedia) — ИИ извлечёт полезные слова из текста.",
    "create.url.extracting": "Извлекаем слова…",
    "create.url.create": "Создать колоду",
    "create.errLookup": "Не удалось получить переводы",
    "create.errCreate": "Не удалось создать колоду",

    // settings
    "settings.back": "На главную",
    "settings.title": "Настройки",
    "settings.desc": "Управляйте режимами обучения и поведением приложения.",
    "settings.recall.title": "Отложенное припоминание",
    "settings.recall.desc": "Улучшайте долговременную память — повторяйте слова через возрастающие интервалы, а не сразу несколько раз подряд.",
    "settings.on": "ВКЛ",
    "settings.off": "ВЫКЛ",
    "settings.recall.onNote": "Новые карточки автоматически планируются для повтора. Прогресс сохраняется даже при отключении режима.",
    "settings.recall.offNote": "Когда режим выключен, приложение работает как обычно — без напоминаний и отложенных сессий. Сохранённый прогресс не удаляется.",

    // collections
    "col.title": "Коллекции",
    "col.subtitle": "Группируйте свои колоды в тематические коллекции",
    "col.new": "Новая коллекция",
    "col.create": "Создать коллекцию",
    "col.name": "Название",
    "col.descPh": "Описание (необязательно)",
    "col.confirm": "Создать",
    "col.empty": "У вас пока нет коллекций",
    "col.decksCount": "колод",
    "col.pickDecks": "Выбрать колоды",
    "col.pickerTitle": "Выберите колоды",
    "col.noDecks": "Сначала создайте колоды",
    "col.cancel": "Отмена",
    "col.save": "Сохранить",
    "col.delete": "Удалить",
    "col.deleteTitle": "Удалить коллекцию?",
    "col.deleteDescGeneric": "Коллекция будет удалена. Колоды внутри неё останутся.",
    "col.cards": "карточек",
  },
  en: {
    "nav.decks": "Decks",
    "nav.collections": "Collections",
    "nav.settings": "Settings",
    "nav.login": "Sign in",
    "nav.logout": "Sign out",
    "nav.theme": "Toggle theme",
    "nav.search": "Find a deck or word…",
    "nav.lang": "Interface language",

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
    "home.study": "Study",
    "home.deleteDeck": "Delete deck",
    "home.toCollections": "Go to collections",
    "home.deleteDeckTitle": "Delete this deck?",
    "home.deleteDeckDescGeneric": "The deck and all its cards will be permanently removed.",
    "home.cards.suffix": "cards",
    "home.decks.suffix": "decks",
    "home.done": "done",
    "home.footer": "Calm. Focused. At your own pace.",

    "create.title": "Create a deck",
    "create.desc": "Choose how to create it: manually or with AI.",
    "create.tab.manual": "Manual",
    "create.tab.ai": "AI",
    "create.tab.url": "From link",
    "create.name": "Deck name",
    "create.namePh": "e.g. IELTS — Speaking",
    "create.descLabel": "Description (optional)",
    "create.descPh": "What is this deck about?",
    "create.addWord": "Add a word",
    "create.wordPh": "Type an English word",
    "create.find": "Find",
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
  },
} as const;

type Key = keyof (typeof dict)["ru"];

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "ru",
  setLang: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ru");

  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("lang")) as Lang | null;
    if (saved === "ru" || saved === "en") setLangState(saved);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem("lang", l);
    if (typeof document !== "undefined") document.documentElement.lang = l;
  };

  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}

export function useT() {
  const { lang } = useContext(LangCtx);
  return (key: Key) => (dict[lang][key] ?? key) as string;
}
