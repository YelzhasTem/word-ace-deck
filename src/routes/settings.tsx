import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Hourglass } from "lucide-react";
import { useDelayedRecallEnabled, scheduleNewCard, RECALL_INTERVALS } from "@/lib/delayed-recall";
import { useDecks } from "@/lib/decks";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Memora" },
      { name: "description", content: "Manage learning modes and app preferences." },
    ],
  }),
  component: SettingsPage,
});

function fmtInterval(ms: number) {
  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  if (ms < HOUR) return `${Math.round(ms / MIN)} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / DAY)} d`;
}

function SettingsPage() {
  const [recallEnabled, setRecallEnabled] = useDelayedRecallEnabled();
  const { decks } = useDecks();
  const t = useT();

  const toggle = (on: boolean) => {
    setRecallEnabled(on);
    if (on) {
      decks.forEach((d) => d.cards.forEach((c) => scheduleNewCard(d.id, c.id)));
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" /> {t("settings.back")}
        </Link>

        <h1 className="font-display text-4xl font-semibold tracking-tight mb-2">{t("settings.title")}</h1>
        <p className="text-muted-foreground mb-10">{t("settings.desc")}</p>

        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex-1">
              <h2 className="font-display text-xl flex items-center gap-2">
                <Hourglass className="h-5 w-5 text-accent" /> {t("settings.recall.title")}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-xl">
                {t("settings.recall.desc")}
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
              <span className="text-sm font-medium">{recallEnabled ? t("settings.on") : t("settings.off")}</span>
              <Switch checked={recallEnabled} onCheckedChange={toggle} />
            </label>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            {recallEnabled ? t("settings.recall.onNote") : t("settings.recall.offNote")}
          </p>
        </section>
      </main>
    </div>
  );
}
