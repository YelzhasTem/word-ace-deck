import { Link } from "@tanstack/react-router";
import { Hourglass, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAllRecallSummary, useDelayedRecallEnabled, decksWithReadyRecall, formatDueIn } from "@/lib/delayed-recall";
import { useMemo } from "react";
import { useT } from "@/lib/i18n";

export function DelayedRecallDashboard() {
  const [enabled] = useDelayedRecallEnabled();
  const summary = useAllRecallSummary();
  const readyDecks = useMemo(() => (enabled ? decksWithReadyRecall() : []), [enabled, summary.ready]);
  const t = useT();

  if (!enabled) {
    return (
      <section className="rounded-3xl border border-dashed border-border bg-card/50 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg flex items-center gap-2">
              <Hourglass className="h-5 w-5 text-accent" /> {t("dr.title")}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-xl">
              {t("dr.offDesc")}
            </p>
          </div>
          <Button asChild variant="outline" className="rounded-full shrink-0">
            <Link to="/settings">{t("dr.openSettings")}</Link>
          </Button>
        </div>
      </section>
    );
  }

  const firstReadyDeck = readyDecks[0]?.deckId;

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h3 className="font-display text-lg flex items-center gap-2">
          <Hourglass className="h-5 w-5 text-accent" /> {t("dr.title")}
        </h3>
        <Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">
          {t("dr.settings")}
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-2xl bg-background border border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">{t("dr.ready")}</p>
          <p className="font-display text-2xl">{summary.ready}</p>
        </div>
        <div className="rounded-2xl bg-background border border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">{t("dr.upcoming")}</p>
          <p className="font-display text-2xl">{summary.upcoming}</p>
        </div>
        <div className="rounded-2xl bg-background border border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">{t("dr.retention")}</p>
          <p className="font-display text-2xl">{summary.retention !== null ? `${summary.retention}%` : "—"}</p>
        </div>
        <div className="rounded-2xl bg-background border border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">{t("dr.mastered")}</p>
          <p className="font-display text-2xl">{summary.mastered}</p>
        </div>
      </div>

      {summary.ready > 0 ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-accent/10 px-4 py-3">
          <p className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            {summary.ready} {summary.ready === 1 ? t("dr.wordReady") : t("dr.wordsReady")} {t("dr.toRecall")}
            {readyDecks.length > 1 ? ` · ${readyDecks.length} ${t("dr.decksSuffix")}` : ""}
          </p>
          {firstReadyDeck && (
            <Button asChild size="sm" className="rounded-full shrink-0">
              <Link to="/recall/$deckId" params={{ deckId: firstReadyDeck }}>
                {t("dr.startSession")}
              </Link>
            </Button>
          )}
        </div>
      ) : summary.nextDue ? (
        <p className="text-sm text-muted-foreground">
          {t("dr.nextReviewPrefix")} {formatDueIn(summary.nextDue)}{t("dr.nextReviewSuffix")}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("dr.empty")}
        </p>
      )}
    </section>
  );
}
