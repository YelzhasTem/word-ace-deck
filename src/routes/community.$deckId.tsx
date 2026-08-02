import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Flag, Heart, Library, Star } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OFFLINE_SAVE_MESSAGE, useOnlineStatus } from "@/lib/online-status";
import {
  duplicatePublicDeck,
  getPublicDeckDetails,
  rateDeck,
  reportDeck,
  toggleDeckLike,
  toggleDeckSave,
} from "@/lib/community.functions";
import { createContentIdempotencyKey } from "@/lib/deck-creation-errors";

export const Route = createFileRoute("/community/$deckId")({
  component: CommunityDeckPage,
});

type DeckDetails = {
  id: string;
  title: string;
  description: string;
  cardCount: number;
  totalLearners: number;
  likes: number;
  rating: number;
  ratingCount: number;
  views: number;
  copies: number;
  liked: boolean;
  saved: boolean;
};

type PublicCard = { id: string; term: string; definition: string };

function CommunityDeckPage() {
  const { deckId } = Route.useParams();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const loadDetails = useServerFn(getPublicDeckDetails);
  const likeDeck = useServerFn(toggleDeckLike);
  const saveDeck = useServerFn(toggleDeckSave);
  const duplicateDeck = useServerFn(duplicatePublicDeck);
  const rate = useServerFn(rateDeck);
  const report = useServerFn(reportDeck);

  const [deck, setDeck] = useState<DeckDetails | null>(null);
  const [cards, setCards] = useState<PublicCard[]>([]);
  const [reportReason, setReportReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [duplicating, setDuplicating] = useState(false);
  const duplicateActive = useRef(false);
  const duplicateKey = useRef<string | null>(null);

  useEffect(() => {
    loadDetails({ data: { deckId } })
      .then((res) => {
        setDeck(res.deck as DeckDetails);
        setCards(res.cards as PublicCard[]);
      })
      .finally(() => setLoading(false));
  }, [deckId, loadDetails]);

  const onLike = async () => {
    if (!deck) return;
    if (!isOnline) {
      toast.error(OFFLINE_SAVE_MESSAGE);
      return;
    }
    const res = await likeDeck({ data: { deckId: deck.id } });
    setDeck({ ...deck, liked: res.liked, likes: res.likes });
  };

  const onSave = async () => {
    if (!deck) return;
    if (!isOnline) {
      toast.error(OFFLINE_SAVE_MESSAGE);
      return;
    }
    const res = await saveDeck({ data: { deckId: deck.id } });
    setDeck({ ...deck, saved: res.saved });
    toast.success(res.saved ? "Saved to your community list." : "Removed from saved decks.");
  };

  const onDuplicate = async () => {
    if (!deck || duplicateActive.current) return;
    if (!isOnline) {
      toast.error(OFFLINE_SAVE_MESSAGE);
      return;
    }
    duplicateKey.current ??= createContentIdempotencyKey();
    duplicateActive.current = true;
    setDuplicating(true);
    try {
      const res = await duplicateDeck({
        data: { deckId: deck.id, idempotencyKey: duplicateKey.current },
      });
      duplicateKey.current = null;
      toast.success("Deck copied into your library.");
      navigate({ to: "/deck/$deckId", params: { deckId: res.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add deck to your library.");
    } finally {
      duplicateActive.current = false;
      setDuplicating(false);
    }
  };

  const onRate = async (rating: number) => {
    if (!deck) return;
    if (!isOnline) {
      toast.error(OFFLINE_SAVE_MESSAGE);
      return;
    }
    const res = await rate({ data: { deckId: deck.id, rating } });
    setDeck({ ...deck, rating: Number(res.rating.toFixed(1)), ratingCount: res.ratingCount });
  };

  const onReport = async () => {
    if (!deck || reportReason.trim().length < 3) return;
    if (!isOnline) {
      toast.error(OFFLINE_SAVE_MESSAGE);
      return;
    }
    await report({ data: { deckId: deck.id, reason: reportReason.trim() } });
    setReportReason("");
    toast.success("Report sent for review.");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-5xl px-6 py-16 text-center text-muted-foreground">
          Loading deck...
        </main>
      </div>
    );
  }

  if (!deck) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-5xl px-6 py-16 text-center">
          <h1 className="font-display text-3xl font-bold">Deck not found</h1>
          <Button asChild className="mt-6">
            <Link to="/community">Back to Community</Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link
          to="/community"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Community
        </Link>

        <section className="rounded-3xl border border-border bg-card p-6 md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="font-display text-4xl font-bold tracking-tight">{deck.title}</h1>
              <p className="mt-3 max-w-2xl text-muted-foreground">
                {deck.description || "No description yet."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="rounded-full"
                onClick={onLike}
                disabled={!isOnline}
              >
                <Heart className={`h-4 w-4 ${deck.liked ? "fill-current text-destructive" : ""}`} />{" "}
                {deck.likes}
              </Button>
              <Button
                variant="outline"
                className="rounded-full"
                onClick={onSave}
                disabled={!isOnline}
              >
                <Library className="h-4 w-4" /> {deck.saved ? "Saved" : "Save"}
              </Button>
              <Button
                className="rounded-full"
                onClick={onDuplicate}
                disabled={!isOnline || duplicating}
              >
                <Copy className="h-4 w-4" /> Add to library
              </Button>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-5">
            <div className="rounded-2xl bg-background border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Cards</p>
              <p className="font-display text-2xl">{deck.cardCount}</p>
            </div>
            <div className="rounded-2xl bg-background border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Learners</p>
              <p className="font-display text-2xl">{deck.totalLearners}</p>
            </div>
            <div className="rounded-2xl bg-background border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Rating</p>
              <p className="font-display text-2xl">{deck.rating || "New"}</p>
            </div>
            <div className="rounded-2xl bg-background border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Views</p>
              <p className="font-display text-2xl">{deck.views}</p>
            </div>
            <div className="rounded-2xl bg-background border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Copies</p>
              <p className="font-display text-2xl">{deck.copies}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Rate this deck:</span>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                onClick={() => onRate(value)}
                disabled={!isOnline}
                className="rounded-full p-1 text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={`Rate ${value}`}
              >
                <Star className="h-5 w-5" />
              </button>
            ))}
            <span className="text-xs text-muted-foreground">({deck.ratingCount} ratings)</span>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="rounded-3xl border border-border bg-card p-6">
            <h2 className="font-display text-2xl font-bold">Cards preview</h2>
            <div className="mt-4 space-y-2">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className="rounded-2xl border border-border bg-background px-4 py-3"
                >
                  <p className="font-semibold">{card.term}</p>
                  <p className="text-sm text-muted-foreground">{card.definition}</p>
                </div>
              ))}
            </div>
          </div>
          <aside className="rounded-3xl border border-border bg-card p-6 h-fit">
            <h2 className="font-display text-xl font-bold">Moderation</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Report inappropriate content for admin review.
            </p>
            <Input
              className="mt-4"
              placeholder="Reason"
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
            />
            <Button
              variant="outline"
              className="mt-3 w-full rounded-full"
              onClick={onReport}
              disabled={!isOnline || reportReason.trim().length < 3}
            >
              <Flag className="h-4 w-4" /> Report deck
            </Button>
          </aside>
        </section>
      </main>
    </div>
  );
}
