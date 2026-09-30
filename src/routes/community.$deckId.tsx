import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Flag, Heart, Library, Star } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { UserSafetyActions } from "@/components/UserSafetyActions";
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
  authorId: string;
  authorName: string;
  myRating: number | null;
  isOwner: boolean;
};

type PendingAction = "like" | "save" | "rate" | "report";

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
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [duplicating, setDuplicating] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const actionActive = useRef(false);
  const duplicateActive = useRef(false);
  const duplicateKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    loadDetails({ data: { deckId } })
      .then((res) => {
        if (!active) return;
        setDeck(res.deck as DeckDetails);
        setCards(res.cards as PublicCard[]);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDeck(null);
        setLoadError(error instanceof Error ? error.message : "Could not load this deck");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [deckId, loadDetails, loadAttempt]);

  // Runs one like/save/rate/report at a time, so a double click sends one request,
  // and shows the server error instead of failing silently.
  const runAction = async (
    action: PendingAction,
    work: () => Promise<void>,
    failureMessage: string,
  ) => {
    if (!deck || actionActive.current) return;
    if (!isOnline) {
      toast.error(OFFLINE_SAVE_MESSAGE);
      return;
    }
    actionActive.current = true;
    setPendingAction(action);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failureMessage);
    } finally {
      actionActive.current = false;
      setPendingAction(null);
    }
  };

  const onLike = () =>
    runAction(
      "like",
      async () => {
        if (!deck) return;
        const res = await likeDeck({ data: { deckId: deck.id } });
        setDeck((current) =>
          current ? { ...current, liked: res.liked, likes: res.likes } : current,
        );
      },
      "Could not update your like.",
    );

  const onSave = () =>
    runAction(
      "save",
      async () => {
        if (!deck) return;
        const res = await saveDeck({ data: { deckId: deck.id } });
        setDeck((current) => (current ? { ...current, saved: res.saved } : current));
        toast.success(res.saved ? "Saved to your community list." : "Removed from saved decks.");
      },
      "Could not update saved decks.",
    );

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

  const onRate = (rating: number) =>
    runAction(
      "rate",
      async () => {
        if (!deck) return;
        const res = await rate({ data: { deckId: deck.id, rating } });
        setDeck((current) =>
          current
            ? {
                ...current,
                rating: Number(res.rating.toFixed(1)),
                ratingCount: res.ratingCount,
                myRating: rating,
              }
            : current,
        );
      },
      "Could not save your rating.",
    );

  const onReport = () => {
    if (reportReason.trim().length < 3) return;
    return runAction(
      "report",
      async () => {
        if (!deck) return;
        await report({ data: { deckId: deck.id, reason: reportReason.trim() } });
        setReportReason("");
        toast.success("Report sent for review.");
      },
      "Could not send the report.",
    );
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
          <h1 className="font-display text-3xl font-bold">
            {loadError ? "Could not load this deck" : "Deck not found"}
          </h1>
          {loadError && <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>}
          {loadError && (
            <Button
              variant="outline"
              className="mt-6 mr-2 rounded-full"
              onClick={() => setLoadAttempt((n) => n + 1)}
            >
              Try again
            </Button>
          )}
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
              <p className="mt-2 text-sm text-muted-foreground">
                by{" "}
                <Link
                  to="/creator/$userId"
                  params={{ userId: deck.authorId }}
                  className="font-medium text-foreground hover:text-primary"
                >
                  {deck.authorName}
                </Link>
              </p>
              <p className="mt-3 max-w-2xl text-muted-foreground">
                {deck.description || "No description yet."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="rounded-full"
                onClick={onLike}
                disabled={!isOnline || pendingAction !== null}
                aria-pressed={deck.liked}
                aria-label={deck.liked ? "Unlike deck" : "Like deck"}
              >
                <Heart className={`h-4 w-4 ${deck.liked ? "fill-current text-destructive" : ""}`} />{" "}
                {deck.likes}
              </Button>
              <Button
                variant="outline"
                className="rounded-full"
                onClick={onSave}
                disabled={!isOnline || pendingAction !== null}
                aria-pressed={deck.saved}
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

          {deck.isOwner ? (
            <p className="mt-6 text-sm text-muted-foreground">
              {deck.ratingCount} ratings. You can't rate your own deck.
            </p>
          ) : (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {deck.myRating ? "Your rating:" : "Rate this deck:"}
              </span>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onRate(value)}
                  disabled={!isOnline || pendingAction !== null}
                  className="rounded-full p-1 text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`Rate ${value}`}
                  aria-pressed={deck.myRating === value}
                >
                  <Star
                    className={`h-5 w-5 ${deck.myRating && value <= deck.myRating ? "fill-current" : ""}`}
                  />
                </button>
              ))}
              <span className="text-xs text-muted-foreground">({deck.ratingCount} ratings)</span>
            </div>
          )}
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
              aria-label="Reason for reporting this deck"
              placeholder="Reason"
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
            />
            <Button
              variant="outline"
              className="mt-3 w-full rounded-full"
              onClick={onReport}
              disabled={!isOnline || pendingAction !== null || reportReason.trim().length < 3}
            >
              <Flag className="h-4 w-4" /> Report deck
            </Button>
            {deck && !deck.isOwner && (
              <UserSafetyActions
                userId={deck.authorId}
                name={deck.authorName}
                className="mt-4 border-t border-border pt-4"
              />
            )}
          </aside>
        </section>
      </main>
    </div>
  );
}
