import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useDeck } from "@/lib/decks";
import { generateAssociation } from "@/lib/ai.functions";
import { recordStreakToday } from "@/lib/streak";
import { recordAnswer, useAssocs, addAssoc, toggleFavoriteAssoc, removeAssoc } from "@/lib/stats";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Sparkles, Loader2, Star, Trash2, Brain, ChevronLeft, ChevronRight, Eye, Check, X } from "lucide-react";

export const Route = createFileRoute("/assoc/$deckId")({
  component: AssocPage,
});

function AssocPage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);
  const gen = useServerFn(generateAssociation);

  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [my, setMy] = useState("");

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

  const total = deck.cards.length;
  const current = deck.cards[idx];
  const assocs = useAssocs(current?.id ?? "");

  if (!current) {
    return (
      <div className="min-h-screen"><SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 text-center text-muted-foreground">
          В колоде нет карточек.
        </main>
      </div>
    );
  }

  const generateOne = async () => {
    setLoading(true); setError("");
    try {
      const r = await gen({ data: { term: current.term, definition: current.definition } });
      addAssoc(current.id, { text: `${r.association}\n\n${r.story}`.trim(), source: "ai", at: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сгенерировать ассоциацию");
    }
    setLoading(false);
  };

  const saveMine = () => {
    const t = my.trim();
    if (!t) return;
    addAssoc(current.id, { text: t, source: "user", at: Date.now() });
    setMy("");
  };

  const go = (delta: number) => {
    setIdx((i) => Math.max(0, Math.min(total - 1, i + delta)));
    setRevealed(false);
  };

  const mark = (helped: boolean) => {
    recordAnswer(deck.id, current.id, helped);
    if (helped) recordStreakToday();
    go(1);
  };

  return (
    <div className="min-h-screen"><SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <Link to="/deck/$deckId" params={{ deckId: deck.id }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {deck.name}
          </Link>
          <span className="inline-flex items-center gap-1.5 text-sm text-accent font-medium"><Brain className="h-4 w-4" /> Memory associations</span>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => go(-1)} disabled={idx===0}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground">{idx + 1} / {total}</span>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => go(1)} disabled={idx===total-1}><ChevronRight className="h-4 w-4" /></Button>
        </div>

        <div className="rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] p-10 text-center mb-6">
          <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold">Слово</span>
          <p className="mt-4 font-display text-5xl md:text-6xl font-extrabold leading-tight tracking-tight">{current.term}</p>
          {revealed ? (
            <p className="mt-6 font-display text-2xl text-primary">{current.definition}</p>
          ) : (
            <Button variant="outline" className="rounded-full mt-6" onClick={() => setRevealed(true)}>
              <Eye className="h-4 w-4" /> Показать перевод
            </Button>
          )}
        </div>

        <section className="rounded-3xl border border-border bg-card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl">Ассоциации и мнемоники</h2>
            <Button size="sm" className="rounded-full" onClick={generateOne} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} ИИ
            </Button>
          </div>
          {error && <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm mb-3">{error}</div>}

          <div className="space-y-2 mb-4">
            {assocs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока нет ассоциаций. Сгенерируйте через ИИ или придумайте свою.</p>
            ) : assocs.map((a, i) => (
              <div key={i} className={`rounded-2xl border px-4 py-3 ${a.favorite ? "border-accent bg-accent/5" : "border-border"}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm whitespace-pre-wrap flex-1">{a.text}</p>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => toggleFavoriteAssoc(current.id, i)} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-accent/10" aria-label="В избранное">
                      <Star className={`h-4 w-4 ${a.favorite ? "fill-accent text-accent" : "text-muted-foreground"}`} />
                    </button>
                    <button onClick={() => removeAssoc(current.id, i)} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-destructive/10 hover:text-destructive" aria-label="Удалить">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{a.source === "ai" ? "ИИ" : "Ваша"} · {new Date(a.at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Input value={my} onChange={(e) => setMy(e.target.value)} placeholder="Своя ассоциация…" />
            <Button onClick={saveMine} className="rounded-full" disabled={!my.trim()}>Сохранить</Button>
          </div>
        </section>

        <div className="flex justify-between gap-3">
          <Button variant="outline" className="rounded-full" onClick={() => mark(false)}>
            <X className="h-4 w-4" /> Не помогло
          </Button>
          <Button className="rounded-full bg-success text-white hover:bg-success/90" onClick={() => mark(true)}>
            <Check className="h-4 w-4" /> Помогло запомнить
          </Button>
        </div>
      </main>
    </div>
  );
}
