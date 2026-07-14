import { memo } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BriefRecommendation } from "../types";
import { explainRecommendation } from "../recommendation-explanations";

interface RecommendationReasonProps {
  recommendation: BriefRecommendation;
  className?: string;
}

/** Renders the 2-3 human-friendly reasons behind a recommendation. Never
 *  shows raw scores/sources — those are debug-only (see debug view). */
export const RecommendationReason = memo(function RecommendationReason({
  recommendation,
  className,
}: RecommendationReasonProps) {
  const reasons = explainRecommendation(recommendation);
  if (reasons.length === 0) return null;

  return (
    <ul className={cn("space-y-1", className)}>
      {reasons.map((text, idx) => (
        <li key={idx} className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-snug">
          <Info className="w-3 h-3 mt-0.5 shrink-0 opacity-50" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
});

RecommendationReason.displayName = "RecommendationReason";
