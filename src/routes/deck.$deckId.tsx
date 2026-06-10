import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { markDeckStudied } from "@/lib/last-studied";
import { useServerFn } from "@tanstack/react-start";
import { useDeck } from "@/lib/decks";
import { useDeckStats, accuracyFor, weakCardIds } from "@/lib/stats";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Play,
  RotateCcw,
  Sparkles,
  Loader2,
  Brain,
  Keyboard,
  Shuffle,
  FileQuestion,
  Zap,
  Lightbulb,
  CalendarClock,
  LineChart,
  Hourglass,
  Globe2,
} from "lucide-react";
import { generateStudyText } from "@/lib/ai.functions";
import {
  useDelayedRecallEnabled,
  useDeckRecallSummary,
  scheduleNewCard,
} from "@/lib/delayed-recall";

export const Route = createFileRoute("/deck/$deckId")({
  component: DeckPage,
});

function renderMarkdown(text: string) {
  // very small markdown: **bold** and line breaks
  const parts: Array<string | { bold: string }> = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ bold: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((p, i) =>
    typeof p === "string" ? (
      <span key={i}>{p}</span>
    ) : (
      <strong key={i} className="font-semibold text-foreground bg-accent/15 px-1 rounded">
        {p.bold}
      </strong>
    ),
  );
}

