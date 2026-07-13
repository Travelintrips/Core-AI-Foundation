import { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { WorkspaceLayout } from "@/components/workspace-layout";
import {
  useWorkspaceSummary,
  useWorkspaceProjects,
  useWorkspaceActivity,
} from "@/hooks/use-workspace";
import { fmtMoney, fmtDate, stageColor } from "@/lib/workspace-format";
import {
  FolderKanban, Clock, CheckCircle2, Wallet, Download, Palette,
  Loader2, ArrowRight, Zap, AlertCircle, Sparkles, TrendingUp, ArrowLeft,
} from "lucide-react";
import { WorkspaceActivityFeed } from "@/components/workspace-activity-feed";

/* ─── Stat card ───────────────────────────────────────────────── */
type StatCardProps = {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  iconBg: string;
  delay?: number;
};

function StatCard({ label, value, icon: Icon, color, iconBg, delay = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className="bg-card border border-card-border rounded-2xl p-5 shadow-sm hover:border-primary/25 transition-colors"
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${iconBg}`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <p className="text-2xl font-serif font-semibold leading-none mb-1">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </motion.div>
  );
}

/* ─── Project status pill ──────────────────────────────────────── */
function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 rounded-full overflow-hidden bg-muted mt-2">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-primary to-orange-400"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(value, 100)}%` }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────── */
export default function WorkspaceDashboardPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data: summary, isLoading, error } = useWorkspaceSummary(token);
  const { data: projects } = useWorkspaceProjects(token, { sort: "newest" });
  const { data: activity } = useWorkspaceActivity(token);

  if (isLoading) {
    return (
      <WorkspaceLayout token={token}>
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <div className="relative">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <div className="absolute inset-0 blur-xl opacity-30 bg-primary rounded-full" />
          </div>
          <p className="text-sm text-muted-foreground animate-pulse">Loading workspace…</p>
        </div>
      </WorkspaceLayout>
    );
  }

  if (error || !summary) {
    return (
      <WorkspaceLayout token={token}>
        <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground/40" />
          <div>
            <h2 className="text-2xl font-serif mb-2">Workspace not found</h2>
            <p className="text-muted-foreground text-sm">This link may be expired or invalid.</p>
          </div>
        </div>
      </WorkspaceLayout>
    );
  }

  const cards: StatCardProps[] = [
    {
      label: "Active Projects",
      value: summary.activeProjects,
      icon: FolderKanban,
      color: "text-primary",
      iconBg: "bg-primary/10",
    },
    {
      label: "Awaiting Your Review",
      value: summary.waitingReview,
      icon: Clock,
      color: "text-amber-600",
      iconBg: "bg-amber-100 dark:bg-amber-900/30",
    },
    {
      label: "Completed",
      value: summary.completedProjects,
      icon: CheckCircle2,
      color: "text-emerald-600",
      iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
    },
    {
      label: "Outstanding Balance",
      value: fmtMoney(summary.outstandingBalance, summary.outstandingCurrency),
      icon: Wallet,
      color: summary.outstandingBalance > 0 ? "text-red-600" : "text-emerald-600",
      iconBg: summary.outstandingBalance > 0
        ? "bg-red-100 dark:bg-red-900/30"
        : "bg-emerald-100 dark:bg-emerald-900/30",
    },
    {
      label: "Downloads Ready",
      value: summary.downloadCount,
      icon: Download,
      color: "text-sky-600",
      iconBg: "bg-sky-100 dark:bg-sky-900/30",
    },
    {
      label: "Brand Assets",
      value: summary.brandAssetCount,
      icon: Palette,
      color: "text-violet-600",
      iconBg: "bg-violet-100 dark:bg-violet-900/30",
    },
  ];

  const recentProjects = (projects?.items ?? []).slice(0, 5);
  const activityItems = activity?.items ?? [];

  /* ── Action needed banner ── */
  const actionNeeded = summary.waitingReview > 0 || summary.outstandingBalance > 0;

  return (
    <WorkspaceLayout token={token}>
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Kembali ke Beranda
      </Link>
      {/* ── Header ── */}
      <div className="mb-8">
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-serif font-medium mb-1"
          data-testid="text-workspace-greeting"
        >
          Welcome back, {summary.clientName}
        </motion.h1>
        <p className="text-muted-foreground">
          {summary.activeProjects > 0
            ? `${summary.activeProjects} active project${summary.activeProjects !== 1 ? "s" : ""} in progress.`
            : "Here's an overview of your workspace."}
        </p>
      </div>

      {/* ── Action needed banner ── */}
      {actionNeeded && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 rounded-2xl p-4 flex items-start gap-3 bg-amber-50 border border-amber-200"
        >
          <Zap className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-700">Action needed</p>
            <p className="text-sm text-amber-600 mt-0.5">
              {[
                summary.waitingReview > 0 && `${summary.waitingReview} project${summary.waitingReview !== 1 ? "s" : ""} waiting for your review`,
                summary.outstandingBalance > 0 && `${fmtMoney(summary.outstandingBalance, summary.outstandingCurrency)} outstanding balance`,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Stat cards grid ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        {cards.map((c, i) => (
          <StatCard key={c.label} {...c} delay={i * 0.06} />
        ))}
      </div>

      {/* ── Bottom grid: projects + activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Recent projects */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-serif font-medium">Recent Projects</h2>
            <Link
              href={`/workspace/${token}/projects`}
              className="text-sm text-primary hover:underline flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-primary rounded"
            >
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {recentProjects.length === 0 ? (
            <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
              <FolderKanban className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
              <h3 className="font-medium mb-1">No projects yet</h3>
              <p className="text-sm text-muted-foreground">Your projects will appear here once started.</p>
              <Link
                href="/services"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Sparkles className="w-3.5 h-3.5" /> Browse services
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentProjects.map((p, i) => (
                <motion.div
                  key={p.projectNumber}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                >
                  <Link
                    href={`/workspace/${token}/projects/${p.projectNumber}`}
                    className="block group focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
                  >
                    <div className="bg-card border border-card-border rounded-2xl p-5 shadow-sm group-hover:border-primary/30 transition-all">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                            {p.brandName}
                          </h3>
                          <p className="text-sm text-muted-foreground truncate">{p.serviceName}</p>
                        </div>
                        <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${stageColor(p.currentStage)}`}>
                          {p.currentStageLabel}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>Progress</span>
                        <span className="font-medium">{p.progressPercent ?? 0}%</span>
                      </div>
                      <ProgressBar value={p.progressPercent ?? 0} />

                      {/* Footer meta */}
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        {p.deliveryDate && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {fmtDate(p.deliveryDate)}
                          </span>
                        )}
                        {(p.assignedAiTeam ?? []).length > 0 && (
                          <span className="flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-primary/60" />
                            {p.assignedAiTeam.length} AI worker{p.assignedAiTeam.length !== 1 ? "s" : ""}
                          </span>
                        )}
                        {p.filesUnlocked && (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <Download className="w-3 h-3" /> Files ready
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}

              {(projects?.total ?? 0) > 5 && (
                <Link
                  href={`/workspace/${token}/projects`}
                  className="block text-center text-sm text-muted-foreground hover:text-foreground py-2 transition-colors"
                >
                  +{(projects?.total ?? 0) - 5} more projects →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Activity feed */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-xl font-serif font-medium">Activity</h2>
          </div>
          <div
            className="rounded-2xl p-5 overflow-hidden"
            style={{
              background: "#0F172A",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <WorkspaceActivityFeed items={activityItems} maxItems={8} />
            {activityItems.length === 0 && (
              <p className="text-xs text-center py-6" style={{ color: "#475569" }}>
                Activity will appear here as your projects progress.
              </p>
            )}
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
