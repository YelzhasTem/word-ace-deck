import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useDeck, type Card } from "@/lib/decks";
import { recordStreakToday } from "@/lib/streak";
import { recordAnswer, recordSpeedRun, useSpeedRecords } from "@/lib/stats";
import { beginStudySession } from "@/lib/study-session";
import { playCorrectSound, playWrongSound } from "@/lib/sounds";
import { useDeckShuffleEnabled } from "@/lib/shuffle-settings";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Timer, Zap, Trophy, RotateCcw, Repeat, Shuffle } from "lucide-react";

export const Route = createFileRoute("/speed/$deckId")({
  component: SpeedPage,
});

type Duration = 30 | 60 | 120;
type Q = { card: Card; prompt: string; options: string[]; correct: number };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function build(cards: Card[], reverseSides: boolean, shuffleQuestions: boolean): Q[] {
  const allAnswers = cards.map((c) => (reverseSides ? c.term : c.definition));
  const orderedCards = shuffleQuestions ? shuffle(cards) : cards;
  return orderedCards.map((card) => {
    const answer = reverseSides ? card.term : card.definition;
    const distractors = shuffle(allAnswers.filter((value) => value !== answer)).slice(0, 3);
    while (distractors.length < 3) distractors.push("—");
    const opts = shuffle([answer, ...distractors]);
    return {
      card,
      prompt: reverseSides ? card.definition : card.term,
      options: opts,
      correct: opts.indexOf(answer),
    };
  });
}

