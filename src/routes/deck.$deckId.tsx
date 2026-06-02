import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useDeck } from "@/lib/decks";
import { useDeckStats, accuracyFor, weakCardIds } from "@/lib/stats";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Plus, Trash2, Play, RotateCcw, Sparkles, Loader2, Brain,
  Keyboard, Shuffle, FileQuestion, Zap, Lightbulb, CalendarClock, LineChart,
} from "lucide-react";
import { generateStudyText } from "@/lib/ai.functions";

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

function DeckPage() {
  const { deckId } = Route.useParams();
  const navigate = useNavigate();
  const { deck, addCard, deleteCard, resetProgress } = useDeck(deckId);
  const stats = useDeckStats(deckId);
  const [term, setTerm] = useState("");
  const [def, setDef] = useState("");
  const generate = useServerFn(generateStudyText);
  const [aiText, setAiText] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string>("");
  const [aiSeed, setAiSeed] = useState(0);

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
      setAiError(e instanceof Error ? e.message : "Не удалось сгенерировать текст");
    }
    setAiLoading(false);
  };

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
          <ArrowLeft className="h-4 w-4" /> Все колоды
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4 mb-10">
          <div>
            <h1 className="font-display text-5xl font-semibold tracking-tight">{deck.name}</h1>
            {deck.description && (
              <p className="mt-3 text-muted-foreground max-w-xl">{deck.description}</p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              {total} {plural(total, ["карточка", "карточки", "карточек"])} ·{" "}
              {known} {plural(known, ["выучена", "выучено", "выучено"])}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => resetProgress(deck.id)}
              disabled={!deck.cards.length}
            >
              <RotateCcw className="h-4 w-4" /> Сбросить
            </Button>
            <Button
              className="rounded-full"
              onClick={() => navigate({ to: "/study/$deckId", params: { deckId: deck.id } })}
              disabled={!deck.cards.length}
            >
              <Play className="h-4 w-4" /> Учить
            </Button>
          </div>
        </div>

        {/* Mode launcher */}
        {deck.cards.length > 0 && (
          <section className="mb-8 rounded-3xl border border-border bg-card p-6">
            <h2 className="font-display text-xl mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-accent" /> Режимы обучения
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { to: "/review/$deckId", icon: CalendarClock, title: "Ежедневный повтор", desc: "SRS-очередь: только слова, которые пора повторить." },
                { to: "/type/$deckId", icon: Keyboard, title: "Ввод перевода", desc: "Активное припоминание, нечёткое сравнение." },
                { to: "/builder/$deckId", icon: Shuffle, title: "Word builder", desc: "Соберите слово из букв. 3 уровня сложности." },
                { to: "/blank/$deckId", icon: FileQuestion, title: "Fill-in-the-blank", desc: "Слово в контексте: выбор, банк или ввод." },
                { to: "/speed/$deckId", icon: Zap, title: "Speed challenge", desc: "30/60/120 сек. Комбо и рекорды." },
                { to: "/assoc/$deckId", icon: Lightbulb, title: "Ассоциации", desc: "Мнемоники от ИИ и собственные." },
                { to: "/deep/$deckId", icon: Brain, title: "Deep learning", desc: "4 варианта перевода." },
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
                  <LineChart className="h-5 w-5 text-accent" /> AI-разбор
                </h2>
                <p className="mt-1 text-sm text-muted-foreground max-w-md">
                  Анализ сессии, слабые слова, план на завтра — всё на основе вашей статистики.
                </p>
              </div>
              <Button
                className="rounded-full shrink-0"
                onClick={() => navigate({ to: "/feedback/$deckId", params: { deckId: deck.id } })}
              >
                <Sparkles className="h-4 w-4" /> Открыть разбор
              </Button>
            </div>
          </section>
        )}

        {/* Performance analytics */}
        {deck.cards.length > 0 && (() => {
          const weak = weakCardIds(deck.id).slice(0, 5);
          const answered = Object.values(stats);
          const totalCorrect = answered.reduce((s, x) => s + x.correct, 0);
          const totalWrong = answered.reduce((s, x) => s + x.wrong, 0);
          const acc = totalCorrect + totalWrong > 0 ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100) : null;
          const mastered = answered.filter((x) => x.mastery >= 0.75).length;
          return (
            <section className="mb-8 rounded-3xl border border-border bg-card p-6">
              <h2 className="font-display text-xl mb-4">Статистика</h2>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Ответов</p>
                  <p className="font-display text-2xl">{totalCorrect + totalWrong}</p>
                </div>
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Точность</p>
                  <p className="font-display text-2xl">{acc !== null ? `${acc}%` : "—"}</p>
                </div>
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Освоено</p>
                  <p className="font-display text-2xl">{mastered}<span className="text-base text-muted-foreground"> / {deck.cards.length}</span></p>
                </div>
              </div>
              {weak.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">Слабые слова</p>
                  <div className="flex flex-wrap gap-2">
                    {weak.map((id) => {
                      const c = deck.cards.find((x) => x.id === id);
                      if (!c) return null;
                      const a = accuracyFor(stats[id]);
                      return (
                        <span key={id} className="px-3 py-1 rounded-full bg-destructive/10 text-destructive text-xs">
                          {c.term}{a !== null ? ` · ${a}%` : ""}
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
        <form
          onSubmit={handleAdd}
          className="rounded-3xl border border-border bg-card p-6 mb-10"
        >
          <h2 className="font-display text-xl mb-4">Добавить карточку</h2>
          <div className="grid md:grid-cols-[1fr_1.4fr_auto] gap-3">
            <Input
              placeholder="Английское слово"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <Input
              placeholder="Перевод или определение"
              value={def}
              onChange={(e) => setDef(e.target.value)}
            />
            <Button type="submit" className="rounded-full">
              <Plus className="h-4 w-4" /> Добавить
            </Button>
          </div>
        </form>

        {/* Cards list */}
        <div className="space-y-3">
          {deck.cards.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border p-12 text-center text-muted-foreground">
              Добавьте первую карточку выше, чтобы начать учить.
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
                    Выучено
                  </span>
                )}
                <button
                  onClick={() => deleteCard(deck.id, card.id)}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  aria-label="Удалить карточку"
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
                <Sparkles className="h-5 w-5 text-accent" /> Текст для активного повторения
              </h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                ИИ составит короткий английский текст со всеми словами колоды — читайте и
                встречайте слова в живом контексте.
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
                {aiText ? "Сгенерировать ещё" : "Сгенерировать"}
              </Button>
            </div>
          </div>

          {deck.cards.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Добавьте хотя бы одну карточку, чтобы сгенерировать текст.
            </p>
          )}

          {aiError && (
            <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm">
              {aiError}
            </div>
          )}

          {aiLoading && !aiText && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
              Готовим текст…
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
