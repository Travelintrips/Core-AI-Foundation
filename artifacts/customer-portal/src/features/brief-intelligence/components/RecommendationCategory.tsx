import { memo } from "react";
import { cn } from "@/lib/utils";
import type { BriefRecommendation, RecommendationCategory as CategoryKey } from "../types";
import { RecommendationItem } from "./RecommendationItem";

interface RecommendationCategoryProps {
  category: CategoryKey;
  label: string;
  items: BriefRecommendation[];
  isAppliable: boolean;
  appliedKeys: string[];
  skippedByKey: Record<string, string>;
  onUseItem: (item: BriefRecommendation) => void;
  onUseCategory: () => void;
  className?: string;
}

/** One recommendation category block (e.g. "Gaya Visual") with a
 *  "Gunakan semua" batch action plus each individual item. */
export const RecommendationCategory = memo(function RecommendationCategory({
  category,
  label,
  items,
  isAppliable,
  appliedKeys,
  skippedByKey,
  onUseItem,
  onUseCategory,
  className,
}: RecommendationCategoryProps) {
  if (items.length === 0) return null;
  const allApplied = items.every((i) => appliedKeys.includes(i.key));

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">{label}</h4>
        {isAppliable && items.length > 1 && !allApplied && (
          <button
            type="button"
            onClick={onUseCategory}
            className="text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
          >
            Gunakan kategori ini
          </button>
        )}
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <RecommendationItem
            key={item.key}
            recommendation={item}
            applied={appliedKeys.includes(item.key)}
            skippedReason={skippedByKey[item.key]}
            onUse={() => onUseItem(item)}
          />
        ))}
      </div>
    </div>
  );
});

RecommendationCategory.displayName = "RecommendationCategory";
