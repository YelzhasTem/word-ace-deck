import { useStreak } from "@/lib/streak";
import { Flame, Trophy, CalendarCheck } from "lucide-react";
import { useT, useLang } from "@/lib/i18n";

function pluralRu(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

export function StreakCard() {
  const { current, longest, totalDays, week } = useStreak();
  const t = useT();
  const { lang } = useLang();

  const dayWord =
    lang === "ru"
      ? pluralRu(current, [t("streak.day.one"), t("streak.day.few"), t("streak.day.many")])
      : current === 1
        ? t("streak.day.one")
        : t("streak.day.many");

  const dowKeys = [
    "streak.dow.mon",
    "streak.dow.tue",
    "streak.dow.wed",
    "streak.dow.thu",
    "streak.dow.fri",
    "streak.dow.sat",
    "streak.dow.sun",
  ] as const;

  return (
    <div className="rounded-3xl bg-card border border-border/70 p-6 md:p-7 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="relative h-14 w-14 rounded-2xl bg-gradient-to-br from-warning/20 to-accent/20 inline-flex items-center justify-center">
            <Flame className="h-7 w-7 text-warning" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium">
              {t("streak.title")}
            </p>
            <p className="font-display text-3xl md:text-4xl font-extrabold leading-none mt-1.5">
              <span className="text-primary tabular-nums">{current}</span>{" "}
              <span className="text-base font-semibold text-muted-foreground">
                {dayWord} {t("streak.daysSuffix")}
              </span>
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="rounded-2xl bg-secondary/60 px-4 py-2.5 min-w-[110px]">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Trophy className="h-3.5 w-3.5" /> {t("streak.record")}
            </div>
            <p className="font-display text-xl font-bold text-foreground tabular-nums mt-0.5">
              {longest}
            </p>
          </div>
          <div className="rounded-2xl bg-secondary/60 px-4 py-2.5 min-w-[110px]">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <CalendarCheck className="h-3.5 w-3.5" /> {t("streak.total")}
            </div>
            <p className="font-display text-xl font-bold text-foreground tabular-nums mt-0.5">
              {totalDays}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2 md:gap-3">
        {week.map((d, i) => {
          const base =
            "flex flex-col items-center gap-2 rounded-2xl py-3 px-1 border transition-colors";
          let cls = "border-border/60 bg-secondary/30 text-muted-foreground";
          if (d.active) cls = "border-accent/40 bg-accent/15 text-primary";
          if (d.isFuture) cls = "border-dashed border-border/50 bg-transparent text-muted-foreground/60";
          if (d.isToday)
            cls = d.active
              ? "border-primary bg-primary text-primary-foreground shadow-[var(--shadow-soft)]"
              : "border-primary/60 bg-card text-primary";
          return (
            <div key={d.date} className={`${base} ${cls}`}>
              <span className="text-[10px] uppercase tracking-wider font-semibold">
                {t(dowKeys[i])}
              </span>
              <div className="h-8 w-8 rounded-full inline-flex items-center justify-center text-sm font-display font-bold">
                {d.active ? <Flame className="h-4 w-4" /> : d.dayNum}
              </div>
            </div>
          );
        })}
      </div>

      {current === 0 && (
        <p className="mt-5 text-sm text-muted-foreground text-center">
          {t("streak.empty")}
        </p>
      )}
    </div>
  );
}
