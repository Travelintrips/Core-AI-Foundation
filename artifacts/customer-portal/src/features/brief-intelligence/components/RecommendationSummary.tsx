import { memo } from "react";
import { cn } from "@/lib/utils";

interface RecommendationSummaryProps {
  completeness: number;
  usedFallbackIndustry: boolean;
  className?: string;
}

/** Small progress hint — shows how much context the engine had, so users
 *  understand why recommendations improve as they fill in more of the brief. */
export const RecommendationSummary = memo(function RecommendationSummary({
  completeness,
  usedFallbackIndustry,
  className,
}: RecommendationSummaryProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="flex-1 h-1.5 rounded-full bg-border/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/70 transition-all duration-300"
          style={{ width: `${completeness}%` }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground shrink-0">
        {completeness}% konteks
      </span>
      {usedFallbackIndustry && (
        <span className="text-[11px] text-amber-500 shrink-0">Industri belum spesifik</span>
      )}
    </div>
  );
});

RecommendationSummary.displayName = "RecommendationSummary";
