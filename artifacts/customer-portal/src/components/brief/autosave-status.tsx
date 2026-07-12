import { Loader2, Save, CloudOff, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type AutosaveState = "idle" | "saving" | "saved" | "offline" | "error";

/**
 * Honest autosave indicator — only ever shows "Saved" once a write has actually
 * succeeded. Text is aria-live so screen reader users hear save-state changes
 * without needing to look at the screen.
 */
export function AutosaveStatus({
  state,
  lastSavedAt,
  now,
  onRetry,
  className,
}: {
  state: AutosaveState;
  lastSavedAt: Date | null;
  /** Pass a ticking timestamp (e.g. from setInterval) so "X ago" text stays fresh. */
  now?: number;
  onRetry?: () => void;
  className?: string;
}) {
  const text = (() => {
    if (state === "saving") return "Saving…";
    if (state === "offline") return "Offline — changes saved locally";
    if (state === "error") return "Save failed";
    if (state === "saved" && lastSavedAt) {
      const seconds = Math.max(0, Math.floor(((now ?? Date.now()) - lastSavedAt.getTime()) / 1000));
      if (seconds < 10) return "Saved just now";
      if (seconds < 60) return `Saved ${seconds}s ago`;
      const minutes = Math.floor(seconds / 60);
      return `Saved ${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    }
    return null;
  })();

  if (!text) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs",
        state === "error" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {state === "saving" && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
      {state === "saved" && <Save className="w-3 h-3" aria-hidden="true" />}
      {state === "offline" && <CloudOff className="w-3 h-3" aria-hidden="true" />}
      {state === "error" && <AlertCircle className="w-3 h-3" aria-hidden="true" />}
      <span>{text}</span>
      {state === "error" && onRetry && (
        <button type="button" onClick={onRetry} className="underline hover:no-underline ml-1">
          Retry
        </button>
      )}
    </div>
  );
}
