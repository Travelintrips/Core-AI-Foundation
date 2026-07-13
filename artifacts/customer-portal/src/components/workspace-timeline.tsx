import { motion } from "framer-motion";
import { CheckCircle2, Circle, GitBranch } from "lucide-react";

type TimelineStep = {
  stage: string;
  label: string;
  completed: boolean;
  current: boolean;
};

export function WorkspaceProjectTimeline({ steps }: { steps: TimelineStep[] }) {
  if (!steps.length) {
    return (
      <p className="text-[12px] text-center py-6" style={{ color: "#475569" }}>
        No timeline data.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <GitBranch className="w-3.5 h-3.5 text-white/50" />
        <h3 className="text-[13px] font-semibold text-white/80 uppercase tracking-wide">
          Project Timeline
        </h3>
      </div>

      <div className="relative">
        {/* Vertical connector line */}
        <div
          className="absolute left-[17px] top-5 bottom-4 w-px"
          style={{
            background:
              "linear-gradient(to bottom, rgba(249,115,22,0.5) 0%, rgba(255,255,255,0.08) 100%)",
          }}
        />

        <ol className="space-y-0.5">
          {steps.map((step, i) => (
            <motion.li
              key={step.stage}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.055, duration: 0.3 }}
              className="flex items-center gap-3"
            >
              {/* Step node */}
              <div className="relative z-10 w-[34px] h-[34px] shrink-0 flex items-center justify-center">
                {step.completed ? (
                  <div
                    className="w-[34px] h-[34px] rounded-full flex items-center justify-center"
                    style={{
                      background: "rgba(16,185,129,0.12)",
                      border: "1px solid rgba(16,185,129,0.3)",
                    }}
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </div>
                ) : step.current ? (
                  <div className="relative w-[34px] h-[34px] flex items-center justify-center">
                    {/* Outer pulse ring */}
                    <motion.div
                      className="absolute inset-0 rounded-full"
                      style={{ border: "1px solid #F97316" }}
                      animate={{ scale: [1, 1.35, 1], opacity: [0.7, 0, 0.7] }}
                      transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
                    />
                    <div
                      className="w-[34px] h-[34px] rounded-full flex items-center justify-center"
                      style={{
                        background: "rgba(249,115,22,0.15)",
                        border: "1px solid rgba(249,115,22,0.5)",
                      }}
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: "#F97316" }}
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    className="w-[34px] h-[34px] rounded-full flex items-center justify-center"
                    style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    <Circle className="w-3 h-3" style={{ color: "#334155" }} />
                  </div>
                )}
              </div>

              {/* Label */}
              <div className="py-1.5">
                <p
                  className="text-[12px] font-medium leading-tight"
                  style={{
                    color: step.current
                      ? "#FB923C"
                      : step.completed
                      ? "#CBD5E1"
                      : "#334155",
                  }}
                >
                  {step.label}
                </p>
                {step.current && (
                  <p className="text-[10px] mt-0.5" style={{ color: "rgba(251,146,60,0.6)" }}>
                    In progress
                  </p>
                )}
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </div>
  );
}
