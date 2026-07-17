/**
 * creative-workspace/project-detail.tsx — Project detail with tabs (Team 2).
 * Route: /creative-workspace/:token/projects/:projectNumber
 * Tabs: Overview | Brief | Progress | Files | Reviews | History
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, RefreshCw, FolderKanban, ClipboardList,
  Layers, RotateCcw, Activity, ArrowLeft, ChevronRight,
} from "lucide-react";
import { CWLayout } from "@/components/creative-workspace/cw-layout";
import { CWLoading, CWError, CWEmpty } from "@/components/creative-workspace/cw-empty";
import { CWBriefCard } from "@/components/creative-workspace/cw-brief-card";
import { CWProgressStages } from "@/components/creative-workspace/cw-progress-stages";
import { CWDeliverableGrid } from "@/components/creative-workspace/cw-deliverable-grid";
import { CWRevisionThread } from "@/components/creative-workspace/cw-revision-thread";
import { CWEventFeed } from "@/components/creative-workspace/cw-event-feed";
import {
  useCWBriefStatus,
  useCWProgress,
  useCWDeliverables,
  useCWRevisions,
  useCWHistory,
  useCWProjects,
} from "@/hooks/creative-workspace";

const TABS = [
  { id: "overview",  label: "Overview",  icon: FolderKanban },
  { id: "brief",     label: "Brief",     icon: ClipboardList },
  { id: "progress",  label: "Progress",  icon: Loader2 },
  { id: "deliverables", label: "Files",  icon: Layers },
  { id: "revisions", label: "Reviews",   icon: RotateCcw },
  { id: "history",   label: "History",   icon: Activity },
] as const;
type TabId = (typeof TABS)[number]["id"];

function stageColor(stage: string) {
  if (stage === "completed") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/25";
  if (["waiting_client_review", "client_review"].includes(stage)) return "bg-amber-500/15 text-amber-300 border-amber-500/25";
  if (["revision", "revision_requested"].includes(stage)) return "bg-orange-500/15 text-orange-300 border-orange-500/25";
  if (["failed", "cancelled"].includes(stage)) return "bg-red-500/15 text-red-300 border-red-500/25";
  return "bg-indigo-500/15 text-indigo-300 border-indigo-500/25";
}

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }); } catch { return null; }
}

// ── Tab Content ────────────────────────────────────────────────────────────────
function TabOverview({ project }: { project: Record<string, unknown> }) {
  const fields = [
    ["Nomor Proyek",   String(project["projectNumber"] ?? "—")],
    ["Brand",          String(project["brandName"] ?? "—")],
    ["Layanan",        String(project["serviceName"] ?? "—")],
    ["Paket",          project["packageName"] ? String(project["packageName"]) : "—"],
    ["Status",         String(project["currentStageLabel"] ?? project["currentStage"] ?? "—")],
    ["Pembayaran",     String(project["paymentStatus"] ?? "—")],
    ["Deadline",       fmtDate(project["deliveryDate"] as string) ?? "—"],
    ["Dibuat",         fmtDate(project["createdAt"] as string) ?? "—"],
  ];
  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 overflow-hidden">
      {fields.map(([label, value]) => (
        <div key={label} className="flex items-center px-4 py-3 border-b border-white/5 last:border-0">
          <span className="text-xs text-slate-500 w-36 shrink-0">{label}</span>
          <span className="text-sm text-white">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function CWProjectDetailPage({
  params,
}: {
  params: { token: string; projectNumber: string };
}) {
  const { token, projectNumber } = params;
  const [, setLocation] = useLocation();

  // Parse tab from URL search params
  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );
  const defaultTab = (searchParams.get("tab") as TabId | null) ?? "overview";
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  // Load project summary from the list endpoint (lightweight)
  const { data: projectsData, isLoading: projectsLoading } = useCWProjects(token, {});
  const project = (projectsData?.items ?? []).find(
    (p) => String(p["projectNumber"]) === projectNumber
  ) as Record<string, unknown> | undefined;

  // Tab-specific data
  const { data: brief, isLoading: briefLoading } = useCWBriefStatus(token, projectNumber);
  const { data: progress, isLoading: progressLoading } = useCWProgress(token, projectNumber);
  const { data: deliverables, isLoading: delivLoading } = useCWDeliverables(token, projectNumber);
  const { data: revisions, isLoading: revLoading } = useCWRevisions(token, projectNumber);
  const { data: history, isLoading: histLoading } = useCWHistory(token, projectNumber);

  const pct = Number(project?.["progressPercent"] ?? 0);

  if (projectsLoading && !project) {
    return <CWLayout token={token}><CWLoading message="Memuat detail proyek…" /></CWLayout>;
  }

  if (!project && !projectsLoading) {
    return (
      <CWLayout token={token} backHref={`/creative-workspace/${token}/projects`}>
        <CWError title="Proyek Tidak Ditemukan" message="Proyek tidak ditemukan atau bukan milik akun ini." />
      </CWLayout>
    );
  }

  const stage = String(project?.["currentStage"] ?? "");
  const stageLabel = String(project?.["currentStageLabel"] ?? stage);

  return (
    <CWLayout token={token} title={String(project?.["brandName"] ?? "Detail Proyek")} backHref={`/creative-workspace/${token}/projects`}>
      {/* Project header */}
      <div className="mb-6">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-white mb-1">{String(project?.["brandName"] ?? "—")}</h1>
            <p className="text-slate-400 text-sm">
              {String(project?.["serviceName"] ?? "")}{project?.["packageName"] ? ` · ${String(project?.["packageName"])}` : ""}
            </p>
          </div>
          <span className={`text-xs px-3 py-1.5 rounded-full border font-medium ${stageColor(stage)}`}>
            {stageLabel}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>Progress keseluruhan</span>
            <span className="font-semibold text-white">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/8 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: pct >= 80 ? "#34D399" : pct >= 40 ? "#6366F1" : "#FBBF24" }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 overflow-x-auto scrollbar-none pb-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-indigo-500 text-white"
                  : "text-slate-400 hover:text-white hover:bg-white/8"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === "overview" && project && <TabOverview project={project} />}

          {activeTab === "brief" && (
            briefLoading ? <CWLoading message="Memuat brief…" /> :
            brief        ? <CWBriefCard brief={brief} /> :
            <CWEmpty variant="generic" description="Data brief tidak tersedia." />
          )}

          {activeTab === "progress" && (
            progressLoading ? <CWLoading message="Memuat progress…" /> :
            progress ? (
              <CWProgressStages
                stages={progress.stages}
                progressPercent={progress.progressPercent}
                overallStageLabel={progress.overallStageLabel}
                estimatedDelivery={progress.estimatedDelivery}
                lastActivityAt={progress.lastActivityAt}
              />
            ) : <CWEmpty variant="generic" description="Data progress belum tersedia." />
          )}

          {activeTab === "deliverables" && (
            delivLoading ? <CWLoading message="Memuat file…" /> :
            deliverables ? (
              <CWDeliverableGrid
                deliverables={deliverables.deliverables}
                zipBundle={deliverables.zipBundle}
                filesUnlocked={deliverables.filesUnlocked}
                totalAssets={deliverables.totalAssets}
                approvedAssets={deliverables.approvedAssets}
              />
            ) : <CWEmpty variant="deliverables" />
          )}

          {activeTab === "revisions" && (
            revLoading ? <CWLoading message="Memuat riwayat review…" /> :
            revisions ? (
              <CWRevisionThread
                entries={revisions.entries}
                currentStatusLabel={revisions.currentStatusLabel}
                totalRounds={revisions.totalRounds}
              />
            ) : <CWEmpty variant="revisions" />
          )}

          {activeTab === "history" && (
            histLoading ? <CWLoading message="Memuat riwayat aktivitas…" /> :
            history ? (
              <CWEventFeed events={history.events} total={history.total} />
            ) : <CWEmpty variant="history" />
          )}
        </motion.div>
      </AnimatePresence>
    </CWLayout>
  );
}
