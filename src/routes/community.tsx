import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Archive, BookOpen, Copy, Heart, Search, Star, Users } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OFFLINE_SAVE_MESSAGE, useOnlineStatus } from "@/lib/online-status";
import {
  duplicatePublicDeck,
  duplicatePublicCollection,
  getCommunityHome,
  searchPublicCollections,
  searchPublicDecks,
} from "@/lib/community.functions";

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

type CommunityCollection = {
  id: string;
  title: string;
  description: string;
  deckCount: number;
  totalLearners: number;
  likes: number;
  rating: number;
};

function DeckCard({
  deck,
  onCopy,
  copyDisabled = false,
}: {
  deck: CommunityDeck;
  onCopy: (id: string) => void;
  copyDisabled?: boolean;
}) {
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
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {deck.description || "No description yet."}
        </p>
      </div>
      <div className="mt-auto grid grid-cols-4 gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <BookOpen className="h-3.5 w-3.5" />
          {deck.cardCount}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {deck.totalLearners}
        </span>
        <span className="inline-flex items-center gap-1">
          <Heart className="h-3.5 w-3.5" />
          {deck.likes}
        </span>
        <span className="inline-flex items-center gap-1">
          <Star className="h-3.5 w-3.5" />
          {deck.rating || "New"}
        </span>
      </div>
      <Button
        variant="outline"
        className="rounded-full"
        onClick={() => onCopy(deck.id)}
        disabled={copyDisabled}
      >
        <Copy className="h-4 w-4" /> Add to library
      </Button>
    </div>
  );
}

function CollectionCard({
  collection,
  onCopy,
  copyDisabled = false,
}: {
  collection: CommunityCollection;
  onCopy: (id: string) => void;
  copyDisabled?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-primary">
          <Archive className="h-3.5 w-3.5" />
          Collection
        </div>
        <h3 className="mt-2 font-display text-xl font-bold tracking-tight">{collection.title}</h3>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {collection.description || "No description yet."}
        </p>
      </div>
      <div className="mt-auto grid grid-cols-4 gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <BookOpen className="h-3.5 w-3.5" />
          {collection.deckCount}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {collection.totalLearners}
        </span>
        <span className="inline-flex items-center gap-1">
          <Heart className="h-3.5 w-3.5" />
          {collection.likes}
        </span>
        <span className="inline-flex items-center gap-1">
          <Star className="h-3.5 w-3.5" />
          {collection.rating || "New"}
        </span>
      </div>
      <Button
        variant="outline"
        className="rounded-full"
        onClick={() => onCopy(collection.id)}
        disabled={copyDisabled}
      >
        <Copy className="h-4 w-4" /> Add collection
      </Button>
    </div>
  );
}

function Section({
  title,
  decks,
  onCopy,
  copyDisabled = false,
}: {
  title: string;
  decks: CommunityDeck[];
  onCopy: (id: string) => void;
  copyDisabled?: boolean;
}) {
  if (decks.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {decks.map((deck) => (
          <DeckCard key={deck.id} deck={deck} onCopy={onCopy} copyDisabled={copyDisabled} />
        ))}
      </div>
    </section>
  );
}

