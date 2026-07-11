import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceSummary, useWorkspaceProjects, useWorkspaceActivity } from "@/hooks/use-workspace";
import { fmtMoney, fmtDateTime, stageColor } from "@/lib/workspace-format";
import {
  FolderKanban, Clock, CheckCircle2, Wallet, Download, Palette, Loader2, ArrowRight, Activity as ActivityIcon,
} from "lucide-react";

export default function WorkspaceDashboardPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data: summary, isLoading, error } = useWorkspaceSummary(token);
  const { data: projects } = useWorkspaceProjects(token, { sort: "newest" });
  const { data: activity } = useWorkspaceActivity(token);

  if (isLoading) {
    return (
      <WorkspaceLayout token={token}>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </WorkspaceLayout>
    );
  }

  if (error || !summary) {
    return (
      <WorkspaceLayout token={token}>
        <div className="text-center py-24">
          <h2 className="text-2xl font-serif mb-2">Workspace not found</h2>
          <p className="text-muted-foreground">This link may be expired or invalid.</p>
        </div>
      </WorkspaceLayout>
    );
  }

  const cards = [
    { label: "Active Projects", value: summary.activeProjects, icon: FolderKanban, color: "bg-primary/10 text-primary" },
    { label: "Waiting on You", value: summary.waitingReview, icon: Clock, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    { label: "Completed", value: summary.completedProjects, icon: CheckCircle2, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    { label: "Outstanding Balance", value: fmtMoney(summary.outstandingBalance, summary.outstandingCurrency), icon: Wallet, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
    { label: "Downloads Ready", value: summary.downloadCount, icon: Download, color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" },
    { label: "Brand Assets", value: summary.brandAssetCount, icon: Palette, color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
  ];

  const recentProjects = (projects?.items ?? []).slice(0, 4);
  const recentActivity = (activity?.items ?? []).slice(0, 6);

  return (
    <WorkspaceLayout token={token}>
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-medium mb-1" data-testid="text-workspace-greeting">
          Welcome back, {summary.clientName}
        </h1>
        <p className="text-muted-foreground">Here's what's happening across your projects.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        {cards.map((c) => (
          <div key={c.label} className="bg-card border border-card-border rounded-2xl p-5 shadow-sm">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 ${c.color}`}>
              <c.icon className="w-5 h-5" />
            </div>
            <p className="text-xl font-serif font-semibold">{c.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-serif font-medium">Recent Projects</h2>
            <Link href={`/workspace/${token}/projects`} className="text-sm text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {recentProjects.length === 0 ? (
            <div className="bg-card border border-card-border rounded-2xl p-10 text-center text-muted-foreground">
              No projects yet.
            </div>
          ) : (
            <div className="space-y-3">
              {recentProjects.map((p) => (
                <Link key={p.projectNumber} href={`/workspace/${token}/projects/${p.projectNumber}`} className="block group">
                  <div className="bg-card border border-card-border rounded-2xl p-5 shadow-sm group-hover:border-primary/30 transition-colors flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-medium truncate">{p.brandName} — {p.serviceName}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Updated {fmtDateTime(p.updatedAt)}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${stageColor(p.currentStage)}`}>
                      {p.currentStageLabel}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-xl font-serif font-medium mb-4 flex items-center gap-2">
            <ActivityIcon className="w-4 h-4" /> Recent Activity
          </h2>
          <div className="bg-card border border-card-border rounded-2xl p-5 shadow-sm">
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="space-y-4">
                {recentActivity.map((a, i) => (
                  <li key={i} className="text-sm">
                    <p className="font-medium">{a.label}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
