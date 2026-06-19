import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAllRecallSummary, decksWithReadyRecall } from "@/lib/delayed-recall";

/**
 * One-shot toast per ready deck when delayed-recall reviews are due.
 */
export function RecallNotifier() {
  const summary = useAllRecallSummary();
  const notifiedDeckRef = useRef<string | null>(null);

  useEffect(() => {
    if (summary.ready === 0) {
      notifiedDeckRef.current = null;
      return;
    }

    const decks = decksWithReadyRecall();
    const firstDeck = decks[0]?.deckId;
    if (!firstDeck || notifiedDeckRef.current === firstDeck) return;
    notifiedDeckRef.current = firstDeck;

    toast.message(
      summary.ready === 1
        ? "1 word is ready for recall"
        : `${summary.ready} words are ready for recall`,
      {
        description: "Your delayed recall session is waiting.",
        action: firstDeck
          ? {
              label: "Start",
              onClick: () => {
                window.location.href = `/recall/${firstDeck}`;
              },
            }
          : undefined,
      },
    );
  }, [summary.ready]);

  return null;
}
