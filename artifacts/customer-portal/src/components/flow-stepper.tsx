import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type FlowStep = {
  key: string;
  label: string;
};

export const FLOW_STEPS: FlowStep[] = [
  { key: "paket",      label: "Paket" },
  { key: "brief",      label: "Brief" },
  { key: "harga",      label: "Harga" },
  { key: "persetujuan", label: "Persetujuan" },
  { key: "verifikasi", label: "Verifikasi Komersial" },
  { key: "produksi",   label: "Produksi" },
  { key: "review",     label: "Review" },
  { key: "selesai",    label: "Selesai" },
];

interface FlowStepperProps {
  currentStep: FlowStep["key"];
  className?: string;
}

export function FlowStepper({ currentStep, className }: FlowStepperProps) {
  const currentIndex = FLOW_STEPS.findIndex((s) => s.key === currentStep);
  const currentLabel = FLOW_STEPS[currentIndex]?.label ?? currentStep;

  return (
    <div className={cn("w-full", className)}>
      {/* Compact summary for narrow viewports — the dot rail below still scrolls
          horizontally, but this line always tells the customer where they are
          without requiring a scroll. */}
      {currentIndex >= 0 && (
        <p className="sm:hidden text-center text-xs font-medium text-muted-foreground px-4 pt-3">
          Langkah {currentIndex + 1} dari {FLOW_STEPS.length}: <span className="text-foreground">{currentLabel}</span>
        </p>
      )}
      <div className="w-full overflow-x-auto">
      <ol className="flex items-center min-w-max mx-auto px-4 py-4 gap-0">
        {FLOW_STEPS.map((step, idx) => {
          const done = idx < currentIndex;
          const active = idx === currentIndex;

          return (
            <li key={step.key} className="flex items-center" aria-current={active ? "step" : undefined}>
              {/* Step dot + label */}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors shrink-0",
                    done
                      ? "bg-primary border-primary text-primary-foreground"
                      : active
                      ? "bg-background border-primary text-primary"
                      : "bg-background border-border text-muted-foreground",
                  )}
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : <span>{idx + 1}</span>}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium whitespace-nowrap",
                    done
                      ? "text-primary"
                      : active
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line between steps */}
              {idx < FLOW_STEPS.length - 1 && (
                <div
                  className={cn(
                    "h-px w-8 md:w-12 shrink-0 mt-[-1rem]",
                    idx < currentIndex ? "bg-primary" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
      </div>
    </div>
  );
}
