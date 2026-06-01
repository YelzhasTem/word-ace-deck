import { Link } from "@tanstack/react-router";

export function SiteHeader() {
  return (
    <header className="border-b border-border/60 bg-background/70 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-foreground font-display text-lg font-semibold shadow-sm group-hover:rotate-[-6deg] transition-transform">
            Lc
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">
            Lingo<span className="text-accent">.</span>Cards
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm font-medium">
          <Link
            to="/"
            className="px-3 py-2 rounded-full hover:bg-secondary transition-colors"
            activeOptions={{ exact: true }}
            activeProps={{ className: "px-3 py-2 rounded-full bg-secondary" }}
          >
            My decks
          </Link>
          <a
            href="https://en.wiktionary.org"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 rounded-full hover:bg-secondary transition-colors text-muted-foreground"
          >
            Dictionary ↗
          </a>
        </nav>
      </div>
    </header>
  );
}
