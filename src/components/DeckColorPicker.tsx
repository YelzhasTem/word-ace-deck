import { Check } from "lucide-react";
import { DECK_COLOR_OPTIONS, type DeckCoverColor, getDeckColorOption } from "@/lib/deck-colors";
import { cn } from "@/lib/utils";

type DeckColorPickerProps = {
  value: DeckCoverColor | null;
  onChange: (value: DeckCoverColor | null) => void;
  label?: string;
};

export function DeckColorPicker({ value, onChange, label = "Deck color" }: DeckColorPickerProps) {
  const selectedOption = getDeckColorOption(value);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{selectedOption.label}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {DECK_COLOR_OPTIONS.map((option) => {
          const selected = option.value === selectedOption.value;

          return (
            <button
              key={option.value ?? "default"}
              type="button"
              aria-label={`${option.label} deck color`}
              aria-pressed={selected}
              title={option.label}
              onClick={() => onChange(option.value)}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                option.swatchClass,
                selected ? "ring-2 ring-primary/35 ring-offset-2 ring-offset-background" : "",
              )}
            >
              {selected ? (
                <Check
                  className={cn(
                    "h-4 w-4 drop-shadow",
                    option.value === null ? "text-foreground" : "text-white",
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
