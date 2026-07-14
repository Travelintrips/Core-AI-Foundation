import { memo, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectionOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  badge?: string;
}

interface SelectionCardProps {
  options: SelectionOption[];
  value: string;
  onChange: (value: string) => void;
  columns?: 2 | 3 | 4 | 5;
  disabled?: boolean;
  className?: string;
}

const colClass: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 md:grid-cols-5",
};

export const SelectionCard = memo(function SelectionCard({
  options,
  value,
  onChange,
  columns = 3,
  disabled,
  className,
}: SelectionCardProps) {
  const handleKey = useCallback(
    (e: React.KeyboardEvent, val: string) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!disabled) onChange(val);
      }
    },
    [disabled, onChange],
  );

  const gridCols = colClass[columns] ?? colClass[3];

  return (
    <div
      role="radiogroup"
      className={cn("grid gap-3", gridCols, className)}
    >
      {options.map((opt) => {
        const isSelected = value === opt.value;

        return (
          <motion.button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.value)}
            onKeyDown={(e) => handleKey(e, opt.value)}
            whileHover={!disabled ? { scale: 1.02, y: -1 } : undefined}
            whileTap={!disabled ? { scale: 0.98 } : undefined}
            transition={{ duration: 0.18 }}
            className={cn(
              "relative flex flex-col items-start p-4 rounded-2xl border text-left",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "transition-all duration-200 cursor-pointer select-none",
              isSelected
                ? [
                    "border-primary bg-primary/10",
                    "shadow-[0_0_20px_-4px_rgba(124,110,250,0.5),inset_0_0_0_1px_rgba(124,110,250,0.3)]",
                  ]
                : "border-border/60 bg-card hover:border-primary/30 hover:bg-primary/5",
              disabled && "opacity-40 cursor-not-allowed",
            )}
          >
            {/* Selected badge */}
            {isSelected && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center"
              >
                <Check className="w-3 h-3 text-primary-foreground" />
              </motion.span>
            )}

            {opt.icon && (
              <span className="text-2xl mb-2 leading-none">{opt.icon}</span>
            )}
            <span
              className={cn(
                "text-sm font-semibold leading-tight",
                isSelected ? "text-primary" : "text-foreground",
              )}
            >
              {opt.label}
            </span>
            {opt.description && (
              <span className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {opt.description}
              </span>
            )}
            {opt.badge && (
              <span className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20 uppercase tracking-wide">
                {opt.badge}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
});

SelectionCard.displayName = "SelectionCard";