function CommunityPage() {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const loadHome = useServerFn(getCommunityHome);
  const searchDecks = useServerFn(searchPublicDecks);
  const searchCollections = useServerFn(searchPublicCollections);
  const copyDeck = useServerFn(duplicatePublicDeck);
  const copyCollection = useServerFn(duplicatePublicCollection);
  const [home, setHome] = useState<{
    trending: CommunityDeck[];
    popular: CommunityDeck[];
    newest: CommunityDeck[];
    topRated: CommunityDeck[];
    recommended: CommunityDeck[];
  } | null>(null);
  const [results, setResults] = useState<CommunityDeck[]>([]);
  const [collectionResults, setCollectionResults] = useState<CommunityCollection[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("popular");
  const [searchTarget, setSearchTarget] = useState<"all" | "decks" | "collections">("all");
  const [mode, setMode] = useState<"search" | "trending" | "following" | "saved">("search");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHome()
      .then(setHome)
      .finally(() => setLoading(false));
  }, [loadHome]);

  const activeSearch = useMemo(
    () => Boolean(query) || mode === "following" || mode === "saved",
    [query, mode],
  );

  useEffect(() => {
    const shouldSearch = Boolean(query) || mode === "following" || mode === "saved";
    if (!shouldSearch) {
      setResults([]);
      setCollectionResults([]);
      return;
    }

    setLoading(true);

    const deckSearch =
      searchTarget === "decks" || searchTarget === "all"
        ? searchDecks({
            data: {
              query,
              sort: mode === "trending" ? "popular" : sort,
              followingOnly: mode === "following",
              savedOnly: mode === "saved",
            },
          })
        : Promise.resolve({ decks: [] as CommunityDeck[] });

    const collectionSearch =
      searchTarget === "collections" || searchTarget === "all"
        ? searchCollections({
            data: {
              query,
              sort: mode === "trending" ? "popular" : sort,
              savedOnly: mode === "saved",
            },
          })
        : Promise.resolve({ collections: [] as CommunityCollection[] });

    Promise.all([deckSearch, collectionSearch])
      .then(([deckRes, collectionRes]) => {
        setResults(deckRes.decks as CommunityDeck[]);
        setCollectionResults(collectionRes.collections as CommunityCollection[]);
      })
      .finally(() => setLoading(false));
  }, [activeSearch, mode, query, searchCollections, searchDecks, sort, searchTarget]);

  const onCopyDeck = async (deckId: string) => {
    if (!isOnline) {
      toast.error(OFFLINE_SAVE_MESSAGE);
      return;
    }
    try {
      const res = await copyDeck({ data: { deckId } });
      toast.success("Deck copied into your library.");
      navigate({ to: "/deck/$deckId", params: { deckId: res.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add deck to your library.");
    }
  };

  const onCopyCollection = async (collectionId: string) => {
    if (!isOnline) {
      toast.error(OFFLINE_SAVE_MESSAGE);
      return;
    }
    try {
      await copyCollection({ data: { collectionId } });
      toast.success("Collection copied into your library.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add collection to your library.",
      );
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-10">
        <section className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">
              Community
            </p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">
              Public Deck Marketplace
            </h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Discover IELTS, business, travel, academic, and specialist vocabulary decks and
              collections from other learners.
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
              <Input
                className="pl-10"
                placeholder="IELTS Vocabulary, Business English, Programming Terms..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
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
                {tab === "search"
                  ? "Search"
                  : tab === "saved"
                    ? "Saved Decks"
                    : tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["all", "decks", "collections"] as const).map((target) => (
              <button
                key={target}
                type="button"
                onClick={() => setSearchTarget(target)}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${searchTarget === target ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
              >
                {target === "all"
                  ? "Decks + Collections"
                  : target === "decks"
                    ? "Decks"
                    : "Collections"}
              </button>
            ))}
          </div>
        </section>

        {loading && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            Loading decks...
          </div>
        )}

        {!loading && (Boolean(query) || mode === "following" || mode === "saved") && (
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">Results</h2>
            {results.length === 0 && collectionResults.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
                No public decks or collections found.
              </div>
            ) : (
              <div className="space-y-8">
                {results.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {results.map((deck) => (
                      <DeckCard
                        key={deck.id}
                        deck={deck}
                        onCopy={onCopyDeck}
                        copyDisabled={!isOnline}
                      />
                    ))}
                  </div>
                )}
                {collectionResults.length > 0 && (
                  <section className="space-y-4">
                    <h3 className="font-display text-xl font-bold tracking-tight">Collections</h3>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {collectionResults.map((collection) => (
                        <CollectionCard
                          key={collection.id}
                          collection={collection}
                          onCopy={onCopyCollection}
                          copyDisabled={!isOnline}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </section>
        )}

        {searchTarget === "all" && !query && mode !== "following" && mode !== "saved" && home && (
          <div className="space-y-10">
            <Section
              title="Trending Decks"
              decks={home.trending}
              onCopy={onCopyDeck}
              copyDisabled={!isOnline}
            />
            <Section
              title="Most Popular"
              decks={home.popular}
              onCopy={onCopyDeck}
              copyDisabled={!isOnline}
            />
            <Section
              title="New Decks"
              decks={home.newest}
              onCopy={onCopyDeck}
              copyDisabled={!isOnline}
            />
            <Section
              title="Top Rated"
              decks={home.topRated}
              onCopy={onCopyDeck}
              copyDisabled={!isOnline}
            />
            <Section
              title="Recommended For You"
              decks={home.recommended}
              onCopy={onCopyDeck}
              copyDisabled={!isOnline}
            />
          </div>
        )}

        {searchTarget !== "all" && !query && !loading && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            Start typing to search public {searchTarget === "decks" ? "decks" : "collections"}.
          </div>
        )}
      </main>
    </div>
  );
}
