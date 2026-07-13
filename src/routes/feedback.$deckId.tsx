import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useDeck } from "@/lib/decks";
import { generateSessionFeedback } from "@/lib/ai.functions";
import { accuracyFor, STAGE_NAMES, useDeckStats, useSessionLog, weakCardIds } from "@/lib/stats";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { OFFLINE_AI_MESSAGE, useOnlineStatus } from "@/lib/online-status";
import { ArrowLeft, Sparkles, Loader2, TrendingUp, Target, Brain, ListChecks } from "lucide-react";

export const Route = createFileRoute("/feedback/$deckId")({
  component: FeedbackPage,
});

type FB = {
  summary: string;
  weakAnalysis: string;
  confusions: { pair: string; note: string }[];
  focus: string[];
  plan: string;
  trend: string;
};

function FeedbackPage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);
  const gen = useServerFn(generateSessionFeedback);
  const isOnline = useOnlineStatus();
  const [fb, setFb] = useState<FB | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Aggregate today's session (last 24h) from real performance data
  const session = useSessionLog(deckId, 1000 * 60 * 60 * 24);
  const stats = useDeckStats(deckId);
  const totals = (() => {
    const correct = session.filter((x) => x.correct).length;
    const wrong = session.length - correct;
    const timed = session.filter((x) => typeof x.ms === "number");
    const avgMs = timed.length
      ? Math.round(timed.reduce((s, x) => s + (x.ms ?? 0), 0) / timed.length)
      : undefined;
    return { answered: session.length, correct, wrong, avgMs };
  })();

  const mastered = deck
    ? deck.cards
        .filter((c) => (stats[c.id]?.mastery ?? 0) >= 0.75)
        .slice(0, 20)
        .map((c) => c.term)
    : [];

  const weakTerms = deck
    ? (weakCardIds(deck.id)
        .slice(0, 10)
        .map((id) => {
          const c = deck.cards.find((x) => x.id === id);
          if (!c) return null;
          const s = stats[id];
          return {
            term: c.term,
            definition: c.definition,
            accuracy: accuracyFor(s) ?? 0,
            avgMs: s?.avgMs,
          };
        })
        .filter(Boolean) as {
        term: string;
        definition: string;
        accuracy: number;
        avgMs?: number;
      }[])
    : [];

  // Heuristic confusion pairs: similar-looking weak terms inside this deck
  const confusions: { a: string; b: string }[] = (() => {
    if (!deck) return [];
    const pool = weakTerms.map((w) => w.term);
    const all = deck.cards.map((c) => c.term);
    const out: { a: string; b: string }[] = [];
    for (const w of pool) {
      for (const o of all) {
        if (o === w) continue;
        const a = w.toLowerCase();
        const b = o.toLowerCase();
        if (Math.abs(a.length - b.length) > 3) continue;
        let shared = 0;
        const set = new Set(a.split(""));
        for (const ch of b) if (set.has(ch)) shared++;
        if (shared / Math.max(a.length, b.length) > 0.7) {
          out.push({ a: w, b: o });
          if (out.length >= 6) return out;
        }
      }
    }
    return out;
  })();

  const run = async () => {
    if (!deck) return;
    if (!isOnline) {
      setError(OFFLINE_AI_MESSAGE);
      return;
    }
    if (totals.answered === 0) {
      setError("No data for today yet. Study in any mode and come back.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await gen({
        data: {
          deckName: deck.name,
          totals,
          mastered,
          weak: weakTerms,
          confusions,
        },
      });
      setFb(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get feedback");
    }
    setLoading(false);
  };

  useEffect(() => {
    // auto-run once when data exists
    if (isOnline && deck && totals.answered > 0 && !fb && !loading && !error) run();
    // eslint-disable-next-line
  }, [deck?.id, isOnline, totals.answered]);

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

  const acc = totals.answered ? Math.round((totals.correct / totals.answered) * 100) : null;

  const stageCounts = STAGE_NAMES.map((name, stage) => ({
    name,
    count: deck.cards.filter((c) => (stats[c.id]?.stage ?? 0) === stage).length,
  }));

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
            <Sparkles className="h-4 w-4" /> AI feedback
          </span>
        </div>

        {/* Real performance summary */}
        <section className="rounded-3xl border border-border bg-card p-6 mb-6">
          <h2 className="font-display text-xl mb-4">Today's session</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-2xl bg-background border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Answers</p>
              <p className="font-display text-2xl">{totals.answered}</p>
            </div>
            <div className="rounded-2xl bg-background border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Accuracy</p>
              <p className="font-display text-2xl">{acc !== null ? `${acc}%` : "—"}</p>
            </div>
            <div className="rounded-2xl bg-background border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Average time</p>
              <p className="font-display text-2xl">
                {totals.avgMs ? `${(totals.avgMs / 1000).toFixed(1)}s` : "—"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {stageCounts.map((s) => (
              <span key={s.name} className="px-3 py-1 rounded-full bg-secondary text-xs">
                {s.name}: <strong className="text-foreground">{s.count}</strong>
              </span>
            ))}
          </div>
        </section>

        {/* AI feedback */}
        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl flex items-center gap-2">
              <Brain className="h-5 w-5 text-accent" /> Personal feedback
            </h2>
            <Button
              size="sm"
              className="rounded-full"
              onClick={run}
              disabled={!isOnline || loading || totals.answered === 0}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}{" "}
              Refresh
            </Button>
          </div>

          {error && (
            <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm mb-3">
              {error}
            </div>
          )}

          {!isOnline && !error && (
            <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm mb-3">
              {OFFLINE_AI_MESSAGE}
            </div>
          )}

          {loading && !fb && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
              AI is analyzing your stats...
            </div>
          )}

          {fb && (
            <div className="space-y-5">
              {fb.summary && (
                <div>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider mb-1">
                    Summary
                  </p>
                  <p className="text-base leading-relaxed">{fb.summary}</p>
                </div>
              )}
              {fb.trend && (
                <div className="inline-flex items-center gap-2 rounded-full bg-accent/10 text-accent px-4 py-1.5 text-sm">
                  <TrendingUp className="h-4 w-4" /> {fb.trend}
                </div>
              )}
              {fb.weakAnalysis && (
                <div>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider mb-1">
                    Weak words
                  </p>
                  <p className="text-base leading-relaxed">{fb.weakAnalysis}</p>
                  {weakTerms.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {weakTerms.map((w) => (
                        <span
                          key={w.term}
                          className="px-3 py-1 rounded-full bg-destructive/10 text-destructive text-xs"
                        >
                          {w.term} · {w.accuracy}%
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {fb.confusions.length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider mb-2">
                    Similar words
                  </p>
                  <ul className="space-y-2">
                    {fb.confusions.map((c, i) => (
                      <li key={i} className="rounded-2xl border border-border px-4 py-3">
                        <p className="font-semibold">{c.pair}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{c.note}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {fb.focus.length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Target className="h-4 w-4" /> What to focus on tomorrow
                  </p>
                  <ul className="space-y-1.5">
                    {fb.focus.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-accent mt-1">•</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {fb.plan && (
                <div>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <ListChecks className="h-4 w-4" /> Plan for tomorrow
                  </p>
                  <p className="text-base leading-relaxed">{fb.plan}</p>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
