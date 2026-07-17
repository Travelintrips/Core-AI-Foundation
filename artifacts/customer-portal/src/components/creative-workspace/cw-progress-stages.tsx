/**
 * cw-progress-stages.tsx — Production stage timeline component (Team 2).
 */
import { motion } from "framer-motion";
import { CheckCircle2, Circle, Loader2, AlertCircle, Clock } from "lucide-react";
import type { ProductionStage, StageStatus } from "@/hooks/creative-workspace";

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return null; }
}

const STATUS_ICON: Record<StageStatus, React.ReactNode> = {
  pending:   <Circle className="w-5 h-5 text-slate-500" />,
  working:   <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />,
  completed: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
  failed:    <AlertCircle className="w-5 h-5 text-red-400" />,
  blocked:   <Clock className="w-5 h-5 text-amber-400" />,
};

const STATUS_RING: Record<StageStatus, string> = {
  pending:   "border-slate-600 bg-slate-800",
  working:   "border-indigo-500 bg-indigo-500/10",
  completed: "border-emerald-500 bg-emerald-500/10",
  failed:    "border-red-500 bg-red-500/10",
  blocked:   "border-amber-500 bg-amber-500/10",
};

export function CWProgressStages({
  stages,
  progressPercent,
  overallStageLabel,
  estimatedDelivery,
  lastActivityAt,
}: {
  stages: ProductionStage[];
  progressPercent: number;
  overallStageLabel: string;
  estimatedDelivery: string | null;
  lastActivityAt: string | null;
}) {
  return (
    <div className="space-y-5">
      {/* Overall progress bar */}
      <div className="p-4 rounded-2xl border border-white/8 bg-white/3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-white">{overallStageLabel}</span>
          <span className="text-sm font-bold text-indigo-400">{progressPercent}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/8 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, #6366F1, #8B5CF6)" }}
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
          {estimatedDelivery && <span>Target: {fmtDate(estimatedDelivery)}</span>}
          {lastActivityAt && <span>Update: {fmtDate(lastActivityAt)}</span>}
        </div>
      </div>

      {/* Stage list */}
      {stages.length === 0 ? (
        <div className="text-center py-8 text-sm text-slate-500">
          Tahap produksi akan muncul saat proses dimulai.
        </div>
      ) : (
        <div className="relative">
          {/* Connector line */}
          <div className="absolute left-[22px] top-6 bottom-6 w-0.5 bg-white/8" />

          <div className="space-y-1">
            {stages.map((stage, i) => (
              <motion.div
                key={stage.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="relative flex gap-4 p-3 rounded-xl hover:bg-white/3 transition-colors"
              >
                {/* Status icon */}
                <div
                  className={`relative z-10 w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${STATUS_RING[stage.status]}`}
                >
                  {STATUS_ICON[stage.status]}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${stage.status === "completed" ? "text-slate-300 line-through" : "text-white"}`}>
                      {stage.name}
                    </span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                      stage.status === "working"   ? "bg-indigo-500/20 text-indigo-300" :
                      stage.status === "completed" ? "bg-emerald-500/20 text-emerald-300" :
                      stage.status === "failed"    ? "bg-red-500/20 text-red-300" :
                      stage.status === "blocked"   ? "bg-amber-500/20 text-amber-300" :
                      "bg-white/8 text-slate-400"
                    }`}>
                      {stage.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{stage.description}</p>
                  {(stage.startedAt || stage.completedAt) && (
                    <div className="flex gap-3 mt-1 text-[11px] text-slate-600">
                      {stage.startedAt && <span>Mulai: {fmtDate(stage.startedAt)}</span>}
                      {stage.completedAt && <span>Selesai: {fmtDate(stage.completedAt)}</span>}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
