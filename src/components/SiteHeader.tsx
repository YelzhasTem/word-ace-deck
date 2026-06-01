import { Link } from "@tanstack/react-router";
import { BookOpenCheck, Moon, Search } from "lucide-react";
import { useEffect, useState } from "react";

export function SiteHeader() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme") === "dark";
    setDark(saved);
    document.documentElement.classList.toggle("dark", saved);
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2.5 group">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm group-hover:scale-105 transition-transform">
            <BookOpenCheck className="h-4.5 w-4.5" strokeWidth={2.25} />
          </span>
          <span className="font-display text-[17px] font-bold tracking-tight">
            Лингво<span className="text-accent">.</span>Карточки
          </span>
        </Link>

        <div className="hidden md:flex flex-1 max-w-md mx-auto">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              placeholder="Найти колоду или слово…"
              className="w-full h-10 rounded-full bg-secondary/70 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:bg-card transition-all"
            />
          </div>
        </div>

        <nav className="ml-auto flex items-center gap-1 text-sm font-medium">
          <Link
            to="/"
            className="px-3 py-2 rounded-full hover:bg-secondary transition-colors"
            activeOptions={{ exact: true }}
            activeProps={{ className: "px-3 py-2 rounded-full bg-secondary text-primary" }}
          >
            Колоды
          </Link>
          <a
            href="https://www.multitran.com/"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline-flex px-3 py-2 rounded-full hover:bg-secondary transition-colors text-muted-foreground"
          >
            Словарь ↗
          </a>
          <button
            onClick={toggleDark}
            aria-label="Переключить тему"
            className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
          >
            <Moon className="h-4 w-4" />
          </button>
        </nav>
      </div>
    </header>
  );
}
