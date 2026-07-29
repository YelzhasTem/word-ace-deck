import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDeck, type Card } from "@/lib/decks";
import { getDefinitionLanguageFor, getLearningLanguageOption } from "@/lib/languages";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check, X, Hourglass, RotateCcw, Repeat, Shuffle } from "lucide-react";
import {
  decksWithReadyRecall,
  dueRecallEntries,
  recordRecallAnswer,
  RECALL_STAGES,
  useDeckDelayedRecallEnabled,
} from "@/lib/delayed-recall";
import { prepareStudySession } from "@/lib/study-session";
import { recordStreakToday } from "@/lib/streak";
import { playCorrectSound, playWrongSound } from "@/lib/sounds";
import { useDeckShuffleEnabled } from "@/lib/shuffle-settings";

export const Route = createFileRoute("/recall/$deckId")({
  component: RecallPage,
});

function shuffleList<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function RecallPage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);
  const [enabled] = useDeckDelayedRecallEnabled(deckId);
  const [shuffleEnabled, setShuffleEnabled] = useDeckShuffleEnabled(deckId);

  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [recallTick, setRecallTick] = useState(0);
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState("");
  const [verdict, setVerdict] = useState<null | "ok" | "miss">(null);
  const [right, setRight] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [reverseSides, setReverseSides] = useState(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [serverExpected, setServerExpected] = useState("");
  const sessionStartedRef = useRef(false);

  useEffect(() => {
    sessionStartedRef.current = false;
    setQueueIds([]);
    setRecallTick((tick) => tick + 1);
    setIdx(0);
    setInput("");
    setVerdict(null);
    setRight(0);
    setWrong(0);
  }, [deckId]);

  useEffect(() => {
    const sync = () => {
      if (!sessionStartedRef.current) setRecallTick((tick) => tick + 1);
    };
    window.addEventListener("delayedRecall:changed", sync);
    return () => window.removeEventListener("delayedRecall:changed", sync);
  }, []);

  const deckCardIds = deck?.cards.map((card) => card.id).join("|") ?? "";
  const buildQueueIds = (ids: string[]) => (shuffleEnabled ? shuffleList(ids) : ids);

  useEffect(() => {
    if (!deck || !enabled) {
      setQueueIds([]);
      return;
    }
    const due = dueRecallEntries(deckId).map((e) => e.cardId);
    const setDue = new Set(due);
    // Preserve deck order, only include ids that still exist
    setQueueIds(buildQueueIds(deck.cards.filter((c) => setDue.has(c.id)).map((c) => c.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, deck, deckCardIds, enabled, recallTick]);

  const cards: Card[] = useMemo(
    () =>
      deck
        ? (queueIds.map((id) => deck.cards.find((c) => c.id === id)).filter(Boolean) as Card[])
        : [],
    [deck, queueIds],
  );

  useEffect(() => {
    setInput("");
    setVerdict(null);
    setServerExpected("");
    setSaveError("");
  }, [idx]);

  useEffect(() => {
    if (!deck || !enabled) return;
    void prepareStudySession(deck.id, "recall").catch((error: unknown) =>
      setSaveError(error instanceof Error ? error.message : "Could not start this recall session"),
    );
  }, [deck, enabled]);

  useEffect(() => {
    if (!deck || !enabled || right > 0 || wrong > 0 || verdict) return;
    const due = dueRecallEntries(deckId).map((e) => e.cardId);
    const setDue = new Set(due);
    setQueueIds(buildQueueIds(deck.cards.filter((c) => setDue.has(c.id)).map((c) => c.id)));
    setIdx(0);
    setInput("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffleEnabled]);

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

  if (!enabled) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="font-display text-3xl">Delayed Recall is turned off</h1>
          <p className="mt-3 text-muted-foreground">
            Turn it on for this deck from the deck page to start a session.
          </p>
          <Button asChild className="mt-8 rounded-full">
            <Link to="/deck/$deckId" params={{ deckId: deck.id }}>
              Back to deck
            </Link>
          </Button>
        </main>
      </div>
    );
  }

  const current = cards[idx];
  const total = cards.length;
  const finished = !current && total > 0;
  const empty = total === 0;
  const nextReadyDeckId = decksWithReadyRecall().find((item) => item.deckId !== deck.id)?.deckId;
  const promptLabel = reverseSides ? "Hint — recall the translation" : "Hint — recall the word";
  const promptText = current ? (reverseSides ? current.term : current.definition) : "";
  const expectedAnswer = current ? (reverseSides ? current.definition : current.term) : "";
  const answerPlaceholder = reverseSides
    ? `${definitionLanguage.label} translation...`
    : `${learningLanguage.label} word...`;
  const answerHelp = reverseSides
    ? `Type the ${definitionLanguage.label} translation that matches this word.`
    : `Type the ${learningLanguage.label} word that matches this definition.`;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!current || verdict || pending) return;
    setPending(true);
    setSaveError("");
    try {
      const result = await recordRecallAnswer(
        deck.id,
        current.id,
        input,
        reverseSides ? "term_to_definition" : "definition_to_term",
      );
      const ok = result.correct;
      setServerExpected(result.expected_answer ?? expectedAnswer);
      if (ok) playCorrectSound();
      else playWrongSound();
      sessionStartedRef.current = true;
      setVerdict(ok ? "ok" : "miss");
      if (ok) {
        setRight((r) => r + 1);
        recordStreakToday();
      } else setWrong((w) => w + 1);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not check this recall answer");
    } finally {
      setPending(false);
    }
  };
  const next = () => setIdx((i) => i + 1);
  const toggleShuffle = () => {
    const nextShuffleEnabled = !shuffleEnabled;
    setShuffleEnabled(nextShuffleEnabled);
    setQueueIds((ids) => {
      const splitAt = verdict ? idx + 1 : idx;
      const answered = ids.slice(0, splitAt);
      const remaining = ids.slice(splitAt);
      return [...answered, ...(nextShuffleEnabled ? shuffleList(remaining) : remaining)];
    });
    setInput("");
    setVerdict(null);
  };
  const toggleReverseSides = () => {
    setReverseSides((value) => !value);
    setInput("");
    setVerdict(null);
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
              <Hourglass className="h-4 w-4" /> Delayed Recall
            </span>
            <Button
              type="button"
              aria-pressed={shuffleEnabled}
              variant={shuffleEnabled ? "secondary" : "ghost"}
              size="sm"
              className={`rounded-full ${shuffleEnabled ? "border border-accent bg-accent/10 text-accent hover:bg-accent/15" : ""}`}
              onClick={toggleShuffle}
              disabled={!!verdict || pending}
            >
              <Shuffle className="h-4 w-4" /> Shuffle
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={toggleReverseSides}
              disabled={!!verdict || pending}
            >
              <Repeat className="h-4 w-4" /> Reverse sides
            </Button>
          </div>
        </div>

        {empty ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">⏳</p>
            <h2 className="font-display text-3xl font-semibold">No words to recall</h2>
            <p className="mt-3 text-muted-foreground">
              No scheduled words are due yet. Check back later — we will remind you.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row">
              {nextReadyDeckId && (
                <Button asChild className="rounded-full">
                  <Link to="/recall/$deckId" params={{ deckId: nextReadyDeckId }}>
                    Start next deck
                  </Link>
                </Button>
              )}
              <Button
                asChild
                variant={nextReadyDeckId ? "outline" : "default"}
                className="rounded-full"
              >
                <Link to="/deck/$deckId" params={{ deckId: deck.id }}>
                  Back to deck
                </Link>
              </Button>
            </div>
          </div>
        ) : finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">🧠</p>
            <h2 className="font-display text-3xl font-semibold">Session complete</h2>
            <p className="mt-3 text-muted-foreground">
              Correct: {right} of {total}. Next intervals were calculated automatically.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row">
              {nextReadyDeckId && (
                <Button asChild className="rounded-full">
                  <Link to="/recall/$deckId" params={{ deckId: nextReadyDeckId }}>
                    Start next deck
                  </Link>
                </Button>
              )}
              <Button
                asChild
                variant={nextReadyDeckId ? "outline" : "default"}
                className="rounded-full"
              >
                <Link to="/deck/$deckId" params={{ deckId: deck.id }}>
                  Back to deck
                </Link>
              </Button>
            </div>
          </div>
        ) : current ? (
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

            <div className="rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] p-10 text-center mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold">
                {promptLabel}
              </span>
              <p className="mt-6 font-display text-3xl md:text-4xl font-semibold leading-tight">
                {promptText}
              </p>
              <p className="mt-6 text-sm text-muted-foreground">{answerHelp}</p>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <Input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={answerPlaceholder}
                disabled={!!verdict || pending}
                className="h-14 text-lg rounded-2xl"
              />
              {verdict === "ok" && (
                <div className="rounded-2xl bg-[color:var(--success)]/10 text-[color:var(--success)] px-4 py-3 text-sm flex items-center gap-2">
                  <Check className="h-4 w-4" /> Correct! {serverExpected}
                </div>
              )}
              {verdict === "miss" && (
                <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm flex items-center gap-2">
                  <X className="h-4 w-4" /> Correct answer:{" "}
                  <span className="font-semibold">{serverExpected}</span>
                </div>
              )}
              {saveError && <p className="text-sm text-destructive">{saveError}</p>}
              <div className="flex justify-end">
                {!verdict ? (
                  <Button type="submit" className="rounded-full" disabled={pending}>
                    {pending ? "Checking..." : "Check"}
                  </Button>
                ) : (
                  <Button type="button" className="rounded-full" onClick={next}>
                    <RotateCcw className="h-4 w-4" /> {idx + 1 < total ? "Next" : "Finish"}
                  </Button>
                )}
              </div>
              <p className="text-center text-xs text-muted-foreground pt-2">
                Current stage: {RECALL_STAGES[Math.min(4, Math.max(0, 0))]}
              </p>
            </form>
          </>
        ) : null}
      </main>
    </div>
  );
}
