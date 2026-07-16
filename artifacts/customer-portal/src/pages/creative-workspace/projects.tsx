/**
 * creative-workspace/projects.tsx — Project list page (Team 2).
 * Route: /creative-workspace/:token/projects
 */
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Search, Loader2, FolderKanban, ArrowRight, Filter, SortDesc, Zap } from "lucide-react";
import { CWLayout } from "@/components/creative-workspace/cw-layout";
import { CWEmpty, CWError } from "@/components/creative-workspace/cw-empty";
import { useCWProjects } from "@/hooks/creative-workspace";

const STATUS_TABS = [
  { key: "",          label: "Semua" },
  { key: "active",    label: "Aktif" },
  { key: "review",    label: "Review" },
  { key: "pending",   label: "Menunggu" },
  { key: "completed", label: "Selesai" },
];

const SORT_OPTIONS = [
  { value: "newest",        label: "Terbaru" },
  { value: "oldest",        label: "Terlama" },
  { value: "delivery_date", label: "Deadline" },
];

function stageColor(stage: string) {
  if (["completed"].includes(stage))                          return "bg-emerald-500/15 text-emerald-300";
  if (["waiting_client_review", "client_review"].includes(stage)) return "bg-amber-500/15 text-amber-300";
  if (["revision", "revision_requested"].includes(stage))    return "bg-orange-500/15 text-orange-300";
  if (["failed", "cancelled"].includes(stage))               return "bg-red-500/15 text-red-300";
  if (["building", "in_progress", "production"].includes(stage)) return "bg-indigo-500/15 text-indigo-300";
  return "bg-white/8 text-slate-400";
}

function fmtDate(d: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return null; }
}

type Project = Record<string, unknown>;

function ProjectCard({ p, token }: { p: Project; token: string }): React.JSX.Element {
  const pct = Number(p["progressPercent"] ?? 0);
  const hasAction = Boolean(p["hasUrgentAction"]);
  const projectNumber = String(p["projectNumber"] ?? "");
  const href = `/creative-workspace/${token}/projects/${projectNumber}`;

  return (
    <Link href={href}>
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="group relative flex flex-col p-4 rounded-2xl border border-white/8 bg-white/3 hover:border-white/18 hover:bg-white/5 transition-all cursor-pointer"
      >
        {hasAction && (
          <span className="absolute top-3 right-3 flex items-center gap-1 text-[10px] text-amber-400 font-semibold">
            <Zap className="w-3 h-3" /> Perlu Tindakan
          </span>
        )}

        {/* Brand name + service */}
        <div className="mb-3 pr-20">
          <p className="text-base font-bold text-white leading-tight">{String(p["brandName"] ?? "—")}</p>
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            {String(p["serviceName"] ?? "")}
            {p["packageName"] ? ` · ${String(p["packageName"])}` : ""}
          </p>
        </div>

        {/* Stage badge */}
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium w-fit mb-3 ${stageColor(String(p["currentStage"] ?? ""))}`}>
          {String(p["currentStageLabel"] ?? p["currentStage"] ?? "—")}
        </span>

        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-white/8 overflow-hidden mb-2">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: pct >= 80 ? "#34D399" : pct >= 40 ? "#6366F1" : "#FBBF24" }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500 mb-3">
          <span>{pct}% selesai</span>
          {Boolean(p["deliveryDate"]) && <span>Target: {fmtDate(String(p["deliveryDate"]))}</span>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/6">
          <span className="text-[11px] text-slate-600">{projectNumber}</span>
          <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 transition-colors" />
        </div>
      </motion.div>
    </Link>
  );
}

export default function CWProjectsPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "delivery_date">("newest");

  const { data, isLoading, error, refetch } = useCWProjects(token, { search, status, sort });
  const items = (data?.items ?? []) as Project[];
  const total = data?.total ?? 0;

  // Client-side tab filter (server already filters by status but we also filter client-side for instant UX)
  const filtered = useMemo(() => {
    if (!status) return items;
    return items.filter((p) => {
      const stage = String(p["currentStage"] ?? "");
      switch (status) {
        case "active":    return !["completed", "cancelled", "failed"].includes(stage);
        case "review":    return ["waiting_client_review", "client_review"].includes(stage) || p["reviewStatus"] === "shared";
        case "pending":   return ["waiting_payment", "draft", "brief_in_progress"].includes(stage);
        case "completed": return ["completed"].includes(stage);
        default:          return true;
      }
    });
  }, [items, status]);

  return (
    <CWLayout token={token} title="Semua Proyek" backHref={`/creative-workspace/${token}`}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Semua Proyek</h1>
        <p className="text-slate-400 text-sm">{total > 0 ? `${total} proyek total` : "Semua proyek kreatif Anda"}</p>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari brand atau layanan…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-white/10 bg-white/4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 transition"
          />
        </div>
        {/* Sort */}
        <div className="relative">
          <SortDesc className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="pl-9 pr-3 py-2.5 rounded-xl border border-white/10 bg-white/4 text-sm text-white focus:outline-none focus:border-indigo-500/40 appearance-none"
          >
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatus(tab.key)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              status === tab.key
                ? "bg-indigo-500 text-white"
                : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
        </div>
      ) : error ? (
        <CWError onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <CWEmpty variant="projects" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <ProjectCard key={String(p["projectNumber"])} p={p} token={token} />
          ))}
        </div>
      )}
    </CWLayout>
  );
}
