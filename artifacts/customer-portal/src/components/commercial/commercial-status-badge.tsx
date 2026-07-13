import { cn } from "@/lib/utils";

export type CommercialTone = "neutral" | "info" | "warning" | "success" | "danger";

const TONE_CLASSES: Record<CommercialTone, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200/60 dark:border-blue-900/40",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200/60 dark:border-amber-900/40",
  success: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200/60 dark:border-green-900/40",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
};

/**
 * Generic status pill for the commercial/quotation/checkout flow.
 *
 * Deliberately does NOT own its own status→label mapping: each page keeps
 * its existing, backend-status-derived label map (STATUS_LABEL, TERMINAL,
 * etc. — see request-pricing.tsx / request-quotation.tsx) and only passes
 * the resulting label + a semantic tone here. This keeps a single source of
 * truth for "what backend status means what" while still giving every
 * commercial page the same pill look & feel.
 */
export function CommercialStatusBadge({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: CommercialTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", tone === "neutral" ? "bg-muted-foreground/50" : "bg-current")} />
      {label}
    </span>
  );
}
