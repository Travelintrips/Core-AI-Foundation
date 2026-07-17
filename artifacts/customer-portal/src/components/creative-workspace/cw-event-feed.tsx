/**
 * cw-event-feed.tsx — Project history event feed (Team 2).
 */
import { motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, Activity } from "lucide-react";
import type { CWHistoryEvent } from "@/hooks/creative-workspace";

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

const SEVERITY_CONFIG: Record<string, { icon: React.ReactNode; cls: string; line: string }> = {
  info:    { icon: <Info className="w-3.5 h-3.5" />,          cls: "bg-blue-500/15 text-blue-400 border-blue-500/20",     line: "bg-blue-500/30" },
  success: { icon: <CheckCircle2 className="w-3.5 h-3.5" />,  cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20", line: "bg-emerald-500/30" },
  warning: { icon: <AlertTriangle className="w-3.5 h-3.5" />, cls: "bg-amber-500/15 text-amber-400 border-amber-500/20",   line: "bg-amber-500/30" },
  error:   { icon: <AlertCircle className="w-3.5 h-3.5" />,   cls: "bg-red-500/15 text-red-400 border-red-500/20",         line: "bg-red-500/30" },
};

export function CWEventFeed({
  events,
  total,
}: {
  events: CWHistoryEvent[];
  total: number;
}) {
  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <Activity className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-500">Belum ada aktivitas tercatat untuk proyek ini.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-xs text-slate-500 mb-3">{total} aktivitas tercatat</div>
      <div className="relative">
        <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-white/5" />
        {events.map((ev, i) => {
          const cfg = SEVERITY_CONFIG[ev.severity] ?? SEVERITY_CONFIG.info;
          return (
            <motion.div
              key={ev.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="relative flex gap-3 py-2 pl-2"
            >
              {/* Dot */}
              <div className={`relative z-10 w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${cfg.cls}`}>
                {cfg.icon}
              </div>
              {/* Text */}
              <div className="flex-1 min-w-0 pt-1">
                <p className="text-sm text-white leading-snug">{ev.title || ev.message}</p>
                {ev.title && ev.message && ev.title !== ev.message && (
                  <p className="text-xs text-slate-500 mt-0.5">{ev.message}</p>
                )}
                <p className="text-[11px] text-slate-600 mt-1">{fmtDateTime(ev.createdAt)}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
