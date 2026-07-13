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
  Loader2, ArrowRight, Zap, AlertCircle, Sparkles, TrendingUp,
} from "lucide-react";
import { WorkspaceActivityFeed } from "@/components/workspace-activity-feed";
import { useTranslation } from "@/lib/i18n";

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

export default function WorkspaceDashboardPage({ params }: { params: { token: string } }) {
  const { t } = useTranslation();
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
          <p className="text-sm text-muted-foreground animate-pulse">{t('workspace.loading')}</p>
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
            <h2 className="text-2xl font-serif mb-2">{t('workspace.notFound')}</h2>
            <p className="text-muted-foreground text-sm">{t('workspace.notFoundDesc')}</p>
          </div>
        </div>
      </WorkspaceLayout>
    );
  }

  const cards: StatCardProps[] = [
    { label: t('workspace.stats.active'),      value: summary.activeProjects,      icon: FolderKanban, color: "text-primary",    iconBg: "bg-primary/10" },
    { label: t('workspace.stats.waiting'),     value: summary.waitingReview,       icon: Clock,        color: "text-amber-600",  iconBg: "bg-amber-100 dark:bg-amber-900/30" },
    { label: t('workspace.stats.completed'),   value: summary.completedProjects,   icon: CheckCircle2, color: "text-emerald-600",iconBg: "bg-emerald-100 dark:bg-emerald-900/30" },
    { label: t('workspace.stats.balance'),
      value: fmtMoney(summary.outstandingBalance, summary.outstandingCurrency),
      icon: Wallet,
      color: summary.outstandingBalance > 0 ? "text-red-600" : "text-emerald-600",
      iconBg: summary.outstandingBalance > 0 ? "bg-red-100 dark:bg-red-900/30" : "bg-emerald-100 dark:bg-emerald-900/30",
    },
    { label: t('workspace.stats.downloads'),   value: summary.downloadCount,       icon: Download,     color: "text-sky-600",    iconBg: "bg-sky-100 dark:bg-sky-900/30" },
    { label: t('workspace.stats.brandAssets'), value: summary.brandAssetCount,     icon: Palette,      color: "text-violet-600", iconBg: "bg-violet-100 dark:bg-violet-900/30" },
  ];

  const recentProjects = (projects?.items ?? []).slice(0, 5);
  const activityItems  = activity?.items ?? [];
  const actionNeeded   = summary.waitingReview > 0 || summary.outstandingBalance > 0;

  return (
    <WorkspaceLayout token={token}>
      {/* Header */}
      <div className="mb-8">
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-serif font-medium mb-1"
          data-testid="text-workspace-greeting"
        >
          {t('workspace.greeting', { name: summary.clientName })}
        </motion.h1>
        <p className="text-muted-foreground">
          {summary.activeProjects > 0
            ? t('workspace.activeProjects', { count: summary.activeProjects })
            : t('workspace.overview')}
        </p>
      </div>

      {/* Action banner */}
      {actionNeeded && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 rounded-2xl p-4 flex items-start gap-3 bg-amber-50 border border-amber-200"
        >
          <Zap className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-700">{t('workspace.action.needed')}</p>
            <p className="text-sm text-amber-600 mt-0.5">
              {[
                summary.waitingReview > 0 && t('workspace.action.review', { count: summary.waitingReview }),
                summary.outstandingBalance > 0 && t('workspace.action.balance', { amount: fmtMoney(summary.outstandingBalance, summary.outstandingCurrency) }),
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
        </motion.div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        {cards.map((c, i) => (
          <StatCard key={c.label} {...c} delay={i * 0.05} />
        ))}
      </div>

      {/* Recent Projects */}
      {recentProjects.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-serif font-medium">{t('workspace.recent.projects')}</h2>
            <Link href={`/workspace/${token}/projects`}
              className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
              {t('workspace.recent.viewAll')} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="space-y-3">
            {recentProjects.map((p: { id: number; title: string; status: string; stage: string; progress?: number; updatedAt: string }, i) => (
              <motion.div key={p.id}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.05, duration: 0.3 }}
                className="bg-card border border-card-border rounded-xl p-4 hover:border-primary/25 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="font-medium text-sm leading-snug line-clamp-1">{p.title}</h3>
                  <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${stageColor(p.stage)}`}>
                    {p.status}
                  </span>
                </div>
                {typeof p.progress === "number" && <ProgressBar value={p.progress} />}
                <p className="text-xs text-muted-foreground mt-2">{fmtDate(p.updatedAt)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Feed */}
      {activityItems.length > 0 && (
        <WorkspaceActivityFeed items={activityItems} />
      )}

      {/* Empty state */}
      {recentProjects.length === 0 && activityItems.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-center py-16 rounded-2xl border border-dashed border-border"
        >
          <Sparkles className="w-10 h-10 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="font-serif font-medium text-lg mb-2">{t('workspace.recent.noProjects')}</h3>
          <p className="text-muted-foreground text-sm mb-6">{t('workspace.recent.noProjectsDesc')}</p>
          <Link href="/services" className="btn-primary inline-flex">
            {t('nav.startProject')} <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      )}
    </WorkspaceLayout>
  );
}
