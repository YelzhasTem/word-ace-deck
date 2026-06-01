import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useDeck, type Card } from "@/lib/decks";
import { recordStreakToday } from "@/lib/streak";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Brain, Check, RotateCcw, X } from "lucide-react";

export const Route = createFileRoute("/deep/$deckId")({
  component: DeepPage,
});

type Question = {
  card: Card;
  options: string[];
  correctIndex: number;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuestions(cards: Card[]): Question[] {
  const allDefs = cards.map((c) => c.definition);
  return shuffle(cards).map((card) => {
    const distractors = shuffle(allDefs.filter((d) => d !== card.definition)).slice(0, 3);
    while (distractors.length < 3) distractors.push("—");
    const options = shuffle([card.definition, ...distractors]);
    return {
      card,
      options,
      correctIndex: options.indexOf(card.definition),
    };
  });
}

function DeepPage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);

  const canPlay = useMemo(() => deck && deck.cards.length >= 4, [deck]);

  useEffect(() => {
    if (deck && canPlay) {
      setQuestions(buildQuestions(deck.cards));
      setIdx(0);
      setPicked(null);
      setCorrectCount(0);
      setWrongCount(0);
    }
  }, [deckId, deck?.cards.length, canPlay]);

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

  const restart = () => {
    setQuestions(buildQuestions(deck.cards));
    setIdx(0);
    setPicked(null);
    setCorrectCount(0);
    setWrongCount(0);
  };

  const handlePick = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    if (i === questions[idx].correctIndex) setCorrectCount((c) => c + 1);
    else setWrongCount((c) => c + 1);
    recordStreakToday();
  };

  const next = () => {
    setPicked(null);
    setIdx((i) => i + 1);
  };

  const current = questions[idx];
  const finished = questions.length > 0 && idx >= questions.length;
  const total = questions.length;

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
          <span className="inline-flex items-center gap-1.5 text-sm text-accent font-medium">
            <Brain className="h-4 w-4" /> Deep learning
          </span>
        </div>

        {!canPlay ? (
          <div className="rounded-3xl border border-dashed border-border p-12 text-center text-muted-foreground">
            Для этого режима нужно минимум 4 карточки в колоде.
          </div>
        ) : finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">🧠</p>
            <h2 className="font-display text-3xl font-semibold">Раунд завершён</h2>
            <p className="mt-3 text-muted-foreground">
              Правильно: {correctCount} из {total}
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/deck/$deckId" params={{ deckId: deck.id }}>К колоде</Link>
              </Button>
              <Button className="rounded-full" onClick={restart}>
                <RotateCcw className="h-4 w-4" /> Ещё раз
              </Button>
            </div>
          </div>
        ) : current ? (
          <>
            <div className="mb-8">
              <div className="flex justify-between text-xs text-muted-foreground mb-2">
                <span>{idx + 1} / {total}</span>
                <span>
                  <span className="text-[color:var(--success)]">✓ {correctCount}</span>{" "}
                  · <span className="text-destructive">✗ {wrongCount}</span>
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
                Выберите перевод
              </span>
              <p className="mt-6 font-display text-5xl md:text-6xl font-extrabold leading-tight tracking-tight">
                {current.card.term}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {current.options.map((opt, i) => {
                const isCorrect = i === current.correctIndex;
                const isPicked = picked === i;
                const showState = picked !== null;
                const stateClass = !showState
                  ? "border-border bg-card hover:border-accent hover:bg-accent/5"
                  : isCorrect
                    ? "border-[color:var(--success)] bg-[color:var(--success)]/10 text-foreground"
                    : isPicked
                      ? "border-destructive bg-destructive/10 text-foreground"
                      : "border-border bg-card opacity-60";
                return (
                  <button
                    key={i}
                    onClick={() => handlePick(i)}
                    disabled={picked !== null}
                    className={`text-left rounded-2xl border-2 px-5 py-4 transition-all flex items-center gap-3 ${stateClass}`}
                  >
                    <span className="h-7 w-7 shrink-0 rounded-full bg-secondary text-xs font-semibold inline-flex items-center justify-center">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="flex-1 font-body text-[15px]">{opt}</span>
                    {showState && isCorrect && (
                      <Check className="h-5 w-5 text-[color:var(--success)]" />
                    )}
                    {showState && isPicked && !isCorrect && (
                      <X className="h-5 w-5 text-destructive" />
                    )}
                  </button>
                );
              })}
            </div>

            {picked !== null && (
              <div className="mt-6 flex justify-end">
                <Button className="rounded-full" onClick={next}>
                  {idx + 1 < total ? "Дальше" : "Завершить"}
                </Button>
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
