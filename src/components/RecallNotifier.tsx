import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAllRecallSummary, useDelayedRecallEnabled, decksWithReadyRecall } from "@/lib/delayed-recall";

/**
 * One-shot toast per session when delayed-recall reviews are due.
 * Only fires when the feature is ON. Re-armed when ready count drops to 0.
 */
export function RecallNotifier() {
  const [enabled] = useDelayedRecallEnabled();
  const summary = useAllRecallSummary();
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      notifiedRef.current = false;
      return;
    }
    if (summary.ready === 0) {
      notifiedRef.current = false;
      return;
    }
    if (notifiedRef.current) return;
    notifiedRef.current = true;

    const decks = decksWithReadyRecall();
    const firstDeck = decks[0]?.deckId;
    toast.message(
      summary.ready === 1
        ? "1 слово готово к припоминанию"
        : `${summary.ready} слов готовы к припоминанию`,
      {
        description: "Ваша отложенная сессия ждёт.",
        action: firstDeck
          ? {
              label: "Начать",
              onClick: () => {
                window.location.href = `/recall/${firstDeck}`;
              },
            }
          : undefined,
      },
    );
  }, [enabled, summary.ready]);

  return null;
}
