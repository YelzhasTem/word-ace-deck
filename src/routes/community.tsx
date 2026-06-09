import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Copy, Heart, Search, Star, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DECK_CATEGORIES, getCommunityHome, searchPublicDecks } from "@/lib/community.functions";

export const Route = createFileRoute("/community")({
  component: CommunityPage,
});

type CommunityDeck = {
  id: string;
  title: string;
  description: string;
  authorId: string;
  authorName: string;
  category: string;
  cardCount: number;
  totalLearners: number;
  likes: number;
  rating: number;
  publishedAt: string | null;
};

function DeckCard({ deck }: { deck: CommunityDeck }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
            {deck.category}
          </span>
          <span className="text-xs text-muted-foreground">
            {deck.publishedAt ? new Date(deck.publishedAt).toLocaleDateString() : "Draft"}
          </span>
        </div>
        <Link
          to="/community/$deckId"
          params={{ deckId: deck.id }}
          className="mt-3 block font-display text-xl font-bold tracking-tight hover:text-primary"
        >
          {deck.title}
        </Link>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{deck.description || "No description yet."}</p>
        <Link
          to="/creator/$userId"
          params={{ userId: deck.authorId }}
          className="mt-3 inline-flex text-xs font-medium text-primary hover:underline"
        >
          by {deck.authorName}
        </Link>
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
  const [author, setAuthor] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("popular");
  const [mode, setMode] = useState<"search" | "trending" | "categories" | "following" | "saved">("search");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHome().then(setHome).finally(() => setLoading(false));
  }, [loadHome]);

  const activeSearch = useMemo(() => query || author || category || mode === "following" || mode === "saved", [query, author, category, mode]);

  useEffect(() => {
    if (!activeSearch) return;
    setLoading(true);
    searchDecks({
      data: {
        query,
        author,
        category: category || null,
        sort: mode === "trending" ? "popular" : sort,
        followingOnly: mode === "following",
        savedOnly: mode === "saved",
      },
    })
      .then((res) => setResults(res.decks as CommunityDeck[]))
      .finally(() => setLoading(false));
  }, [activeSearch, author, category, mode, query, searchDecks, sort]);

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
          <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-10" placeholder="IELTS Vocabulary, Business English, Programming Terms..." value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Input placeholder="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">All categories</option>
              {DECK_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
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
            {(["search", "trending", "categories", "following", "saved"] as const).map((tab) => (
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

        {mode === "categories" && (
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">Categories</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {DECK_CATEGORIES.map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setCategory(item);
                    setMode("search");
                  }}
                  className="rounded-2xl border border-border bg-card px-4 py-5 text-left font-medium hover:border-primary"
                >
                  {item}
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
