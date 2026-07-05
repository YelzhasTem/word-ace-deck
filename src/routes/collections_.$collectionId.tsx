import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowLeft, BookOpen, FolderOpen, Library, Play } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCollection } from "@/lib/collections";
import { useDecks } from "@/lib/decks";
import { getDeckColorOption } from "@/lib/deck-colors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/collections_/$collectionId")({
  component: CollectionDetailPage,
});

function CollectionDetailPage() {
  const { collectionId } = Route.useParams();
  const { collection, isLoading: collectionsLoading } = useCollection(collectionId);
  const { decks, isLoading: decksLoading } = useDecks();
  const isLoading = collectionsLoading || decksLoading;

  const collectionDecks = useMemo(() => {
    if (!collection) return [];
    const decksById = new Map(decks.map((deck) => [deck.id, deck]));
    return collection.deckIds
      .map((deckId) => decksById.get(deckId))
      .filter(Boolean) as typeof decks;
  }, [collection, decks]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-6xl px-6 py-10">
          <Skeleton className="mb-8 h-5 w-36" />
          <section className="mb-8 rounded-3xl border border-border bg-card p-6">
            <Skeleton className="h-10 w-64 max-w-full" />
            <Skeleton className="mt-4 h-4 w-96 max-w-full" />
          </section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-2xl border border-border bg-card p-5">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="mt-3 h-4 w-full" />
                <Skeleton className="mt-6 h-10 w-full rounded-full" />
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-4xl px-6 py-20 text-center">
          <FolderOpen className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
          <h1 className="font-display text-3xl font-bold">Collection not found</h1>
          <p className="mt-3 text-muted-foreground">
            This collection may have been deleted or is not available for this account.
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/collections">Back to collections</Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Link
          to="/collections"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Collections
        </Link>

        <section className="mb-8 rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-accent">
                <Library className="h-3.5 w-3.5" />
                Collection
              </p>
              <h1 className="font-display text-4xl font-bold tracking-tight">{collection.name}</h1>
              {collection.description && (
                <p className="mt-3 max-w-2xl text-muted-foreground">{collection.description}</p>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
              <span className="font-display text-2xl font-semibold text-foreground">
                {collectionDecks.length}
              </span>{" "}
              {collectionDecks.length === 1 ? "deck" : "decks"}
            </div>
          </div>
        </section>

        {collectionDecks.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border p-12 text-center">
            <FolderOpen className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
            <h2 className="font-display text-2xl font-semibold">No decks in this collection</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Go back to Collections and use Pick decks to add decks here.
            </p>
            <Button asChild className="mt-6 rounded-full">
              <Link to="/collections">Back to collections</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collectionDecks.map((deck) => {
              const known = deck.cards.filter((card) => card.known).length;
              const total = deck.cards.length;
              const progress = total ? Math.round((known / total) * 100) : 0;
              const deckColorOption = getDeckColorOption(deck.coverColor);

              return (
                <div
                  key={deck.id}
                  className={cn(
                    "flex min-h-[230px] flex-col rounded-2xl border p-5 shadow-[var(--shadow-soft)] transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[var(--shadow-card)]",
                    deckColorOption.cardClass,
                  )}
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-display text-xl font-semibold leading-tight">
                        {deck.name}
                      </h2>
                      {deck.description && (
                        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                          {deck.description}
                        </p>
                      )}
                    </div>
                    <BookOpen className="h-5 w-5 shrink-0 text-accent" />
                  </div>

                  <div className="mt-auto space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {known} / {total} learned
                        </span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={cn(
                            "h-full bg-gradient-to-r transition-all duration-500",
                            deckColorOption.progressClass,
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {total > 0 ? (
                        <Button asChild className="rounded-full">
                          <Link to="/study/$deckId" params={{ deckId: deck.id }}>
                            <Play className="h-4 w-4" />
                            Study
                          </Link>
                        </Button>
                      ) : (
                        <Button className="rounded-full" disabled>
                          <Play className="h-4 w-4" />
                          Study
                        </Button>
                      )}
                      <Button asChild variant="outline" className="rounded-full">
                        <Link to="/deck/$deckId" params={{ deckId: deck.id }}>
                          Open
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
