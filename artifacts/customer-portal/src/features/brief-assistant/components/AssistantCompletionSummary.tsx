/**
 * Phase 4A — Brief Assistant: Completion Summary
 *
 * Shown when the user has finished or dismissed the assistant.
 * Brief state is unchanged; autosave handled by existing flow.
 */

import { memo } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssistantCompletionSummaryProps {
  appliedCount: number;
  skippedCount: number;
  onClose: () => void;
  onReset: () => void;
}

export const AssistantCompletionSummary = memo(function AssistantCompletionSummary({
  appliedCount,
  skippedCount,
  onClose,
  onReset,
}: AssistantCompletionSummaryProps) {
  return (
    <div className="flex flex-col items-center text-center space-y-5 py-4">
      <div className="w-14 h-14 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
        <CheckCircle2 className="w-7 h-7 text-primary" />
      </div>

      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Sesi asisten selesai</h3>
        <p className="text-sm text-muted-foreground">
          {appliedCount > 0
            ? `${appliedCount} jawaban diterapkan ke brief Anda.`
            : "Brief Anda tidak berubah."}
          {skippedCount > 0 && ` ${skippedCount} pertanyaan dilewati.`}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-2">
          Lanjutkan mengisi form brief secara manual untuk melengkapi detail lainnya.
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full">
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "w-full px-4 py-3 rounded-xl text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            "min-h-[44px]",
          )}
        >
          Kembali ke brief
        </button>
        <button
          type="button"
          onClick={onReset}
          className={cn(
            "w-full px-3 py-2 rounded-lg text-xs text-muted-foreground",
            "hover:text-foreground transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
          )}
        >
          Mulai ulang asisten
        </button>
      </div>
    </div>
  );
});

AssistantCompletionSummary.displayName = "AssistantCompletionSummary";