function SpeedPage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);
  const [shuffleEnabled, setShuffleEnabled] = useDeckShuffleEnabled(deckId);

  const [duration, setDuration] = useState<Duration>(60);
  const [reverseSides, setReverseSides] = useState(false);
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(60);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [right, setRight] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [weak, setWeak] = useState<Card[]>([]);
  const timerRef = useRef<number | null>(null);
  const records = useSpeedRecords(deckId).slice(0, 5);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    },
    [],
  );

  const finished = !running && left === 0 && right + wrong > 0;
  useEffect(() => {
    if (finished) {
      recordSpeedRun(deckId);
      recordStreakToday();
    }
    // eslint-disable-next-line
  }, [finished]);

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

  const canPlay = deck.cards.length >= 4;

  const start = (d: Duration) => {
    if (!canPlay) return;
    void beginStudySession(deckId, "speed", d).catch((error: unknown) =>
      console.warn("[Learning] Could not start speed session:", error),
    );
    setDuration(d);
    setLeft(d);
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setRight(0);
    setWrong(0);
    setWeak([]);
    setIdx(0);
    setQuestions(build(deck.cards, reverseSides, shuffleEnabled));
    setRunning(true);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          setRunning(false);
          return 0;
        }
        return l - 1;
      });
    }, 1000);
  };

  const toggleShuffle = () => {
    const nextShuffleEnabled = !shuffleEnabled;
    setShuffleEnabled(nextShuffleEnabled);
    setQuestions((qs) => {
      const answered = qs.slice(0, idx);
      const remainingCards = qs.slice(idx).map((question) => question.card);
      return [...answered, ...build(remainingCards, reverseSides, nextShuffleEnabled)];
    });
  };

  const toggleReverseSides = () => {
    const nextReverseSides = !reverseSides;
    setReverseSides(nextReverseSides);
    setQuestions((qs) => {
      const answered = qs.slice(0, idx);
      const remainingCards = qs.slice(idx).map((question) => question.card);
      return [...answered, ...build(remainingCards, nextReverseSides, shuffleEnabled)];
    });
  };

  const cur = questions[idx];
  const pick = (i: number) => {
    if (!cur || !running) return;
    const ok = i === cur.correct;
    if (ok) playCorrectSound();
    else playWrongSound();
    recordAnswer(deck.id, cur.card.id, ok, undefined, {
      mode: "speed",
      durationSeconds: duration,
    });
    if (ok) {
      const newCombo = combo + 1;
      const mult = 1 + Math.min(newCombo, 10) * 0.1;
      setScore((s) => s + Math.round(100 * mult));
      setCombo(newCombo);
      setMaxCombo((m) => Math.max(m, newCombo));
      setRight((r) => r + 1);
    } else {
      setCombo(0);
      setWrong((w) => w + 1);
      setWeak((w) => (w.find((x) => x.id === cur.card.id) ? w : [...w, cur.card]));
    }
    if (idx + 1 >= questions.length) {
      setQuestions((qs) => [...qs, ...build(deck.cards, reverseSides, shuffleEnabled)]);
    }
    setIdx((i2) => i2 + 1);
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
              <Zap className="h-4 w-4" /> Speed challenge
            </span>
            <Button
              type="button"
              aria-pressed={shuffleEnabled}
              variant={shuffleEnabled ? "secondary" : "ghost"}
              size="sm"
              className={`rounded-full ${shuffleEnabled ? "border border-accent bg-accent/10 text-accent hover:bg-accent/15" : ""}`}
              onClick={toggleShuffle}
            >
              <Shuffle className="h-4 w-4" /> Shuffle
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={toggleReverseSides}
            >
              <Repeat className="h-4 w-4" /> Reverse sides
            </Button>
          </div>
        </div>

        {!canPlay ? (
          <div className="rounded-3xl border border-dashed border-border p-12 text-center text-muted-foreground">
            At least 4 cards are required.
          </div>
        ) : !running && !finished ? (
          <div className="rounded-3xl border border-border bg-card p-10 text-center">
            <Timer className="h-12 w-12 mx-auto text-accent mb-3" />
            <h2 className="font-display text-3xl font-semibold">Choose duration</h2>
            <div className="mt-6 flex justify-center gap-3 flex-wrap">
              {([30, 60, 120] as Duration[]).map((d) => (
                <Button key={d} className="rounded-full" onClick={() => start(d)}>
                  {d} sec
                </Button>
              ))}
            </div>
            {records.length > 0 && (
              <div className="mt-10 text-left">
                <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <Trophy className="h-4 w-4" /> Top scores
                </p>
                <ul className="space-y-1 text-sm">
                  {records.map((r, i) => (
                    <li
                      key={i}
                      className="flex justify-between text-muted-foreground border-b border-border/50 py-1.5"
                    >
                      <span>
                        {r.duration}s · {new Date(r.at).toLocaleDateString()}
                      </span>
                      <span>
                        <span className="text-foreground font-semibold">{r.score}</span> ·{" "}
                        {r.accuracy}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : finished ? (
          <div className="rounded-3xl border border-border bg-card p-10 text-center">
            <Trophy className="h-12 w-12 mx-auto text-accent mb-3" />
            <h2 className="font-display text-3xl font-semibold">Results</h2>
            <p className="mt-3 text-lg">
              Score: <span className="font-semibold">{score}</span>
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Accuracy {right + wrong > 0 ? Math.round((right / (right + wrong)) * 100) : 0}% ·
              Answers {right + wrong} · Max combo {maxCombo}
            </p>
            {weak.length > 0 && (
              <div className="mt-6 text-left max-w-md mx-auto">
                <p className="text-sm font-semibold mb-2">Weak words:</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {weak.map((c) => (
                    <li key={c.id}>
                      · <span className="text-foreground font-medium">{c.term}</span> —{" "}
                      {c.definition}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/deck/$deckId" params={{ deckId: deck.id }}>
                  Back to deck
                </Link>
              </Button>
              <Button className="rounded-full" onClick={() => start(duration)}>
                <RotateCcw className="h-4 w-4" /> Try again
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Timer className="h-5 w-5 text-accent" />
                <span className="font-display text-3xl tabular-nums">{left}s</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Score <span className="text-foreground font-semibold">{score}</span> · Combo ×
                {combo}
              </div>
            </div>
            {cur && (
              <>
                <div className="rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] p-10 text-center mb-6">
                  <p className="font-display text-5xl md:text-6xl font-extrabold leading-tight">
                    {cur.prompt}
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {cur.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => pick(i)}
                      className="text-left rounded-2xl border-2 border-border bg-card hover:border-accent hover:bg-accent/5 px-5 py-4"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
