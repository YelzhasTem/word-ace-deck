import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpenCheck, Languages, LogOut, Menu, Moon, Search, Settings as SettingsIcon, User, X } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { useLang, useT } from "@/lib/i18n";

export function SiteHeader() {
  const [dark, setDark] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const navigate = useNavigate();
  const { lang, setLang } = useLang();
  const t = useT();

  useEffect(() => {
    const saved = localStorage.getItem("theme") === "dark";
    setDark(saved);
    document.documentElement.classList.toggle("dark", saved);

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

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
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2.5 group">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm group-hover:scale-105 transition-transform">
            <BookOpenCheck className="h-4.5 w-4.5" strokeWidth={2.25} />
          </span>
          <span className="font-display text-[17px] font-bold tracking-tight">
            Memora
          </span>
        </Link>

        <button
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
          className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
        >
          {collapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
        </button>

        {!collapsed && (
          <>
            <div className="hidden md:flex flex-1 max-w-md mx-auto">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="search"
                  placeholder={t("nav.search")}
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
                {t("nav.decks")}
              </Link>
              <Link
                to="/collections"
                className="px-3 py-2 rounded-full hover:bg-secondary transition-colors"
                activeProps={{ className: "px-3 py-2 rounded-full bg-secondary text-primary" }}
              >
                {t("nav.collections")}
              </Link>
              <Link
                to="/settings"
                aria-label={t("nav.settings")}
                className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
                activeProps={{ className: "h-9 w-9 inline-flex items-center justify-center rounded-full bg-secondary text-primary transition-colors" }}
              >
                <SettingsIcon className="h-4 w-4" />
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
              {session ? (
                <div className="flex items-center gap-2 pl-2">
                  <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <User className="h-3.5 w-3.5" />
                    {session.user.email}
                  </span>
                  <button
                    onClick={handleLogout}
                    aria-label={t("nav.logout")}
                    className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Link
                  to="/auth"
                  className="ml-2 px-4 py-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm"
                >
                  {t("nav.login")}
                </Link>
              )}
            </nav>
          </>
        )}
      </div>
    </header>
  );
}
