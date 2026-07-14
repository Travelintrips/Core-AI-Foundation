import { memo } from "react";
import { motion } from "framer-motion";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

export interface SummaryRow {
  label: string;
  value?: string | null;
  emptyLabel?: string;
}

export interface SummarySection {
  heading: string;
  step?: number;
  icon?: LucideIcon;
  rows: SummaryRow[];
}

interface SummaryCardProps {
  sections: SummarySection[];
  onEditStep?: (step: number) => void;
  className?: string;
}

/**
 * Read-only review card that displays a structured summary of all brief sections.
 * Each section can link back to its step via onEditStep.
 */
export const SummaryCard = memo(function SummaryCard({
  sections,
  onEditStep,
  className,
}: SummaryCardProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {sections.map((section, si) => {
        const Icon = section.icon;
        return (
          <motion.div
            key={section.heading}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: si * 0.05 }}
            className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden"
          >
            {/* Section header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/30 bg-surface-1/50">
              <div className="flex items-center gap-2">
                {Icon && (
                  <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                  </div>
                )}
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {section.heading}
                </h3>
              </div>
              {onEditStep && section.step != null && (
                <button
                  type="button"
                  onClick={() => onEditStep(section.step!)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-md px-1.5 py-0.5"
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
              )}
            </div>

            {/* Rows */}
            <div className="divide-y divide-border/20">
              {section.rows.map((row) => {
                const hasValue = row.value?.trim();
                return (
                  <div
                    key={row.label}
                    className="flex gap-4 px-5 py-3"
                  >
                    <span className="text-xs font-medium text-muted-foreground shrink-0 w-32 pt-0.5">
                      {row.label}
                    </span>
                    <span
                      className={cn(
                        "text-sm flex-1 min-w-0 break-words",
                        hasValue ? "text-foreground" : "text-muted-foreground/50 italic",
                      )}
                    >
                      {hasValue ? row.value : (row.emptyLabel ?? "Tidak diisi")}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
});

SummaryCard.displayName = "SummaryCard";
