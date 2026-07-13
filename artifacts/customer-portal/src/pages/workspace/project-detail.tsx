import { useState, useMemo } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { WorkspaceLayout } from "@/components/workspace-layout";
import {
  useWorkspaceProjectDetail,
  useSignDownload,
  useRepeatOrder,
  useWorkspaceActivity,
} from "@/hooks/use-workspace";
import { fmtMoney, fmtDate, fmtDateTime, stageColor } from "@/lib/workspace-format";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, ArrowLeft, CheckCircle2, Download, Lock, FileText,
  Sparkles, RefreshCw, ExternalLink, Eye, AlertCircle, Info,
  Palette, Layers, Image, FileCode, FileAudio, ChevronDown, ChevronUp,
  Shield, CreditCard, Package,
} from "lucide-react";
import { WorkspaceAiWorkforce, CurrentAiTask } from "@/components/workspace-ai-workforce";
import { WorkspaceActivityFeed } from "@/components/workspace-activity-feed";
import { WorkspaceProjectHealth } from "@/components/workspace-project-health";
import { WorkspaceProjectTimeline } from "@/components/workspace-timeline";

/* ─── Tabs ───────────────────────────────────────────────────── */
const TABS = ["Overview", "Files", "Reviews", "Payments", "Invoices"] as const;
type Tab = (typeof TABS)[number];

/* ─── Helpers ────────────────────────────────────────────────── */
function fileIcon(category: string | null) {
  const c = (category ?? "").toLowerCase();
  if (c.includes("logo") || c.includes("design") || c.includes("visual")) return <Layers className="w-4 h-4 text-violet-400" />;
  if (c.includes("image") || c.includes("photo")) return <Image className="w-4 h-4 text-sky-400" />;
  if (c.includes("color") || c.includes("palette") || c.includes("brand")) return <Palette className="w-4 h-4 text-pink-400" />;
  if (c.includes("audio") || c.includes("voice")) return <FileAudio className="w-4 h-4 text-amber-400" />;
  if (c.includes("code") || c.includes("html")) return <FileCode className="w-4 h-4 text-emerald-400" />;
  return <FileText className="w-4 h-4 text-slate-400" />;
}

function fileStatusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "approved") return { label: "Approved", color: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  if (s === "pending_review" || s === "shared") return { label: "In Review", color: "bg-amber-100 text-amber-700 border-amber-200" };
  if (s === "revision") return { label: "Revision", color: "bg-red-100 text-red-700 border-red-200" };
  if (s === "generated") return { label: "Generated", color: "bg-blue-100 text-blue-700 border-blue-200" };
  return { label: status.replace(/_/g, " "), color: "bg-slate-100 text-slate-600 border-slate-200" };
}

/* ─── Insight banner ─────────────────────────────────────────── */
type InsightVariant = "info" | "warning" | "success" | "action";
type Insight = { variant: InsightVariant; icon: React.ReactNode; title: string; message: string };

function getInsight(
  stage: string,
  filesUnlocked: boolean,
  paymentStatus: string | null,
  reviewStatus: string | null,
  progress: number,
): Insight | null {
  if (stage === "completed" || stage === "delivered") {
    return { variant: "success", icon: <CheckCircle2 className="w-4 h-4" />, title: "Project Complete", message: "Your project has been delivered. Download your files below." };
  }
  if (!filesUnlocked && (paymentStatus === "pending" || paymentStatus === "waiting_verification")) {
    return { variant: "action", icon: <CreditCard className="w-4 h-4" />, title: "Payment Verification Pending", message: "Your payment is being verified. Files will unlock once confirmed." };
  }
  if (reviewStatus === "shared" || stage === "waiting_review" || stage === "revision_requested") {
    return { variant: "warning", icon: <Eye className="w-4 h-4" />, title: "Your Review is Needed", message: "The team is waiting for your feedback to continue production." };
  }
  if (stage === "running" || stage === "in_progress" || stage === "generating") {
    return { variant: "info", icon: <Sparkles className="w-4 h-4" />, title: "AI Team is Working", message: `${progress}% complete — your AI team is actively producing your deliverables.` };
  }
  if (stage === "pending") {
    return { variant: "info", icon: <Package className="w-4 h-4" />, title: "Project Queued", message: "Your project is in the queue and will begin soon." };
  }
  return null;
}

