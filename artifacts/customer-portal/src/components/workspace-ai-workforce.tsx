import { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Wand2, Brain, PenTool, Palette, ShieldCheck, Cpu, Zap } from "lucide-react";

/* ─── Worker metadata map ─────────────────────────────────────── */
type WorkerMeta = {
  gradFrom: string; gradTo: string;
  icon: React.ElementType; department: string;
  model: string; specialty: string;
  statusLabel: string; statusColor: string;
  confidence: number;
};

const WORKER_META: Record<string, WorkerMeta> = {
  "creative director": {
    gradFrom: "#8B5CF6", gradTo: "#7C3AED",
    icon: Wand2, department: "Creative Direction",
    model: "GPT-4o + Claude", specialty: "Brand Positioning",
    statusLabel: "Working", statusColor: "#10B981", confidence: 96,
  },
  "brand strategist": {
    gradFrom: "#3B82F6", gradTo: "#0EA5E9",
    icon: Brain, department: "Strategy",
    model: "Claude 3.5 Sonnet", specialty: "Market Strategy",
    statusLabel: "Thinking", statusColor: "#F59E0B", confidence: 82,
  },
  "copywriter": {
    gradFrom: "#F59E0B", gradTo: "#F97316",
    icon: PenTool, department: "Content",
    model: "GPT-4o", specialty: "Persuasive Copy",
    statusLabel: "Generating", statusColor: "#3B82F6", confidence: 74,
  },
  "senior copywriter": {
    gradFrom: "#F59E0B", gradTo: "#F97316",
    icon: PenTool, department: "Content",
    model: "GPT-4o", specialty: "Persuasive Copy",
    statusLabel: "Generating", statusColor: "#3B82F6", confidence: 74,
  },
  "visual designer": {
    gradFrom: "#10B981", gradTo: "#059669",
    icon: Palette, department: "Design",
    model: "DALL-E 3", specialty: "Visual Identity",
    statusLabel: "Rendering", statusColor: "#8B5CF6", confidence: 68,
  },
  "image designer": {
    gradFrom: "#10B981", gradTo: "#059669",
    icon: Palette, department: "Design",
    model: "DALL-E 3 + Flux", specialty: "Visual Identity",
    statusLabel: "Rendering", statusColor: "#8B5CF6", confidence: 68,
  },
  "human reviewer": {
    gradFrom: "#F43F5E", gradTo: "#E11D48",
    icon: ShieldCheck, department: "Quality Assurance",
    model: "Human Expert", specialty: "Quality Control",
    statusLabel: "Ready", statusColor: "#64748B", confidence: 100,
  },
};

const FALLBACK_META: WorkerMeta = {
  gradFrom: "#64748B", gradTo: "#475569",
  icon: Cpu, department: "AI Processing",
  model: "AI Model", specialty: "General Tasks",
  statusLabel: "Working", statusColor: "#10B981", confidence: 80,
};

const DEFAULT_TEAM = [
  "Creative Director AI",
  "Brand Strategist AI",
  "Senior Copywriter AI",
  "Visual Designer AI",
  "Human Reviewer",
];

function normKey(name: string) {
  return name.toLowerCase().replace(/\s+ai$/i, "").replace(/^senior\s+/i, "").trim();
}

function getMeta(name: string): WorkerMeta {
  const full = name.toLowerCase().replace(/\s+ai$/i, "").trim();
  return WORKER_META[full] ?? WORKER_META[normKey(name)] ?? FALLBACK_META;
}

