import { memo } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConflictWarning } from "../types";

interface RecommendationWarningProps {
  warnings: ConflictWarning[];
  className?: string;
}

/** Non-blocking conflict warnings — informational only, never prevents
 *  the user from applying or keeping their own selections. */
export const RecommendationWarning = memo(function RecommendationWarning({
  warnings,
  className,
}: RecommendationWarningProps) {
  if (warnings.length === 0) return null;

  return (
    <div className={cn("space-y-1.5", className)} aria-live="polite">
      {warnings.map((w) => (
        <div
          key={w.code}
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2"
        >
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
          <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">{w.message}</p>
        </div>
      ))}
    </div>
  );
});

RecommendationWarning.displayName = "RecommendationWarning";
