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
  ArrowLeft, Plus, Trash2, Play, RotateCcw, Sparkles, Loader2, Brain,
  Keyboard, Shuffle, FileQuestion, Zap, Lightbulb, CalendarClock, LineChart, Hourglass,
} from "lucide-react";
import { generateStudyText } from "@/lib/ai.functions";
import { useDelayedRecallEnabled, useDeckRecallSummary, scheduleNewCard } from "@/lib/delayed-recall";
import { DECK_CATEGORIES, updateDeckPublishing } from "@/lib/community.functions";
import { toast } from "sonner";

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
          Загрузка колоды...
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
              <div key={item} className="flex items-center justify-between rounded-2xl bg-secondary/50 px-4 py-3">
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
  useEffect(() => { markDeckStudied(deckId); }, [deckId]);
  const navigate = useNavigate();
  const { deck, addCard, deleteCard, resetProgress, isLoading } = useDeck(deckId);
  const stats = useDeckStats(deckId);
  const [term, setTerm] = useState("");
  const [def, setDef] = useState("");
  const generate = useServerFn(generateStudyText);
  const updatePublishing = useServerFn(updateDeckPublishing);
  const [aiText, setAiText] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string>("");
  const [aiSeed, setAiSeed] = useState(0);
  const [visibility, setVisibility] = useState<"private" | "unlisted" | "public">("private");
  const [category, setCategory] = useState<(typeof DECK_CATEGORIES)[number]>("General English");
  const [keywords, setKeywords] = useState("");
  const [recallEnabled, setRecallEnabled] = useDelayedRecallEnabled();
  const recallSummary = useDeckRecallSummary(deckId);

  useEffect(() => {
    if (!deck) return;
    setVisibility(deck.visibility);
    setCategory((DECK_CATEGORIES.includes(deck.category as never) ? deck.category : "General English") as (typeof DECK_CATEGORIES)[number]);
    setKeywords(deck.keywords.join(", "));
  }, [deck]);

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
      setAiError(e instanceof Error ? e.message : "Не удалось сгенерировать текст");
    }
    setAiLoading(false);
  };

  if (isLoading) return <DeckLoading />;

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

  const handlePublishingSave = async () => {
    if (!deck) return;
    const parsedKeywords = keywords
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean)
      .slice(0, 12);
    await updatePublishing({
      data: {
        deckId: deck.id,
        visibility,
        category,
        keywords: parsedKeywords,
      },
    });
    toast.success(visibility === "public" ? "Deck published to Community." : "Deck visibility updated.");
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

        <section className="mb-8 rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-display text-xl">Deck publishing</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Choose whether this deck stays private, is available by direct link, or appears in the public marketplace.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Visibility</span>
                  <select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as "private" | "unlisted" | "public")}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Category</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as (typeof DECK_CATEGORIES)[number])}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {DECK_CATEGORIES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Keywords</span>
                  <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="IELTS, travel, verbs" />
                </label>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 md:items-end">
              <Button className="rounded-full" onClick={handlePublishingSave}>
                {visibility === "public" ? "Publish deck" : "Save visibility"}
              </Button>
              {deck.visibility !== "private" && (
                <Link
                  to="/community/$deckId"
                  params={{ deckId: deck.id }}
                  className="text-sm text-primary hover:underline"
                >
                  Open public link
                </Link>
              )}
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-border bg-background px-4 py-3">
              <p className="text-xs text-muted-foreground">Visibility</p>
              <p className="font-semibold capitalize">{deck.visibility}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background px-4 py-3">
              <p className="text-xs text-muted-foreground">Learners</p>
              <p className="font-semibold">{deck.totalLearners}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background px-4 py-3">
              <p className="text-xs text-muted-foreground">Likes</p>
              <p className="font-semibold">{deck.likes}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background px-4 py-3">
              <p className="text-xs text-muted-foreground">Rating</p>
              <p className="font-semibold">{deck.rating || "New"}</p>
            </div>
          </div>
        </section>

        {/* Delayed Recall */}
        <section className="mb-8 rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
            <div className="flex-1">
              <h2 className="font-display text-xl flex items-center gap-2">
                <Hourglass className="h-5 w-5 text-accent" /> Отложенное припоминание
              </h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                Улучшайте долговременную память — повторяйте слова через возрастающие интервалы
                (10 мин · 1 д · 3 д · 7 д · 14 д · 30 д), а не сразу несколько раз подряд.
              </p>
            </div>
            <label className="flex items-center gap-3 shrink-0 cursor-pointer">
              <span className="text-sm font-medium">{recallEnabled ? "ВКЛ" : "ВЫКЛ"}</span>
              <Switch checked={recallEnabled} onCheckedChange={toggleRecall} />
            </label>
          </div>

          {recallEnabled && (
            <div className="animate-in fade-in slide-in-from-top-1 duration-300">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">К повтору</p>
                  <p className="font-display text-2xl">{recallSummary.ready}</p>
                </div>
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">В очереди</p>
                  <p className="font-display text-2xl">{recallSummary.upcoming}</p>
                </div>
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Удержание</p>
                  <p className="font-display text-2xl">{recallSummary.retention !== null ? `${recallSummary.retention}%` : "—"}</p>
                </div>
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Освоено</p>
                  <p className="font-display text-2xl">{recallSummary.mastered}</p>
                </div>
              </div>
              {recallSummary.ready > 0 && (
                <div className="rounded-2xl bg-accent/10 text-foreground px-4 py-3 text-sm mb-4 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-accent" />
                  {recallSummary.ready} {recallSummary.ready === 1 ? "слово готово" : "слов готовы"} к припоминанию — сессия ждёт.
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  className="rounded-full"
                  onClick={() => navigate({ to: "/recall/$deckId", params: { deckId: deck.id } })}
                  disabled={recallSummary.ready === 0}
                >
                  <Hourglass className="h-4 w-4" /> Начать сессию
                </Button>
              </div>
            </div>
          )}
        </section>

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