/* ─── CountUp hook ────────────────────────────────────────────── */
function CountUp({ to, duration = 1000 }: { to: number; duration?: number }) {
  const [val, setVal] = useState(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    const start = performance.now();
    function tick(now: number) {
      const p = Math.min((now - start) / duration, 1);
      setVal(Math.round(p * to));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [to, duration]);
  return <>{val}</>;
}

/* ─── Main component ──────────────────────────────────────────── */
export function WorkspaceAiWorkforce({
  team,
  isDemoPlaceholder = false,
}: {
  team: string[];
  isDemoPlaceholder?: boolean;
}) {
  const displayTeam = team.length > 0 ? team : DEFAULT_TEAM;
  const isDemo = isDemoPlaceholder || team.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-white/80 uppercase tracking-wide">
          AI Workforce
        </h3>
        {isDemo && (
          <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: "rgba(245,158,11,0.15)", color: "#F59E0B", border: "1px solid rgba(245,158,11,0.25)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
            DEMO PREVIEW
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {displayTeam.map((name, i) => {
          const meta = getMeta(name);
          const Icon = meta.icon;
          return (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07, duration: 0.35 }}
              className="rounded-xl p-3.5"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `linear-gradient(135deg, ${meta.gradFrom}, ${meta.gradTo})` }}
                >
                  <Icon className="w-4 h-4 text-white" />
                </div>

                <div className="flex-1 min-w-0">
                  {/* Name + status */}
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="text-[12px] font-semibold text-white truncate">{name}</p>
                    <span className="flex items-center gap-1 shrink-0">
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ background: meta.statusColor }}
                      />
                      <span className="text-[11px] font-medium" style={{ color: meta.statusColor }}>
                        {meta.statusLabel}
                      </span>
                    </span>
                  </div>

                  {/* Subtitle */}
                  <p className="text-[10px] mb-2.5" style={{ color: "#64748B" }}>
                    {meta.department} · {meta.model}
                  </p>

                  {/* Confidence */}
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px]" style={{ color: "#475569" }}>Confidence</span>
                    <span className="text-[11px] font-semibold text-slate-300">
                      <CountUp to={meta.confidence} duration={800 + i * 80} />%
                    </span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(90deg, ${meta.gradFrom}, ${meta.gradTo})` }}
                      initial={{ width: 0 }}
                      animate={{ width: `${meta.confidence}%` }}
                      transition={{ delay: 0.2 + i * 0.07, duration: 0.85, ease: "easeOut" }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Compact "current AI task" card ─────────────────────────── */
export function CurrentAiTask({
  stageName,
  stageLabel,
  team,
  deliveryDate,
  filesCount,
  startedAt,
}: {
  stageName: string;
  stageLabel: string;
  team: string[];
  deliveryDate: string | null;
  filesCount: number;
  startedAt: string;
}) {
  const workerForStage = () => {
    const sl = stageName.toLowerCase();
    if (sl.includes("brief") || sl.includes("strategy")) return team[0] ?? "Creative Director AI";
    if (sl.includes("copy") || sl.includes("writ")) return team.find(t => /copy/i.test(t)) ?? team[1] ?? team[0];
    if (sl.includes("design") || sl.includes("visual") || sl.includes("render")) return team.find(t => /design|visual/i.test(t)) ?? team[0];
    if (sl.includes("review") || sl.includes("approv")) return team.find(t => /review|human/i.test(t)) ?? team[team.length - 1];
    return team[0] ?? "AI Team";
  };

  const worker = workerForStage();
  const meta = getMeta(worker);
  const Icon = meta.icon;

  const fmt = (d: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
    } catch { return "—"; }
  };

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "rgba(249,115,22,0.07)",
        border: "1px solid rgba(249,115,22,0.2)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-3.5 h-3.5 text-orange-400" />
        <span className="text-[11px] font-semibold text-orange-400 uppercase tracking-wide">Current Task</span>
      </div>

      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${meta.gradFrom}, ${meta.gradTo})` }}
        >
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
        <div>
          <p className="text-[12px] font-semibold text-white">{worker}</p>
          <p className="text-[10px]" style={{ color: "#64748B" }}>{meta.specialty}</p>
        </div>
        <span
          className="ml-auto flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{ background: "rgba(16,185,129,0.15)", color: "#10B981", border: "1px solid rgba(16,185,129,0.2)" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Active
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Stage", value: stageLabel },
          { label: "ETA", value: fmt(deliveryDate) },
          { label: "Started", value: fmt(startedAt) },
          { label: "Files", value: `${filesCount}` },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-[10px]" style={{ color: "#475569" }}>{label}</p>
            <p className="text-[12px] font-medium text-slate-300">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
