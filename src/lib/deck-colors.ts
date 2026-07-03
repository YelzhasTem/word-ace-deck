export const DECK_COVER_COLOR_VALUES = [
  "rose",
  "amber",
  "emerald",
  "sky",
  "violet",
  "slate",
] as const;

export type DeckCoverColor = (typeof DECK_COVER_COLOR_VALUES)[number];

export type DeckColorOption = {
  value: DeckCoverColor | null;
  label: string;
  swatchClass: string;
  cardClass: string;
  progressClass: string;
};

export const DECK_COLOR_OPTIONS: DeckColorOption[] = [
  {
    value: null,
    label: "Default",
    swatchClass: "border-border bg-card",
    cardClass: "border-border/70 bg-card",
    progressClass: "from-accent to-primary",
  },
  {
    value: "rose",
    label: "Rose",
    swatchClass: "border-rose-300 bg-rose-400",
    cardClass: "border-rose-200/80 bg-rose-50/90 dark:border-rose-500/30 dark:bg-rose-950/20",
    progressClass: "from-rose-400 to-pink-500",
  },
  {
    value: "amber",
    label: "Amber",
    swatchClass: "border-amber-300 bg-amber-400",
    cardClass: "border-amber-200/90 bg-amber-50/90 dark:border-amber-500/30 dark:bg-amber-950/20",
    progressClass: "from-amber-400 to-orange-500",
  },
  {
    value: "emerald",
    label: "Emerald",
    swatchClass: "border-emerald-300 bg-emerald-400",
    cardClass:
      "border-emerald-200/90 bg-emerald-50/90 dark:border-emerald-500/30 dark:bg-emerald-950/20",
    progressClass: "from-emerald-400 to-teal-500",
  },
  {
    value: "sky",
    label: "Sky",
    swatchClass: "border-sky-300 bg-sky-400",
    cardClass: "border-sky-200/90 bg-sky-50/90 dark:border-sky-500/30 dark:bg-sky-950/20",
    progressClass: "from-sky-400 to-cyan-500",
  },
  {
    value: "violet",
    label: "Violet",
    swatchClass: "border-violet-300 bg-violet-400",
    cardClass:
      "border-violet-200/90 bg-violet-50/90 dark:border-violet-500/30 dark:bg-violet-950/20",
    progressClass: "from-violet-400 to-fuchsia-500",
  },
  {
    value: "slate",
    label: "Slate",
    swatchClass: "border-slate-400 bg-slate-500",
    cardClass: "border-slate-200/90 bg-slate-50/90 dark:border-slate-500/40 dark:bg-slate-900/35",
    progressClass: "from-slate-400 to-zinc-600",
  },
];

export function normalizeDeckCoverColor(value?: string | null): DeckCoverColor | null {
  if (!value) return null;
  return DECK_COVER_COLOR_VALUES.includes(value as DeckCoverColor)
    ? (value as DeckCoverColor)
    : null;
}

export function getDeckColorOption(value?: string | null) {
  const normalized = normalizeDeckCoverColor(value);
  return DECK_COLOR_OPTIONS.find((option) => option.value === normalized) ?? DECK_COLOR_OPTIONS[0];
}
