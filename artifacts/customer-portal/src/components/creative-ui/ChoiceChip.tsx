import { memo, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChipOption {
  value: string;
  label: string;
  icon?: string;
  disabled?: boolean;
}

// ── Single-select variant ────────────────────────────────────────────────────

interface ChoiceChipProps {
  options: ChipOption[] | string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

function normalizeOptions(options: ChipOption[] | string[]): ChipOption[] {
  return options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

export const ChoiceChip = memo(function ChoiceChip({
  options,
  value,
  onChange,
  disabled,
  loading,
  className,
}: ChoiceChipProps) {
  const normalized = useMemo(() => normalizeOptions(options), [options]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent, val: string) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!disabled) onChange(val);
      }
    },
    [disabled, onChange],
  );

  return (
    <div
      role="radiogroup"
      className={cn("flex flex-wrap gap-2", className)}
    >
      {normalized.map((opt) => {
        const isSelected = value === opt.value;
        const isDisabled = disabled || loading || opt.disabled;

        return (
          <motion.button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-disabled={isDisabled}
            disabled={isDisabled}
            onClick={() => !isDisabled && onChange(opt.value)}
            onKeyDown={(e) => handleKey(e, opt.value)}
            whileHover={!isDisabled ? { scale: 1.03 } : undefined}
            whileTap={!isDisabled ? { scale: 0.97 } : undefined}
            transition={{ duration: 0.15 }}
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-sm font-medium transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "min-h-[36px] select-none",
              isSelected
                ? "bg-primary/15 border-primary text-primary shadow-[0_0_12px_-2px_rgba(124,110,250,0.4)]"
                : "bg-card border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-primary/5",
              isDisabled && "opacity-40 cursor-not-allowed pointer-events-none",
            )}
          >
            {opt.icon && <span className="text-base leading-none">{opt.icon}</span>}
            {opt.label}
            {isSelected && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Check className="w-3.5 h-3.5 shrink-0" />
              </motion.span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
});

ChoiceChip.displayName = "ChoiceChip";

// ── Multi-select variant ─────────────────────────────────────────────────────

interface MultiChoiceChipProps {
  options: ChipOption[] | string[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  max?: number;
}

export const MultiChoiceChip = memo(function MultiChoiceChip({
  options,
  value,
  onChange,
  disabled,
  loading,
  className,
  max,
}: MultiChoiceChipProps) {
  const normalized = useMemo(() => normalizeOptions(options), [options]);

  const toggle = useCallback(
    (val: string) => {
      if (disabled || loading) return;
      if (value.includes(val)) {
        onChange(value.filter((v) => v !== val));
      } else {
        if (max && value.length >= max) return;
        onChange([...value, val]);
      }
    },
    [value, onChange, disabled, loading, max],
  );

  return (
    <div
      role="group"
      className={cn("flex flex-wrap gap-2", className)}
    >
      {normalized.map((opt) => {
        const isSelected = value.includes(opt.value);
        const isDisabled = disabled || loading || opt.disabled || (!!max && value.length >= max && !isSelected);

        return (
          <motion.button
            key={opt.value}
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            aria-disabled={isDisabled}
            disabled={isDisabled && !isSelected}
            onClick={() => toggle(opt.value)}
            whileHover={!isDisabled ? { scale: 1.03 } : undefined}
            whileTap={!isDisabled ? { scale: 0.97 } : undefined}
            transition={{ duration: 0.15 }}
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-sm font-medium transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "min-h-[36px] select-none",
              isSelected
                ? "bg-primary/15 border-primary text-primary shadow-[0_0_12px_-2px_rgba(124,110,250,0.4)]"
                : "bg-card border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-primary/5",
              isDisabled && !isSelected && "opacity-40 cursor-not-allowed",
            )}
          >
            {opt.icon && <span className="text-base leading-none">{opt.icon}</span>}
            {opt.label}
            {isSelected && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.15 }}
              >
                <Check className="w-3.5 h-3.5 shrink-0" />
              </motion.span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
});

MultiChoiceChip.displayName = "MultiChoiceChip";
