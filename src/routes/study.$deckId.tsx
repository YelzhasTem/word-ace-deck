import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDeck } from "@/lib/decks";
import { useServerFn } from "@tanstack/react-start";
import { recordStreakToday } from "@/lib/streak";
import { recordAnswer } from "@/lib/stats";
import { playCorrectSound, playWrongSound } from "@/lib/sounds";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, X, Shuffle, RotateCcw, Repeat, Star, Loader2 } from "lucide-react";
import { rateDeck } from "@/lib/community.functions";

export const Route = createFileRoute("/study/$deckId")({
  component: StudyPage,
});

function StudyPage() {
  const { deckId } = Route.useParams();
  const { deck, markCard, resetProgress } = useDeck(deckId);
  const rateOriginalDeck = useServerFn(rateDeck);

  const [order, setOrder] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reverseSides, setReverseSides] = useState(false);
  const [rated, setRated] = useState(false);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionWrong, setSessionWrong] = useState(0);
  const autoResetDeckRef = useRef<string | null>(null);

  const queueSource = useMemo(
    () => (deck ? deck.cards.filter((c) => !c.known).map((c) => c.id) : []),
    [deck],
  );

  useEffect(() => {
    autoResetDeckRef.current = null;
    setOrder(queueSource);
    setIdx(0);
    setFlipped(false);
    setSessionCorrect(0);
    setSessionWrong(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

  useEffect(() => {
    setOrder((prev) => {
      const set = new Set(queueSource);
      const kept = prev.filter((id) => set.has(id));
      const newOnes = queueSource.filter((id) => !prev.includes(id));
      return [...kept, ...newOnes];
    });
  }, [queueSource]);

  useEffect(() => {
    if (!deck || deck.cards.length === 0) return;
    const sessionAnswered = sessionCorrect + sessionWrong;
    const completedBeforeSession = sessionAnswered === 0 && deck.cards.every((card) => card.known);

    if (!completedBeforeSession || autoResetDeckRef.current === deck.id) return;

    autoResetDeckRef.current = deck.id;
    resetProgress(deck.id);
    setOrder(deck.cards.map((card) => card.id));
    setIdx(0);
    setFlipped(false);
  }, [deck, resetProgress, sessionCorrect, sessionWrong]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight" || e.key === "2") {
        handleKnown();
      } else if (e.key === "ArrowLeft" || e.key === "1") {
        handleAgain();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, order, deck]);

  if (!deck) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="font-display text-3xl">Deck not found</h1>
          <Link to="/" className="mt-6 inline-block text-accent underline">
            Home
          </Link>
        </main>
      </div>
    );
  }

  const currentId = order[idx];
  const current = deck.cards.find((c) => c.id === currentId);
  const total = deck.cards.length;
  const knownCount = deck.cards.filter((c) => c.known).length;
  const sessionAnswered = sessionCorrect + sessionWrong;
  const completedBeforeSession = total > 0 && knownCount === total && sessionAnswered === 0;
  const frontLabel = reverseSides ? "Translation" : "Word";
  const backLabel = reverseSides ? "Word" : "Translation";
  const frontText = current ? (reverseSides ? current.definition : current.term) : "";
  const backText = current ? (reverseSides ? current.term : current.definition) : "";

  const handleKnown = () => {
    if (!current) return;
    playCorrectSound();
    setFlipped(false);
    recordAnswer(deck.id, current.id, true);
    setSessionCorrect((count) => count + 1);
    markCard(deck.id, current.id, true);
    recordStreakToday();
    // The card automatically leaves the queue through queueSource,
    // the next card takes the current index, so no separate advance is needed.
  };

  const handleAgain = () => {
    if (!current) return;
    playWrongSound();
    setFlipped(false);
    recordAnswer(deck.id, current.id, false);
    setSessionWrong((count) => count + 1);
    const currentIndex = order.indexOf(current.id);
    setOrder((prev) => {
      if (prev.length <= 1 || currentIndex === -1) return prev;
      const next = [...prev];
      const [cur] = next.splice(currentIndex, 1);
      next.push(cur);
      return next;
    });
    if (order.length > 1 && currentIndex !== -1) {
      setIdx(currentIndex >= order.length - 1 ? 0 : currentIndex);
    }
  };

  const shuffle = () => {
    setOrder((prev) => [...prev].sort(() => Math.random() - 0.5));
    setIdx(0);
    setFlipped(false);
  };

  const finished = !current && !completedBeforeSession;

  const onRateOriginal = async (rating: number) => {
    if (!deck?.sourceDeckId) return;
    await rateOriginalDeck({ data: { deckId: deck.sourceDeckId, rating } });
    setRated(true);
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <Link
            to="/deck/$deckId"
            params={{ deckId: deck.id }}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> {deck.name}
          </Link>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={shuffle}
              disabled={order.length < 2}
            >
              <Shuffle className="h-4 w-4" /> Shuffle
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => {
                setReverseSides((value) => !value);
                setFlipped(false);
              }}
            >
              <Repeat className="h-4 w-4" /> Reverse sides
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => {
                resetProgress(deck.id);
                setIdx(0);
                setFlipped(false);
                setSessionCorrect(0);
                setSessionWrong(0);
              }}
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>
              {finished ? total : total - order.length + (idx + 1)} / {total}
            </span>
            <span>learned {knownCount}</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${total ? (knownCount / total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {completedBeforeSession && !current ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-accent" />
            <h2 className="font-display text-3xl font-semibold">Starting a new run</h2>
            <p className="mt-3 text-muted-foreground">
              Preparing this deck for another study session.
            </p>
          </div>
        ) : finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">🎉</p>
            <h2 className="font-display text-3xl font-semibold">Run complete</h2>
            <p className="mt-3 text-muted-foreground">
              You know {knownCount} of {total} cards.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Correct answers:{" "}
              <span className="font-semibold text-foreground">{sessionCorrect}</span>
              {sessionAnswered > 0 ? ` of ${sessionAnswered}` : ""}
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/deck/$deckId" params={{ deckId: deck.id }}>
                  Back to deck
                </Link>
              </Button>
              <Button
                className="rounded-full"
                onClick={() => {
                  resetProgress(deck.id);
                  setIdx(0);
                  setFlipped(false);
                  setSessionCorrect(0);
                  setSessionWrong(0);
                }}
              >
                <RotateCcw className="h-4 w-4" /> Study again
              </Button>
            </div>
            {deck.sourceDeckId && (
              <div className="mx-auto mt-8 max-w-md rounded-2xl border border-border bg-background p-4">
                <p className="text-sm font-medium">Rate the original community deck</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This is optional, but helps other users find useful decks.
                </p>
                {rated ? (
                  <p className="mt-3 text-sm text-primary">Thanks, your rating was saved.</p>
                ) : (
                  <div className="mt-3 flex justify-center gap-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        onClick={() => onRateOriginal(value)}
                        className="rounded-full p-1 text-primary hover:bg-secondary"
                        aria-label={`Rate ${value}`}
                      >
                        <Star className="h-6 w-6" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Card */}
            <div className="flip-scene h-[420px] mb-8">
              <div
                className={`flip-card cursor-pointer ${flipped ? "is-flipped" : ""}`}
                onClick={() => setFlipped((f) => !f)}
                role="button"
                aria-label="Flip card"
              >
                <div className="flip-face rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] flex flex-col items-center justify-center p-10 text-center">
                  <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-6">
                    {frontLabel}
                  </span>
                  <p className="font-display text-5xl md:text-6xl font-extrabold leading-tight tracking-tight text-foreground">
                    {frontText}
                  </p>
                  <span className="mt-8 text-xs text-muted-foreground">
                    Click the card or press Space to flip
                  </span>
                </div>
                <div className="flip-face flip-face--back rounded-3xl bg-primary text-primary-foreground shadow-[var(--shadow-card)] flex flex-col items-center justify-center p-10 text-center">
                  <span className="text-xs uppercase tracking-[0.2em] opacity-70 font-semibold mb-6">
                    {backLabel}
                  </span>
                  <p className="font-display text-3xl md:text-4xl font-bold leading-snug">
                    {backText}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                size="lg"
                className="rounded-full h-14 text-base border-border hover:bg-destructive/5 hover:text-destructive hover:border-destructive/40"
                onClick={handleAgain}
              >
                <X className="h-5 w-5" /> Try again
              </Button>
              <Button
                size="lg"
                className="rounded-full h-14 text-base bg-success text-white hover:bg-success/90"
                onClick={handleKnown}
              >
                <Check className="h-5 w-5" /> Know it
              </Button>
            </div>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">Space</kbd> — flip ·{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">←</kbd> again ·{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">→</kbd> know it
            </p>
          </>
        )}
      </main>
    </div>
  );
}
