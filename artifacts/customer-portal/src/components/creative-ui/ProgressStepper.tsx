import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Step {
  id: number | string;
  title: string;
  key?: string;
}

interface ProgressStepperProps {
  steps: Step[];
  currentStep: number;
  /** Estimated total minutes for the whole form */
  estimatedMinutes?: number;
  className?: string;
}

/**
 * Modern multi-step progress indicator for Creative AI brief forms.
 * Shows step count, animated fill bar, percentage, and time estimate.
 */
export const ProgressStepper = memo(function ProgressStepper({
  steps,
  currentStep,
  estimatedMinutes = 5,
  className,
}: ProgressStepperProps) {
  const total = steps.length;

  const { percentage, minutesRemaining } = useMemo(() => {
    const pct = Math.round(((currentStep - 1) / (total - 1)) * 100);
    const remaining = Math.ceil(((total - currentStep) / (total - 1)) * estimatedMinutes);
    return { percentage: pct, minutesRemaining: remaining };
  }, [currentStep, total, estimatedMinutes]);

  return (
    <div className={cn("space-y-2", className)}>
      {/* Header row */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground/80 uppercase tracking-widest">
          Langkah {currentStep} / {total}
        </span>
        <span className="text-muted-foreground">
          {currentStep < total
            ? `Estimasi ${minutesRemaining} menit lagi`
            : "Langkah terakhir"}
        </span>
      </div>

      {/* Progress track */}
      <div
        className="relative h-2 rounded-full bg-surface-2 overflow-hidden"
        role="progressbar"
        aria-valuenow={currentStep}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={`Langkah ${currentStep} dari ${total}`}
      >
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 to-primary"
          initial={false}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        />
        {/* Shimmer */}
        <motion.div
          className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/20 to-transparent"
          animate={{ x: ["-4rem", "100vw"] }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear", repeatDelay: 1 }}
          style={{ left: `${percentage}%` }}
        />
      </div>

      {/* Percentage */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{percentage}% selesai</span>
        {/* Step dots */}
        <div className="flex gap-1">
          {steps.map((s) => {
            const sid = Number(s.id);
            const done = sid <= currentStep;
            const active = sid === currentStep;
            return (
              <motion.div
                key={s.id}
                animate={{
                  backgroundColor: active
                    ? "hsl(var(--primary))"
                    : done
                    ? "rgba(124, 110, 250, 0.5)"
                    : "hsl(var(--border))",
                  scale: active ? 1.3 : 1,
                }}
                transition={{ duration: 0.25 }}
                className="w-1.5 h-1.5 rounded-full"
              />
            );
          })}
        </div>

      </div>
    </div>
  );
});

ProgressStepper.displayName = "ProgressStepper";