const INSIGHT_STYLES: Record<InsightVariant, { bg: string; border: string; text: string }> = {
  info:    { bg: "bg-primary/5",   border: "border-primary/20",   text: "text-primary" },
  warning: { bg: "bg-amber-50",    border: "border-amber-200",    text: "text-amber-700" },
  success: { bg: "bg-emerald-50",  border: "border-emerald-200",  text: "text-emerald-700" },
  action:  { bg: "bg-violet-50",   border: "border-violet-200",   text: "text-violet-700" },
};

/* ─── Right-panel divider ────────────────────────────────────── */
function PanelDivider() {
  return <div className="my-5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }} />;
}

/* ─── Collapsible section for mobile AI panel ────────────────── */
function CollapsibleSection({
  title, defaultOpen = false, children,
}: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between py-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 rounded"
      >
        <span className="text-[13px] font-semibold text-white/70 uppercase tracking-wide">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────── */
export default function WorkspaceProjectDetailPage({
  params,
}: {
  params: { token: string; projectNumber: string };
}) {
  const { token, projectNumber } = params;
  const [tab, setTab] = useState<Tab>("Overview");
  const [mobileAiOpen, setMobileAiOpen] = useState(false);

  const { data, isLoading, error } = useWorkspaceProjectDetail(token, projectNumber);
  const { data: activityData } = useWorkspaceActivity(token);
  const signDownload = useSignDownload(token);
  const repeatOrder = useRepeatOrder(token);
  const { toast } = useToast();

  /* ── Loading ── */
  if (isLoading) {
    return (
      <WorkspaceLayout token={token}>
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <div className="relative">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <div className="absolute inset-0 blur-lg opacity-30 bg-primary rounded-full" />
          </div>
          <p className="text-sm text-muted-foreground animate-pulse">Loading project workspace…</p>
        </div>
      </WorkspaceLayout>
    );
  }

  /* ── Error ── */
  if (error || !data) {
    return (
      <WorkspaceLayout token={token}>
        <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground/40" />
          <div>
            <h2 className="text-2xl font-serif mb-2">Project not found</h2>
            <p className="text-muted-foreground text-sm mb-6">This link may be expired or the project doesn't exist.</p>
          </div>
          <Link href={`/workspace/${token}/projects`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <ArrowLeft className="w-4 h-4" /> Back to projects
          </Link>
        </div>
      </WorkspaceLayout>
    );
  }

  const { overview, runtime } = data;
  const activityItems = activityData?.items ?? [];
  const hasLiveRuntime = !!(runtime?.isLive && runtime.workers.length > 0);
  const isDemo = !hasLiveRuntime && (overview.assignedAiTeam ?? []).length === 0;

  const insight = getInsight(
    overview.currentStage,
    overview.filesUnlocked,
    overview.paymentStatus,
    overview.reviewStatus,
    overview.progressPercent ?? 0,
  );

  /* ── Handlers ── */
  async function handleDownload(assetId: number, locked: boolean) {
    if (locked) {
      toast({ title: "File locked", description: "This file unlocks once payment is verified.", variant: "destructive" });
      return;
    }
    try {
      const res = await signDownload.mutateAsync(assetId);
      window.open(res.downloadUrl, "_blank");
    } catch (e) {
      toast({ title: "Could not generate link", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function handleRepeatOrder(mode: "similar" | "duplicate" | "use_brief") {
    try {
      const res = await repeatOrder.mutateAsync({ projectNumber, mode });
      window.location.href = res.redirectTo;
    } catch (e) {
      toast({ title: "Could not start repeat order", description: (e as Error).message, variant: "destructive" });
    }
  }

  /* ── Tab badge counts ── */
  const tabBadge: Partial<Record<Tab, number>> = {
    Files: data.deliverables.length,
    Reviews: data.reviews.length,
    Payments: data.payments.length,
    Invoices: data.invoices.length,
  };

  /* ─────────────────────── AI INTELLIGENCE PANEL ─────────────── */
  const AiPanel = (
    <div className="space-y-0">
      {/* Current AI Task */}
      {(overview.currentStage !== "completed" && overview.currentStage !== "delivered") && (
        <>
          <CurrentAiTask
            stageName={overview.currentStage}
            stageLabel={overview.currentStageLabel}
            team={overview.assignedAiTeam ?? []}
            runtime={runtime}
            deliveryDate={overview.deliveryDate}
            filesCount={data.deliverables.length}
            startedAt={overview.createdAt}
          />
          <PanelDivider />
        </>
      )}

      {/* Workforce */}
      <WorkspaceAiWorkforce
        team={overview.assignedAiTeam ?? []}
        runtime={runtime}
        isDemoPlaceholder={isDemo}
      />

      {/* Activity */}
      <PanelDivider />
      <WorkspaceActivityFeed items={activityItems} maxItems={8} />

      {/* Timeline */}
      <PanelDivider />
      <WorkspaceProjectTimeline steps={data.timeline} />

      {/* Health */}
      <PanelDivider />
      <WorkspaceProjectHealth
        overview={overview}
        timeline={data.timeline}
        reviews={data.reviews}
        deliverables={data.deliverables}
      />
    </div>
  );

  return (
    <WorkspaceLayout token={token}>
      {/* ── Back nav ── */}
      <Link
        href={`/workspace/${token}/projects`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors group focus-visible:ring-2 focus-visible:ring-primary rounded"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        All Projects
      </Link>

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-3xl font-serif font-medium leading-tight">{overview.brandName}</h1>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${stageColor(overview.currentStage)}`}>
              {overview.currentStageLabel}
            </span>
          </div>
          <p className="text-muted-foreground">{overview.serviceName}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {overview.reviewUrl && (
            <a
              href={overview.reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium bg-primary text-primary-foreground px-4 py-2 rounded-full hover:bg-primary/90 transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Eye className="w-3.5 h-3.5" /> Review Files
            </a>
          )}
          <button
            onClick={() => handleRepeatOrder("similar")}
            disabled={repeatOrder.isPending}
            className="inline-flex items-center gap-1.5 text-sm font-medium bg-card border border-card-border px-4 py-2 rounded-full hover:border-primary/40 transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            data-testid="button-repeat-order"
          >
            {repeatOrder.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Repeat Order
          </button>
        </div>
      </div>

      {/* ── Insight banner ── */}
      <AnimatePresence>
        {insight && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={`mb-6 flex items-start gap-3 rounded-2xl p-4 border ${INSIGHT_STYLES[insight.variant].bg} ${INSIGHT_STYLES[insight.variant].border}`}
          >
            <span className={`shrink-0 mt-0.5 ${INSIGHT_STYLES[insight.variant].text}`}>
              {insight.icon}
            </span>
            <div>
              <p className={`text-sm font-semibold ${INSIGHT_STYLES[insight.variant].text}`}>
                {insight.title}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">{insight.message}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Recommendations ── */}
      {data.recommendations.length > 0 && (
        <div className="mb-6 bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">You might also like</p>
            <p className="text-sm text-muted-foreground">{data.recommendations.join(", ")}</p>
          </div>
        </div>
      )}

      {/* ── Mobile AI panel toggle ── */}
      <button
        className="lg:hidden w-full flex items-center justify-between mb-4 rounded-2xl px-5 py-3.5 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        style={{ background: "#0F172A", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={() => setMobileAiOpen(v => !v)}
        aria-expanded={mobileAiOpen}
        aria-label="Toggle AI Intelligence panel"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-orange-400" />
          AI Intelligence
          {isDemo && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold">DEMO</span>
          )}
        </span>
        {mobileAiOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {/* Mobile AI panel */}
      <AnimatePresence initial={false}>
        {mobileAiOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeInOut" }}
            className="lg:hidden overflow-hidden mb-6 rounded-2xl"
            style={{ background: "#0F172A", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="p-5">
              {AiPanel}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main two-column layout ── */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-8 items-start">

        {/* ── LEFT: Tab content ── */}
        <div className="lg:col-span-7">
          {/* Tab strip */}
          <div
            className="flex items-center gap-1 mb-5 p-1 rounded-xl overflow-x-auto"
            role="tablist"
            aria-label="Project sections"
            style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)" }}
          >
            {TABS.map((t) => {
              const count = tabBadge[t];
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`relative flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium whitespace-nowrap rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
                    tab === t
                      ? "bg-white shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`tab-${t.toLowerCase()}`}
                >
                  {t}
                  {count != null && count > 0 && (
                    <span className={`text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center ${
                      tab === t ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {/* ── Overview ── */}
              {tab === "Overview" && (
                <div className="space-y-5">
                  {/* Key metrics strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Progress", value: `${overview.progressPercent ?? 0}%` },
                      { label: "Delivery", value: overview.deliveryDate ? fmtDate(overview.deliveryDate) : "—" },
                      { label: "Total", value: overview.total ? fmtMoney(overview.total, overview.currency) : "—" },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-card border border-card-border rounded-2xl p-4 text-center">
                        <p className="text-xs text-muted-foreground mb-1">{label}</p>
                        <p className="font-semibold font-serif text-lg">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Brief details */}
                  <div className="bg-card border border-card-border rounded-2xl p-5">
                    <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      Project Brief
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(
                        [
                          ["Business Type", overview.businessType],
                          ["Target Market", overview.targetMarket],
                          ["Product / Service", overview.productOrService],
                          ["Goal", overview.goal],
                          ["Style Preference", overview.stylePreference],
                          ["Color Preference", overview.colorPreference],
                        ] as [string, string | null | undefined][]
                      )
                        .filter(([, v]) => v)
                        .map(([label, value]) => (
                          <div key={label}>
                            <p className="text-[11px] text-muted-foreground/70 mb-0.5 uppercase tracking-wide">{label}</p>
                            <p className="text-sm font-medium">{value}</p>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Package info */}
                  {overview.packageName && (
                    <div className="bg-card border border-card-border rounded-2xl p-5">
                      <h3 className="text-sm font-semibold mb-2">Package</h3>
                      <p className="text-sm">{overview.packageName}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Files ── */}
              {tab === "Files" && (
                <div className="space-y-3">
                  {data.deliverables.length === 0 ? (
                    <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
                      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                        <FileText className="w-6 h-6 text-muted-foreground/50" />
                      </div>
                      <h3 className="font-medium mb-1">No files yet</h3>
                      <p className="text-sm text-muted-foreground">Your AI team is still working on your deliverables.</p>
                    </div>
                  ) : (
                    data.deliverables.map((d, i) => {
                      const badge = fileStatusBadge(d.status);
                      return (
                        <motion.div
                          key={d.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="bg-card border border-card-border rounded-2xl p-4 flex items-center gap-4 hover:border-primary/30 transition-colors group"
                        >
                          {/* File icon */}
                          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                            {fileIcon(d.category)}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm truncate">{d.title}</p>
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${badge.color}`}>
                                {badge.label}
                              </span>
                              {d.approvedBy && (
                                <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                                  <Shield className="w-3 h-3" /> Approved
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              v{d.version}
                              {d.category && ` · ${d.category}`}
                              {" · "}
                              {fmtDate(d.createdAt)}
                            </p>
                            {d.revisionNotes && (
                              <p className="text-xs text-amber-600 mt-1 flex items-start gap-1">
                                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                                {d.revisionNotes}
                              </p>
                            )}
                          </div>

                          {/* Download button */}
                          <button
                            onClick={() => handleDownload(d.id, d.locked)}
                            disabled={signDownload.isPending}
                            aria-label={d.locked ? "File locked — awaiting payment" : `Download ${d.title}`}
                            className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all focus-visible:ring-2 focus-visible:ring-primary ${
                              d.locked
                                ? "bg-muted text-muted-foreground cursor-not-allowed"
                                : "bg-primary/10 text-primary hover:bg-primary/20 hover:scale-110"
                            }`}
                            data-testid={`button-download-${d.id}`}
                          >
                            {signDownload.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : d.locked ? (
                              <Lock className="w-4 h-4" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </button>
                        </motion.div>
                      );
                    })
                  )}
                </div>
              )}

              {/* ── Reviews ── */}
              {tab === "Reviews" && (
                <div className="space-y-3">
                  {overview.reviewUrl && (
                    <a
                      href={overview.reviewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-4 bg-primary/5 border border-primary/20 rounded-2xl p-4 hover:bg-primary/10 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <Eye className="w-5 h-5 text-primary" />
                        <div>
                          <p className="text-sm font-semibold text-primary">Open Review Portal</p>
                          <p className="text-xs text-muted-foreground">View and approve your deliverables</p>
                        </div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-primary group-hover:translate-x-0.5 transition-transform" />
                    </a>
                  )}

                  {data.reviews.length === 0 ? (
                    <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
                      <Eye className="w-10 h-10 mx-auto text-muted-foreground/30 mb-4" />
                      <h3 className="font-medium mb-1">No review sessions yet</h3>
                      <p className="text-sm text-muted-foreground">Review requests will appear here as your project progresses.</p>
                    </div>
                  ) : (
                    <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
                      <ul className="divide-y divide-border/50">
                        {data.reviews.map((r, i) => {
                          const badge = fileStatusBadge(r.status);
                          return (
                            <li key={i} className="flex items-center justify-between gap-4 px-5 py-4">
                              <div>
                                <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border capitalize ${badge.color}`}>
                                  {badge.label}
                                </span>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {fmtDateTime(r.sharedAt ?? r.createdAt)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* ── Payments ── */}
              {tab === "Payments" && (
                <div>
                  {data.payments.length === 0 ? (
                    <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
                      <CreditCard className="w-10 h-10 mx-auto text-muted-foreground/30 mb-4" />
                      <h3 className="font-medium mb-1">No payment schedule</h3>
                      <p className="text-sm text-muted-foreground">Payment details will appear here once set up.</p>
                    </div>
                  ) : (
                    <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" role="table">
                          <thead>
                            <tr className="text-left text-xs text-muted-foreground border-b border-border/50 bg-muted/30">
                              <th className="px-5 py-3 font-semibold">Installment</th>
                              <th className="px-5 py-3 font-semibold">Amount</th>
                              <th className="px-5 py-3 font-semibold">Status</th>
                              <th className="px-5 py-3 font-semibold">Due</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.payments.map((p, i) => {
                              const badge = fileStatusBadge(p.status);
                              return (
                                <motion.tr
                                  key={p.id}
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ delay: i * 0.04 }}
                                  className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
                                >
                                  <td className="px-5 py-4 font-medium">{p.installmentLabel}</td>
                                  <td className="px-5 py-4 font-semibold">{fmtMoney(p.amount, overview.currency)}</td>
                                  <td className="px-5 py-4">
                                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border capitalize ${badge.color}`}>
                                      {badge.label}
                                    </span>
                                  </td>
                                  <td className="px-5 py-4 text-muted-foreground">{fmtDate(p.dueDate)}</td>
                                </motion.tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Invoices ── */}
              {tab === "Invoices" && (
                <div className="space-y-3">
                  {data.invoices.length === 0 ? (
                    <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
                      <FileText className="w-10 h-10 mx-auto text-muted-foreground/30 mb-4" />
                      <h3 className="font-medium mb-1">No invoices yet</h3>
                      <p className="text-sm text-muted-foreground">Invoices will appear here once issued.</p>
                    </div>
                  ) : (
                    data.invoices.map((inv, i) => {
                      const badge = fileStatusBadge(inv.status);
                      return (
                        <motion.div
                          key={inv.id}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="bg-card border border-card-border rounded-2xl p-5 flex items-center justify-between gap-4 hover:border-primary/30 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                              <FileText className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{inv.invoiceNumber}</p>
                              <p className="text-xs text-muted-foreground">{fmtDate(inv.issuedAt)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border capitalize ${badge.color}`}>
                              {badge.label}
                            </span>
                            <p className="font-semibold">{fmtMoney(inv.total, overview.currency)}</p>
                            <Link
                              href={`/workspace/${token}/invoices`}
                              className="text-xs font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary rounded"
                            >
                              View
                            </Link>
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ── RIGHT: AI Intelligence panel (desktop) ── */}
        <div className="hidden lg:block lg:col-span-5">
          <div
            className="sticky top-8 rounded-2xl p-5 max-h-[calc(100vh-5rem)] overflow-y-auto"
            style={{
              background: "#0F172A",
              border: "1px solid rgba(255,255,255,0.07)",
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(255,255,255,0.1) transparent",
            }}
          >
            {AiPanel}
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
