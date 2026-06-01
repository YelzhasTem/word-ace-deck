import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useDeck } from "@/lib/decks";
import { recordStreakToday } from "@/lib/streak";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, X, Shuffle, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/study/$deckId")({
  component: StudyPage,
});

function StudyPage() {
  const { deckId } = Route.useParams();
  const { deck, markCard, resetProgress } = useDeck(deckId);

  const [order, setOrder] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const queueSource = useMemo(
    () => (deck ? deck.cards.filter((c) => !c.known).map((c) => c.id) : []),
    [deck],
  );

  useEffect(() => {
    setOrder(queueSource);
    setIdx(0);
    setFlipped(false);
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
          <h1 className="font-display text-3xl">Колода не найдена</h1>
          <Link to="/" className="mt-6 inline-block text-accent underline">На главную</Link>
        </main>
      </div>
    );
  }

  const currentId = order[idx];
  const current = deck.cards.find((c) => c.id === currentId);
  const total = deck.cards.length;
  const knownCount = deck.cards.filter((c) => c.known).length;

  const advance = () => {
    setFlipped(false);
    setTimeout(() => setIdx((i) => i + 1), 150);
  };

  const handleKnown = () => {
    if (!current) return;
    markCard(deck.id, current.id, true);
    advance();
  };

  const handleAgain = () => {
    if (!current) return;
    setFlipped(false);
    setTimeout(() => {
      setOrder((prev) => {
        const next = [...prev];
        const [cur] = next.splice(idx, 1);
        next.push(cur);
        return next;
      });
    }, 150);
  };

  const shuffle = () => {
    setOrder((prev) => [...prev].sort(() => Math.random() - 0.5));
    setIdx(0);
    setFlipped(false);
  };

  const finished = !current;

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
              <Shuffle className="h-4 w-4" /> Перемешать
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => {
                resetProgress(deck.id);
                setIdx(0);
                setFlipped(false);
              }}
            >
              <RotateCcw className="h-4 w-4" /> Сбросить
            </Button>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>
              {finished ? total : idx + 1} / {order.length || total}
            </span>
            <span>выучено {knownCount}</span>
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

        {finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">🎉</p>
            <h2 className="font-display text-3xl font-semibold">Подход завершён</h2>
            <p className="mt-3 text-muted-foreground">
              Вы знаете {knownCount} из {total} карточек.
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/deck/$deckId" params={{ deckId: deck.id }}>К колоде</Link>
              </Button>
              <Button
                className="rounded-full"
                onClick={() => {
                  resetProgress(deck.id);
                  setIdx(0);
                  setFlipped(false);
                }}
              >
                <RotateCcw className="h-4 w-4" /> Учить снова
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Card */}
            <div className="flip-scene h-[420px] mb-8">
              <div
                className={`flip-card cursor-pointer ${flipped ? "is-flipped" : ""}`}
                onClick={() => setFlipped((f) => !f)}
                role="button"
                aria-label="Перевернуть карточку"
              >
                <div className="flip-face rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] flex flex-col items-center justify-center p-10 text-center">
                  <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-6">
                    Слово
                  </span>
                  <p className="font-display text-5xl md:text-6xl font-extrabold leading-tight tracking-tight text-foreground">
                    {current.term}
                  </p>
                  <span className="mt-8 text-xs text-muted-foreground">
                    Нажмите карточку или пробел, чтобы перевернуть
                  </span>
                </div>
                <div className="flip-face flip-face--back rounded-3xl bg-primary text-primary-foreground shadow-[var(--shadow-card)] flex flex-col items-center justify-center p-10 text-center">
                  <span className="text-xs uppercase tracking-[0.2em] opacity-70 font-semibold mb-6">
                    Перевод
                  </span>
                  <p className="font-display text-3xl md:text-4xl font-bold leading-snug">
                    {current.definition}
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
                <X className="h-5 w-5" /> Ещё раз
              </Button>
              <Button
                size="lg"
                className="rounded-full h-14 text-base bg-success text-white hover:bg-success/90"
                onClick={handleKnown}
              >
                <Check className="h-5 w-5" /> Знаю
              </Button>
            </div>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">Пробел</kbd> — перевернуть ·{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">←</kbd> ещё раз ·{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">→</kbd> знаю
            </p>
          </>
        )}
      </main>
    </div>
  );
}
