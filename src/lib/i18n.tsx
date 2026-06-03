import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "ru" | "en";

const dict = {
  ru: {
    "nav.decks": "Колоды",
    "nav.collections": "Коллекции",
    "nav.settings": "Настройки",
    "nav.login": "Войти",
    "nav.logout": "Выйти",
    "nav.theme": "Переключить тему",
    "nav.search": "Найти колоду или слово…",
    "nav.lang": "Язык интерфейса",
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
  return (key: Key) => dict[lang][key] ?? key;
}
