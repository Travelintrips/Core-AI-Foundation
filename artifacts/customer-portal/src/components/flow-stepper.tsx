import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export type FlowStep = {
  key: string;
  label: string;
};

/** Step keys — labels are derived from translations */
export const FLOW_STEP_KEYS = [
  "paket", "brief", "harga", "persetujuan", "verifikasi",
  "produksi", "review", "selesai",
] as const;

/** Build translated steps array. Call inside a component that has i18n context. */
export function useFlowSteps(): FlowStep[] {
  const { t } = useTranslation();
  return FLOW_STEP_KEYS.map((key) => ({
    key,
    label: t(`flowStepper.steps.${key}`),
  }));
}

/** Static fallback for components that render outside i18n context (rare) */
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
  currentStep: (typeof FLOW_STEP_KEYS)[number] | string;
  className?: string;
}

export function FlowStepper({ currentStep, className }: FlowStepperProps) {
  const { t } = useTranslation();
  const steps = useFlowSteps();
  const currentIndex = steps.findIndex((s) => s.key === currentStep);
  const currentLabel = steps[currentIndex]?.label ?? currentStep;

  return (
    <div className={cn("w-full", className)}>
      {currentIndex >= 0 && (
        <p className="sm:hidden text-center text-xs font-medium text-muted-foreground px-4 pt-3">
          {t('flowStepper.current', { step: currentIndex + 1, total: steps.length })}
          <span className="text-foreground">{currentLabel}</span>
        </p>
      )}
      <div className="w-full overflow-x-auto">
        <ol className="flex items-center min-w-max mx-auto px-4 py-4 gap-0">
          {steps.map((step, idx) => {
            const done = idx < currentIndex;
            const active = idx === currentIndex;

            return (
              <li key={step.key} className="flex items-center" aria-current={active ? "step" : undefined}>
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

                {idx < steps.length - 1 && (
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
