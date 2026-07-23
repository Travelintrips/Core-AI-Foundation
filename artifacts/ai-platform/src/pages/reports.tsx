import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, BarChart3, TrendingUp, DollarSign, Cpu, Activity, Users, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

const API_BASE = "";
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  if (key) headers["x-admin-api-key"] = key;
  if (init?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body?.error as string) ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type AnalyticsOverview = {
  totalWorkflows: number;
  totalExecutions: number;
  totalTokensUsed: number;
  totalCost: number;
  avgLatencyMs: number;
  successRate: number;
};

type PaymentKpi = {
  paidRevenue: number;
  outstandingBalance: number;
  pendingVerificationCount: number;
  lockedProjects: number;
  unlockedProjects: number;
};

type JobStats = {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  retrying: number;
  cancelled: number;
  blocked: number;
  waiting: number;
};

function KpiCard({ label, value, sub, icon: Icon, accent, testId }: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof BarChart3;
  accent?: string;
  testId?: string;
}) {
  return (
    <div className="border border-border rounded-xl p-4 bg-card/40" data-testid={testId}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide leading-tight">{label}</span>
        <Icon className={`w-4 h-4 flex-shrink-0 ${accent ?? "text-muted-foreground"}`} />
      </div>
      <div className={`text-2xl font-bold font-mono ${accent ?? "text-foreground"}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h2>
      {children}
    </div>
  );
}

function fmtMoney(n: number, currency = "IDR") {
  if (currency === "IDR") return `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return n.toLocaleString();
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export default function ReportsPage() {
  const { data: analytics, isLoading: analyticsLoading, refetch: refetchAnalytics, isFetching: analyticsFetching } = useQuery({
    queryKey: ["reports", "analytics"],
    queryFn: () => apiFetch<AnalyticsOverview>("/api/ai/analytics/overview"),
    refetchInterval: 60_000,
  });

  const { data: kpi, isLoading: kpiLoading, refetch: refetchKpi } = useQuery({
    queryKey: ["reports", "payment-kpi"],
    queryFn: () => apiFetch<PaymentKpi>("/api/ai/payments/kpi"),
    refetchInterval: 60_000,
  });

  const { data: jobStats, isLoading: jobStatsLoading, refetch: refetchJobs } = useQuery({
    queryKey: ["reports", "job-stats"],
    queryFn: () => apiFetch<JobStats>("/api/ai/jobs/stats"),
    refetchInterval: 30_000,
  });

  const { data: serviceRequests, isLoading: srLoading } = useQuery({
    queryKey: ["reports", "service-requests"],
    queryFn: () => apiFetch<Array<{ status: string; total: string; currency: string }>>("/api/ai/catalog/requests"),
    refetchInterval: 60_000,
  });

  function handleRefreshAll() {
    refetchAnalytics();
    refetchKpi();
    refetchJobs();
  }

  const isLoading = analyticsLoading || kpiLoading || jobStatsLoading || srLoading;

  const srSummary = (() => {
    const all = serviceRequests ?? [];
    return {
      total: all.length,
      completed: all.filter((r) => r.status === "completed").length,
      inProgress: all.filter((r) => ["in_progress", "orchestrating", "waiting_review"].includes(r.status)).length,
      pending: all.filter((r) => ["draft", "brief_in_progress", "quoted", "quotation_ready", "waiting_customer_approval"].includes(r.status)).length,
    };
  })();

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8" data-testid="page-reports">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BarChart3 className="w-6 h-6" /> Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Operational KPIs aggregated from canonical sources — no hardcoded values.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefreshAll} disabled={analyticsFetching}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${analyticsFetching ? "animate-spin" : ""}`} /> Refresh All
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Financial */}
          <Section title="Financial Operations">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <KpiCard label="Paid Revenue" value={fmtMoney(kpi?.paidRevenue ?? 0)} icon={DollarSign} accent="text-green-400" testId="kpi-paid-revenue" />
              <KpiCard label="Outstanding" value={fmtMoney(kpi?.outstandingBalance ?? 0)} icon={Clock} accent="text-yellow-400" testId="kpi-outstanding" />
              <KpiCard label="Pending Verification" value={kpi?.pendingVerificationCount ?? 0} icon={AlertTriangle} accent="text-orange-400" testId="kpi-pending-verification" />
              <KpiCard label="Locked Projects" value={kpi?.lockedProjects ?? 0} icon={AlertTriangle} accent="text-red-400" testId="kpi-locked-projects" />
              <KpiCard label="Unlocked Projects" value={kpi?.unlockedProjects ?? 0} icon={CheckCircle2} accent="text-green-400" testId="kpi-unlocked-projects" />
            </div>
          </Section>

          {/* Service Requests */}
          <Section title="Service Request Funnel">
            <div className="grid grid-cols-4 gap-3">
              <KpiCard label="Total Requests" value={srSummary.total} icon={Users} testId="kpi-sr-total" />
              <KpiCard label="Completed" value={srSummary.completed} icon={CheckCircle2} accent="text-green-400" testId="kpi-sr-completed" />
              <KpiCard label="In Production" value={srSummary.inProgress} icon={Activity} accent="text-blue-400" testId="kpi-sr-in-progress" />
              <KpiCard label="Pending Review/Approval" value={srSummary.pending} icon={Clock} accent="text-yellow-400" testId="kpi-sr-pending" />
            </div>
          </Section>

          {/* AI Platform */}
          <Section title="AI Platform Performance">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Total Executions" value={(analytics?.totalExecutions ?? 0).toLocaleString()} icon={Activity} testId="kpi-executions" />
              <KpiCard label="Tokens Used" value={fmtTokens(analytics?.totalTokensUsed ?? 0)} icon={Cpu} testId="kpi-tokens" />
              <KpiCard label="Success Rate" value={`${((analytics?.successRate ?? 0) * 100).toFixed(1)}%`} icon={TrendingUp} accent="text-green-400" testId="kpi-success-rate" />
              <KpiCard label="Avg Latency" value={analytics?.avgLatencyMs ? `${Math.round(analytics.avgLatencyMs)}ms` : "—"} icon={Clock} testId="kpi-latency" />
            </div>
          </Section>

          {/* Job Engine */}
          <Section title="AI Job Engine">
            <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
              {[
                { key: "queued", label: "Queued", color: "text-blue-400" },
                { key: "running", label: "Running", color: "text-emerald-400" },
                { key: "retrying", label: "Retrying", color: "text-yellow-400" },
                { key: "completed", label: "Completed", color: "text-green-400" },
                { key: "failed", label: "Failed", color: "text-red-400" },
                { key: "cancelled", label: "Cancelled", color: "text-zinc-400" },
                { key: "blocked", label: "Blocked", color: "text-orange-400" },
                { key: "waiting", label: "Waiting", color: "text-slate-400" },
              ].map(({ key, label, color }) => (
                <div key={key} className="border border-border rounded-xl p-3 bg-card/40" data-testid={`kpi-job-${key}`}>
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
                  <div className={`text-xl font-bold font-mono ${color}`}>{(jobStats as Record<string, number>)?.[key] ?? 0}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* Note on data source integrity */}
          <div className="border border-border/50 rounded-xl p-4 bg-muted/5 text-xs text-muted-foreground space-y-1">
            <div className="font-semibold text-foreground/70 mb-2">Data Source Integrity</div>
            <div>✅ Financial KPIs: <code>ai_payment_schedules</code> via canonical billing service</div>
            <div>✅ Service Requests: <code>ai_service_requests</code> via catalog API</div>
            <div>✅ AI Performance: <code>ai_workflow_executions</code> via analytics service</div>
            <div>✅ Job Engine: <code>ai_jobs</code> via dispatcher service</div>
            <div className="mt-2 text-orange-400/80">⚠️ Provider Breakdown (on Analytics page): token distribution is evenly approximated in API — not from per-provider tracking. Root cause: analytics.ts#/ai/analytics/provider-breakdown. Fix scope: Team 43/API server.</div>
          </div>
        </>
      )}
    </div>
  );
}
