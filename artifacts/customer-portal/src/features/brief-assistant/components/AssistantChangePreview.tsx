/**
 * Phase 4A — Brief Assistant: Change Preview (Preview-before-apply)
 *
 * Shows proposed before/after for a draft change.
 * Only Terapkan may call onApply — Ubah and Lewati never mutate the brief.
 *
 * Conflict flow:
 *   - If change.conflict is true AND field already has content:
 *       show "Pertahankan / Tambahkan / Ganti"
 *   - If no conflict (field was empty):
 *       show "Terapkan / Ubah jawaban / Lewati"
 */

import { memo } from "react";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantDraftChange } from "../types";

interface AssistantChangePreviewProps {
  change: AssistantDraftChange;
  onApply: (mergeMode: "merge" | "replace") => void;
  onEdit: () => void;
  onSkip: () => void;
}

function ValueList({ items, empty }: { items: string[]; empty: string }) {
  if (!items || items.length === 0) {
    return <span className="text-muted-foreground italic">{empty}</span>;
  }
  return (
    <ul className="list-none space-y-0.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className="text-muted-foreground mt-0.5">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export const AssistantChangePreview = memo(function AssistantChangePreview({
  change,
  onApply,
  onEdit,
  onSkip,
}: AssistantChangePreviewProps) {
  const hasExisting = change.displayBefore.length > 0;
  const isConflict = change.conflict && hasExisting;

  return (
    <div className="space-y-4">
      {/* Warnings */}
      {change.warnings.length > 0 && (
        <div className="rounded-xl p-3 bg-amber-500/10 border border-amber-500/30">
          {change.warnings.map((w, i) => (
            <div key={i} className="flex gap-2 text-xs text-amber-500">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Before/After card */}
      <div className="rounded-xl border border-border/60 overflow-hidden bg-card/40">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-border/40 bg-muted/20">
          <span className="text-xs font-medium text-muted-foreground">Pratinjau perubahan</span>
        </div>

        {/* Content */}
        <div className="px-4 py-3 space-y-3">
          {/* Before */}
          {hasExisting && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Saat ini
              </p>
              <div className="text-sm text-foreground/80">
                <ValueList items={change.displayBefore} empty="Belum diisi" />
              </div>
            </div>
          )}

          {/* Arrow */}
          {hasExisting && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border/40" />
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
              <div className="flex-1 h-px bg-border/40" />
            </div>
          )}

          {/* After */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {hasExisting ? "Ditambahkan" : "Akan diisi"}
            </p>
            <div className="text-sm text-primary font-medium">
              <ValueList items={change.displayAfter} empty="Tidak ada perubahan" />
            </div>
          </div>

          {/* Protect existing notice */}
          {!isConflict && hasExisting && (
            <p className="text-[11px] text-muted-foreground/70 border-t border-border/30 pt-2">
              Pilihan yang sudah Anda isi tidak akan dihapus.
            </p>
          )}
        </div>
      </div>

      {/* Action buttons */}
      {isConflict ? (
        /* Conflict: field already had different content */
        <div className="space-y-2">
          <p className="text-xs text-amber-500 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Field ini sudah terisi. Apa yang ingin Anda lakukan?
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onApply("merge")}
              disabled={!change.canMerge}
              className={cn(
                "w-full px-4 py-2.5 rounded-xl text-sm font-medium text-left",
                "border border-primary/40 text-primary hover:bg-primary/10",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                "disabled:opacity-40 disabled:pointer-events-none",
              )}
            >
              Tambahkan ke pilihan yang ada
              {!change.canMerge && " (tidak tersedia)"}
            </button>
            <button
              type="button"
              onClick={() => onApply("replace")}
              className={cn(
                "w-full px-4 py-2.5 rounded-xl text-sm font-medium text-left",
                "border border-destructive/40 text-destructive hover:bg-destructive/10",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60",
              )}
            >
              Ganti jawaban lama
            </button>
            <button
              type="button"
              onClick={onSkip}
              className={cn(
                "w-full px-4 py-2.5 rounded-xl text-sm text-muted-foreground text-left",
                "hover:text-foreground transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              )}
            >
              Pertahankan jawaban lama
            </button>
          </div>
        </div>
      ) : (
        /* No conflict: field was empty or same value */
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onApply("merge")}
            className={cn(
              "flex-1 min-w-[100px] px-4 py-2.5 rounded-xl text-sm font-medium",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              "min-h-[44px]",
            )}
          >
            Terapkan
          </button>
          <button
            type="button"
            onClick={onEdit}
            className={cn(
              "px-4 py-2.5 rounded-xl text-sm text-muted-foreground",
              "border border-border/60 hover:text-foreground hover:border-border",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              "min-h-[44px]",
            )}
          >
            Ubah jawaban
          </button>
          <button
            type="button"
            onClick={onSkip}
            className={cn(
              "px-4 py-2.5 rounded-xl text-sm text-muted-foreground",
              "hover:text-foreground transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              "min-h-[44px]",
            )}
          >
            Lewati
          </button>
        </div>
      )}
    </div>
  );
});

AssistantChangePreview.displayName = "AssistantChangePreview";
