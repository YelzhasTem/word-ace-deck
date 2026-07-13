import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useDeck } from "@/lib/decks";
import { getDefinitionLanguageFor, getLearningLanguageOption } from "@/lib/languages";
import { accuracyFor, recordAnswer, useDeckStats } from "@/lib/stats";
import { recordStreakToday } from "@/lib/streak";
import { playCorrectSound, playWrongSound } from "@/lib/sounds";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Check, X, RotateCcw, Repeat } from "lucide-react";

export const Route = createFileRoute("/reverse/$deckId")({
  component: ReversePage,
});

type Dir = "fwd" | "rev"; // fwd: term to definition, rev: definition to term
type Item = { cardId: string; dir: Dir };

const REV_SUFFIX = ":rev";
const statKey = (cardId: string, dir: Dir) => (dir === "fwd" ? cardId : cardId + REV_SUFFIX);

function ReversePage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);
  const stats = useDeckStats(deckId);
  const [allowReverse, setAllowReverse] = useState(true);
  const [queue, setQueue] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [startedAt, setStartedAt] = useState<number>(Date.now());

  // Build weighted queue: weaker direction more likely; new directions on top.
  const buildQueue = useMemo(
    () => () => {
      if (!deck) return [];
      const items: { item: Item; weight: number; unseen: boolean }[] = [];
      for (const c of deck.cards) {
        const dirs: Dir[] = allowReverse ? ["fwd", "rev"] : ["fwd"];
        for (const dir of dirs) {
          const s = stats[statKey(c.id, dir)];
          const mastery = s?.mastery ?? 0;
          const unseen = !s;
          // Weight: lower mastery → higher weight. Unseen gets boost.
          const weight = (1 - mastery) * 2 + (unseen ? 1 : 0) + 0.1;
          items.push({ item: { cardId: c.id, dir }, weight, unseen });
        }
      }
      // Weighted shuffle: sample without replacement by random^(1/weight)
      const sorted = items
        .map((x) => ({ ...x, key: Math.random() ** (1 / x.weight) }))
        .sort((a, b) => b.key - a.key)
        .map((x) => x.item);
      return sorted;
    },
    [deck, allowReverse, stats],
  );

  useEffect(() => {
    setQueue(buildQueue());
    setIdx(0);
    setFlipped(false);
    setStartedAt(Date.now());
  }, [buildQueue, deckId]);

  const current = queue[idx];
  const card = deck && current ? deck.cards.find((c) => c.id === current.cardId) : undefined;

  useEffect(() => {
    setFlipped(false);
    setStartedAt(Date.now());
  }, [idx]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!current) return;
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight" || e.key === "2") handle(true);
      else if (e.key === "ArrowLeft" || e.key === "1") handle(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, startedAt]);

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

  const learningLanguage = getLearningLanguageOption(deck.targetLanguage);
  const definitionLanguage = getDefinitionLanguageFor(deck.targetLanguage, deck.definitionLanguage);
  const forwardLabel = `${learningLanguage.label} → ${definitionLanguage.label}`;
  const reverseLabel = `${definitionLanguage.label} → ${learningLanguage.label}`;

  const handle = (correct: boolean) => {
    if (!current) return;
    if (correct) playCorrectSound();
    else playWrongSound();
    const ms = Date.now() - startedAt;
    recordAnswer(deck.id, statKey(current.cardId, current.dir), correct, ms);
    recordStreakToday();
    // Re-insert incorrect near the end for quick re-test
    if (!correct) {
      const currentIndex = queue.findIndex(
        (item) => item.cardId === current.cardId && item.dir === current.dir,
      );
      setQueue((prev) => {
        if (prev.length <= 1 || currentIndex === -1) return prev;
        const next = [...prev];
        const [cur] = next.splice(currentIndex, 1);
        const insertAt = Math.min(next.length, currentIndex + 3);
        next.splice(insertAt, 0, cur);
        return next;
      });
      if (queue.length > 1 && currentIndex !== -1) {
        setIdx(currentIndex >= queue.length - 1 ? 0 : currentIndex);
      }
      setFlipped(false);
    } else {
      setFlipped(false);
      setTimeout(() => setIdx((i) => i + 1), 150);
    }
  };

  const restart = () => {
    setQueue(buildQueue());
    setIdx(0);
    setFlipped(false);
  };

  // Stats summary
  const sumFwd = { correct: 0, wrong: 0 };
  const sumRev = { correct: 0, wrong: 0 };
  for (const c of deck.cards) {
    const f = stats[c.id];
    const r = stats[c.id + REV_SUFFIX];
    if (f) {
      sumFwd.correct += f.correct;
      sumFwd.wrong += f.wrong;
    }
    if (r) {
      sumRev.correct += r.correct;
      sumRev.wrong += r.wrong;
    }
  }
  const accFwd =
    sumFwd.correct + sumFwd.wrong > 0
      ? Math.round((sumFwd.correct / (sumFwd.correct + sumFwd.wrong)) * 100)
      : null;
  const accRev =
    sumRev.correct + sumRev.wrong > 0
      ? Math.round((sumRev.correct / (sumRev.correct + sumRev.wrong)) * 100)
      : null;

  // Hardest in reverse (lowest accuracy with at least 2 attempts)
  const hardestReverse = deck.cards
    .map((c) => ({ c, s: stats[c.id + REV_SUFFIX] }))
    .filter((x) => x.s && x.s.correct + x.s.wrong >= 2)
    .map((x) => ({ ...x, acc: accuracyFor(x.s)! }))
    .sort((a, b) => a.acc - b.acc)
    .slice(0, 5);

  const finished = !current;
  const front = card ? (current!.dir === "fwd" ? card.term : card.definition) : "";
  const back = card ? (current!.dir === "fwd" ? card.definition : card.term) : "";
  const dirLabel = current?.dir === "fwd" ? forwardLabel : reverseLabel;

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
          <Button variant="ghost" size="sm" className="rounded-full" onClick={restart}>
            <RotateCcw className="h-4 w-4" /> Restart
          </Button>
        </div>

        <div className="mb-6">
          <h1 className="font-display text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Repeat className="h-6 w-6 text-accent" /> Reverse Cards Mode
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Study words both ways to strengthen long-term memory and active recall.
          </p>
        </div>

        {/* Settings */}
        <div className="mb-6 rounded-2xl border border-border bg-card px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold">Enable Reverse Cards Mode</p>
            <p className="text-xs text-muted-foreground">
              Random direction for each card: {forwardLabel} and {reverseLabel}.
            </p>
          </div>
          <Switch checked={allowReverse} onCheckedChange={(v) => setAllowReverse(Boolean(v))} />
        </div>

        {/* Direction stats */}
        <div className="mb-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{forwardLabel}</p>
            <p className="font-display text-2xl">{accFwd !== null ? `${accFwd}%` : "—"}</p>
            <p className="text-xs text-muted-foreground">
              {sumFwd.correct} correct · {sumFwd.wrong} mistakes
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{reverseLabel}</p>
            <p className="font-display text-2xl">{accRev !== null ? `${accRev}%` : "—"}</p>
            <p className="text-xs text-muted-foreground">
              {sumRev.correct} correct · {sumRev.wrong} mistakes
            </p>
          </div>
        </div>

        {finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">🎉</p>
            <h2 className="font-display text-3xl font-semibold">Run complete</h2>
            <p className="mt-3 text-muted-foreground">All directions are complete.</p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/deck/$deckId" params={{ deckId: deck.id }}>
                  Back to deck
                </Link>
              </Button>
              <Button className="rounded-full" onClick={restart}>
                <RotateCcw className="h-4 w-4" /> Another round
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {idx + 1} / {queue.length}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 text-accent font-semibold uppercase tracking-wider">
                <Repeat className="h-3 w-3" /> {dirLabel}
              </span>
            </div>

            <div className="flip-scene h-[420px] mb-8">
              <div
                className={`flip-card cursor-pointer ${flipped ? "is-flipped" : ""}`}
                onClick={() => setFlipped((f) => !f)}
                role="button"
                aria-label="Flip card"
              >
                <div className="flip-face rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] flex flex-col items-center justify-center p-10 text-center">
                  <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-6">
                    {current!.dir === "fwd" ? "Word" : "Translation"}
                  </span>
                  <p className="font-display text-5xl md:text-6xl font-extrabold leading-tight tracking-tight text-foreground">
                    {front}
                  </p>
                  <span className="mt-8 text-xs text-muted-foreground">
                    Think, then click to reveal the answer
                  </span>
                </div>
                <div className="flip-face flip-face--back rounded-3xl bg-primary text-primary-foreground shadow-[var(--shadow-card)] flex flex-col items-center justify-center p-10 text-center">
                  <span className="text-xs uppercase tracking-[0.2em] opacity-70 font-semibold mb-6">
                    {current!.dir === "fwd" ? "Translation" : "Word"}
                  </span>
                  <p className="font-display text-3xl md:text-4xl font-bold leading-snug">{back}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                size="lg"
                className="rounded-full h-14 text-base border-border hover:bg-destructive/5 hover:text-destructive hover:border-destructive/40"
                onClick={() => handle(false)}
              >
                <X className="h-5 w-5" /> Do not know
              </Button>
              <Button
                size="lg"
                className="rounded-full h-14 text-base bg-success text-white hover:bg-success/90"
                onClick={() => handle(true)}
              >
                <Check className="h-5 w-5" /> Know it
              </Button>
            </div>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">Space</kbd> — flip ·{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">←</kbd> do not know ·{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">→</kbd> know it
            </p>
          </>
        )}

        {hardestReverse.length > 0 && (
          <section className="mt-10 rounded-3xl border border-border bg-card p-6">
            <h2 className="font-display text-xl mb-3">Hardest in reverse direction</h2>
            <div className="flex flex-wrap gap-2">
              {hardestReverse.map(({ c, acc }) => (
                <span
                  key={c.id}
                  className="px-3 py-1 rounded-full bg-destructive/10 text-destructive text-xs"
                >
                  {c.definition} → {c.term} · {acc}%
                </span>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
