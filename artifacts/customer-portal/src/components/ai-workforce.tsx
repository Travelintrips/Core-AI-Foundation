/**
 * AI Workforce Section — Service Detail Page
 *
 * Pure visual / UX enrichment. All data is demo placeholder (no backend).
 * Clearly labelled "Demo Preview" per design spec.
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu, Users, Brain, Palette, CheckCircle2, Clock, Zap,
  Sparkles, ChevronRight, Activity, AlertCircle, Timer,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type WorkerStatus = "Working" | "Available" | "Thinking" | "Preparing" | "Ready";

interface AIWorker {
  id: string;
  name: string;
  role: string;
  status: WorkerStatus;
  confidence: number;   // 0–100
  model: string;
  specialty: string;
  icon: React.ElementType;
  avatarGradient: string;
  isHuman?: boolean;
}

interface TimelineStep {
  id: string;
  label: string;
  agent: string;
  status: "done" | "active" | "pending";
}

// ── Workers definition ────────────────────────────────────────────────────────

const WORKERS: AIWorker[] = [
  {
    id: "creative-director",
    name: "Creative Director AI",
    role: "Creative Director",
    status: "Working",
    confidence: 98,
    model: "GPT-4o + Claude",
    specialty: "Brand Positioning",
    icon: Sparkles,
    avatarGradient: "from-[#7C6EFA] to-[#5F52D0]",
  },
  {
    id: "brand-strategist",
    name: "Brand Strategist AI",
    role: "Brand Strategist",
    status: "Available",
    confidence: 95,
    model: "Claude 3.5 Sonnet",
    specialty: "Market Strategy",
    icon: Brain,
    avatarGradient: "from-[#22D3EE] to-[#0EA5E9]",
  },
  {
    id: "senior-copywriter",
    name: "Senior Copywriter AI",
    role: "Senior Copywriter",
    status: "Thinking",
    confidence: 87,
    model: "GPT-4o",
    specialty: "Persuasive Copy",
    icon: Cpu,
    avatarGradient: "from-[#F59E0B] to-[#D97706]",
  },
  {
    id: "visual-designer",
    name: "Visual Designer AI",
    role: "Visual Designer",
    status: "Preparing",
    confidence: 92,
    model: "DALL·E 4 + Midjourney",
    specialty: "Visual Identity",
    icon: Palette,
    avatarGradient: "from-[#10B981] to-[#059669]",
  },
  {
    id: "human-reviewer",
    name: "Human Quality Reviewer",
    role: "QA Reviewer",
    status: "Ready",
    confidence: 100,
    model: "Human Expert",
    specialty: "QA & Approval",
    icon: Users,
    avatarGradient: "from-[#8B5CF6] to-[#6D28D9]",
    isHuman: true,
  },
];

const TIMELINE: TimelineStep[] = [
  { id: "creative",  label: "Creative Direction", agent: "Creative Director AI",    status: "active"  },
  { id: "strategy",  label: "Brand Strategy",      agent: "Brand Strategist AI",    status: "pending" },
  { id: "copy",      label: "Copywriting",          agent: "Senior Copywriter AI",   status: "pending" },
  { id: "design",    label: "Visual Design",        agent: "Visual Designer AI",     status: "pending" },
  { id: "review",    label: "Human Review",         agent: "Human Quality Reviewer", status: "pending" },
  { id: "delivery",  label: "Delivery",             agent: "—",                      status: "pending" },
];

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<WorkerStatus, { color: string; bg: string; border: string; pulse: string; label: string }> = {
  Working:   { color: "#10B981", bg: "rgba(16,185,129,0.1)",  border: "rgba(16,185,129,0.3)",  pulse: "#10B981", label: "Working"   },
  Available: { color: "#22D3EE", bg: "rgba(34,211,238,0.1)",  border: "rgba(34,211,238,0.3)",  pulse: "#22D3EE", label: "Available" },
  Thinking:  { color: "#F59E0B", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)",  pulse: "#F59E0B", label: "Thinking"  },
  Preparing: { color: "#7C6EFA", bg: "rgba(124,110,250,0.1)", border: "rgba(124,110,250,0.3)", pulse: "#7C6EFA", label: "Preparing" },
  Ready:     { color: "#10B981", bg: "rgba(16,185,129,0.1)",  border: "rgba(16,185,129,0.3)",  pulse: "#10B981", label: "Ready"     },
};

// ── Confidence counter hook ───────────────────────────────────────────────────

function useCountUp(target: number, duration = 1200, delay = 0) {
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(eased * target));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(timeout);
  }, [target, duration, delay]);

  return value;
}

// ── StatusDot ─────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: WorkerStatus }) {
  const cfg = STATUS_CONFIG[status];
  const shouldPulse = status === "Working" || status === "Thinking" || status === "Preparing";

  return (
    <span className="relative flex items-center justify-center w-2.5 h-2.5">
      {shouldPulse && (
        <motion.span
          className="absolute inline-flex rounded-full"
          style={{ width: "100%", height: "100%", background: cfg.pulse, opacity: 0.4 }}
          animate={{ scale: [1, 2.2, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <span className="relative inline-flex w-2.5 h-2.5 rounded-full" style={{ background: cfg.color }} />
    </span>
  );
}

// ── AIWorkerCard ──────────────────────────────────────────────────────────────

function AIWorkerCard({ worker, index, inView }: { worker: AIWorker; index: number; inView: boolean }) {
  const cfg = STATUS_CONFIG[worker.status];
  const confidence = useCountUp(inView ? worker.confidence : 0, 1000, index * 120);
  const Icon = worker.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: 0.45, delay: index * 0.1, ease: "easeOut" }}
      className="relative shrink-0 w-64 rounded-2xl flex flex-col gap-4 p-5 overflow-hidden"
      style={{
        background: "linear-gradient(160deg, rgba(13,21,38,0.95) 0%, rgba(10,18,37,0.98) 100%)",
        border: `1px solid rgba(46,66,112,0.8)`,
        backdropFilter: "blur(12px)",
        boxShadow: `0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)`,
      }}
    >
      {/* Soft top glow */}
      <div
        className="absolute top-0 left-0 right-0 h-24 pointer-events-none rounded-t-2xl"
        style={{ background: `linear-gradient(180deg, ${cfg.color}10 0%, transparent 100%)` }}
      />

      {/* Avatar + status */}
      <div className="flex items-start justify-between relative z-[1]">
        <div
          className={`w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br ${worker.avatarGradient}`}
          style={{ boxShadow: `0 4px 16px ${cfg.color}30` }}
        >
          <Icon className="w-6 h-6 text-white" />
        </div>
        <span
          className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
          style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}
        >
          <StatusDot status={worker.status} />
          {cfg.label}
        </span>
      </div>

      {/* Name + role */}
      <div className="relative z-[1]">
        <p
          className="font-bold text-sm leading-snug text-[#F0F4FF] mb-0.5"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          {worker.name}
        </p>
        <p className="text-[11px] text-[#8B9BC4]">{worker.role}</p>
      </div>

      {/* Confidence bar */}
      <div className="relative z-[1]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-[#8B9BC4] font-medium">Confidence</span>
          <span
            className="text-[13px] font-bold tabular-nums"
            style={{ color: cfg.color, fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {confidence}%
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(46,66,112,0.5)" }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, ${cfg.color}80, ${cfg.color})` }}
            initial={{ width: 0 }}
            animate={inView ? { width: `${worker.confidence}%` } : { width: 0 }}
            transition={{ duration: 1.0, delay: index * 0.1 + 0.2, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Meta */}
      <div className="relative z-[1] space-y-2 border-t pt-3" style={{ borderColor: "rgba(46,66,112,0.6)" }}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] text-[#8B9BC4] uppercase tracking-wider font-semibold shrink-0">Model</span>
          <span className="text-[11px] text-[#C8D5F0] font-medium text-right leading-tight">{worker.model}</span>
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] text-[#8B9BC4] uppercase tracking-wider font-semibold shrink-0">Specialty</span>
          <span className="text-[11px] text-[#C8D5F0] font-medium text-right leading-tight">{worker.specialty}</span>
        </div>
      </div>
    </motion.div>
  );
}

// ── AI Team Timeline ──────────────────────────────────────────────────────────

function AITeamTimeline({ inView }: { inView: boolean }) {
  return (
    <div className="flex flex-col gap-0">
      {TIMELINE.map((step, i) => (
        <motion.div
          key={step.id}
          initial={{ opacity: 0, x: -12 }}
          animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
          transition={{ duration: 0.35, delay: 0.3 + i * 0.07, ease: "easeOut" }}
          className="flex items-stretch gap-3"
        >
          {/* Line + dot */}
          <div className="flex flex-col items-center shrink-0" style={{ width: 20 }}>
            <div
              className="w-3 h-3 rounded-full border-2 shrink-0 mt-1"
              style={{
                borderColor: step.status === "active" ? "#7C6EFA"
                  : step.status === "done"  ? "#10B981"
                  : "rgba(46,66,112,0.8)",
                background: step.status === "active" ? "#7C6EFA"
                  : step.status === "done"  ? "#10B981"
                  : "transparent",
                boxShadow: step.status === "active" ? "0 0 8px rgba(124,110,250,0.5)" : "none",
              }}
            >
              {step.status === "active" && (
                <motion.div
                  className="w-full h-full rounded-full"
                  style={{ background: "#7C6EFA" }}
                  animate={{ scale: [1, 1.6, 1], opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
            </div>
            {i < TIMELINE.length - 1 && (
              <div
                className="flex-1 w-px mt-1"
                style={{
                  background: step.status === "done"
                    ? "#10B981"
                    : step.status === "active"
                    ? "linear-gradient(180deg, #7C6EFA 0%, rgba(46,66,112,0.4) 100%)"
                    : "rgba(46,66,112,0.4)",
                  minHeight: 24,
                }}
              />
            )}
          </div>

          {/* Content */}
          <div className={`pb-4 flex-1 ${i === TIMELINE.length - 1 ? "pb-0" : ""}`}>
            <p
              className="text-sm font-semibold leading-snug"
              style={{
                color: step.status === "active" ? "#F0F4FF"
                  : step.status === "done"  ? "#10B981"
                  : "#8B9BC4",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
            >
              {step.label}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: step.status === "active" ? "#8B9BC4" : "#4A5568" }}>
              {step.agent}
            </p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ── Progress panel ────────────────────────────────────────────────────────────

function ProgressPanel({ inView }: { inView: boolean }) {
  const progress = useCountUp(inView ? 18 : 0, 1200, 400);

  return (
    <div className="space-y-4">
      {/* Overall progress */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[#8B9BC4] uppercase tracking-wider">Current Progress</span>
          <span className="text-sm font-bold text-[#7C6EFA] tabular-nums" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {progress}%
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(46,66,112,0.5)" }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, #7C6EFA, #22D3EE)" }}
            initial={{ width: 0 }}
            animate={inView ? { width: "18%" } : { width: 0 }}
            transition={{ duration: 1.2, delay: 0.4, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Stats */}
      {[
        { icon: Clock,     label: "Estimated Completion", value: "3–5 days",             color: "#22D3EE" },
        { icon: Activity,  label: "Current AI Working",    value: "Creative Director AI",  color: "#10B981" },
        { icon: Timer,     label: "Time in Queue",         value: "~2 hours",              color: "#F59E0B" },
        { icon: Zap,       label: "Queue",                 value: "4 agents waiting",      color: "#7C6EFA" },
      ].map(({ icon: Icon, label, value, color }, i) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 8 }}
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.3, delay: 0.5 + i * 0.08 }}
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: "rgba(13,21,38,0.6)", border: "1px solid rgba(46,66,112,0.5)" }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${color}15`, border: `1px solid ${color}30` }}
          >
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-[#8B9BC4] font-semibold uppercase tracking-wider">{label}</p>
            <p className="text-sm font-semibold text-[#F0F4FF] truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{value}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AiWorkforceSection() {
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      className="relative overflow-hidden border-b"
      style={{
        background: "linear-gradient(180deg, rgba(7,12,28,0.95) 0%, rgba(6,11,24,1) 100%)",
        borderColor: "rgba(46,66,112,0.5)",
      }}
    >
      {/* Background orb */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[200px] rounded-full"
        style={{ background: "radial-gradient(ellipse, rgba(124,110,250,0.08) 0%, transparent 70%)", filter: "blur(40px)" }}
      />

      <div className="relative container mx-auto px-4 md:px-8 max-w-7xl py-10">

        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-3 mb-8 flex-wrap"
        >
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(124,110,250,0.2) 0%, rgba(34,211,238,0.1) 100%)", border: "1px solid rgba(124,110,250,0.3)" }}
            >
              <Users className="w-4 h-4 text-[#7C6EFA]" />
            </div>
            <h2
              className="font-bold text-lg text-[#F0F4FF]"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Meet Your AI Workforce
            </h2>
          </div>

          {/* Demo preview badge */}
          <span
            className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider"
            style={{
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.3)",
              color: "#F59E0B",
            }}
          >
            <AlertCircle className="w-3 h-3" />
            Demo Preview
          </span>

          <div className="flex-1 h-px" style={{ background: "rgba(46,66,112,0.6)", minWidth: 20 }} />
          <p className="text-xs text-[#8B9BC4]">
            Your dedicated AI team, assembled for this project
          </p>
        </motion.div>

        {/* Main layout: cards left, timeline + progress right */}
        <div className="flex gap-8 items-start flex-col lg:flex-row">

          {/* AI Worker cards — horizontal scroll */}
          <div className="flex-1 min-w-0">
            <div
              className="flex gap-4 overflow-x-auto pb-3"
              style={{ scrollbarWidth: "none" }}
            >
              {WORKERS.map((worker, i) => (
                <AIWorkerCard key={worker.id} worker={worker} index={i} inView={inView} />
              ))}
            </div>

            {/* Legend */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : { opacity: 0 }}
              transition={{ delay: 0.8 }}
              className="flex items-center gap-4 mt-4 flex-wrap"
            >
              {(Object.entries(STATUS_CONFIG) as [WorkerStatus, typeof STATUS_CONFIG[WorkerStatus]][]).map(([status, cfg]) => (
                <span key={status} className="flex items-center gap-1.5 text-[11px] text-[#8B9BC4]">
                  <StatusDot status={status} />
                  {cfg.label}
                </span>
              ))}
            </motion.div>
          </div>

          {/* Right column: timeline + progress */}
          <div className="lg:w-72 shrink-0 flex flex-col gap-6 lg:gap-8">

            {/* Timeline */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: 16 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              className="rounded-2xl p-5"
              style={{
                background: "rgba(13,21,38,0.8)",
                border: "1px solid rgba(46,66,112,0.6)",
                backdropFilter: "blur(12px)",
              }}
            >
              <p
                className="text-xs font-bold text-[#8B9BC4] uppercase tracking-wider mb-4 flex items-center gap-2"
              >
                <ChevronRight className="w-3.5 h-3.5 text-[#7C6EFA]" />
                AI Team Timeline
              </p>
              <AITeamTimeline inView={inView} />
            </motion.div>

            {/* Progress panel */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: 16 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="rounded-2xl p-5"
              style={{
                background: "rgba(13,21,38,0.8)",
                border: "1px solid rgba(46,66,112,0.6)",
                backdropFilter: "blur(12px)",
              }}
            >
              <p className="text-xs font-bold text-[#8B9BC4] uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-[#7C6EFA]" />
                Project Status
              </p>
              <ProgressPanel inView={inView} />
            </motion.div>

          </div>
        </div>
      </div>
    </section>
  );
}
