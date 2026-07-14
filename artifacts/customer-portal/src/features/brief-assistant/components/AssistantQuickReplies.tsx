/**
 * Phase 4A — Brief Assistant: Quick Reply Buttons
 *
 * Renders single-select or multi-select chip buttons from the question's
 * option registry (never hardcoded lists).
 *
 * Supports: single / multi / exclusive / Other (triggers text input).
 */

import { memo, useState, useCallback } from "react";
import { Check, Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantOption, AssistantQuestionType } from "../types";

interface AssistantQuickRepliesProps {
  options: AssistantOption[];
  selected: string[];
  questionType: AssistantQuestionType;
  maxSelections?: number;
  onSelectionChange: (keys: string[]) => void;
  /** Called when the user confirms the current selection. */
  onConfirm: (keys: string[], customText: string) => void;
  onOtherActivated?: () => void;
  className?: string;
}

export const AssistantQuickReplies = memo(function AssistantQuickReplies({
  options,
  selected,
  questionType,
  maxSelections,
  onSelectionChange,
  onConfirm,
  className,
}: AssistantQuickRepliesProps) {
  const [customText, setCustomText] = useState("");
  const isMulti = questionType === "multi";
  const isAtMax = isMulti && maxSelections !== undefined && selected.filter(k => k !== "other").length >= maxSelections;
  const hasOtherSelected = selected.includes("other");

  const toggle = useCallback(
    (key: string) => {
      const opt = options.find((o) => o.key === key);

      if (!isMulti) {
        // Single select: always replace
        onSelectionChange([key]);
        // For single, auto-confirm unless "other" requires text
        if (key !== "other") {
          onConfirm([key], "");
        }
        return;
      }

      // Handle exclusive options (e.g., "none", "unsure")
      if (opt?.exclusive) {
        onSelectionChange(selected.includes(key) ? [] : [key]);
        return;
      }
      // Deselect if another exclusive was selected
      const prevExclusive = selected.find((s) => options.find((o) => o.key === s)?.exclusive);
      const base = prevExclusive ? [] : selected;

      if (base.includes(key)) {
        onSelectionChange(base.filter((k) => k !== key));
      } else {
        if (key !== "other" && isAtMax) return; // at max, don't add
        onSelectionChange([...base, key]);
      }
    },
    [isMulti, isAtMax, selected, options, onSelectionChange, onConfirm],
  );

  const handleConfirm = useCallback(() => {
    onConfirm(selected, customText.trim());
  }, [selected, customText, onConfirm]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Option chips */}
      <div
        className="flex flex-wrap gap-2"
        role={isMulti ? "group" : "radiogroup"}
        aria-label="Pilihan jawaban"
      >
        {options.map((opt) => {
          const isSelected = selected.includes(opt.key);
          const atMaxAndNotSelected = isMulti && isAtMax && !isSelected && opt.key !== "other";

          return (
            <button
              key={opt.key}
              type="button"
              role={isMulti ? "checkbox" : "radio"}
              aria-checked={isSelected}
              aria-disabled={atMaxAndNotSelected}
              onClick={() => !atMaxAndNotSelected && toggle(opt.key)}
              title={opt.description}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium",
                "border transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                "min-h-[40px]", // touch target ≥ 44px (height + padding)
                isSelected
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border/60 bg-card/60 text-foreground hover:border-primary/50 hover:bg-card",
                atMaxAndNotSelected && "opacity-40 cursor-not-allowed",
                // Color swatches
                opt.hex && "pr-2.5",
              )}
            >
              {opt.hex && (
                <span
                  className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0"
                  style={{ backgroundColor: opt.hex }}
                  aria-hidden
                />
              )}
              {isSelected && isMulti && <Check className="w-3 h-3 shrink-0" />}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>

      {/* Custom text for "Lainnya" */}
      {hasOtherSelected && (
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground font-medium">
            Tuliskan pilihan Anda:
          </label>
          <textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder={isMulti ? "Contoh: Petani, nelayan, atau peternak" : "Tuliskan jawaban Anda"}
            aria-label="Jawaban kustom"
            className={cn(
              "w-full resize-none rounded-lg px-3 py-2 text-sm",
              "bg-card/60 border border-border/60 text-foreground",
              "placeholder:text-muted-foreground/60",
              "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50",
              "transition-colors",
            )}
          />
        </div>
      )}

      {/* Max selection indicator */}
      {isMulti && maxSelections !== undefined && (
        <p className="text-[11px] text-muted-foreground">
          {selected.filter((k) => k !== "other").length} / {maxSelections} dipilih
          {isAtMax && " — batas tercapai"}
        </p>
      )}

      {/* Confirm button for multi-select */}
      {isMulti && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selected.length === 0 || (hasOtherSelected && !customText.trim() && selected.length === 1)}
            aria-label="Konfirmasi pilihan dan lanjut"
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              "disabled:opacity-40 disabled:pointer-events-none",
              "min-h-[40px]",
            )}
          >
            Lanjut
          </button>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onSelectionChange([])}
              className="px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Batal pilih
            </button>
          )}
        </div>
      )}
    </div>
  );
});

AssistantQuickReplies.displayName = "AssistantQuickReplies";
