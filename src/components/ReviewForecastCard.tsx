import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarClock, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { accountLearningDb } from "@/lib/account-learning-db";
import {
  getDeckRecall,
  hydrateDelayedRecallState,
  isDelayedRecallHydrated,
} from "@/lib/delayed-recall";
import type { Deck } from "@/lib/decks";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { buildReviewForecast, forecastHorizon, type ForecastItem } from "@/lib/review-forecast";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

type ProgressDue = { deckId: string; cardId: string; due: number };

// Only rows due before the end of the forecast window are fetched, so this stays small
// even for large libraries; paging covers users with a big overdue backlog.
async function fetchProgressDue(horizon: number): Promise<ProgressDue[] | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return null;

  const rows: ProgressDue[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await accountLearningDb()
      .from("card_progress")
      .select("deck_id, card_id, card_key, due_at")
      .eq("user_id", userId)
      .not("due_at", "is", null)
      .lt("due_at", new Date(horizon).toISOString())
      .order("due_at", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!row.due_at) continue;
      rows.push({
        deckId: row.deck_id,
        // Reverse-direction progress is stored under "<cardId>:rev".
        cardId: row.card_id ?? row.card_key.replace(/:rev$/, ""),
        due: new Date(row.due_at).getTime(),
      });
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function useProgressDue() {
  const [rows, setRows] = useState<ProgressDue[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await fetchProgressDue(forecastHorizon(Date.now()));
        if (cancelled) return;
        setRows(result ?? []);
        setFailed(false);
      } catch (error) {
        if (cancelled) return;
        console.warn("[Forecast] Could not load review forecast:", error);
        setFailed(true);
      }
    };
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void load();
      }
    });
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("stats:changed", load);
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("stats:changed", load);
    };
  }, []);

  return { rows, failed };
}

function useRecallVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    if (!isDelayedRecallHydrated()) void hydrateDelayedRecallState();
    window.addEventListener("delayedRecall:changed", bump);
    return () => window.removeEventListener("delayedRecall:changed", bump);
  }, []);
  return version;
}

const weekdayFormat = new Intl.DateTimeFormat("en", { weekday: "short" });

export function ReviewForecastCard({ decks }: { decks: Deck[] }) {
  const t = useT();
  const { rows, failed } = useProgressDue();
  const recallVersion = useRecallVersion();

  const forecast = useMemo(() => {
    if (!rows) return null;
    // Skip progress for deleted decks or cards so the numbers match what can be studied.
    const liveCards = new Map(decks.map((d) => [d.id, new Set(d.cards.map((c) => c.id))]));
    const isLive = (deckId: string, cardId: string) => liveCards.get(deckId)?.has(cardId) ?? false;

    const items: ForecastItem[] = [];
    for (const row of rows) {
      if (isLive(row.deckId, row.cardId)) items.push({ source: "review", ...row });
    }
    for (const deck of decks) {
      for (const entry of getDeckRecall(deck.id)) {
        if (isLive(deck.id, entry.cardId)) {
          items.push({ source: "recall", deckId: deck.id, cardId: entry.cardId, due: entry.due });
        }
      }
    }
    return buildReviewForecast(items, Date.now());
    // recallVersion re-reads the delayed recall cache when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, decks, recallVersion]);

  if (failed && !forecast) return null;

  const today = forecast?.days[0];
  const upcoming = forecast?.days.slice(1) ?? [];
  const max = Math.max(1, ...(forecast?.days.map((d) => d.total) ?? [0]));
  const top = forecast?.topDeckToday;
  const topDeck = top ? decks.find((d) => d.id === top.deckId) : undefined;

  return (
    <section className="mb-14 rounded-3xl bg-card border border-border/70 p-6 md:p-7 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/15 to-accent/20 inline-flex items-center justify-center">
            <CalendarClock className="h-7 w-7 text-primary" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium">
              {t("forecast.title")}
            </p>
            <p className="font-display text-3xl md:text-4xl font-extrabold leading-none mt-1.5">
              <span className="text-primary tabular-nums">{today ? today.total : "–"}</span>{" "}
              <span className="text-base font-semibold text-muted-foreground">
                {t("forecast.dueToday")}
              </span>
            </p>
            {today && today.recall > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                {today.review} {t("forecast.legend.review").toLowerCase()} · {today.recall}{" "}
                {t("forecast.legend.recall").toLowerCase()}
              </p>
            )}
          </div>
        </div>

        {top && topDeck ? (
          <Button asChild className="rounded-full px-5">
            <Link
              to={top.source === "recall" ? "/recall/$deckId" : "/study/$deckId"}
              params={{ deckId: topDeck.id }}
            >
              <Play className="h-4 w-4" /> {t("forecast.start")}: {topDeck.name}
            </Link>
          </Button>
        ) : (
          forecast && (
            <p className="text-sm text-muted-foreground max-w-xs">
              {forecast.weekTotal > 0 ? t("forecast.clearToday") : t("forecast.empty")}
            </p>
          )
        )}
      </div>

      <div className="grid grid-cols-7 gap-2 md:gap-3" role="list" aria-label={t("forecast.next7")}>
        {upcoming.map((day, i) => {
          const height = day.total > 0 ? Math.max(8, Math.round((day.total / max) * 100)) : 0;
          const recallShare = day.total > 0 ? (day.recall / day.total) * 100 : 0;
          const label = i === 0 ? t("forecast.tomorrow") : weekdayFormat.format(day.start);
          return (
            <div
              key={day.date}
              role="listitem"
              aria-label={`${label}: ${day.total}`}
              className="flex flex-col items-center gap-2"
            >
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {day.total > 0 ? day.total : ""}
              </span>
              <div className="relative h-20 w-full max-w-10 rounded-xl bg-secondary/40 overflow-hidden">
                <div
                  className="absolute inset-x-0 bottom-0 flex flex-col rounded-xl overflow-hidden"
                  style={{ height: `${height}%` }}
                >
                  {day.recall > 0 && (
                    <div className="bg-accent" style={{ height: `${recallShare}%` }} />
                  )}
                  <div className="flex-1 bg-primary" />
                </div>
              </div>
              <span
                className={cn(
                  "text-[10px] uppercase tracking-wider font-semibold",
                  i === 0 ? "text-primary" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> {t("forecast.legend.review")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> {t("forecast.legend.recall")}
        </span>
        {forecast && (
          <span className="ml-auto tabular-nums">
            {t("forecast.next7")}: {forecast.weekTotal - (today?.total ?? 0)}
          </span>
        )}
      </div>
    </section>
  );
}
