/**
 * cw-deliverable-grid.tsx — Deliverable asset grid (Team 2).
 * No direct download URLs — calls existing sign endpoint.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Download, Lock, CheckCircle2, Clock, RotateCcw, Package,
  Layers, Image, Palette, FileText, FileCode, FileAudio, Archive,
} from "lucide-react";
import type { CWDeliverable, CWZipBundle } from "@/hooks/creative-workspace";

function assetIcon(assetType: string, category: string | null) {
  const c = ((category ?? assetType) ?? "").toLowerCase();
  if (c.includes("logo") || c.includes("brand")) return <Layers className="w-5 h-5 text-violet-400" />;
  if (c.includes("image") || c.includes("photo") || c.includes("social")) return <Image className="w-5 h-5 text-sky-400" />;
  if (c.includes("color") || c.includes("palette")) return <Palette className="w-5 h-5 text-pink-400" />;
  if (c.includes("audio") || c.includes("voice")) return <FileAudio className="w-5 h-5 text-amber-400" />;
  if (c.includes("code") || c.includes("html")) return <FileCode className="w-5 h-5 text-emerald-400" />;
  return <FileText className="w-5 h-5 text-slate-400" />;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:    { label: "Dalam Proses", cls: "bg-slate-700 text-slate-300" },
  generated:  { label: "Dibuat", cls: "bg-blue-500/20 text-blue-300" },
  completed:  { label: "Siap", cls: "bg-indigo-500/20 text-indigo-300" },
  approved:   { label: "Disetujui ✓", cls: "bg-emerald-500/20 text-emerald-300" },
  rejected:   { label: "Perlu Revisi", cls: "bg-red-500/20 text-red-300" },
  revision_requested: { label: "Revisi Diminta", cls: "bg-amber-500/20 text-amber-300" },
};

function DeliverableCard({ item }: { item: CWDeliverable }) {
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const badge = STATUS_BADGE[item.status] ?? { label: item.statusLabel ?? item.status, cls: "bg-white/8 text-slate-400" };

  async function handleDownload() {
    if (!item.downloadAvailable) return;
    setSigning(true);
    setError(null);
    try {
      const res = await fetch(item.signEndpoint, { method: "POST" });
      if (!res.ok) throw new Error("Gagal mendapatkan link download");
      const data = await res.json() as { downloadUrl?: string; url?: string };
      const url = data.downloadUrl ?? data.url;
      if (!url) throw new Error("URL tidak tersedia");
      window.open(url, "_blank", "noopener noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setSigning(false);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group relative flex flex-col p-4 rounded-2xl border border-white/8 bg-white/3 hover:border-white/15 hover:bg-white/5 transition-all"
    >
      {/* Icon + version */}
      <div className="flex items-center justify-between mb-3">
        <div className="w-10 h-10 rounded-xl bg-white/6 flex items-center justify-center">
          {assetIcon(item.assetType, item.category)}
        </div>
        {item.version > 1 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/8 text-slate-400 font-medium">
            v{item.version}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="text-sm font-semibold text-white mb-1 leading-snug">{item.title}</p>
      {item.category && (
        <p className="text-[11px] text-slate-500 mb-2 capitalize">{item.category.replace(/_/g, " ")}</p>
      )}

      {/* Status */}
      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium w-fit mb-3 ${badge.cls}`}>
        {badge.label}
      </span>

      {/* Revision notes */}
      {item.revisionNotes && (
        <div className="mb-3 p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/20 text-[11px] text-amber-300 flex items-start gap-1.5">
          <RotateCcw className="w-3 h-3 mt-0.5 shrink-0" />
          {item.revisionNotes}
        </div>
      )}

      {/* Download button */}
      <div className="mt-auto">
        {item.locked ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Lock className="w-3.5 h-3.5" />
            Tersedia setelah pembayaran dikonfirmasi
          </div>
        ) : !item.downloadAvailable ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Clock className="w-3.5 h-3.5" />
            Sedang diproses…
          </div>
        ) : (
          <button
            onClick={handleDownload}
            disabled={signing}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 text-xs font-medium hover:bg-indigo-500/25 transition-colors disabled:opacity-50"
          >
            {signing ? (
              <span className="animate-pulse">Menyiapkan…</span>
            ) : (
              <><Download className="w-3.5 h-3.5" /> Unduh</>
            )}
          </button>
        )}
        {error && <p className="text-[11px] text-red-400 mt-1 text-center">{error}</p>}
      </div>
    </motion.div>
  );
}

function ZipBundleCard({ zip }: { zip: CWZipBundle }) {
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setSigning(true);
    setError(null);
    try {
      const res = await fetch(zip.signEndpoint, { method: "POST" });
      if (!res.ok) throw new Error("Gagal mendapatkan link download");
      const data = await res.json() as { downloadUrl?: string; url?: string };
      const url = data.downloadUrl ?? data.url;
      if (!url) throw new Error("URL tidak tersedia");
      window.open(url, "_blank", "noopener noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setSigning(false);
    }
  }

  const ready = zip.status === "completed";
  return (
    <div className="flex items-center gap-4 p-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/5">
      <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center shrink-0">
        <Archive className="w-5 h-5 text-indigo-400" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-white">Paket Lengkap (ZIP)</p>
        <p className="text-xs text-slate-400">{zip.assetCount != null ? `${zip.assetCount} file` : "Semua file"} dalam satu paket</p>
        {!ready && <p className="text-xs text-amber-400 mt-0.5">Sedang dikompres…</p>}
        {error && <p className="text-xs text-red-400 mt-0.5">{error}</p>}
      </div>
      <button
        onClick={handleDownload}
        disabled={!ready || signing}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 disabled:opacity-40 transition-colors"
      >
        {signing ? <span className="animate-pulse">…</span> : <><Download className="w-4 h-4" /> Download ZIP</>}
      </button>
    </div>
  );
}

export function CWDeliverableGrid({
  deliverables,
  zipBundle,
  filesUnlocked,
  totalAssets,
  approvedAssets,
}: {
  deliverables: CWDeliverable[];
  zipBundle: CWZipBundle | null;
  filesUnlocked: boolean;
  totalAssets: number;
  approvedAssets: number;
}) {
  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-slate-400">{totalAssets} file total</span>
        {approvedAssets > 0 && (
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> {approvedAssets} disetujui
          </span>
        )}
        {!filesUnlocked && (
          <span className="flex items-center gap-1 text-amber-400">
            <Lock className="w-3.5 h-3.5" /> File terkunci
          </span>
        )}
      </div>

      {/* ZIP bundle */}
      {zipBundle && zipBundle.status === "completed" && (
        <ZipBundleCard zip={zipBundle} />
      )}

      {/* Individual files */}
      {deliverables.length === 0 ? (
        <div className="text-center py-12 text-sm text-slate-500">
          File deliverable akan muncul setelah produksi selesai.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {deliverables.map((item) => (
            <DeliverableCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
