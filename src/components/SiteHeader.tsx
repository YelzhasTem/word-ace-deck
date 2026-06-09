import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import { BookOpenCheck, Languages, LogOut, Menu, Moon, Search, Settings as SettingsIcon, User } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { useLang, useT } from "@/lib/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SiteHeader() {
  const [dark, setDark] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { lang, setLang } = useLang();
  const t = useT();

  const [searchValue, setSearchValue] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("search") || "";
  });

  useEffect(() => {
    const saved = localStorage.getItem("theme") === "dark";
    setDark(saved);
    document.documentElement.classList.toggle("dark", saved);

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(value);
    if (location.pathname === "/dashboard") {
      const url = new URL(window.location.href);
      if (value.trim()) {
        url.searchParams.set("search", value.trim());
      } else {
        url.searchParams.delete("search");
      }
      window.history.replaceState({}, "", url);
    }
  };

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const toggleLang = () => setLang(lang === "ru" ? "en" : "ru");

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-6 py-4 flex flex-wrap items-center gap-3 md:gap-4">
        <Link to="/" className="flex items-center gap-2.5 group">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm group-hover:scale-105 transition-transform">
            <BookOpenCheck className="h-4.5 w-4.5" strokeWidth={2.25} />
          </span>
          <span className="font-display text-[17px] font-bold tracking-tight">
            Memora
          </span>
        </Link>

        <div className="order-3 flex w-full md:order-none md:w-auto md:flex-1 md:max-w-md md:mx-auto">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              placeholder={t("nav.search")}
              value={searchValue}
              onChange={handleSearchChange}
              className="w-full h-10 rounded-full bg-secondary/70 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:bg-card transition-all"
            />
          </div>
        </div>

        <nav className="ml-auto flex items-center gap-1 text-sm font-medium">
          <Link
            to="/"
            className="px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3"
            activeOptions={{ exact: true }}
            activeProps={{ className: "px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3" }}
          >
            {t("nav.decks")}
          </Link>
          <Link
            to="/collections"
            className="px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3"
            activeProps={{ className: "px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3" }}
          >
            {t("nav.collections")}
          </Link>
          <Link
            to="/community"
            className="px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3"
            activeProps={{ className: "px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3" }}
          >
            Community
          </Link>
          <button
            onClick={toggleLang}
            aria-label={t("nav.lang")}
            title={t("nav.lang")}
            className="h-9 px-2.5 inline-flex items-center gap-1.5 rounded-full hover:bg-secondary text-muted-foreground transition-colors"
          >
            <Languages className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase">{lang}</span>
          </button>
          <button
            onClick={toggleDark}
            aria-label={t("nav.theme")}
            className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
          >
            <Moon className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Open menu"
              className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
            >
              <Menu className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {session ? (
                <>
                  <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                    <User className="h-3.5 w-3.5" />
                    <span className="truncate">{session.user.email}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/settings">
                      <SettingsIcon className="h-4 w-4" />
                      {t("nav.settings")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleLogout}>
                    <LogOut className="h-4 w-4" />
                    {t("nav.logout")}
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem asChild>
                    <Link to="/settings">
                      <SettingsIcon className="h-4 w-4" />
                      {t("nav.settings")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/auth">
                      <User className="h-4 w-4" />
                      {t("nav.login")}
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </div>
    </header>
  );
}
