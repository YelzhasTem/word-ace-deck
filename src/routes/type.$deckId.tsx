import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useDeck, type Card } from "@/lib/decks";
import { getDefinitionLanguageFor, getLearningLanguageOption } from "@/lib/languages";
import { recordStreakToday } from "@/lib/streak";
import { recordAnswer, isCloseMatch, prioritise, accuracyFor, useDeckStats } from "@/lib/stats";
import { playCorrectSound, playWrongSound } from "@/lib/sounds";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check, X, Keyboard, RotateCcw, Repeat } from "lucide-react";

export const Route = createFileRoute("/type/$deckId")({
  component: TypePage,
});

function TypePage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);
  const stats = useDeckStats(deckId);

  const queue = useMemo<Card[]>(() => (deck ? prioritise(deckId, deck.cards) : []), [deck, deckId]);
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState("");
  const [verdict, setVerdict] = useState<null | "ok" | "miss">(null);
  const [right, setRight] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState<number>(() => Date.now());
  const [reverseSides, setReverseSides] = useState(false);

  useEffect(() => {
    setIdx(0);
    setInput("");
    setVerdict(null);
    setRight(0);
    setWrong(0);
    setWrongIds([]);
    setStartedAt(Date.now());
  }, [deckId]);
  useEffect(() => {
    setStartedAt(Date.now());
  }, [idx]);

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
  const current = queue[idx];
  const finished = !current;
  const total = queue.length;
  const promptLabel = reverseSides ? "Type the word" : "Type the translation";
  const promptText = current ? (reverseSides ? current.definition : current.term) : "";
  const expectedAnswer = current ? (reverseSides ? current.term : current.definition) : "";
  const answerPlaceholder = reverseSides
    ? `${learningLanguage.label} word...`
    : `${definitionLanguage.label} translation...`;
  const reviewPrimary = (card: Card) => (reverseSides ? card.definition : card.term);
  const reviewSecondary = (card: Card) => (reverseSides ? card.term : card.definition);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!current || verdict || !input.trim()) return;
    const elapsed = Date.now() - startedAt;
    const ok = isCloseMatch(input, expectedAnswer);
    if (ok) playCorrectSound();
    else playWrongSound();
    setVerdict(ok ? "ok" : "miss");
    recordAnswer(deck.id, current.id, ok, elapsed);
    if (ok) {
      setRight((r) => r + 1);
      recordStreakToday();
    } else {
      setWrong((w) => w + 1);
      setWrongIds((ids) => [...ids, current.id]);
    }
  };

  const next = () => {
    setVerdict(null);
    setInput("");
    setIdx((i) => i + 1);
  };
  const restart = () => {
    setIdx(0);
    setInput("");
    setVerdict(null);
    setRight(0);
    setWrong(0);
    setWrongIds([]);
    setStartedAt(Date.now());
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm text-accent font-medium">
              <Keyboard className="h-4 w-4" /> Typed translation
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => {
                setReverseSides((value) => !value);
                setInput("");
                setStartedAt(Date.now());
              }}
              disabled={!!verdict}
            >
              <Repeat className="h-4 w-4" /> Reverse sides
            </Button>
          </div>
        </div>

        {finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">⌨️</p>
            <h2 className="font-display text-3xl font-semibold">Round complete</h2>
            <p className="mt-3 text-muted-foreground">
              Correct: {right} of {total} · accuracy {total ? Math.round((right / total) * 100) : 0}
              %
            </p>
            {wrongIds.length > 0 && (
              <div className="mt-6 text-left max-w-md mx-auto">
                <p className="text-sm font-semibold mb-2">To review:</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {wrongIds.map((id) => {
                    const c = deck.cards.find((x) => x.id === id);
                    return c ? (
                      <li key={id}>
                        · <span className="text-foreground font-medium">{reviewPrimary(c)}</span> —{" "}
                        {reviewSecondary(c)}
                      </li>
                    ) : null;
                  })}
                </ul>
              </div>
            )}
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/deck/$deckId" params={{ deckId: deck.id }}>
                  Back to deck
                </Link>
              </Button>
              <Button className="rounded-full" onClick={restart}>
                <RotateCcw className="h-4 w-4" /> Try again
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <div className="flex justify-between text-xs text-muted-foreground mb-2">
                <span>
                  {idx + 1} / {total}
                </span>
                <span>
                  <span className="text-[color:var(--success)]">✓ {right}</span> ·{" "}
                  <span className="text-destructive">✗ {wrong}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${(idx / total) * 100}%` }}
                />
              </div>
            </div>

            <div className="rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] p-10 text-center mb-6">
              <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold">
                {promptLabel}
              </span>
              <p className="mt-6 font-display text-5xl md:text-6xl font-extrabold leading-tight tracking-tight">
                {promptText}
              </p>
              {(() => {
                const a = accuracyFor(stats[current.id]);
                return a !== null ? (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Your accuracy for this word: {a}%
                  </p>
                ) : null;
              })()}
            </div>

            <form onSubmit={submit} className="space-y-3">
              <Input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={answerPlaceholder}
                disabled={!!verdict}
                className="h-14 text-lg rounded-2xl"
              />
              {verdict === "ok" && (
                <div className="rounded-2xl bg-[color:var(--success)]/10 text-[color:var(--success)] px-4 py-3 text-sm flex items-center gap-2">
                  <Check className="h-4 w-4" /> Correct! {expectedAnswer}
                </div>
              )}
              {verdict === "miss" && (
                <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm flex items-center gap-2">
                  <X className="h-4 w-4" /> Correct answer:{" "}
                  <span className="font-semibold">{expectedAnswer}</span>
                </div>
              )}
              <div className="flex justify-end gap-2">
                {!verdict ? (
                  <Button type="submit" className="rounded-full" disabled={!input.trim()}>
                    Check
                  </Button>
                ) : (
                  <Button type="button" className="rounded-full" onClick={next}>
                    {idx + 1 < total ? "Next" : "Finish"}
                  </Button>
                )}
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
