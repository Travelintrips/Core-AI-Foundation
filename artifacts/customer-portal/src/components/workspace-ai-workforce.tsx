import { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Wand2, Brain, PenTool, Palette, ShieldCheck, Cpu, Zap, Radio, Layers, AlertTriangle } from "lucide-react";
import type { RuntimeSnapshot, RuntimeWorkerSnapshot, RuntimeWorkerStatus } from "@/hooks/use-workspace";

/* ─── Worker metadata map (display styling only — icon/gradient, never a fabricated metric) ─── */
type WorkerMeta = {
  gradFrom: string; gradTo: string;
  icon: React.ElementType; department: string;
  model: string; specialty: string;
};

const WORKER_META: Record<string, WorkerMeta> = {
  "creative director": {
    gradFrom: "#8B5CF6", gradTo: "#7C3AED",
    icon: Wand2, department: "Creative Direction",
    model: "GPT-4o + Claude", specialty: "Brand Positioning",
  },
  "brand strategist": {
    gradFrom: "#3B82F6", gradTo: "#0EA5E9",
    icon: Brain, department: "Strategy",
    model: "Claude 3.5 Sonnet", specialty: "Market Strategy",
  },
  "copywriter": {
    gradFrom: "#F59E0B", gradTo: "#F97316",
    icon: PenTool, department: "Content",
    model: "GPT-4o", specialty: "Persuasive Copy",
  },
  "senior copywriter": {
    gradFrom: "#F59E0B", gradTo: "#F97316",
    icon: PenTool, department: "Content",
    model: "GPT-4o", specialty: "Persuasive Copy",
  },
  "visual designer": {
    gradFrom: "#10B981", gradTo: "#059669",
    icon: Palette, department: "Design",
    model: "DALL-E 3", specialty: "Visual Identity",
  },
  "image designer": {
    gradFrom: "#10B981", gradTo: "#059669",
    icon: Palette, department: "Design",
    model: "DALL-E 3 + Flux", specialty: "Visual Identity",
  },
  "human reviewer": {
    gradFrom: "#F43F5E", gradTo: "#E11D48",
    icon: ShieldCheck, department: "Quality Assurance",
    model: "Human Expert", specialty: "Quality Control",
  },
};

const FALLBACK_META: WorkerMeta = {
  gradFrom: "#64748B", gradTo: "#475569",
  icon: Cpu, department: "AI Processing",
  model: "AI Model", specialty: "General Tasks",
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

function iconForRoleKey(roleKey: string): React.ElementType {
  if (roleKey.includes("director")) return Wand2;
  if (roleKey.includes("strategist")) return Brain;
  if (roleKey.includes("copy")) return PenTool;
  if (roleKey.includes("design") || roleKey.includes("visual")) return Palette;
  if (roleKey.includes("quality") || roleKey.includes("review")) return ShieldCheck;
  return Cpu;
}

/* ─── Real status labels (derived only from creative_project_steps.status) ─── */
const STATUS_STYLE: Record<RuntimeWorkerStatus, { label: string; color: string }> = {
  queued: { label: "Queued", color: "#64748B" },
  working: { label: "Working", color: "#F59E0B" },
  completed: { label: "Completed", color: "#10B981" },
  failed: { label: "Needs Attention", color: "#F43F5E" },
  blocked: { label: "Blocked", color: "#F43F5E" },
};

/* ─── Small source badge ─────────────────────────────────────── */
function SourceBadge({ kind }: { kind: "live" | "workflow" | "demo" }) {
  if (kind === "live") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
        style={{ background: "rgba(16,185,129,0.15)", color: "#10B981", border: "1px solid rgba(16,185,129,0.25)" }}>
        <Radio className="w-2.5 h-2.5" />
        LIVE RUNTIME
      </span>
    );
  }
  if (kind === "workflow") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
        style={{ background: "rgba(59,130,246,0.15)", color: "#3B82F6", border: "1px solid rgba(59,130,246,0.25)" }}>
        <Layers className="w-2.5 h-2.5" />
        WORKFLOW METADATA
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: "rgba(245,158,11,0.15)", color: "#F59E0B", border: "1px solid rgba(245,158,11,0.25)" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
      DEMO PREVIEW
    </span>
  );
}

/* ─── Main component ──────────────────────────────────────────── */
export function WorkspaceAiWorkforce({
  team,
  runtime,
  isDemoPlaceholder = false,
}: {
  team: string[];
  runtime?: RuntimeSnapshot;
  isDemoPlaceholder?: boolean;
}) {
  // Tier 1: real runtime workers derived from creative_project_steps.
  if (runtime?.isLive && runtime.workers.length > 0) {
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold text-white/80 uppercase tracking-wide">AI Workforce</h3>
          <SourceBadge kind="live" />
        </div>
        <div className="space-y-2.5">
          {runtime.workers.map((worker, i) => (
            <RuntimeWorkerCard key={worker.id} worker={worker} index={i} />
          ))}
        </div>
      </div>
    );
  }

  // Tier 2: planned roster from the service catalog (assignedAiTeam) — real
  // data (curated per-service), but not derived from execution, so it is
  // never shown with a confidence score or "live" styling.
  if (!isDemoPlaceholder && team.length > 0) {
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold text-white/80 uppercase tracking-wide">AI Workforce</h3>
          <SourceBadge kind="workflow" />
        </div>
        <div className="space-y-2.5">
          {team.map((name, i) => (
            <StaticWorkerCard key={name} name={name} index={i} />
          ))}
        </div>
      </div>
    );
  }

  // Tier 3: no real data of any kind — clearly labeled demo preview.
  const displayTeam = team.length > 0 ? team : DEFAULT_TEAM;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-white/80 uppercase tracking-wide">AI Workforce</h3>
        <SourceBadge kind="demo" />
      </div>
      <div className="space-y-2.5">
        {displayTeam.map((name, i) => (
          <StaticWorkerCard key={name} name={name} index={i} />
        ))}
      </div>
    </div>
  );
}

