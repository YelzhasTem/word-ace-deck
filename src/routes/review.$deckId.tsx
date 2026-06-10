import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useDeck, type Card } from "@/lib/decks";
import { recordStreakToday } from "@/lib/streak";
import { recordAnswer, isCloseMatch, dueCardIds, useDeckStats, STAGE_NAMES } from "@/lib/stats";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, CalendarClock, Check, X, RotateCcw, Sparkles } from "lucide-react";

export const Route = createFileRoute("/review/$deckId")({
  component: ReviewPage,
});

function ReviewPage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);
  const stats = useDeckStats(deckId);

  // Fix the due-queue at session start so cards don't disappear after correct answer
  const [queueIds, setQueueIds] = useState<string[]>([]);
  useEffect(() => {
    if (!deck) return;
    setQueueIds(dueCardIds(deckId, deck.cards));
  }, [deckId, deck?.cards.length]);

  const cards: Card[] = useMemo(
    () => (deck ? queueIds.map((id) => deck.cards.find((c) => c.id === id)).filter(Boolean) as Card[] : []),
    [deck, queueIds],
  );

  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState("");
  const [verdict, setVerdict] = useState<null | "ok" | "miss">(null);
  const [right, setRight] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [startedAt, setStartedAt] = useState<number>(() => Date.now());

  useEffect(() => { setStartedAt(Date.now()); setInput(""); setVerdict(null); }, [idx]);

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

  const current = cards[idx];
  const total = cards.length;
  const finished = !current && total > 0;
  const empty = total === 0;

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!current || verdict) return;
    const ok = isCloseMatch(input, current.definition);
    setVerdict(ok ? "ok" : "miss");
    recordAnswer(deck.id, current.id, ok, Date.now() - startedAt);
    if (ok) { setRight((r) => r + 1); recordStreakToday(); } else setWrong((w) => w + 1);
  };
  const next = () => setIdx((i) => i + 1);

  return (
    <div className="min-h-screen"><SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <Link to="/deck/$deckId" params={{ deckId: deck.id }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {deck.name}
          </Link>
          <span className="inline-flex items-center gap-1.5 text-sm text-accent font-medium">
            <CalendarClock className="h-4 w-4" /> Daily review
          </span>
        </div>

        {empty ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">✨</p>
            <h2 className="font-display text-3xl font-semibold">Nothing to review today</h2>
            <p className="mt-3 text-muted-foreground">All words in this deck are still fresh. Check back later — the system will tell you when to review.</p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full"><Link to="/deck/$deckId" params={{ deckId: deck.id }}>Back to deck</Link></Button>
              <Button asChild className="rounded-full"><Link to="/type/$deckId" params={{ deckId: deck.id }}><Sparkles className="h-4 w-4" /> Practice</Link></Button>
            </div>
          </div>
        ) : finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">🎯</p>
            <h2 className="font-display text-3xl font-semibold">Review complete</h2>
            <p className="mt-3 text-muted-foreground">Correct: {right} of {total}. Next intervals were calculated automatically.</p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full"><Link to="/deck/$deckId" params={{ deckId: deck.id }}>Back to deck</Link></Button>
              <Button asChild className="rounded-full"><Link to="/feedback/$deckId" params={{ deckId: deck.id }}><Sparkles className="h-4 w-4" /> AI feedback</Link></Button>
            </div>
          </div>
        ) : current ? (
          <>
            <div className="mb-8">
              <div className="flex justify-between text-xs text-muted-foreground mb-2">
                <span>{idx + 1} / {total} · stage: {STAGE_NAMES[stats[current.id]?.stage ?? 0]}</span>
                <span><span className="text-[color:var(--success)]">✓ {right}</span> · <span className="text-destructive">✗ {wrong}</span></span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-accent transition-all" style={{ width: `${(idx/total)*100}%` }} />
              </div>
            </div>

            <div className="rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] p-10 text-center mb-6">
              <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold">Type the translation</span>
              <p className="mt-6 font-display text-5xl md:text-6xl font-extrabold leading-tight tracking-tight">{current.term}</p>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <Input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Translation..." disabled={!!verdict} className="h-14 text-lg rounded-2xl" />
              {verdict === "ok" && (
                <div className="rounded-2xl bg-[color:var(--success)]/10 text-[color:var(--success)] px-4 py-3 text-sm flex items-center gap-2">
                  <Check className="h-4 w-4" /> Correct! {current.definition}
                </div>
              )}
              {verdict === "miss" && (
                <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm flex items-center gap-2">
                  <X className="h-4 w-4" /> Correct answer: <span className="font-semibold">{current.definition}</span>
                </div>
              )}
              <div className="flex justify-end">
                {!verdict ? (
                  <Button type="submit" className="rounded-full">Check</Button>
                ) : (
                  <Button type="button" className="rounded-full" onClick={next}>
                    <RotateCcw className="h-4 w-4" /> {idx + 1 < total ? "Next" : "Finish"}
                  </Button>
                )}
              </div>
            </form>
          </>
        ) : null}
      </main>
    </div>
  );
}
