import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Globe2, LayoutGrid, Search, Settings2, Trash2 } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useDecks } from "@/lib/decks";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/decks")({
  component: DecksPage,
});

function DecksPage() {
  const { decks, isLoading, deleteDeck, updateDeck } = useDecks();
  const [query, setQuery] = useState("");
  const [editDeckId, setEditDeckId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const t = useT();

  const deckToEdit = editDeckId ? decks.find((d) => d.id === editDeckId) : undefined;

  useEffect(() => {
    if (!deckToEdit) return;
    setEditName(deckToEdit.name);
    setEditDescription(deckToEdit.description);
  }, [deckToEdit]);

  const closeEdit = () => {
    setEditDeckId(null);
    setEditName("");
    setEditDescription("");
  };

  const filteredDecks = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return decks;
    return decks.filter(
      (deck) =>
        deck.name.toLowerCase().includes(search) ||
        deck.description.toLowerCase().includes(search) ||
        deck.cards.some(
          (card) =>
            card.term.toLowerCase().includes(search) ||
            card.definition.toLowerCase().includes(search),
        ),
    );
  }, [decks, query]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Library</p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">
              {t("home.yourDecks")}
            </h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Browse every deck in your account, search by title or word, and jump into study modes.
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            {filteredDecks.length} / {decks.length} {t("home.decks.suffix")}
          </div>
        </section>

        <section className="mb-8 rounded-2xl border border-border bg-card p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-10"
              type="search"
              placeholder={t("nav.search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </section>

        {isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="rounded-3xl border border-border bg-card p-6">
                <Skeleton className="h-7 w-40" />
                <Skeleton className="mt-3 h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-3/4" />
                <Skeleton className="mt-8 h-2 w-full rounded-full" />
                <div className="mt-5 flex gap-2">
                  <Skeleton className="h-10 w-24 rounded-full" />
                  <Skeleton className="h-10 w-24 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredDecks.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-border bg-card/50 p-16 text-center">
            <p className="text-muted-foreground">
              {query ? t("home.searchNothing") : t("home.empty")}
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredDecks.map((deck) => {
              const known = deck.cards.filter((card) => card.known).length;
              const total = deck.cards.length;
              const pct = total ? Math.round((known / total) * 100) : 0;
              return (
                <div
                  key={deck.id}
                  className="rounded-3xl border border-border/70 bg-card p-6 shadow-[var(--shadow-soft)] transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[var(--shadow-card)]"
                >
                  <Link to="/deck/$deckId" params={{ deckId: deck.id }} className="block">
                    <h2 className="font-display text-xl font-bold leading-tight tracking-tight">
                      {deck.name}
                    </h2>
                    {deck.description && (
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                        {deck.description}
                      </p>
                    )}
                    <div className="mt-6">
                      <div className="mb-1.5 flex justify-between text-xs font-medium text-muted-foreground">
                        <span>
                          {total} {t("home.cards.suffix")}
                        </span>
                        <span className="text-primary tabular-nums">{pct}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full bg-gradient-to-r from-accent to-primary transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </Link>

                  <div className="mt-5 flex items-center gap-2">
                    <Link
                      to="/study/$deckId"
                      params={{ deckId: deck.id }}
                      className="inline-flex rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <BookOpen className="mr-1.5 h-4 w-4" /> {t("home.study")}
                    </Link>
                    <Link
                      to="/deck/$deckId"
                      params={{ deckId: deck.id }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
                    >
                      <LayoutGrid className="h-3.5 w-3.5" /> {t("home.modes")}
                    </Link>
                    <Link
                      to="/publish"
                      search={{ type: "deck", id: deck.id }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
                    >
                      <Globe2 className="h-3.5 w-3.5" /> Publish
                    </Link>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setEditDeckId(deck.id);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <Settings2 className="h-3.5 w-3.5" /> Settings
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        deleteDeck(deck.id);
                      }}
                      title={t("home.deleteDeck")}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-card text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <Dialog open={editDeckId !== null} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit deck</DialogTitle>
            <DialogDescription>Change the deck name and description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              placeholder="Deck name"
            />
            <Textarea
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              placeholder="Deck description"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeEdit}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editDeckId) return;
                updateDeck(editDeckId, editName.trim(), editDescription.trim());
                closeEdit();
              }}
              disabled={!editName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
