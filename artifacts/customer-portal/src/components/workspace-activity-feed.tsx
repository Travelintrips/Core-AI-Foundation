import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { WorkspaceActivity } from "@/hooks/use-workspace";
import { CheckCircle2, Clock, Loader2, AlertCircle, Zap, Activity, ChevronDown } from "lucide-react";

/**
 * V4.1 — optional, deterministic context from executionSummaryService, keyed
 * by the same resourceId as the base WorkspaceActivity item. Additive: items
 * without a match simply don't expand.
 */
export type ActivityItemContext = {
  whyItMatters: string;
  nextStep: string | null;
  customerAction: { kind: string; label: string } | null;
};

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function fmtRelative(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  } catch { return "—"; }
}

type StatusDot = { color: string; bg: string; animate: boolean };
function statusStyle(status: string): StatusDot {
  switch (status) {
    case "completed":
      return { color: "#10B981", bg: "rgba(16,185,129,0.15)", animate: false };
    case "pending":
      return { color: "#F59E0B", bg: "rgba(245,158,11,0.15)", animate: true };
    case "processing":
      return { color: "#3B82F6", bg: "rgba(59,130,246,0.15)", animate: true };
    case "error":
    case "failed":
      return { color: "#EF4444", bg: "rgba(239,68,68,0.15)", animate: false };
    default:
      return { color: "#64748B", bg: "rgba(100,116,139,0.15)", animate: false };
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed": return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case "pending": return <Clock className="w-3.5 h-3.5 text-amber-400" />;
    case "processing": return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
    case "error":
    case "failed": return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
    default: return <Zap className="w-3.5 h-3.5 text-slate-500" />;
  }
}

export function WorkspaceActivityFeed({
  items,
  maxItems = 10,
  contextByResourceId,
}: {
  items: WorkspaceActivity[];
  maxItems?: number;
  /** V4.1 — optional per-item expanded context, keyed by item.resourceId. */
  contextByResourceId?: Record<string, ActivityItemContext>;
}) {
  const shown = items.slice(0, maxItems);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-3.5 h-3.5 text-white/50" />
        <h3 className="text-[13px] font-semibold text-white/80 uppercase tracking-wide">Live Activity</h3>
      </div>

      {shown.length === 0 ? (
        <p className="text-[12px] text-center py-5" style={{ color: "#475569" }}>No activity yet.</p>
      ) : (
        <div className="relative">
          {/* Vertical connector */}
          <div
            className="absolute left-[15px] top-3 bottom-3 w-px"
            style={{ background: "linear-gradient(to bottom, rgba(249,115,22,0.3), rgba(255,255,255,0.04))" }}
          />
          <ol className="space-y-0.5">
            {shown.map((item, i) => {
              const ss = statusStyle(item.status);
              const key = `${item.createdAt}-${i}`;
              const context = item.resourceId ? contextByResourceId?.[item.resourceId] : undefined;
              const hasExpandable = !!(context && (context.whyItMatters || context.nextStep));
              const isOpen = expandedKey === key;
              return (
                <motion.li
                  key={key}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.28 }}
                  className="flex gap-3 group"
                >
                  {/* Icon node */}
                  <div
                    className="relative z-10 w-[30px] h-[30px] shrink-0 flex items-center justify-center rounded-full mt-1.5"
                    style={{ background: ss.bg }}
                  >
                    <StatusIcon status={item.status} />
                  </div>

                  {/* Content */}
                  <div
                    className="flex-1 min-w-0 py-2 border-b"
                    style={{ borderColor: "rgba(255,255,255,0.05)" }}
                  >
                    <button
                      type="button"
                      disabled={!hasExpandable}
                      aria-expanded={hasExpandable ? isOpen : undefined}
                      aria-controls={hasExpandable ? `activity-detail-${key}` : undefined}
                      onClick={() => setExpandedKey((k) => (k === key ? null : key))}
                      className={`w-full text-left flex items-start justify-between gap-2 ${hasExpandable ? "cursor-pointer" : "cursor-default"}`}
                    >
                      <p className="text-[12px] font-medium leading-snug" style={{ color: "#CBD5E1" }}>
                        {item.label}
                      </p>
                      {hasExpandable && (
                        <ChevronDown
                          aria-hidden="true"
                          className="w-3.5 h-3.5 shrink-0 mt-0.5 transition-transform"
                          style={{ color: "#475569", transform: isOpen ? "rotate(180deg)" : "none" }}
                        />
                      )}
                    </button>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[10px]" style={{ color: "#475569" }}>
                        {fmtTime(item.createdAt)} · {fmtRelative(item.createdAt)}
                      </p>
                      {item.status && item.status !== "completed" && (
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full capitalize"
                          style={{ background: ss.bg, color: ss.color }}
                        >
                          {item.status}
                        </span>
                      )}
                    </div>

                    <AnimatePresence initial={false}>
                      {hasExpandable && isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="overflow-hidden"
                          id={`activity-detail-${key}`}
                        >
                          <div className="pt-2 space-y-1">
                            {context!.whyItMatters && (
                              <p className="text-[11px] leading-snug" style={{ color: "#94A3B8" }}>
                                {context!.whyItMatters}
                              </p>
                            )}
                            {context!.nextStep && (
                              <p className="text-[11px] leading-snug" style={{ color: "#FB923C" }}>
                                Next: {context!.nextStep}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
