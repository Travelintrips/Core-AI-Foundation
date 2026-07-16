/**
 * creative-workspace/overview.tsx — Main dashboard page (Team 2).
 * Route: /creative-workspace/:token
 * NOT registered in App.tsx — Team 24 wires this via integration manifest.
 */
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  FolderKanban, Clock, CheckCircle2, CreditCard, Bell,
  Download, ArrowRight, Zap, Loader2, AlertCircle,
} from "lucide-react";
import { CWLayout } from "@/components/creative-workspace/cw-layout";
import { CWError } from "@/components/creative-workspace/cw-empty";
import { useCWOverview } from "@/hooks/creative-workspace";
import type { CWProjectCard, CWUrgentAction, CWStats } from "@/hooks/creative-workspace";

function fmtMoney(amount: number, currency = "IDR") {
  if (currency === "IDR") return `Rp${Math.round(amount).toLocaleString("id-ID")}`;
  return `${currency} ${amount.toLocaleString()}`;
}

function fmtDate(d: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" }); } catch { return null; }
}

// ── Stat Cards ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, icon: Icon, color, bg, delay = 0,
}: { label: string; value: string | number; icon: React.ElementType; color: string; bg: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="p-4 rounded-2xl border border-white/8 bg-white/3 hover:border-white/15 transition-colors"
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${bg}`}>
        <Icon className={`w-4.5 h-4.5 ${color}`} />
      </div>
      <p className="text-xl font-bold text-white leading-none mb-1">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </motion.div>
  );
}

// ── Urgent Action Banner ───────────────────────────────────────────────────────
const ACTION_COLORS: Record<string, string> = {
  high:   "border-red-500/30 bg-red-500/6",
  medium: "border-amber-500/30 bg-amber-500/6",
  low:    "border-indigo-500/30 bg-indigo-500/6",
};

const ACTION_LABEL_COLOR: Record<string, string> = {
  high: "text-red-400", medium: "text-amber-400", low: "text-indigo-400",
};

function UrgentBanner({ action }: { action: CWUrgentAction }) {
  return (
    <Link href={action.actionPath}>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer hover:border-white/20 transition-colors ${ACTION_COLORS[action.priority] ?? ACTION_COLORS.low}`}
      >
        <Zap className={`w-4 h-4 shrink-0 ${ACTION_LABEL_COLOR[action.priority]}`} />
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-semibold ${ACTION_LABEL_COLOR[action.priority]}`}>{action.label}</span>
          <span className="text-slate-400 text-sm mx-2">·</span>
          <span className="text-sm text-slate-300">{action.projectName}</span>
          <p className="text-xs text-slate-500 mt-0.5">{action.message}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
      </motion.div>
    </Link>
  );
}

// ── Project Row ────────────────────────────────────────────────────────────────
function ProjectRow({ p, token, delay }: { p: CWProjectCard; token: string; delay: number }) {
  const pct = p.progressPercent;
  const barColor = pct >= 80 ? "#34D399" : pct >= 50 ? "#6366F1" : "#FBBF24";

  return (
    <Link href={`/creative-workspace/${token}/projects/${p.projectNumber}`}>
      <motion.div
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay }}
        className="group flex items-center gap-4 px-4 py-3.5 rounded-xl hover:bg-white/4 border border-transparent hover:border-white/8 transition-all cursor-pointer"
      >
        {/* Progress ring proxy */}
        <div className="shrink-0 w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-xs font-bold text-white">
          {pct}%
        </div>

        {/* Name + stage */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{p.brandName}</p>
          <p className="text-xs text-slate-400 truncate">{p.serviceName}{p.packageName ? ` · ${p.packageName}` : ""}</p>
          <div className="h-1 rounded-full bg-white/8 mt-1.5 overflow-hidden w-24">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
          </div>
        </div>

        {/* Stage badge */}
        <div className="hidden sm:block shrink-0">
          <span className="text-[11px] px-2 py-1 rounded-lg bg-white/6 text-slate-400">
            {p.currentStageLabel}
          </span>
        </div>

        {/* Delivery date */}
        {p.deliveryDate && (
          <span className="hidden md:block text-xs text-slate-500 shrink-0">
            {fmtDate(p.deliveryDate)}
          </span>
        )}

        {/* Urgent indicator */}
        {p.urgentAction && (
          <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
        )}

        <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
      </motion.div>
    </Link>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CWOverviewPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data, isLoading, error, refetch } = useCWOverview(token);

  if (isLoading) {
    return (
      <CWLayout token={token} title="Beranda">
        <div className="flex flex-col items-center justify-center py-28 gap-4">
          <div className="relative">
            <Loader2 className="w-9 h-9 animate-spin text-indigo-400" />
            <div className="absolute inset-0 blur-xl opacity-20 bg-indigo-500 rounded-full" />
          </div>
          <p className="text-sm text-slate-400 animate-pulse">Memuat workspace Anda…</p>
        </div>
      </CWLayout>
    );
  }

  if (error || !data) {
    return (
      <CWLayout token={token} title="Beranda">
        <CWError
          title="Workspace Tidak Ditemukan"
          message="Link workspace Anda tidak valid atau sudah kadaluarsa. Hubungi tim kami untuk link baru."
          onRetry={() => refetch()}
        />
      </CWLayout>
    );
  }

  const stats: { label: string; value: string | number; icon: React.ElementType; color: string; bg: string }[] = [
    { label: "Total Proyek",       value: data.stats.totalProjects,    icon: FolderKanban, color: "text-indigo-400",  bg: "bg-indigo-500/15" },
    { label: "Menunggu Review",    value: data.stats.waitingReview,    icon: Clock,        color: "text-amber-400",   bg: "bg-amber-500/15" },
    { label: "Selesai",            value: data.stats.completedProjects, icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/15" },
    { label: "Dapat Diunduh",      value: data.stats.downloadableAssets, icon: Download,   color: "text-sky-400",     bg: "bg-sky-500/15" },
    { label: "Notifikasi Baru",    value: data.stats.unreadNotifications, icon: Bell,      color: "text-violet-400",  bg: "bg-violet-500/15" },
    {
      label: "Outstanding",
      value: data.stats.outstandingBalance > 0
        ? fmtMoney(data.stats.outstandingBalance, data.stats.outstandingCurrency)
        : "Lunas",
      icon: CreditCard,
      color: data.stats.outstandingBalance > 0 ? "text-red-400" : "text-emerald-400",
      bg:    data.stats.outstandingBalance > 0 ? "bg-red-500/15" : "bg-emerald-500/15",
    },
  ];

  return (
    <CWLayout token={token} title="Beranda">
      {/* Welcome */}
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">
          Selamat datang, {data.clientName.split(" ")[0]} 👋
        </h1>
        <p className="text-slate-400 text-sm">{data.clientEmail}</p>
      </motion.div>

      {/* Urgent actions */}
      {data.urgentActions.length > 0 && (
        <div className="mb-7 space-y-2">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Perlu Tindakan</h2>
          {data.urgentActions.map((a, i) => <UrgentBanner key={`${a.type}-${a.projectNumber}`} action={a} />)}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-7">
        {stats.map((s, i) => (
          <StatCard key={s.label} {...s} delay={i * 0.05} />
        ))}
      </div>

      {/* Recent projects */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Proyek Terbaru</h2>
          <Link href={`/creative-workspace/${token}/projects`} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1">
            Lihat semua <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {data.recentProjects.length === 0 ? (
          <div className="text-center py-10 rounded-2xl border border-white/8 bg-white/2">
            <AlertCircle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-400">Belum ada proyek. Mulai order pertama Anda!</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/8 bg-white/2 overflow-hidden divide-y divide-white/5">
            {data.recentProjects.map((p, i) => (
              <ProjectRow key={p.projectNumber} p={p} token={token} delay={i * 0.04} />
            ))}
          </div>
        )}
      </div>
    </CWLayout>
  );
}
