import { cn } from "@/lib/utils";

/**
 * Static quick-fill suggestions for brief fields. These are NOT AI-generated —
 * they are curated UX helpers. Labelled "Quick suggestions" / "Suggested options"
 * per product rule: never imply an AI analysis that doesn't exist.
 */
export function GuidedChips({
  options,
  onSelect,
  label = "Quick suggestions",
  labelClassName,
  chipClassName,
  className,
}: {
  options: string[];
  onSelect: (value: string) => void;
  label?: string;
  labelClassName?: string;
  chipClassName?: string;
  className?: string;
}) {
  if (!options.length) return null;
  return (
    <div className={cn("mt-2", className)}>
      <p className={cn("text-[11px] font-medium text-muted-foreground mb-1.5", labelClassName)}>{label}</p>
      <div className="flex flex-wrap gap-1.5 overflow-x-auto -mx-0.5 px-0.5 pb-0.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors min-h-[32px] focus-visible:outline-none focus-visible:ring-2",
              chipClassName ??
                "border-border text-foreground/80 hover:border-primary hover:text-primary hover:bg-primary/5 focus-visible:ring-primary/40",
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