function fmtTime(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function RuntimeWorkerCard({ worker, index }: { worker: RuntimeWorkerSnapshot; index: number }) {
  const Icon = iconForRoleKey(worker.roleKey);
  const style = STATUS_STYLE[worker.status];
  const meta = getMeta(worker.displayName);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.35 }}
      className="rounded-xl p-3.5"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${meta.gradFrom}, ${meta.gradTo})` }}
        >
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <p className="text-[12px] font-semibold text-white truncate">{worker.displayName}</p>
            <span className="flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: style.color }} />
              <span className="text-[11px] font-medium" style={{ color: style.color }}>{style.label}</span>
            </span>
          </div>
          <p className="text-[10px] mb-2" style={{ color: "#64748B" }}>
            {worker.department ?? "AI Production"}
            {worker.model ? ` · ${worker.model}` : ""}
          </p>
          <p className="text-[10px]" style={{ color: "#475569" }}>
            {worker.stepName}
            {worker.completedAt ? ` · done ${fmtTime(worker.completedAt)}` : ` · started ${fmtTime(worker.startedAt)}`}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function StaticWorkerCard({ name, index }: { name: string; index: number }) {
  const meta = getMeta(name);
  const Icon = meta.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.35 }}
      className="rounded-xl p-3.5"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${meta.gradFrom}, ${meta.gradTo})` }}
        >
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-white truncate mb-0.5">{name}</p>
          <p className="text-[10px]" style={{ color: "#64748B" }}>{meta.department} · {meta.model}</p>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Compact "current AI task" card ─────────────────────────── */
export function CurrentAiTask({
  stageName,
  stageLabel,
  team,
  runtime,
  deliveryDate,
  filesCount,
  startedAt,
  summary,
}: {
  stageName: string;
  stageLabel: string;
  team: string[];
  runtime?: RuntimeSnapshot;
  deliveryDate: string | null;
  filesCount: number;
  startedAt: string;
  /**
   * V4.1 — deterministic, customer-safe context for the current step, derived
   * from executionSummaryService. Optional: renders nothing extra when absent,
   * so this never fabricates progress or an ETA that isn't already shown above.
   */
  summary?: { whyItMatters: string; nextStep: string | null };
}) {
  const fmt = (d: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
    } catch { return "—"; }
  };

  // Real runtime current task — no keyword-guessing needed, backend already
  // picked the step (running > needs-attention > latest completed > next pending).
  if (runtime?.isLive && runtime.currentTask) {
    const task = runtime.currentTask;
    const style = STATUS_STYLE[task.status];
    const Icon = iconForRoleKey(task.workerRole);
    const needsAttention = task.status === "failed" || task.status === "blocked";
    return (
      <div
        className="rounded-xl p-4"
        style={{
          background: needsAttention ? "rgba(244,63,94,0.07)" : "rgba(249,115,22,0.07)",
          border: `1px solid ${needsAttention ? "rgba(244,63,94,0.2)" : "rgba(249,115,22,0.2)"}`,
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          {needsAttention ? (
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          ) : (
            <Zap className="w-3.5 h-3.5 text-orange-400" />
          )}
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${needsAttention ? "text-rose-400" : "text-orange-400"}`}>
            Current Task
          </span>
          <SourceBadge kind="live" />
        </div>

        <div className="flex items-center gap-2.5 mb-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: needsAttention ? "linear-gradient(135deg, #F43F5E, #E11D48)" : "linear-gradient(135deg, #8B5CF6, #7C3AED)" }}
          >
            <Icon className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <p className="text-[12px] font-semibold text-white">{task.workerDisplayName}</p>
            <p className="text-[10px]" style={{ color: "#64748B" }}>{task.taskLabel}</p>
          </div>
          <span
            className="ml-auto flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: `${style.color}22`, color: style.color, border: `1px solid ${style.color}44` }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: style.color }} />
            {style.label}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Stage", value: stageLabel },
            { label: "ETA", value: deliveryDate ? fmt(deliveryDate) : "Estimating…" },
            { label: "Started", value: fmt(task.startedAt) },
            { label: "Files", value: `${filesCount}` },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px]" style={{ color: "#475569" }}>{label}</p>
              <p className="text-[12px] font-medium text-slate-300">{value}</p>
            </div>
          ))}
        </div>

        {summary && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="text-[11px] leading-snug" style={{ color: "#94A3B8" }}>{summary.whyItMatters}</p>
            {summary.nextStep && (
              <p className="text-[11px] leading-snug mt-1.5" style={{ color: "#FB923C" }}>
                Next: {summary.nextStep}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // No live runtime data — honest fallback, no worker-name guessing.
  if (runtime && runtime.source === "unavailable" && team.length === 0) {
    return (
      <div className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="text-[12px]" style={{ color: "#64748B" }}>AI team will appear when production starts.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <p className="text-[12px]" style={{ color: "#64748B" }}>Runtime data is not available for this project yet.</p>
    </div>
  );
}
