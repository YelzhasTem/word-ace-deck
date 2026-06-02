import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Hourglass } from "lucide-react";
import { useDelayedRecallEnabled, scheduleNewCard, RECALL_INTERVALS } from "@/lib/delayed-recall";
import { useDecks } from "@/lib/decks";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Настройки — Memora" },
      { name: "description", content: "Управление режимами обучения и предпочтениями." },
    ],
  }),
  component: SettingsPage,
});

function fmtInterval(ms: number) {
  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  if (ms < HOUR) return `${Math.round(ms / MIN)} мин`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} ч`;
  return `${Math.round(ms / DAY)} д`;
}

function SettingsPage() {
  const [recallEnabled, setRecallEnabled] = useDelayedRecallEnabled();
  const { decks } = useDecks();

  const toggle = (on: boolean) => {
    setRecallEnabled(on);
    if (on) {
      // Backfill schedule for all existing cards so the user can start right away.
      decks.forEach((d) => d.cards.forEach((c) => scheduleNewCard(d.id, c.id)));
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" /> На главную
        </Link>

        <h1 className="font-display text-4xl font-semibold tracking-tight mb-2">Настройки</h1>
        <p className="text-muted-foreground mb-10">Управляйте режимами обучения и поведением приложения.</p>

        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex-1">
              <h2 className="font-display text-xl flex items-center gap-2">
                <Hourglass className="h-5 w-5 text-accent" /> Отложенное припоминание
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-xl">
                Улучшайте долговременную память — повторяйте слова через возрастающие интервалы,
                а не сразу несколько раз подряд.
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {RECALL_INTERVALS.map((ms, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-full bg-secondary text-xs font-medium text-muted-foreground">
                    {fmtInterval(ms)}
                  </span>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-3 shrink-0 cursor-pointer">
              <span className="text-sm font-medium">{recallEnabled ? "ВКЛ" : "ВЫКЛ"}</span>
              <Switch checked={recallEnabled} onCheckedChange={toggle} />
            </label>
          </div>
          {recallEnabled ? (
            <p className="mt-5 text-xs text-muted-foreground">
              Новые карточки автоматически планируются для повтора. Прогресс сохраняется даже при отключении режима.
            </p>
          ) : (
            <p className="mt-5 text-xs text-muted-foreground">
              Когда режим выключен, приложение работает как обычно — без напоминаний и отложенных сессий.
              Сохранённый прогресс не удаляется.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
