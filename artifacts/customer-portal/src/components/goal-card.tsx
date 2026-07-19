/**
 * GoalCard — reusable card for goal-based discovery — Team 03
 *
 * Displays a customer-facing business goal.
 * Fully keyboard-accessible; respects prefers-reduced-motion.
 */

import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { GoalSummary } from "@/lib/discoveryApi";

// Accent colours cycling through the goal list
const ACCENTS = [
  { border: "rgba(124,110,250,0.45)", glow: "rgba(124,110,250,0.12)", icon: "#7C6EFA" },
  { border: "rgba(34,211,238,0.45)",  glow: "rgba(34,211,238,0.12)",  icon: "#22D3EE" },
  { border: "rgba(245,158,11,0.45)",  glow: "rgba(245,158,11,0.12)",  icon: "#F59E0B" },
  { border: "rgba(16,185,129,0.45)",  glow: "rgba(16,185,129,0.12)",  icon: "#10B981" },
  { border: "rgba(249,115,22,0.45)",  glow: "rgba(249,115,22,0.12)",  icon: "#F97316" },
  { border: "rgba(236,72,153,0.45)",  glow: "rgba(236,72,153,0.12)",  icon: "#EC4899" },
];

type GoalCardProps = {
  goal: GoalSummary;
  index?: number;
};

export function GoalCard({ goal, index = 0 }: GoalCardProps) {
  const accent = ACCENTS[index % ACCENTS.length];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="group"
    >
      <Link
        href={`/goals/${goal.slug}`}
        className="block rounded-2xl p-5 h-full outline-none focus-visible:ring-2 focus-visible:ring-[#7C6EFA] focus-visible:ring-offset-2 focus-visible:ring-offset-[#060B18] transition-all duration-200 hover:-translate-y-0.5"
        aria-label={`${goal.name}${goal.description ? ` — ${goal.description}` : ""}`}
        style={{
          background: "#0D1526",
          border: "1px solid #2E4270",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = accent.border;
          (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 32px ${accent.glow}`;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = "#2E4270";
          (e.currentTarget as HTMLElement).style.boxShadow = "none";
        }}
      >
        <div className="flex flex-col gap-4 h-full">
          {/* Icon */}
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
            style={{
              background: `linear-gradient(135deg, ${accent.glow} 0%, rgba(13,21,38,0) 100%)`,
              border: `1px solid ${accent.border}`,
            }}
            aria-hidden="true"
          >
            {goal.icon ?? "🎯"}
          </div>

          {/* Text */}
          <div className="flex-1 flex flex-col gap-1.5">
            <h3
              className="font-bold text-base leading-snug"
              style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {goal.name}
            </h3>
            {goal.description && (
              <p className="text-sm text-[#8B9BC4] leading-relaxed line-clamp-2">
                {goal.description}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end pt-3 border-t border-[#243352] mt-auto">
            <span
              className="flex items-center gap-1 text-xs font-semibold transition-all duration-200 group-hover:gap-2"
              style={{ color: accent.icon }}
              aria-hidden="true"
            >
              Jelajahi <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

export function GoalCardSkeleton() {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4 animate-pulse"
      style={{ background: "#0D1526", border: "1px solid #243352" }}
      aria-hidden="true"
    >
      <div className="w-12 h-12 rounded-xl bg-[#1E2D4A]" />
      <div className="flex flex-col gap-2 flex-1">
        <div className="h-5 w-3/4 rounded bg-[#1E2D4A]" />
        <div className="h-4 w-full rounded bg-[#1E2D4A]" />
        <div className="h-4 w-2/3 rounded bg-[#1E2D4A]" />
      </div>
      <div className="h-px bg-[#243352] mt-auto" />
      <div className="flex justify-end">
        <div className="h-3.5 w-16 rounded bg-[#1E2D4A]" />
      </div>
    </div>
  );
}
