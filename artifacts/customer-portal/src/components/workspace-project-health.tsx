import { motion } from "framer-motion";
import { TrendingUp, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import type { WorkspaceProjectDetail, WorkspaceProject } from "@/hooks/use-workspace";

type HealthProps = {
  overview: WorkspaceProject;
  timeline: WorkspaceProjectDetail["timeline"];
  reviews: WorkspaceProjectDetail["reviews"];
  deliverables: WorkspaceProjectDetail["deliverables"];
};

function HealthBar({
  value,
  colorFrom,
  colorTo,
  delay = 0,
}: {
  value: number;
  colorFrom: string;
  colorTo: string;
  delay?: number;
}) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${colorFrom}, ${colorTo})` }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        transition={{ delay, duration: 0.85, ease: "easeOut" }}
      />
    </div>
  );
}

export function WorkspaceProjectHealth({
  overview,
  timeline,
  reviews,
  deliverables,
}: HealthProps) {
  const progress = overview.progressPercent ?? 0;
  const completedStages = timeline.filter((s) => s.completed).length;
  const totalStages = timeline.length;
  const stageProgress = totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0;

  const pendingReviews = reviews.filter(
    (r) => r.status === "pending" || r.status === "shared"
  ).length;
  const approvedReviews = reviews.filter((r) => r.status === "approved").length;

  const unlockedFiles = deliverables.filter((d) => !d.locked).length;
  const totalFiles = deliverables.length;

  const isBlocked =
    (overview.currentStage === "review" || overview.currentStage === "waiting_review") &&
    pendingReviews > 0;

  const riskLevel =
    isBlocked ? "High"
    : pendingReviews > 0 ? "Medium"
    : "Low";

  const riskColor =
    riskLevel === "High" ? "#EF4444"
    : riskLevel === "Medium" ? "#F59E0B"
    : "#10B981";

  const stats = [
    {
      label: "Pending Review",
      value: pendingReviews,
      icon: Clock,
      accent: pendingReviews > 0 ? "#F59E0B" : "#10B981",
    },
    {
      label: "Approved",
      value: approvedReviews,
      icon: CheckCircle2,
      accent: "#10B981",
    },
    {
      label: "Files Ready",
      value: `${unlockedFiles}/${totalFiles}`,
      icon: TrendingUp,
      accent: unlockedFiles === totalFiles && totalFiles > 0 ? "#10B981" : "#3B82F6",
    },
    {
      label: "Risk",
      value: riskLevel,
      icon: AlertTriangle,
      accent: riskColor,
    },
  ];

  return (
    <div>
      <h3 className="text-[13px] font-semibold text-white/80 uppercase tracking-wide mb-3">
        Project Health
      </h3>

      <div className="space-y-3 mb-4">
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[11px]" style={{ color: "#64748B" }}>Overall Progress</span>
            <span className="text-[12px] font-semibold text-slate-300">{progress}%</span>
          </div>
          <HealthBar value={progress} colorFrom="#F97316" colorTo="#F59E0B" delay={0} />
        </div>

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[11px]" style={{ color: "#64748B" }}>
              Stages Complete ({completedStages}/{totalStages})
            </span>
            <span className="text-[12px] font-semibold text-slate-300">{stageProgress}%</span>
          </div>
          <HealthBar value={stageProgress} colorFrom="#3B82F6" colorTo="#8B5CF6" delay={0.1} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {stats.map(({ label, value, icon: Icon, accent }) => (
          <div
            key={label}
            className="rounded-xl p-3"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className="w-3 h-3" style={{ color: accent }} />
              <span className="text-[10px]" style={{ color: "#64748B" }}>{label}</span>
            </div>
            <p className="text-[13px] font-semibold" style={{ color: accent }}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
