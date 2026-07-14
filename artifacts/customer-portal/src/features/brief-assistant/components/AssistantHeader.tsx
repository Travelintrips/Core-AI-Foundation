/**
 * Phase 4A — Brief Assistant: Panel Header
 */

import { memo } from "react";
import { Sparkles, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantMode, AssistantStage } from "../types";

const STAGE_LABELS: Partial<Record<AssistantStage, string>> = {
  idle: "Pilih mode",
  intro: "Memulai",
  question: "Mengisi brief",
  preview: "Pratinjau perubahan",
  review: "Ringkasan",
  complete: "Selesai",
};

const MODE_LABELS: Record<AssistantMode, string> = {
  "start-from-beginning": "Isi dari awal",
  "complete-missing": "Lengkapi yang kosong",
  "show-recommendations": "Rekomendasi",
};

interface AssistantHeaderProps {
  stage: AssistantStage;
  mode: AssistantMode | null;
  currentIndex: number;
  total: number;
  onClose: () => void;
  onReset: () => void;
}

export const AssistantHeader = memo(function AssistantHeader({
  stage,
  mode,
  currentIndex,
  total,
  onClose,
  onReset,
}: AssistantHeaderProps) {
  const showProgress =
    stage === "question" || stage === "preview";
  const progressPct =
    total > 0 ? Math.min(100, Math.round(((currentIndex - 1) / total) * 100)) : 0;

  return (
    <div className="flex flex-col gap-0 border-b border-border/50">
      {/* Title row */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate">
            Asisten Brief
          </span>
          {mode && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              — {MODE_LABELS[mode]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {stage !== "idle" && (
            <button
              type="button"
              onClick={onReset}
              aria-label="Mulai ulang sesi asisten"
              className={cn(
                "p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                "min-h-[36px] min-w-[36px] flex items-center justify-center",
              )}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup asisten brief"
            className={cn(
              "p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              "min-h-[36px] min-w-[36px] flex items-center justify-center",
            )}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stage label */}
      <div className="px-4 pb-2">
        <span className="text-xs text-muted-foreground">
          {STAGE_LABELS[stage] ?? ""}
        </span>
      </div>

      {/* Progress bar */}
      {showProgress && total > 0 && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-muted-foreground">
              Pertanyaan {currentIndex} dari {total}
            </span>
            <span className="text-[11px] text-muted-foreground">{progressPct}%</span>
          </div>
          <div className="h-1 rounded-full bg-border/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/70 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}
    </div>
  );
});

AssistantHeader.displayName = "AssistantHeader";
