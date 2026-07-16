import { memo, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/creative-ui";
import type { BriefData } from "@/pages/brief";
import type { ServiceType } from "@/config/brief-service-config";
import { buildBriefIntelligenceContext } from "../context-adapter";
import { computeBriefRecommendations } from "../engine";
import { applyRecommendations, isFreeTextCategoryFilled } from "../apply-adapter";
import { APPLIABLE_CATEGORIES } from "../types";
import type { ApplySkip, BriefRecommendation, RecommendationCategory } from "../types";
import { RecommendationCategory as RecommendationCategoryBlock } from "./RecommendationCategory";
import { RecommendationSummary } from "./RecommendationSummary";
import { RecommendationWarning } from "./RecommendationWarning";
import { BriefIntelligenceDebugPanel, isBriefDebugEnabled } from "./BriefIntelligenceDebugPanel";

const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  style: "Gaya Visual",
  color: "Palet Warna",
  audience: "Target Audiens",
  personality: "Kepribadian Brand",
  deliverable: "Format Output",
  toneOfVoice: "Tone of Voice",
  photographyDirection: "Arahan Fotografi",
  visualDirection: "Arahan Visual",
  contentDirection: "Arahan Konten",
};

interface BriefRecommendationPanelProps {
  brief: BriefData;
  serviceName: string | null | undefined;
  onApply: (updated: BriefData) => void;
  className?: string;
}

/**
 * Deterministic, rule-based recommendation panel for the brief wizard.
 * Recomputes on every render from live brief state (cheap, pure function —
 * no memoization risk of staleness). Never calls an API; every action here
 * only updates local BriefData, which continues to flow through the
 * wizard's existing autosave path unchanged.
 */
export const BriefRecommendationPanel = memo(function BriefRecommendationPanel({
  brief,
  serviceName,
  onApply,
  className,
}: BriefRecommendationPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [appliedKeys, setAppliedKeys] = useState<Record<string, string[]>>({});
  const [skippedByCategory, setSkippedByCategory] = useState<Record<string, Record<string, string>>>({});

  const context = useMemo(
    () => buildBriefIntelligenceContext({ brief, serviceName }),
    // Recompute only when the fields the engine actually reads change.
    [
      brief.companyIndustry, brief.companySize, brief.primaryGoal, brief.audienceDemographics,
      brief.existingAssets, brief.priority, brief.stylePreference, brief.colorPalette, serviceName,
    ],
  );

  const result = useMemo(() => computeBriefRecommendations(context), [context]);

  // Free-text categories (Kepribadian Brand, Tone of Voice, Arahan Fotografi/
  // Visual/Konten, Format Output) always no-op when their target field is
  // already filled in — see isFreeTextCategoryFilled. Hide those items
  // entirely rather than showing a "Gunakan" button that silently does
  // nothing when clicked.
  const visibleCategories = useMemo(
    () => result.categories
      .map((cat) => (
        isFreeTextCategoryFilled(brief, cat.category) ? { ...cat, items: [] } : cat
      ))
      .filter((cat) => cat.items.length > 0),
    [result, brief.outputFormats, brief.specialRequirements],
  );

  if (!result.hasEnoughContext) return null;
  if (visibleCategories.length === 0) return null;

  const runApply = (
    mode: "apply-single" | "apply-category" | "apply-all-empty-only",
    target: { category?: RecommendationCategory; key?: string },
    allItems: BriefRecommendation[],
  ) => {
    const { updatedBrief, applied, skipped } = applyRecommendations(brief, allItems, mode, target);
    if (applied.length > 0) onApply(updatedBrief);

    setAppliedKeys((prev) => {
      const next = { ...prev };
      for (const a of applied) {
        next[a.category] = Array.from(new Set([...(next[a.category] ?? []), a.key]));
      }
      return next;
    });
    setSkippedByCategory((prev) => {
      const next = { ...prev };
      for (const s of skipped as ApplySkip[]) {
        if (!s.key) continue;
        next[s.category] = { ...(next[s.category] ?? {}), [s.key]: s.reason };
      }
      return next;
    });
  };

  const allItems = visibleCategories.flatMap((c) => c.items);

  return (
    <SectionCard
      className={cn("border-primary/25", className)}
      animate={false}
      title={undefined}
    >
      <div className="-m-6 -mb-1">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="w-full flex items-center justify-between gap-3 px-6 pt-6 pb-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-t-2xl"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 ring-1 ring-primary/20">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Rekomendasi untuk brief Anda</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Berdasarkan industri, layanan, dan tujuan yang Anda isi.</p>
            </div>
          </div>
          <ChevronDown className={cn("w-4 h-4 text-muted-foreground shrink-0 transition-transform", collapsed && "-rotate-90")} />
        </button>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-6 pb-6 space-y-5">
                <RecommendationSummary completeness={result.completeness} usedFallbackIndustry={result.usedFallbackIndustry} />
                <RecommendationWarning warnings={result.warnings} />
                {import.meta.env.DEV && isBriefDebugEnabled() && (
                  <BriefIntelligenceDebugPanel result={result} />
                )}

                {visibleCategories.map((cat) => (
                  <RecommendationCategoryBlock
                    key={cat.category}
                    category={cat.category}
                    label={CATEGORY_LABELS[cat.category]}
                    items={cat.items}
                    isAppliable={APPLIABLE_CATEGORIES.includes(cat.category)}
                    appliedKeys={appliedKeys[cat.category] ?? []}
                    skippedByKey={skippedByCategory[cat.category] ?? {}}
                    onUseItem={(item) => runApply("apply-single", { category: item.category, key: item.key }, allItems)}
                    onUseCategory={() => runApply("apply-category", { category: cat.category }, allItems)}
                  />
                ))}

                <div className="pt-1 border-t border-border/30">
                  <button
                    type="button"
                    onClick={() => runApply("apply-all-empty-only", {}, allItems)}
                    className={cn(
                      "mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg",
                      "text-xs font-medium border border-primary/30 text-primary hover:bg-primary/5",
                      "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    )}
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Terapkan ke field kosong
                  </button>
                  <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                    Pilihan yang sudah Anda isi tidak akan diganti.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </SectionCard>
  );
});

BriefRecommendationPanel.displayName = "BriefRecommendationPanel";
