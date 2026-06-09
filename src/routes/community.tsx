import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Heart, Search, Star, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCommunityHome, searchPublicDecks } from "@/lib/community.functions";

export const Route = createFileRoute("/community")({
  component: CommunityPage,
});

type CommunityDeck = {
  id: string;
  title: string;
  description: string;
  cardCount: number;
  totalLearners: number;
  likes: number;
  rating: number;
};

function DeckCard({ deck }: { deck: CommunityDeck }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
      <div className="min-w-0">
        <Link
          to="/community/$deckId"
          params={{ deckId: deck.id }}
          className="block font-display text-xl font-bold tracking-tight hover:text-primary"
        >
          {deck.title}
        </Link>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{deck.description || "No description yet."}</p>
      </div>
      <div className="mt-auto grid grid-cols-4 gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" />{deck.cardCount}</span>
        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{deck.totalLearners}</span>
        <span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{deck.likes}</span>
        <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5" />{deck.rating || "New"}</span>
      </div>
    </div>
  );
}

function Section({ title, decks }: { title: string; decks: CommunityDeck[] }) {
  if (decks.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {decks.map((deck) => <DeckCard key={deck.id} deck={deck} />)}
      </div>
    </section>
  );
}

function CommunityPage() {
  const loadHome = useServerFn(getCommunityHome);
  const searchDecks = useServerFn(searchPublicDecks);
  const [home, setHome] = useState<{
    trending: CommunityDeck[];
    popular: CommunityDeck[];
    newest: CommunityDeck[];
    topRated: CommunityDeck[];
    recommended: CommunityDeck[];
  } | null>(null);
  const [results, setResults] = useState<CommunityDeck[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("popular");
  const [mode, setMode] = useState<"search" | "trending" | "following" | "saved">("search");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHome().then(setHome).finally(() => setLoading(false));
  }, [loadHome]);

  const activeSearch = useMemo(() => query || mode === "following" || mode === "saved", [query, mode]);

  useEffect(() => {
    if (!activeSearch) return;
    setLoading(true);
    searchDecks({
      data: {
        query,
        sort: mode === "trending" ? "popular" : sort,
        followingOnly: mode === "following",
        savedOnly: mode === "saved",
      },
    })
      .then((res) => setResults(res.decks as CommunityDeck[]))
      .finally(() => setLoading(false));
  }, [activeSearch, mode, query, searchDecks, sort]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-10">
        <section className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Community</p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">Public Deck Marketplace</h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Discover IELTS, business, travel, academic, and specialist vocabulary decks from other learners.
            </p>
          </div>
          <Button asChild className="rounded-full">
            <Link to="/">Create your own deck</Link>
          </Button>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-10" placeholder="IELTS Vocabulary, Business English, Programming Terms..." value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="popular">Popularity</option>
              <option value="rating">Rating</option>
              <option value="learners">Learners</option>
              <option value="newest">Newest</option>
              <option value="updated">Recently updated</option>
              <option value="likes">Likes</option>
            </select>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["search", "trending", "following", "saved"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setMode(tab)}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${mode === tab ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
              >
                {tab === "search" ? "Search Decks" : tab === "saved" ? "Saved Decks" : tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </section>

        {loading && <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">Loading decks...</div>}

        {!loading && activeSearch && (
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">Results</h2>
            {results.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
                No public decks found.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {results.map((deck) => <DeckCard key={deck.id} deck={deck} />)}
              </div>
            )}
          </section>
        )}

        {!activeSearch && home && (
          <div className="space-y-10">
            <Section title="Trending Decks" decks={home.trending} />
            <Section title="Most Popular" decks={home.popular} />
            <Section title="New Decks" decks={home.newest} />
            <Section title="Top Rated" decks={home.topRated} />
            <Section title="Recommended For You" decks={home.recommended} />
          </div>
        )}

      </main>
    </div>
  );
}
