import { memo } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface SuggestionGroupProps {
  options: string[];
  onSelect: (value: string) => void;
  label?: string;
  className?: string;
}

/**
 * Quick-fill suggestion pills shown below a form field.
 * These are NOT AI-generated — they are curated UX helpers.
 * Clicking one fills the connected field; they don't have selected state.
 */
export const SuggestionGroup = memo(function SuggestionGroup({
  options,
  onSelect,
  label = "Saran cepat",
  className,
}: SuggestionGroupProps) {
  if (!options.length) return null;

  return (
    <div className={cn("mt-2.5", className)}>
      <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground/80 mb-2">
        <Sparkles className="w-3 h-3 opacity-60" />
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full border border-border/50 bg-surface-1",
              "text-xs font-medium text-muted-foreground",
              "hover:border-primary/40 hover:text-primary hover:bg-primary/5",
              "transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              "min-h-[30px]",
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
});

SuggestionGroup.displayName = "SuggestionGroup";
