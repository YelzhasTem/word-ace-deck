import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useDeck, type Card } from "@/lib/decks";
import { recordStreakToday } from "@/lib/streak";
import { recordAnswer, isCloseMatch, prioritise, accuracyFor, useDeckStats } from "@/lib/stats";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check, X, Keyboard, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/type/$deckId")({
  component: TypePage,
});

function TypePage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);
  const stats = useDeckStats(deckId);

  const queue = useMemo<Card[]>(() => (deck ? prioritise(deckId, deck.cards) : []), [deck, deckId, stats]);
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState("");
  const [verdict, setVerdict] = useState<null | "ok" | "miss">(null);
  const [right, setRight] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState<number>(() => Date.now());

  useEffect(() => { setIdx(0); setInput(""); setVerdict(null); setRight(0); setWrong(0); setWrongIds([]); setStartedAt(Date.now()); }, [deckId]);
  useEffect(() => { setStartedAt(Date.now()); }, [idx]);

  if (!deck) {
    return (
      <div className="min-h-screen"><SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="font-display text-3xl">Колода не найдена</h1>
          <Link to="/" className="mt-6 inline-block text-accent underline">На главную</Link>
        </main>
      </div>
    );
  }

  const current = queue[idx];
  const finished = !current;
  const total = queue.length;

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!current || verdict) return;
    const elapsed = Date.now() - startedAt;
    const ok = isCloseMatch(input, current.definition);
    setVerdict(ok ? "ok" : "miss");
    recordAnswer(deck.id, current.id, ok, elapsed);
    if (ok) { setRight((r) => r + 1); recordStreakToday(); }
    else { setWrong((w) => w + 1); setWrongIds((ids) => [...ids, current.id]); }
  };

  const next = () => { setVerdict(null); setInput(""); setIdx((i) => i + 1); };
  const restart = () => { setIdx(0); setInput(""); setVerdict(null); setRight(0); setWrong(0); setWrongIds([]); };

  return (
    <div className="min-h-screen"><SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <Link to="/deck/$deckId" params={{ deckId: deck.id }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {deck.name}
          </Link>
          <span className="inline-flex items-center gap-1.5 text-sm text-accent font-medium"><Keyboard className="h-4 w-4" /> Ввод перевода</span>
        </div>

        {finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">⌨️</p>
            <h2 className="font-display text-3xl font-semibold">Раунд завершён</h2>
            <p className="mt-3 text-muted-foreground">Правильно: {right} из {total} · точность {total ? Math.round((right/total)*100) : 0}%</p>
            {wrongIds.length > 0 && (
              <div className="mt-6 text-left max-w-md mx-auto">
                <p className="text-sm font-semibold mb-2">К повторению:</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {wrongIds.map((id) => {
                    const c = deck.cards.find((x) => x.id === id);
                    return c ? <li key={id}>· <span className="text-foreground font-medium">{c.term}</span> — {c.definition}</li> : null;
                  })}
                </ul>
              </div>
            )}
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full"><Link to="/deck/$deckId" params={{ deckId: deck.id }}>К колоде</Link></Button>
              <Button className="rounded-full" onClick={restart}><RotateCcw className="h-4 w-4" /> Ещё раз</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <div className="flex justify-between text-xs text-muted-foreground mb-2">
                <span>{idx + 1} / {total}</span>
                <span><span className="text-[color:var(--success)]">✓ {right}</span> · <span className="text-destructive">✗ {wrong}</span></span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-accent transition-all" style={{ width: `${(idx/total)*100}%` }} />
              </div>
            </div>

            <div className="rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] p-10 text-center mb-6">
              <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold">Введите перевод</span>
              <p className="mt-6 font-display text-5xl md:text-6xl font-extrabold leading-tight tracking-tight">{current.term}</p>
              {(() => { const a = accuracyFor(stats[current.id]); return a !== null ? (
                <p className="mt-4 text-xs text-muted-foreground">Ваша точность по слову: {a}%</p>
              ) : null; })()}
            </div>

            <form onSubmit={submit} className="space-y-3">
              <Input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Перевод на русском…"
                disabled={!!verdict}
                className="h-14 text-lg rounded-2xl"
              />
              {verdict === "ok" && (
                <div className="rounded-2xl bg-[color:var(--success)]/10 text-[color:var(--success)] px-4 py-3 text-sm flex items-center gap-2">
                  <Check className="h-4 w-4" /> Верно! {current.definition}
                </div>
              )}
              {verdict === "miss" && (
                <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm flex items-center gap-2">
                  <X className="h-4 w-4" /> Правильный ответ: <span className="font-semibold">{current.definition}</span>
                </div>
              )}
              <div className="flex justify-end gap-2">
                {!verdict ? (
                  <Button type="submit" className="rounded-full">Проверить</Button>
                ) : (
                  <Button type="button" className="rounded-full" onClick={next}>
                    {idx + 1 < total ? "Дальше" : "Завершить"}
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
