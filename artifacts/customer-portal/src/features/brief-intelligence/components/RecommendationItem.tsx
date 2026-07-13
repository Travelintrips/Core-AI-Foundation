import { memo } from "react";
import { Plus, Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { BriefRecommendation } from "../types";
import { RecommendationReason } from "./RecommendationReason";

interface RecommendationItemProps {
  recommendation: BriefRecommendation;
  applied?: boolean;
  skippedReason?: string;
  onUse: () => void;
}

const CONFIDENCE_DOT: Record<string, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-muted-foreground/40",
};

/** A single recommended value (e.g. style="Minimalis") with an inline
 *  "Gunakan" action. Human-friendly only — no raw scores rendered. */
export const RecommendationItem = memo(function RecommendationItem({
  recommendation,
  applied,
  skippedReason,
  onUse,
}: RecommendationItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "rounded-xl border px-3 py-2.5 transition-colors",
        applied ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/50 bg-card/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn("w-1.5 h-1.5 rounded-full shrink-0", CONFIDENCE_DOT[recommendation.confidence])}
            aria-hidden
          />
          <span className="text-sm font-medium text-foreground truncate">{recommendation.label}</span>
        </div>

        {applied ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500 shrink-0">
            <Check className="w-3.5 h-3.5" /> Digunakan
          </span>
        ) : (
          <button
            type="button"
            onClick={onUse}
            aria-label={`Gunakan rekomendasi ${recommendation.label}`}
            className={cn(
              "inline-flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-lg border border-border/60",
              "text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5",
              "transition-all duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            )}
          >
            <Plus className="w-3 h-3" /> Gunakan
          </button>
        )}
      </div>

      <RecommendationReason recommendation={recommendation} className="mt-1.5 pl-3.5" />

      {skippedReason && !applied && (
        <p className="mt-1.5 pl-3.5 text-[11px] text-muted-foreground/70 italic">{skippedReason}</p>
      )}
    </motion.div>
  );
});

RecommendationItem.displayName = "RecommendationItem";
