import { motion } from "framer-motion";
import type { WorkspaceActivity } from "@/hooks/use-workspace";
import { CheckCircle2, Clock, Loader2, AlertCircle, Zap, Activity } from "lucide-react";

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
}: {
  items: WorkspaceActivity[];
  maxItems?: number;
}) {
  const shown = items.slice(0, maxItems);

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
              return (
                <motion.li
                  key={`${item.createdAt}-${i}`}
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
                    <p className="text-[12px] font-medium leading-snug" style={{ color: "#CBD5E1" }}>
                      {item.label}
                    </p>
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