function plural(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

function DeckLoading() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          Loading deck...
        </div>

        <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-4">
            <Skeleton className="h-12 w-72 max-w-full rounded-xl" />
            <Skeleton className="h-5 w-96 max-w-full" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-28 rounded-full" />
            <Skeleton className="h-10 w-24 rounded-full" />
          </div>
        </div>

        <section className="mb-8 rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="w-full max-w-xl space-y-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
            <Skeleton className="h-10 w-32 rounded-full" />
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-9 w-24 rounded-full" />
          </div>
          <div className="space-y-3">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="flex items-center justify-between rounded-2xl bg-secondary/50 px-4 py-3"
              >
                <div className="w-full max-w-md space-y-2">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-4 w-56 max-w-full" />
                </div>
                <Skeleton className="h-8 w-8 rounded-full" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function DeckPage() {
  const { deckId } = Route.useParams();
  useEffect(() => {
    markDeckStudied(deckId);
  }, [deckId]);
  const navigate = useNavigate();
  const { deck, addCard, deleteCard, resetProgress, isLoading, isFetching, refetchDecks } = useDeck(deckId);
  const stats = useDeckStats(deckId);
  const [didRetryLoad, setDidRetryLoad] = useState(false);
  const [term, setTerm] = useState("");
  const [def, setDef] = useState("");
  const generate = useServerFn(generateStudyText);
  const [aiText, setAiText] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string>("");
  const [aiSeed, setAiSeed] = useState(0);
  const [recallEnabled, setRecallEnabled] = useDelayedRecallEnabled();
  const recallSummary = useDeckRecallSummary(deckId);

  const toggleRecall = (on: boolean) => {
    setRecallEnabled(on);
    // When turning ON, backfill schedule for any existing cards.
    if (on && deck) {
      for (const c of deck.cards) scheduleNewCard(deck.id, c.id);
    }
  };

  const runGenerate = async (nextSeed: number) => {
    if (!deck || deck.cards.length === 0) return;
    setAiLoading(true);
    setAiError("");
    try {
      const { text } = await generate({
        data: {
          words: deck.cards.map((c) => c.term),
          deckName: deck.name,
          seed: nextSeed,
        },
      });
      setAiText(text);
      setAiSeed(nextSeed);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Could not generate text");
    }
    setAiLoading(false);
  };

  useEffect(() => {
    setDidRetryLoad(false);
  }, [deckId]);

  useEffect(() => {
    if (!isLoading && !isFetching && !deck && !didRetryLoad) {
      setDidRetryLoad(true);
      void refetchDecks();
    }
  }, [deck, didRetryLoad, isFetching, isLoading, refetchDecks]);

  if (isLoading || isFetching || (!deck && !didRetryLoad)) return <DeckLoading />;

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

  const handleAdd = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!term.trim() || !def.trim()) return;
    addCard(deck.id, term.trim(), def.trim());
    setTerm("");
    setDef("");
  };

  const total = deck.cards.length;
  const known = deck.cards.filter((c) => c.known).length;

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="h-4 w-4" /> All decks
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4 mb-10">
          <div>
            <h1 className="font-display text-5xl font-semibold tracking-tight">{deck.name}</h1>
            {deck.description && (
              <p className="mt-3 text-muted-foreground max-w-xl">{deck.description}</p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              {total} {plural(total, ["card", "cards", "cards"])} · {known}{" "}
              {plural(known, ["learned", "learned", "learned"])}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => resetProgress(deck.id)}
              disabled={!deck.cards.length}
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
            <Button
              className="rounded-full"
              onClick={() => navigate({ to: "/study/$deckId", params: { deckId: deck.id } })}
              disabled={!deck.cards.length}
            >
              <Play className="h-4 w-4" /> Study
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/publish" search={{ type: "deck", id: deck.id }}>
                <Globe2 className="h-4 w-4" /> Publish
              </Link>
            </Button>
          </div>
        </div>

        {/* Delayed Recall */}
        <section className="mb-8 rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
            <div className="flex-1">
              <h2 className="font-display text-xl flex items-center gap-2">
                <Hourglass className="h-5 w-5 text-accent" /> Delayed Recall
              </h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                Improve long-term memory by reviewing words at growing intervals (10 min · 1 d · 3 d
                · 7 d · 14 d · 30 d), instead of cramming them all at once.
              </p>
            </div>
            <label className="flex items-center gap-3 shrink-0 cursor-pointer">
              <span className="text-sm font-medium">{recallEnabled ? "ON" : "OFF"}</span>
              <Switch checked={recallEnabled} onCheckedChange={toggleRecall} />
            </label>
          </div>

          {recallEnabled && (
            <div className="animate-in fade-in slide-in-from-top-1 duration-300">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">To review</p>
                  <p className="font-display text-2xl">{recallSummary.ready}</p>
                </div>
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Upcoming</p>
                  <p className="font-display text-2xl">{recallSummary.upcoming}</p>
                </div>
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Retention</p>
                  <p className="font-display text-2xl">
                    {recallSummary.retention !== null ? `${recallSummary.retention}%` : "—"}
                  </p>
                </div>
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Mastered</p>
                  <p className="font-display text-2xl">{recallSummary.mastered}</p>
                </div>
              </div>
              {recallSummary.ready > 0 && (
                <div className="rounded-2xl bg-accent/10 text-foreground px-4 py-3 text-sm mb-4 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-accent" />
                  {recallSummary.ready} {recallSummary.ready === 1 ? "word ready" : "words ready"}{" "}
                  for recall — a session is waiting.
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  className="rounded-full"
                  onClick={() => navigate({ to: "/recall/$deckId", params: { deckId: deck.id } })}
                  disabled={recallSummary.ready === 0}
                >
                  <Hourglass className="h-4 w-4" /> Start session
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Mode launcher */}
        {deck.cards.length > 0 && (
          <section className="mb-8 rounded-3xl border border-border bg-card p-6">
            <h2 className="font-display text-xl mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-accent" /> Study modes
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                {
                  to: "/review/$deckId",
                  icon: CalendarClock,
                  title: "Daily review",
                  desc: "SRS queue: only words due for review.",
                },
                {
                  to: "/type/$deckId",
                  icon: Keyboard,
                  title: "Typed translation",
                  desc: "Active recall with fuzzy matching.",
                },
                {
                  to: "/builder/$deckId",
                  icon: Shuffle,
                  title: "Word builder",
                  desc: "Build the word from letters. 3 difficulty levels.",
                },
                {
                  to: "/blank/$deckId",
                  icon: FileQuestion,
                  title: "Fill-in-the-blank",
                  desc: "A word in context: choices, word bank, or free input.",
                },
                {
                  to: "/speed/$deckId",
                  icon: Zap,
                  title: "Speed challenge",
                  desc: "30/60/120 sec. Combos and records.",
                },
                {
                  to: "/deep/$deckId",
                  icon: Brain,
                  title: "Deep learning",
                  desc: "4 translation options.",
                },
              ].map((m) => {
                const disabled = m.to === "/deep/$deckId" && deck.cards.length < 4;
                return (
                  <button
                    key={m.to}
                    disabled={disabled}
                    onClick={() => navigate({ to: m.to, params: { deckId: deck.id } } as never)}
                    className="text-left rounded-2xl border border-border bg-background hover:border-accent hover:bg-accent/5 px-4 py-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <m.icon className="h-5 w-5 text-accent mb-2" />
                    <p className="font-semibold">{m.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* AI Analysis */}
        {deck.cards.length > 0 && (
          <section className="mb-8 rounded-3xl border border-border bg-card p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-xl flex items-center gap-2">
                  <LineChart className="h-5 w-5 text-accent" /> AI feedback
                </h2>
                <p className="mt-1 text-sm text-muted-foreground max-w-md">
                  Session analysis, weak words, and a plan for tomorrow based on your stats.
                </p>
              </div>
              <Button
                className="rounded-full shrink-0"
                onClick={() => navigate({ to: "/feedback/$deckId", params: { deckId: deck.id } })}
              >
                <Sparkles className="h-4 w-4" /> Open feedback
              </Button>
            </div>
          </section>
        )}

        {/* Performance analytics */}
        {deck.cards.length > 0 &&
          (() => {
            const weak = weakCardIds(deck.id).slice(0, 5);
            const answered = Object.values(stats);
            const totalCorrect = answered.reduce((s, x) => s + x.correct, 0);
            const totalWrong = answered.reduce((s, x) => s + x.wrong, 0);
            const acc =
              totalCorrect + totalWrong > 0
                ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100)
                : null;
            const mastered = answered.filter((x) => x.mastery >= 0.75).length;
            return (
              <section className="mb-8 rounded-3xl border border-border bg-card p-6">
                <h2 className="font-display text-xl mb-4">Stats</h2>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="rounded-2xl bg-background border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">Answers</p>
                    <p className="font-display text-2xl">{totalCorrect + totalWrong}</p>
                  </div>
                  <div className="rounded-2xl bg-background border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">Accuracy</p>
                    <p className="font-display text-2xl">{acc !== null ? `${acc}%` : "—"}</p>
                  </div>
                  <div className="rounded-2xl bg-background border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">Mastered</p>
                    <p className="font-display text-2xl">
                      {mastered}
                      <span className="text-base text-muted-foreground">
                        {" "}
                        / {deck.cards.length}
                      </span>
                    </p>
                  </div>
                </div>
                {weak.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold mb-2">Weak words</p>
                    <div className="flex flex-wrap gap-2">
                      {weak.map((id) => {
                        const c = deck.cards.find((x) => x.id === id);
                        if (!c) return null;
                        const a = accuracyFor(stats[id]);
                        return (
                          <span
                            key={id}
                            className="px-3 py-1 rounded-full bg-destructive/10 text-destructive text-xs"
                          >
                            {c.term}
                            {a !== null ? ` · ${a}%` : ""}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })()}

        {/* Add card */}
        <form onSubmit={handleAdd} className="rounded-3xl border border-border bg-card p-6 mb-10">
          <h2 className="font-display text-xl mb-4">Add card</h2>
          <div className="grid md:grid-cols-[1fr_1.4fr_auto] gap-3">
            <Input
              placeholder="English word"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <Input
              placeholder="Translation or definition"
              value={def}
              onChange={(e) => setDef(e.target.value)}
            />
            <Button type="submit" className="rounded-full">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </form>

        {/* Cards list */}
        <div className="space-y-3">
          {deck.cards.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border p-12 text-center text-muted-foreground">
              Add your first card above to start studying.
            </div>
          ) : (
            deck.cards.map((card) => (
              <div
                key={card.id}
                className="rounded-2xl border border-border bg-card px-5 py-4 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-display text-lg font-semibold truncate">{card.term}</p>
                  <p className="text-sm text-muted-foreground truncate">{card.definition}</p>
                </div>
                {card.known && (
                  <span className="text-xs px-2 py-1 rounded-full bg-[color:var(--success)]/15 text-[color:var(--success)] font-medium">
                    Learned
                  </span>
                )}
                <button
                  onClick={() => deleteCard(deck.id, card.id)}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  aria-label="Delete card"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* AI text generator */}
        <section className="mt-12 rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="font-display text-2xl flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-accent" /> Text for active review
              </h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                AI will write a short English text using all words in the deck — read it and meet
                the words in living context.
              </p>
            </div>
            <div className="flex gap-2">
              {aiText && (
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => runGenerate(aiSeed + 1)}
                  disabled={aiLoading}
                >
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
              )}
              <Button
                className="rounded-full"
                onClick={() => runGenerate(aiText ? aiSeed + 1 : 0)}
                disabled={aiLoading || deck.cards.length === 0}
              >
                {aiLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {aiText ? "Generate again" : "Generate"}
              </Button>
            </div>
          </div>

          {deck.cards.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Add at least one card to generate a text.
            </p>
          )}

          {aiError && (
            <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm">
              {aiError}
            </div>
          )}

          {aiLoading && !aiText && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
              Preparing text...
            </div>
          )}

          {aiText && (
            <article className="prose-like whitespace-pre-wrap font-body text-[15px] leading-relaxed text-foreground/90">
              {renderMarkdown(aiText)}
            </article>
          )}
        </section>
      </main>
    </div>
  );
}
