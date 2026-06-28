import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckSquare,
  Globe2,
  LayoutGrid,
  Loader2,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  const { decks, isLoading, deleteDecks, updateDeck } = useDecks();
  const [query, setQuery] = useState("");
  const [editDeckId, setEditDeckId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDeckIds, setSelectedDeckIds] = useState<Set<string>>(new Set());
  const [deleteRequest, setDeleteRequest] = useState<{
    ids: string[];
    scope: "single" | "selected" | "all";
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  const selectedCount = selectedDeckIds.size;
  const filteredDeckIds = useMemo(() => filteredDecks.map((deck) => deck.id), [filteredDecks]);
  const allFilteredSelected =
    filteredDeckIds.length > 0 && filteredDeckIds.every((id) => selectedDeckIds.has(id));
  const deleteRequestDecks = useMemo(() => {
    if (!deleteRequest) return [];
    return deleteRequest.ids
      .map((id) => decks.find((deck) => deck.id === id))
      .filter(Boolean) as typeof decks;
  }, [decks, deleteRequest]);

  useEffect(() => {
    setSelectedDeckIds((current) => {
      const existingDeckIds = new Set(decks.map((deck) => deck.id));
      const next = new Set([...current].filter((id) => existingDeckIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [decks]);

  const toggleDeckSelection = (deckId: string) => {
    setSelectedDeckIds((current) => {
      const next = new Set(current);
      if (next.has(deckId)) next.delete(deckId);
      else next.add(deckId);
      return next;
    });
  };

  const selectFilteredDecks = () => {
    setSelectionMode(true);
    setSelectedDeckIds((current) => {
      const next = new Set(current);
      filteredDeckIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearFilteredDecks = () => {
    setSelectedDeckIds((current) => {
      const next = new Set(current);
      filteredDeckIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedDeckIds(new Set());
  };

  const openDeleteRequest = (ids: string[], scope: "single" | "selected" | "all") => {
    if (ids.length === 0) return;
    setDeleteRequest({ ids, scope });
  };

  const confirmDelete = async () => {
    if (!deleteRequest || deleting) return;
    setDeleting(true);
    try {
      await deleteDecks(deleteRequest.ids);
      const deletedCount = deleteRequest.ids.length;
      setSelectedDeckIds((current) => {
        const next = new Set(current);
        deleteRequest.ids.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteRequest(null);
      if (deleteRequest.scope === "all") {
        setSelectionMode(false);
      }
      toast.success(deletedCount === 1 ? "Deck deleted." : `${deletedCount} decks deleted.`);
    } finally {
      setDeleting(false);
    }
  };

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
            {decks.length} {t("home.decks.suffix")}
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

        {!isLoading && decks.length > 0 && (
          <section className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {selectionMode
                  ? `${selectedCount} ${selectedCount === 1 ? "deck" : "decks"} selected`
                  : "Manage deck deletion"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Select several decks to delete them together, or remove every deck at once.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={selectionMode ? "secondary" : "outline"}
                onClick={() => {
                  if (selectionMode) clearSelection();
                  setSelectionMode((current) => !current);
                }}
              >
                <CheckSquare className="h-4 w-4" />
                {selectionMode ? "Selection on" : "Select decks"}
              </Button>
              {selectionMode && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={allFilteredSelected ? clearFilteredDecks : selectFilteredDecks}
                    disabled={filteredDeckIds.length === 0}
                  >
                    {allFilteredSelected ? "Clear shown" : "Select all shown"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={clearSelection}
                    disabled={selectedCount === 0}
                  >
                    <X className="h-4 w-4" />
                    Clear
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => openDeleteRequest([...selectedDeckIds], "selected")}
                    disabled={selectedCount === 0}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete selected
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="destructive"
                onClick={() =>
                  openDeleteRequest(
                    decks.map((deck) => deck.id),
                    "all",
                  )
                }
              >
                <Trash2 className="h-4 w-4" />
                Delete all
              </Button>
            </div>
          </section>
        )}

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
              const isSelected = selectedDeckIds.has(deck.id);
              return (
                <div
                  key={deck.id}
                  className={`rounded-3xl border bg-card p-6 shadow-[var(--shadow-soft)] transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[var(--shadow-card)] ${
                    isSelected ? "border-primary ring-2 ring-primary/15" : "border-border/70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {selectionMode && (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          if (checked === "indeterminate") return;
                          if (checked !== isSelected) toggleDeckSelection(deck.id);
                        }}
                        aria-label={`Select ${deck.name}`}
                        className="mt-1 h-5 w-5 rounded-md"
                      />
                    )}
                    <Link
                      to="/deck/$deckId"
                      params={{ deckId: deck.id }}
                      className="block min-w-0 flex-1"
                    >
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
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setEditDeckId(deck.id);
                      }}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label={t("home.settings")}
                    >
                      <Settings2 className="h-4 w-4" />
                    </button>
                  </div>

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
                        openDeleteRequest([deck.id], "single");
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

      <Dialog
        open={deleteRequest !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteRequest(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deleteRequest?.scope === "all"
                ? "Delete all decks?"
                : deleteRequest?.ids.length === 1
                  ? "Delete this deck?"
                  : `Delete ${deleteRequest?.ids.length ?? 0} decks?`}
            </DialogTitle>
            <DialogDescription>
              {deleteRequest?.scope === "all"
                ? `This will permanently delete all ${deleteRequest.ids.length} decks in your account.`
                : "These decks and all their cards will be permanently removed."}
            </DialogDescription>
          </DialogHeader>

          {deleteRequest && (
            <div className="rounded-2xl border border-border bg-secondary/40 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Decks to delete
              </p>
              <ul className="space-y-1.5 text-sm">
                {deleteRequestDecks.slice(0, 6).map((deck) => (
                  <li key={deck.id} className="truncate font-medium text-foreground">
                    {deck.name}
                  </li>
                ))}
              </ul>
              {deleteRequest.ids.length > 6 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  + {deleteRequest.ids.length - 6} more
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteRequest(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
