import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useDeck, type Card } from "@/lib/decks";
import { recordStreakToday } from "@/lib/streak";
import { recordAnswer, prioritise } from "@/lib/stats";
import { playCorrectSound, playWrongSound } from "@/lib/sounds";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shuffle, Check, X, Eraser, RotateCcw, Trophy } from "lucide-react";

export const Route = createFileRoute("/builder/$deckId")({
  component: BuilderPage,
});

type Difficulty = "easy" | "medium" | "hard";

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickDistractors(difficulty: Difficulty, word: string): string[] {
  if (difficulty !== "hard") return [];
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  const set = new Set(word.toLowerCase().split(""));
  const out: string[] = [];
  const n = Math.max(2, Math.min(4, Math.floor(word.length / 3)));
  while (out.length < n) {
    const ch = alpha[Math.floor(Math.random() * alpha.length)];
    if (!set.has(ch)) out.push(ch);
  }
  return out;
}

function BuilderPage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);

  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const queue = useMemo<Card[]>(() => (deck ? prioritise(deckId, deck.cards) : []), [deck, deckId]);
  const [idx, setIdx] = useState(0);
  const [pool, setPool] = useState<{ ch: string; id: number; used: boolean }[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [verdict, setVerdict] = useState<null | "ok" | "miss">(null);
  const [score, setScore] = useState(0);
  const [perfect, setPerfect] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [start, setStart] = useState<number>(() => Date.now());
  const [hadMistake, setHadMistake] = useState(false);

  const current = queue[idx];

  const buildPool = (card: Card, diff: Difficulty) => {
    const word = card.term;
    const letters = word.split("").map((ch, i) => ({ ch, id: i, used: false }));
    const distractors = pickDistractors(diff, word).map((ch, i) => ({
      ch, id: 1000 + i, used: false,
    }));
    const shuffled = shuffleArr([...letters, ...distractors]);
    let prePicked: number[] = [];
    if (diff === "easy" && letters.length > 0) {
      const first = shuffled.findIndex((x) => x.id === 0);
      if (first >= 0) {
        shuffled[first].used = true;
        prePicked = [0];
      }
    }
    setPool(shuffled);
    setPicked(prePicked);
    setVerdict(null);
    setHadMistake(false);
  };

  useEffect(() => {
    if (current) buildPool(current, difficulty);
  }, [current?.id, difficulty]);

  useEffect(() => { setIdx(0); setScore(0); setPerfect(0); setMistakes(0); setStart(Date.now()); }, [deckId]);

  if (!deck) {
    return (
      <div className="min-h-screen"><SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="font-display text-3xl">Deck not found</h1>
          <Link to="/" className="mt-6 inline-block text-accent underline">Home</Link>
        </main>
      </div>
    );
  }

  const total = queue.length;
  const finished = !current;
  const built = picked.map((i) => pool[i]?.ch ?? "").join("");

  const pick = (i: number) => {
    if (verdict) return;
    setPool((p) => p.map((x, idx2) => idx2 === i ? { ...x, used: true } : x));
    setPicked((p) => [...p, i]);
  };
  const unpick = (place: number) => {
    if (verdict) return;
    const idxInPool = picked[place];
    setPool((p) => p.map((x, idx2) => idx2 === idxInPool ? { ...x, used: false } : x));
    setPicked((p) => p.filter((_, j) => j !== place));
  };
  const clearAll = () => {
    if (verdict) return;
    setPool((p) => p.map((x) => ({ ...x, used: false })));
    setPicked(difficulty === "easy" && current ? (() => {
      const first = pool.findIndex((x) => x.id === 0);
      if (first >= 0) { setPool((p) => p.map((x, idx2) => idx2 === first ? { ...x, used: true } : x)); return [first]; }
      return [];
    })() : []);
  };
  const check = () => {
    if (!current) return;
    const elapsed = Date.now() - start;
    const ok = built.toLowerCase() === current.term.toLowerCase();
    if (ok) playCorrectSound();
    else playWrongSound();
    setVerdict(ok ? "ok" : "miss");
    recordAnswer(deck.id, current.id, ok, elapsed);
    if (ok) {
      const base = current.term.length * 10;
      const diffBonus = difficulty === "hard" ? 1.5 : difficulty === "easy" ? 0.7 : 1;
      const perfectBonus = hadMistake ? 1 : 1.5;
      setScore((s) => s + Math.round(base * diffBonus * perfectBonus));
      if (!hadMistake) setPerfect((p) => p + 1);
      recordStreakToday();
    } else {
      setMistakes((m) => m + 1);
      setHadMistake(true);
    }
  };
  const next = () => { setVerdict(null); setStart(Date.now()); setIdx((i) => i + 1); };
  const tryAgain = () => { if (current) buildPool(current, difficulty); };
  const restart = () => { setIdx(0); setScore(0); setPerfect(0); setMistakes(0); setStart(Date.now()); };

  return (
    <div className="min-h-screen"><SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <Link to="/deck/$deckId" params={{ deckId: deck.id }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {deck.name}
          </Link>
          <span className="inline-flex items-center gap-1.5 text-sm text-accent font-medium"><Shuffle className="h-4 w-4" /> Word builder</span>
        </div>

        <div className="flex gap-2 mb-6">
          {(["easy","medium","hard"] as Difficulty[]).map((d) => (
            <button key={d} onClick={() => setDifficulty(d)}
              className={`px-4 py-1.5 rounded-full text-sm border transition-colors ${difficulty===d ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>
              {d === "easy" ? "Easy" : d === "medium" ? "Medium" : "Hard"}
            </button>
          ))}
        </div>

        {finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <Trophy className="h-12 w-12 mx-auto text-accent mb-3" />
            <h2 className="font-display text-3xl font-semibold">Done</h2>
            <p className="mt-3 text-muted-foreground">
              Score: <span className="text-foreground font-semibold">{score}</span> · Perfect: {perfect}/{total} · Mistakes: {mistakes} · Time: {Math.round((Date.now()-start)/1000)} s
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full"><Link to="/deck/$deckId" params={{ deckId: deck.id }}>Back to deck</Link></Button>
              <Button className="rounded-full" onClick={restart}><RotateCcw className="h-4 w-4" /> Try again</Button>
            </div>
          </div>
        ) : current ? (
          <>
            <div className="mb-6 flex justify-between text-xs text-muted-foreground">
              <span>{idx + 1} / {total}</span>
              <span>Score: <span className="text-foreground font-semibold">{score}</span></span>
            </div>

            <div className="rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] p-8 text-center mb-6">
              <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold">Build the word</span>
              <p className="mt-4 font-display text-2xl text-muted-foreground">{current.definition}</p>

              <div className="mt-8 min-h-[64px] flex flex-wrap justify-center gap-2">
                {picked.length === 0 ? (
                  <span className="text-muted-foreground/50 text-sm self-center">Tap letters below...</span>
                ) : picked.map((poolIdx, place) => (
                  <button key={place} onClick={() => unpick(place)}
                    className="h-12 w-10 rounded-xl bg-primary text-primary-foreground font-display text-xl uppercase">
                    {pool[poolIdx]?.ch}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2 mb-6">
              {pool.map((p, i) => (
                <button key={i} onClick={() => pick(i)} disabled={p.used || !!verdict}
                  className={`h-12 w-10 rounded-xl border-2 font-display text-xl uppercase transition-all ${p.used ? "opacity-30 border-border bg-secondary" : "bg-card border-border hover:border-accent hover:bg-accent/5"}`}>
                  {p.ch}
                </button>
              ))}
            </div>

            {verdict === "ok" && (
              <div className="rounded-2xl bg-[color:var(--success)]/10 text-[color:var(--success)] px-4 py-3 text-sm mb-4 flex items-center gap-2">
                <Check className="h-4 w-4" /> {hadMistake ? "Correct!" : "Perfect!"}
              </div>
            )}
            {verdict === "miss" && (
              <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm mb-4 flex items-center gap-2">
                <X className="h-4 w-4" /> Not the word. Correct: <span className="font-semibold">{current.term}</span>
              </div>
            )}

            <div className="flex justify-between gap-2">
              <Button variant="ghost" className="rounded-full" onClick={clearAll} disabled={!!verdict}>
                <Eraser className="h-4 w-4" /> Clear
              </Button>
              {!verdict ? (
                <Button className="rounded-full" onClick={check} disabled={picked.length === 0}>Check</Button>
              ) : verdict === "miss" ? (
                <div className="flex gap-2">
                  <Button variant="outline" className="rounded-full" onClick={tryAgain}><RotateCcw className="h-4 w-4" /> Try again</Button>
                  <Button className="rounded-full" onClick={next}>Next</Button>
                </div>
              ) : (
                <Button className="rounded-full" onClick={next}>{idx + 1 < total ? "Next" : "Finish"}</Button>
              )}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
