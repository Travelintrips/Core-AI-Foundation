/**
 * ConfidenceBar — Team 5 Brand Intelligence 2.0
 * Renders a colour-coded progress bar for a 0–1 confidence score.
 */
interface ConfidenceBarProps {
  score: number; // 0–1
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function ConfidenceBar({ score, showLabel = true, size = "md" }: ConfidenceBarProps) {
  const pct = Math.round(score * 100);

  const color =
    score >= 0.7
      ? "bg-emerald-500"
      : score >= 0.4
      ? "bg-amber-500"
      : "bg-red-500";

  const label =
    score >= 0.7 ? "High" : score >= 0.4 ? "Medium" : "Low";

  const height = size === "sm" ? "h-1.5" : "h-2.5";

  return (
    <div className="flex items-center gap-2 w-full">
      <div className={`flex-1 bg-muted rounded-full overflow-hidden ${height}`}>
        <div
          className={`${height} ${color} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-muted-foreground w-24 text-right shrink-0">
          {label} ({pct}%)
        </span>
      )}
    </div>
  );
}
