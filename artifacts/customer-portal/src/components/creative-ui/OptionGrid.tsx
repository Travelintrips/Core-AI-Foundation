import { memo, useCallback } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GridOption {
  value: string;
  label: string;
  icon?: string;
  description?: string;
}

interface OptionGridProps {
  options: GridOption[];
  value: string | string[];
  multiple?: boolean;
  onChange: (value: string | string[]) => void;
  columns?: 2 | 3 | 4;
  disabled?: boolean;
  className?: string;
}

const colClass: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

/**
 * Compact grid of selectable option tiles.
 * Simpler than SelectionCard — optimised for 6–12 options in a tight grid.
 */
export const OptionGrid = memo(function OptionGrid({
  options,
  value,
  multiple,
  onChange,
  columns = 3,
  disabled,
  className,
}: OptionGridProps) {
  const isSelected = useCallback(
    (val: string) =>
      Array.isArray(value) ? value.includes(val) : value === val,
    [value],
  );

  const handleToggle = useCallback(
    (val: string) => {
      if (disabled) return;
      if (!multiple) {
        onChange(val);
        return;
      }
      const arr = Array.isArray(value) ? value : [value].filter(Boolean);
      if (arr.includes(val)) {
        onChange(arr.filter((v) => v !== val));
      } else {
        onChange([...arr, val]);
      }
    },
    [value, multiple, onChange, disabled],
  );

  const gridCols = colClass[columns] ?? colClass[3];

  return (
    <div
      role={multiple ? "group" : "radiogroup"}
      className={cn("grid gap-2", gridCols, className)}
    >
      {options.map((opt) => {
        const sel = isSelected(opt.value);
        return (
          <motion.button
            key={opt.value}
            type="button"
            role={multiple ? "checkbox" : "radio"}
            aria-checked={sel}
            disabled={disabled}
            onClick={() => handleToggle(opt.value)}
            whileHover={!disabled ? { scale: 1.02 } : undefined}
            whileTap={!disabled ? { scale: 0.96 } : undefined}
            transition={{ duration: 0.15 }}
            className={cn(
              "relative flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border text-center",
              "transition-all duration-200 cursor-pointer select-none min-h-[72px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              sel
                ? "bg-primary/12 border-primary text-primary shadow-[0_0_16px_-4px_rgba(124,110,250,0.45)]"
                : "bg-card border-border/60 text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-foreground",
              disabled && "opacity-40 cursor-not-allowed",
            )}
          >
            {sel && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center"
              >
                <Check className="w-2.5 h-2.5 text-primary-foreground" />
              </motion.span>
            )}
            {opt.icon && (
              <span className="text-xl leading-none">{opt.icon}</span>
            )}
            <span className="text-xs font-semibold leading-tight">{opt.label}</span>
            {opt.description && (
              <span className="text-[10px] leading-snug opacity-70">{opt.description}</span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
});

OptionGrid.displayName = "OptionGrid";
