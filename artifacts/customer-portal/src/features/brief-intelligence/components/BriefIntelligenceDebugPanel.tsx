/**
 * Development-only debug panel for the Brief Intelligence engine.
 *
 * Render conditions (both must be true):
 *   1. import.meta.env.DEV — never included in production builds
 *   2. URL has ?briefDebug=1 query param
 *
 * This file is intentionally never imported in production code paths.
 * Tree-shaking will eliminate it from production bundles.
 */

import { memo, useState } from "react";
import { Bug, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BriefIntelligenceResult } from "../types";

interface BriefIntelligenceDebugPanelProps {
  result: BriefIntelligenceResult;
  className?: string;
}

/** Returns true only in development AND when ?briefDebug=1 is present. */
export function isBriefDebugEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return new URLSearchParams(window.location.search).get("briefDebug") === "1";
  } catch {
    return false;
  }
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex gap-2 text-[11px]">
    <span className="text-muted-foreground shrink-0 w-44">{label}</span>
    <span className="font-mono text-foreground break-all">{value}</span>
  </div>
);

/**
 * Debug panel — only call this component when `isBriefDebugEnabled()` is true.
 * It defaults to collapsed to avoid visual noise during development.
 */
export const BriefIntelligenceDebugPanel = memo(function BriefIntelligenceDebugPanel({
  result,
  className,
}: BriefIntelligenceDebugPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-500/40 bg-amber-500/5 text-xs overflow-hidden",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-amber-600 hover:bg-amber-500/10 transition-colors"
      >
        <Bug className="w-3.5 h-3.5 shrink-0" />
        <span className="font-semibold text-[11px]">Brief Intelligence Debug</span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 ml-auto transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-amber-500/30 pt-2">
          <Row label="Engine version" value={result.engineVersion} />
          <Row label="Industry match type" value={result.debug.industryMatchType ?? "—"} />
          <Row label="Matched industry key" value={result.debug.matchedIndustryProfileKey ?? "—"} />
          <Row label="Matched service key" value={result.debug.matchedServiceProfileKey} />
          <Row label="Fallback used" value={String(result.usedFallbackIndustry)} />
          <Row label="Completeness" value={`${result.completeness}%`} />
          <Row label="Applied rule sources" value={result.debug.appliedRuleSources.join(", ") || "—"} />

          {result.warnings.length > 0 && (
            <div className="mt-2 pt-2 border-t border-amber-500/20">
              <p className="text-[11px] font-semibold text-amber-600 mb-1">
                Conflict warnings ({result.warnings.length})
              </p>
              {result.warnings.map((w) => (
                <div key={w.code} className="text-[11px] text-muted-foreground">
                  [{w.severity}] <span className="font-mono">{w.code}</span>
                  {" — "}keys: {w.affectedKeys.join(", ")}
                </div>
              ))}
            </div>
          )}

          {result.categories.map((cat) => (
            <div key={cat.category} className="mt-2 pt-2 border-t border-amber-500/20">
              <p className="text-[11px] font-semibold text-amber-600 mb-1">
                {cat.category} ({cat.items.length} items)
              </p>
              {cat.items.map((item) => (
                <div key={item.key} className="text-[11px] text-muted-foreground">
                  <span className="font-mono">{item.key}</span>
                  {" "}score={item.score.toFixed(1)} confidence={item.confidence}
                  {" "}sources=[{item.sources.join(",")}]
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

BriefIntelligenceDebugPanel.displayName = "BriefIntelligenceDebugPanel";
