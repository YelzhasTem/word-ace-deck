import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useDeck, type Card } from "@/lib/decks";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check, X, Hourglass, RotateCcw } from "lucide-react";
import {
  dueRecallEntries,
  recordRecallAnswer,
  RECALL_STAGES,
  isDelayedRecallEnabled,
} from "@/lib/delayed-recall";
import { isCloseMatch } from "@/lib/stats";
import { recordStreakToday } from "@/lib/streak";

export const Route = createFileRoute("/recall/$deckId")({
  component: RecallPage,
});

function RecallPage() {
  const { deckId } = Route.useParams();
  const { deck } = useDeck(deckId);
  const enabled = typeof window !== "undefined" ? isDelayedRecallEnabled() : false;

  const [queueIds, setQueueIds] = useState<string[]>([]);
  useEffect(() => {
    if (!deck) return;
    const due = dueRecallEntries(deckId).map((e) => e.cardId);
    const setDue = new Set(due);
    // Preserve deck order, only include ids that still exist
    setQueueIds(deck.cards.filter((c) => setDue.has(c.id)).map((c) => c.id));
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

  useEffect(() => { setInput(""); setVerdict(null); }, [idx]);

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

  if (!enabled) {
    return (
      <div className="min-h-screen"><SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="font-display text-3xl">Режим отложенного припоминания выключен</h1>
          <p className="mt-3 text-muted-foreground">Включите его на странице колоды, чтобы начать сессию.</p>
          <Button asChild className="mt-8 rounded-full">
            <Link to="/deck/$deckId" params={{ deckId: deck.id }}>К колоде</Link>
          </Button>
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
    const ok = isCloseMatch(input, current.term);
    setVerdict(ok ? "ok" : "miss");
    recordRecallAnswer(deck.id, current.id, ok);
    if (ok) { setRight((r) => r + 1); recordStreakToday(); }
    else setWrong((w) => w + 1);
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
            <Hourglass className="h-4 w-4" /> Отложенное припоминание
          </span>
        </div>

        {empty ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">⏳</p>
            <h2 className="font-display text-3xl font-semibold">Слов к припоминанию нет</h2>
            <p className="mt-3 text-muted-foreground">Все запланированные слова ещё не подошли. Загляните позже — мы сами подскажем.</p>
            <Button asChild className="mt-8 rounded-full">
              <Link to="/deck/$deckId" params={{ deckId: deck.id }}>К колоде</Link>
            </Button>
          </div>
        ) : finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">🧠</p>
            <h2 className="font-display text-3xl font-semibold">Сессия завершена</h2>
            <p className="mt-3 text-muted-foreground">Правильно: {right} из {total}. Следующие интервалы рассчитаны автоматически.</p>
            <Button asChild className="mt-8 rounded-full">
              <Link to="/deck/$deckId" params={{ deckId: deck.id }}>К колоде</Link>
            </Button>
          </div>
        ) : current ? (
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

            <div className="rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] p-10 text-center mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold">Подсказка — вспомните слово</span>
              <p className="mt-6 font-display text-3xl md:text-4xl font-semibold leading-tight">{current.definition}</p>
              <p className="mt-6 text-sm text-muted-foreground">Введите английское слово, соответствующее этому определению.</p>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <Input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Слово…" disabled={!!verdict} className="h-14 text-lg rounded-2xl" />
              {verdict === "ok" && (
                <div className="rounded-2xl bg-[color:var(--success)]/10 text-[color:var(--success)] px-4 py-3 text-sm flex items-center gap-2">
                  <Check className="h-4 w-4" /> Верно! {current.term}
                </div>
              )}
              {verdict === "miss" && (
                <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm flex items-center gap-2">
                  <X className="h-4 w-4" /> Правильный ответ: <span className="font-semibold">{current.term}</span>
                </div>
              )}
              <div className="flex justify-end">
                {!verdict ? (
                  <Button type="submit" className="rounded-full">Проверить</Button>
                ) : (
                  <Button type="button" className="rounded-full" onClick={next}>
                    <RotateCcw className="h-4 w-4" /> {idx + 1 < total ? "Дальше" : "Завершить"}
                  </Button>
                )}
              </div>
              <p className="text-center text-xs text-muted-foreground pt-2">
                Текущая стадия: {RECALL_STAGES[Math.min(4, Math.max(0, 0))]}
              </p>
            </form>
          </>
        ) : null}
      </main>
    </div>
  );
}
