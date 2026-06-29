import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpenCheck, LogOut, Menu, Moon, Settings as SettingsIcon, User } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { useT } from "@/lib/i18n";
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
  const [authReady, setAuthReady] = useState(false);
  const [username, setUsername] = useState("");
  const navigate = useNavigate();
  const t = useT();

  useEffect(() => {
    const saved = localStorage.getItem("theme") === "dark";
    setDark(saved);
    document.documentElement.classList.toggle("dark", saved);

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadUsername = async () => {
      if (!session) {
        setUsername("");
        return;
      }

      const metadataUsername =
        typeof session.user.user_metadata?.username === "string"
          ? session.user.user_metadata.username.trim()
          : "";
      setUsername(metadataUsername);

      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!mounted) return;
      setUsername(data?.username ?? metadataUsername);
    };

    void loadUsername();

    const handleUsernameUpdate = (event: Event) => {
      const nextUsername = (event as CustomEvent<string>).detail;
      if (typeof nextUsername === "string") setUsername(nextUsername);
    };

    window.addEventListener("memora:username-updated", handleUsernameUpdate);

    return () => {
      mounted = false;
      window.removeEventListener("memora:username-updated", handleUsernameUpdate);
    };
  }, [session]);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { mode: "login" } });
  };

  const accountLabel = username ? `@${username}` : "Signed in";
  const isSignedIn = Boolean(session);
  const isSignedOut = authReady && !session;

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-6 py-4 flex flex-wrap items-center gap-3 md:gap-4">
        <Link to="/" className="flex items-center gap-2.5 group">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm group-hover:scale-105 transition-transform">
            <BookOpenCheck className="h-4.5 w-4.5" strokeWidth={2.25} />
          </span>
          <span className="font-display text-[17px] font-bold tracking-tight">Memora</span>
        </Link>

        <nav className="ml-auto flex items-center gap-1 text-sm font-medium">
          {isSignedOut ? (
            <>
              <Link
                to="/decks"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                {t("nav.decks")}
              </Link>
              <Link
                to="/collections"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                {t("nav.collections")}
              </Link>
              <Link
                to="/community"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                Community
              </Link>
              <button
                onClick={toggleDark}
                aria-label={t("nav.theme")}
                className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
              >
                <Moon className="h-4 w-4" />
              </button>
              <Link
                to="/auth"
                search={{ mode: "login" }}
                className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("nav.login")}
              </Link>
            </>
          ) : null}
          {isSignedIn ? (
            <>
              <Link
                to="/decks"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                {t("nav.decks")}
              </Link>
              <Link
                to="/collections"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                {t("nav.collections")}
              </Link>
              <Link
                to="/community"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                Community
              </Link>
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
                  <DropdownMenuItem asChild className="md:hidden">
                    <Link to="/decks">{t("nav.decks")}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="md:hidden">
                    <Link to="/collections">{t("nav.collections")}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="md:hidden">
                    <Link to="/community">Community</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="md:hidden" />
                  <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                    <User className="h-3.5 w-3.5" />
                    <span className="truncate">{accountLabel}</span>
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
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
