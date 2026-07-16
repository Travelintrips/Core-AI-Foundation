/**
 * cw-revision-thread.tsx — Review & revision history thread (Team 2).
 */
import { motion } from "framer-motion";
import { CheckCircle2, Clock, RotateCcw, Eye, AlertCircle, ExternalLink, MessageSquare } from "lucide-react";
import type { CWRevisionEntry } from "@/hooks/creative-workspace";

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; cls: string; iconCls: string }> = {
  not_shared:         { icon: <Clock className="w-4 h-4" />,         label: "Belum Dibagikan",           cls: "border-slate-600 bg-slate-800",          iconCls: "text-slate-400" },
  shared:             { icon: <Clock className="w-4 h-4" />,         label: "Menunggu Review Anda",       cls: "border-amber-500 bg-amber-500/10",        iconCls: "text-amber-400" },
  viewed:             { icon: <Eye className="w-4 h-4" />,           label: "Sudah Dilihat",              cls: "border-blue-500 bg-blue-500/10",          iconCls: "text-blue-400" },
  approved:           { icon: <CheckCircle2 className="w-4 h-4" />,  label: "Disetujui ✓",               cls: "border-emerald-500 bg-emerald-500/10",    iconCls: "text-emerald-400" },
  rejected:           { icon: <AlertCircle className="w-4 h-4" />,   label: "Ditolak",                   cls: "border-red-500 bg-red-500/10",            iconCls: "text-red-400" },
  revision_requested: { icon: <RotateCcw className="w-4 h-4" />,     label: "Revisi Diminta",             cls: "border-orange-500 bg-orange-500/10",      iconCls: "text-orange-400" },
  revision_complete:  { icon: <CheckCircle2 className="w-4 h-4" />,  label: "Revisi Selesai",             cls: "border-emerald-500 bg-emerald-500/10",    iconCls: "text-emerald-400" },
  expired:            { icon: <Clock className="w-4 h-4" />,         label: "Link Kadaluarsa",            cls: "border-slate-600 bg-slate-800",          iconCls: "text-slate-500" },
  revoked:            { icon: <AlertCircle className="w-4 h-4" />,   label: "Dibatalkan",                 cls: "border-slate-600 bg-slate-800",          iconCls: "text-slate-500" },
  none:               { icon: <MessageSquare className="w-4 h-4" />, label: "Belum Ada Review",           cls: "border-slate-600 bg-slate-800",          iconCls: "text-slate-400" },
};

function RevisionEntry({ entry, isLast }: { entry: CWRevisionEntry; isLast: boolean }) {
  const cfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG["not_shared"];
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: entry.round * 0.05 }}
      className="relative flex gap-4"
    >
      {/* Connector */}
      {!isLast && (
        <div className="absolute left-[22px] top-11 bottom-0 w-0.5 bg-white/6" />
      )}

      {/* Status icon */}
      <div className={`relative z-10 w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${cfg.cls}`}>
        <span className={cfg.iconCls}>{cfg.icon}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-6">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-sm font-semibold text-white">Round {entry.round}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${cfg.iconCls} bg-white/5`}>
            {entry.statusLabel}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-slate-500 mb-2">
          {entry.sharedAt && <span>Dikirim: {fmtDate(entry.sharedAt)}</span>}
          {entry.viewedAt && <span>Dilihat: {fmtDate(entry.viewedAt)}</span>}
          {entry.resolvedAt && <span>Diselesaikan: {fmtDate(entry.resolvedAt)}</span>}
        </div>

        {entry.reviewUrl && (entry.status === "shared" || entry.status === "viewed") && (
          <a
            href={entry.reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Buka Review
          </a>
        )}
      </div>
    </motion.div>
  );
}

export function CWRevisionThread({
  entries,
  currentStatusLabel,
  totalRounds,
}: {
  entries: CWRevisionEntry[];
  currentStatusLabel: string;
  totalRounds: number;
}) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-12">
        <MessageSquare className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-500">Belum ada riwayat review. File akan dibagikan oleh tim setelah produksi selesai.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Summary */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/8 mb-4">
        <div>
          <span className="text-sm font-semibold text-white">{totalRounds} putaran review</span>
          <span className="text-slate-500 mx-2">·</span>
          <span className="text-sm text-slate-400">{currentStatusLabel}</span>
        </div>
      </div>

      {entries.map((e, i) => (
        <RevisionEntry key={e.id} entry={e} isLast={i === entries.length - 1} />
      ))}
    </div>
  );
}
