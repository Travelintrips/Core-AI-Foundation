/**
 * Phase 4A — Brief Assistant: Review Screen
 *
 * Shows a summary of all reviewed fields before the session ends.
 * Does NOT submit the brief — user returns to the manual wizard.
 */

import { memo } from "react";
import { CheckCircle2, Circle, SkipForward, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BriefData } from "@/pages/brief";
import { REVIEW_FIELDS } from "../constants";
import { isFieldFilled } from "../question-planner";

interface AssistantReviewProps {
  brief: BriefData;
  skippedQuestionIds: string[];
  onComplete: () => void;
  onClose: () => void;
}

type FieldStatus = "filled" | "skipped" | "empty" | "optional-empty";

function getStatus(
  brief: BriefData,
  field: keyof BriefData,
  required: boolean,
  skipped: string[],
): FieldStatus {
  if (isFieldFilled(brief, field)) return "filled";
  if (skipped.includes(field)) return "skipped";
  if (!required) return "optional-empty";
  return "empty";
}

const STATUS_CONFIG: Record<FieldStatus, { icon: React.ComponentType<{ className?: string }>; label: string; color: string }> = {
  filled:         { icon: CheckCircle2, label: "Sudah diisi",  color: "text-emerald-500" },
  skipped:        { icon: SkipForward,  label: "Dilewati",     color: "text-amber-500" },
  empty:          { icon: Circle,       label: "Belum diisi",  color: "text-destructive" },
  "optional-empty":{ icon: Minus,       label: "Opsional",     color: "text-muted-foreground" },
};

export const AssistantReview = memo(function AssistantReview({
  brief,
  skippedQuestionIds,
  onComplete,
  onClose,
}: AssistantReviewProps) {
  const fields = REVIEW_FIELDS.map((f) => ({
    ...f,
    status: getStatus(brief, f.field, f.required, skippedQuestionIds),
  }));

  const filledCount = fields.filter((f) => f.status === "filled").length;
  const requiredEmpty = fields.filter((f) => f.status === "empty").length;

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="rounded-xl p-4 bg-card/40 border border-border/50">
        <p className="text-sm font-medium text-foreground mb-1">
          {filledCount} dari {fields.length} field terisi
        </p>
        {requiredEmpty > 0 ? (
          <p className="text-xs text-amber-500">
            {requiredEmpty} field wajib masih kosong — bisa dilengkapi lewat form manual.
          </p>
        ) : (
          <p className="text-xs text-emerald-500">
            Semua field wajib sudah terisi! 🎉
          </p>
        )}
      </div>

      {/* Field list */}
      <div className="space-y-1.5" aria-label="Ringkasan field brief">
        {fields.map((f) => {
          const cfg = STATUS_CONFIG[f.status];
          const Icon = cfg.icon;
          return (
            <div
              key={f.field}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-card/30 border border-border/30"
            >
              <Icon className={cn("w-4 h-4 shrink-0", cfg.color)} aria-hidden />
              <span className="flex-1 text-sm text-foreground">{f.label}</span>
              <span className={cn("text-[11px]", cfg.color)}>{cfg.label}</span>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div
        className="flex flex-col gap-2 pt-2"
        aria-live="polite"
        aria-label="Tindakan berikutnya"
      >
        <button
          type="button"
          onClick={onComplete}
          className={cn(
            "w-full px-4 py-3 rounded-xl text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            "min-h-[44px]",
          )}
        >
          Selesai dan kembali ke brief
        </button>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "w-full px-4 py-3 rounded-xl text-sm text-muted-foreground",
            "border border-border/50 hover:text-foreground hover:border-border",
            "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            "min-h-[44px]",
          )}
        >
          Lanjut isi manual
        </button>
      </div>
    </div>
  );
});

AssistantReview.displayName = "AssistantReview";
