import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, FolderOpen, Globe2, Save } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCollections } from "@/lib/collections";
import { useDecks } from "@/lib/decks";
import { DECK_CATEGORIES, updateDeckPublishing } from "@/lib/community.functions";

type PublishType = "deck" | "collection";
type Visibility = "private" | "unlisted" | "public";

export const Route = createFileRoute("/publish")({
  component: PublishPage,
});

function parseKeywords(value: string) {
  return value
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function PublishPage() {
  const location = useLocation();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialType = query.get("type") === "collection" ? "collection" : "deck";
  const initialId = query.get("id") ?? "";

  const { decks, isLoading: decksLoading } = useDecks();
  const { collections, updateCollectionPublishing } = useCollections();
  const updateDeck = useServerFn(updateDeckPublishing);

  const [type, setType] = useState<PublishType>(initialType);
  const [selectedId, setSelectedId] = useState(initialId);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [category, setCategory] = useState<(typeof DECK_CATEGORIES)[number]>("General English");
  const [keywords, setKeywords] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedDeck = type === "deck" ? decks.find((deck) => deck.id === selectedId) : undefined;
  const selectedCollection =
    type === "collection" ? collections.find((collection) => collection.id === selectedId) : undefined;
  const selectedItem = selectedDeck ?? selectedCollection;
  const isLoading = decksLoading && decks.length === 0;

  useEffect(() => {
    const nextId = type === "deck" ? decks[0]?.id : collections[0]?.id;
    if (!selectedId && nextId) setSelectedId(nextId);
  }, [collections, decks, selectedId, type]);

  useEffect(() => {
    const item = selectedDeck ?? selectedCollection;
    if (!item) return;
    setVisibility(item.visibility);
    setKeywords(item.keywords.join(", "));
    if (selectedDeck) {
      setCategory(
        DECK_CATEGORIES.includes(selectedDeck.category as never)
          ? (selectedDeck.category as (typeof DECK_CATEGORIES)[number])
          : "General English",
      );
    }
  }, [selectedCollection, selectedDeck]);

  const switchType = (nextType: PublishType) => {
    setType(nextType);
    const nextId = nextType === "deck" ? decks[0]?.id : collections[0]?.id;
    setSelectedId(nextId ?? "");
  };

  const handleSave = async () => {
    if (!selectedItem) return;
    setSaving(true);
    try {
      if (type === "deck") {
        await updateDeck({
          data: {
            deckId: selectedItem.id,
            visibility,
            category,
            keywords: parseKeywords(keywords),
          },
        });
      } else {
        await updateCollectionPublishing(selectedItem.id, visibility, parseKeywords(keywords));
      }
      toast.success(visibility === "public" ? "Published to Community." : "Publishing settings saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save publishing settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link
          to={type === "deck" && selectedDeck ? "/deck/$deckId" : "/collections"}
          params={type === "deck" && selectedDeck ? { deckId: selectedDeck.id } : undefined}
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <section className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Publishing</p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">Publish your content</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Choose whether a deck or collection stays private, opens by direct link, or appears in Community.
          </p>
        </section>

        {isLoading ? (
          <section className="rounded-3xl border border-border bg-card p-6">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="mt-5 h-24 w-full" />
            <Skeleton className="mt-5 h-10 w-36 rounded-full" />
          </section>
        ) : (
          <section className="rounded-3xl border border-border bg-card p-6">
            <Tabs value={type} onValueChange={(value) => switchType(value as PublishType)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="deck" className="gap-2">
                  <BookOpen className="h-4 w-4" /> Deck
                </TabsTrigger>
                <TabsTrigger value="collection" className="gap-2">
                  <FolderOpen className="h-4 w-4" /> Collection
                </TabsTrigger>
              </TabsList>

              <TabsContent value="deck" className="mt-6 space-y-5">
                <PublishForm
                  emptyText="Create a deck before publishing."
                  items={decks.map((deck) => ({ id: deck.id, name: deck.name }))}
                  selectedId={selectedId}
                  setSelectedId={setSelectedId}
                  visibility={visibility}
                  setVisibility={setVisibility}
                  category={category}
                  setCategory={setCategory}
                  keywords={keywords}
                  setKeywords={setKeywords}
                  selectedItem={selectedDeck}
                  type="deck"
                />
              </TabsContent>

              <TabsContent value="collection" className="mt-6 space-y-5">
                <PublishForm
                  emptyText="Create a collection before publishing."
                  items={collections.map((collection) => ({ id: collection.id, name: collection.name }))}
                  selectedId={selectedId}
                  setSelectedId={setSelectedId}
                  visibility={visibility}
                  setVisibility={setVisibility}
                  keywords={keywords}
                  setKeywords={setKeywords}
                  selectedItem={selectedCollection}
                  type="collection"
                />
              </TabsContent>
            </Tabs>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
              <div className="text-sm text-muted-foreground">
                {selectedItem ? (
                  <>
                    Current status: <span className="font-medium capitalize text-foreground">{selectedItem.visibility}</span>
                  </>
                ) : (
                  "Select an item to configure publishing."
                )}
              </div>
              <Button className="rounded-full" onClick={handleSave} disabled={!selectedItem || saving}>
                {saving ? (
                  <>
                    <Globe2 className="h-4 w-4 animate-spin" /> Saving
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" /> Save publishing
                  </>
                )}
              </Button>
            </div>
          </section>
        )}

        {selectedDeck && selectedDeck.visibility !== "private" && (
          <div className="mt-4 text-right">
            <Link
              to="/community/$deckId"
              params={{ deckId: selectedDeck.id }}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open public deck link
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

function PublishForm({
  emptyText,
  items,
  selectedId,
  setSelectedId,
  visibility,
  setVisibility,
  category,
  setCategory,
  keywords,
  setKeywords,
  selectedItem,
  type,
}: {
  emptyText: string;
  items: { id: string; name: string }[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  visibility: Visibility;
  setVisibility: (visibility: Visibility) => void;
  category?: (typeof DECK_CATEGORIES)[number];
  setCategory?: (category: (typeof DECK_CATEGORIES)[number]) => void;
  keywords: string;
  setKeywords: (keywords: string) => void;
  selectedItem?: {
    id: string;
    name: string;
    description: string;
    visibility: Visibility;
    keywords: string[];
    totalLearners: number;
    likes: number;
    rating: number;
  };
  type: PublishType;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-background p-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">{type === "deck" ? "Deck" : "Collection"}</span>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Visibility</span>
          <Select value={visibility} onValueChange={(value) => setVisibility(value as Visibility)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="unlisted">Unlisted</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {type === "deck" && category && setCategory && (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Category</span>
          <Select value={category} onValueChange={(value) => setCategory(value as (typeof DECK_CATEGORIES)[number])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DECK_CATEGORIES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Keywords</span>
        <Input
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          placeholder="IELTS, business, travel"
        />
      </label>

      {selectedItem && (
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-border bg-background px-4 py-3">
            <p className="text-xs text-muted-foreground">Visibility</p>
            <p className="font-semibold capitalize">{selectedItem.visibility}</p>
          </div>
          <div className="rounded-2xl border border-border bg-background px-4 py-3">
            <p className="text-xs text-muted-foreground">Learners</p>
            <p className="font-semibold">{selectedItem.totalLearners}</p>
          </div>
          <div className="rounded-2xl border border-border bg-background px-4 py-3">
            <p className="text-xs text-muted-foreground">Likes</p>
            <p className="font-semibold">{selectedItem.likes}</p>
          </div>
          <div className="rounded-2xl border border-border bg-background px-4 py-3">
            <p className="text-xs text-muted-foreground">Rating</p>
            <p className="font-semibold">{selectedItem.rating || "New"}</p>
          </div>
        </div>
      )}
    </>
  );
}
