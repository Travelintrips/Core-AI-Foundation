/**
 * DimensionCard — Team 5 Brand Intelligence 2.0
 * Generic card for a single brand intelligence dimension.
 */
import { ConfidenceBar } from "./ConfidenceBar.js";

interface DimensionCardProps {
  title: string;
  icon: string; // emoji or short text icon
  confidence: { score: number; evidence: string[]; gaps: string[] };
  children: React.ReactNode;
}

export function DimensionCard({ title, icon, confidence, children }: DimensionCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <h3 className="font-semibold text-sm text-foreground">{title}</h3>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            confidence.score >= 0.7
              ? "bg-emerald-500/15 text-emerald-600"
              : confidence.score >= 0.4
              ? "bg-amber-500/15 text-amber-600"
              : "bg-red-500/15 text-red-600"
          }`}
        >
          {confidence.score >= 0.7 ? "High" : confidence.score >= 0.4 ? "Medium" : "Low"} confidence
        </span>
      </div>

      {/* Confidence bar */}
      <ConfidenceBar score={confidence.score} size="sm" />

      {/* Content */}
      <div className="text-sm text-foreground/80">{children}</div>

      {/* Evidence / gaps */}
      {(confidence.evidence.length > 0 || confidence.gaps.length > 0) && (
        <div className="pt-2 border-t border-border flex flex-col gap-1.5">
          {confidence.evidence.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="text-emerald-600 font-medium">Evidence: </span>
              {confidence.evidence.join(", ")}
            </p>
          )}
          {confidence.gaps.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="text-amber-600 font-medium">Missing: </span>
              {confidence.gaps.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
