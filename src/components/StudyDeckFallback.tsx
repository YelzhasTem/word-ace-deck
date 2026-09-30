import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";

type Props = {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

/** Shown by study modes while the deck loads, fails to load, or is missing. */
export function StudyDeckFallback({ loading, error, onRetry }: Props) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        {loading ? (
          <div role="status" className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <span>Loading deck…</span>
          </div>
        ) : error ? (
          <>
            <h1 className="font-display text-3xl">Could not load this deck</h1>
            <p className="mt-3 text-muted-foreground">Check your connection and try again.</p>
            <Button className="mt-6 rounded-full" onClick={onRetry}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <h1 className="font-display text-3xl">Deck not found</h1>
            <Link to="/decks" className="mt-6 inline-block text-accent underline">
              All decks
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
