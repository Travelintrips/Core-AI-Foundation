/**
 * cw-empty.tsx — Shared empty / loading / error states for Creative Workspace.
 */
import { Loader2, AlertCircle, FolderOpen, Bell, Inbox } from "lucide-react";

// ── Loading ───────────────────────────────────────────────────────────────────
export function CWLoading({ message = "Memuat data…" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="relative">
        <Loader2 className="w-9 h-9 animate-spin text-indigo-400" />
        <div className="absolute inset-0 blur-xl opacity-20 bg-indigo-500 rounded-full" />
      </div>
      <p className="text-sm text-slate-400 animate-pulse">{message}</p>
    </div>
  );
}

// ── Error ─────────────────────────────────────────────────────────────────────
export function CWError({
  title = "Gagal Memuat",
  message = "Terjadi kesalahan. Silakan coba lagi.",
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-red-400" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-white mb-1">{title}</h3>
        <p className="text-sm text-slate-400 max-w-xs">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-xl bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 text-sm font-medium hover:bg-indigo-500/25 transition-colors"
        >
          Coba Lagi
        </button>
      )}
    </div>
  );
}

// ── Empty ─────────────────────────────────────────────────────────────────────
type EmptyVariant = "projects" | "notifications" | "deliverables" | "revisions" | "history" | "generic";

const VARIANTS: Record<EmptyVariant, { icon: React.ElementType; title: string; desc: string }> = {
  projects: {
    icon: FolderOpen,
    title: "Belum Ada Proyek",
    desc: "Proyek Anda akan muncul di sini setelah order pertama dikonfirmasi.",
  },
  notifications: {
    icon: Bell,
    title: "Semua Sudah Terbaca",
    desc: "Tidak ada notifikasi baru saat ini.",
  },
  deliverables: {
    icon: Inbox,
    title: "Belum Ada File",
    desc: "File deliverable akan tersedia setelah produksi selesai dan pembayaran dikonfirmasi.",
  },
  revisions: {
    icon: FolderOpen,
    title: "Belum Ada Riwayat Review",
    desc: "Riwayat review dan revisi akan muncul di sini.",
  },
  history: {
    icon: Inbox,
    title: "Belum Ada Aktivitas",
    desc: "Aktivitas proyek akan tercatat di sini.",
  },
  generic: {
    icon: Inbox,
    title: "Belum Ada Data",
    desc: "Data akan muncul setelah ada aktivitas.",
  },
};

export function CWEmpty({
  variant = "generic",
  title,
  description,
}: {
  variant?: EmptyVariant;
  title?: string;
  description?: string;
}) {
  const v = VARIANTS[variant];
  const Icon = v.icon;
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center">
        <Icon className="w-7 h-7 text-slate-500" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-slate-300 mb-1">{title ?? v.title}</h3>
        <p className="text-sm text-slate-500 max-w-xs">{description ?? v.desc}</p>
      </div>
    </div>
  );
}
