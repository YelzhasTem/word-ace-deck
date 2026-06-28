import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/online-status";

export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-destructive/30 bg-background/95 px-4 py-3 text-sm text-foreground shadow-lg backdrop-blur"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <WifiOff className="h-4 w-4" />
      </span>
      <span>
        <span className="block font-medium">No internet connection</span>
        <span className="block text-xs text-muted-foreground">
          AI, creation, and saving are turned off until you are back online.
        </span>
      </span>
    </div>
  );
}
