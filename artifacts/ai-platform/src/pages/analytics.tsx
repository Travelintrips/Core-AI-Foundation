/**
 * Analytics — Phase 4.5 real-data dashboard.
 *
 * Phase 4.5 additions:
 *   - Date range filter (7 / 14 / 30 / 90 days)
 *   - Provider filter (client-side from cost data)
 *   - Agent filter (client-side from agent stats)
 *   - Empty state: explains when data appears + "Run Test Data" admin button
 *   - Export CSV button
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetAnalyticsOverview,
  useGetAgentStats,
  useGetCostAnalytics,
  useGetProviderBreakdown,
} from "@workspace/api-client-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  if (key) headers["x-admin-api-key"] = key;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

type CatalogFunnelCounts = {
  newRequests: number; briefInProgress: number; briefCompleted: number;
  quotationReady: number; waitingApproval: number; approved: number;
  inProduction: number; completed: number;
};

type CatalogAnalyticsData = {
  totalRequests: number;
  completedRequests: number;
  conversionRate: number;
  briefCompletionRate?: number;
  quotationApprovalRate?: number;
  approvalToPaymentRate?: number;
  requestToProjectRate?: number;
  averageQuotationValue?: number | null;
  averageTimeToApprovalDays?: number | null;
  funnelCounts?: CatalogFunnelCounts;
};

function useCatalogAnalytics() {
  return useQuery({
    queryKey: ["catalog-analytics"],
    queryFn: () => apiFetch<CatalogAnalyticsData>("/api/ai/catalog/analytics"),
    refetchInterval: 60_000,
  });
}
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  BarChart2,
  Cpu,
  DollarSign,
  Download,
  Loader2,
  Play,
  Star,
  TrendingUp,
  Zap,
  Users,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ── Colour palette for charts ──────────────────────────────────────────────────

const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6"];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 0) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(decimals);
}

function fmtCost(n: number | null | undefined) {
  if (n == null) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.001) return `$${(n * 1000).toFixed(4)}m`;
  return `$${n.toFixed(4)}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMs(n: number | null | undefined) {
  if (n == null) return "—";
  return n > 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color = "text-primary",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">{label}</p>
          <div className={cn("size-7 rounded border flex items-center justify-center border-border/50 bg-muted/20", color)}>
            <Icon className="size-3.5" />
          </div>
        </div>
        <p className="text-2xl font-bold font-mono tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground font-mono mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !payload) return null;
  return (
    <div className="rounded border border-border bg-background/95 px-3 py-2 shadow-lg">
      <p className="text-[10px] font-mono text-muted-foreground mb-1">{String(label)}</p>
      {(payload as Array<{ name: string; value: number; color: string }>).map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-xs font-mono">
          <span className="size-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold">{typeof p.value === "number" && p.value < 0.01 ? fmtCost(p.value) : fmt(p.value, 2)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Star display ───────────────────────────────────────────────────────────────

function StarDisplay({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground text-xs font-mono">—</span>;
  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-0.5">
        {[1,2,3,4,5].map(n => (
          <Star key={n} className={cn("size-3", n <= Math.round(value) ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30")} />
        ))}
      </div>
      <span className="text-[10px] font-mono text-muted-foreground ml-0.5">{value.toFixed(1)}</span>
    </div>
  );
}

// ── Date range options ────────────────────────────────────────────────────────

const DAY_OPTIONS = [
  { label: "7d",  value: 7 },
  { label: "14d", value: 14 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { toast } = useToast();
  const [days, setDays] = useState(14);
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [runningTestData, setRunningTestData] = useState(false);

  const { data: overview, isLoading: overviewLoading } = useGetAnalyticsOverview();
  const { data: costData, isLoading: costLoading } = useGetCostAnalytics({ days });
  const { data: rawAgentStats = [], isLoading: agentLoading } = useGetAgentStats({ days });
  const { data: providerBreakdown = [] } = useGetProviderBreakdown();
  const { data: catalogAnalytics } = useCatalogAnalytics();

  const isLoading = overviewLoading || costLoading || agentLoading;

  // ── Client-side filters ─────────────────────────────────────────────────────

  const allProviders = [
    ...new Set([
      ...(costData?.byProvider ?? []).map((p) => p.provider),
      ...providerBreakdown.map((p) => p.providerName),
    ]),
  ].filter(Boolean);

  const allAgents = rawAgentStats.map((a) => a.agentSlug);

  const agentStats = agentFilter === "all"
    ? rawAgentStats
    : rawAgentStats.filter((a) => a.agentSlug === agentFilter);

  const filteredProviderBreakdown = (costData?.byProvider ?? providerBreakdown.map((p) => ({
    provider: p.providerName,
    totalRequests: p.executions ?? 0,
    totalTokens: p.tokensUsed ?? 0,
    totalEstimatedCostUsd: 0,
    avgLatencyMs: p.avgLatencyMs ?? null,
  }))).filter((p) => providerFilter === "all" || p.provider === providerFilter);

  const dailyData = (costData?.daily ?? []).map((d) => ({
    date: d.date.slice(5),
    cost: d.totalEstimatedCostUsd,
    requests: d.totalRequests,
    tokens: d.totalTokens,
    latency: d.avgLatencyMs ?? 0,
  }));

  const pieData =
    filteredProviderBreakdown.length > 0
      ? filteredProviderBreakdown.map((p) => ({ name: p.provider, value: p.totalRequests }))
      : providerBreakdown.map((p) => ({ name: p.providerName, value: p.executions ?? 0 }));

  const hasData = agentStats.length > 0 || dailyData.length > 0 || filteredProviderBreakdown.some((p) => p.totalRequests > 0);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleRunTestData = async () => {
    setRunningTestData(true);
    try {
      const res = await fetch("/api/ai/test-runs/creative", { method: "POST" });
      const json = await res.json() as { created?: string[]; errors?: string[] };
      if (res.ok) {
        toast({
          title: "Test data created",
          description: `${json.created?.length ?? 0} synthetic projects added. Refresh to see analytics.`,
        });
        // Reload page after short delay so queries refetch
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast({ title: "Failed to create test data", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setRunningTestData(false);
    }
  };

  const handleExportCsv = () => {
    const params = new URLSearchParams({ days: String(days) });
    if (providerFilter !== "all") params.set("provider", providerFilter);
    if (agentFilter !== "all") params.set("agent", agentFilter);
    window.open(`/api/ai/analytics/export/csv?${params}`, "_blank");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-14 flex items-center gap-3 px-6 border-b border-border shrink-0">
        <BarChart2 className="size-4 text-primary" />
        <span className="font-mono text-sm font-semibold">Analytics</span>
        {isLoading && <Loader2 className="size-3.5 text-muted-foreground animate-spin ml-1" />}

        <div className="ml-auto flex items-center gap-2">
          {/* Date range */}
          <div className="flex items-center gap-1 border border-border/50 rounded-md p-0.5">
            {DAY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={cn(
                  "px-2.5 py-1 rounded text-[10px] font-mono transition-colors",
                  days === opt.value
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Provider filter */}
          {allProviders.length > 1 && (
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="h-7 w-32 text-[10px] font-mono border-border/50">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-mono">All providers</SelectItem>
                {allProviders.map((p) => (
                  <SelectItem key={p} value={p} className="text-xs font-mono capitalize">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Agent filter */}
          {allAgents.length > 1 && (
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="h-7 w-36 text-[10px] font-mono border-border/50">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-mono">All agents</SelectItem>
                {allAgents.map((a) => (
                  <SelectItem key={a} value={a} className="text-xs font-mono">{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Export CSV */}
          {hasData && (
            <Button variant="outline" size="sm" onClick={handleExportCsv} className="h-7 gap-1.5 text-[10px] font-mono border-border/50">
              <Download className="size-3" />
              CSV
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">

          {/* KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Total Executions"
              value={fmt(overview?.totalExecutions)}
              sub={`${fmt(overview?.activeWorkflows)} active workflows`}
              icon={Activity}
              color="text-primary"
            />
            <KpiCard
              label="Total Tokens"
              value={fmt(overview?.totalTokensUsed)}
              sub="Across all agents"
              icon={Zap}
              color="text-indigo-400"
            />
            <KpiCard
              label="Total Cost"
              value={fmtCost(
                costData?.byProvider?.reduce((s, p) => s + p.totalEstimatedCostUsd, 0) ?? 0,
              )}
              sub="Estimated USD"
              icon={DollarSign}
              color="text-green-400"
            />
            <KpiCard
              label="Avg Latency"
              value={fmtMs(overview?.avgLatencyMs)}
              sub={overview?.successRate != null ? `${(overview.successRate).toFixed(1)}% success rate` : undefined}
              icon={Clock}
              color="text-yellow-400"
            />
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Providers" value={fmt(overview?.totalProviders)} icon={Cpu} color="text-blue-400" />
            <KpiCard label="Models"    value={fmt(overview?.totalModels)}    icon={Cpu} color="text-purple-400" />
            <KpiCard label="Workflows" value={fmt(overview?.totalWorkflows)} icon={TrendingUp} color="text-cyan-400" />
            <KpiCard label="Agents"    value={fmt(agentStats.length > 0 ? agentStats.length : overview?.totalModels)} icon={Users} color="text-pink-400" />
          </div>

          {/* Cost trend chart */}
          {dailyData.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-mono font-semibold text-foreground/80">Daily Activity</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-4">
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={dailyData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "monospace", fill: "rgba(255,255,255,0.4)" }} />
                    <YAxis tick={{ fontSize: 10, fontFamily: "monospace", fill: "rgba(255,255,255,0.4)" }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                    <Area type="monotone" dataKey="requests" stroke="#6366f1" fill="url(#colorRequests)" name="Requests" strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="tokens" stroke="#22c55e" fill="url(#colorTokens)" name="Tokens" strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Provider breakdown pie */}
            {pieData.some((d) => d.value > 0) && (
              <Card className="border-border/50">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-mono font-semibold text-foreground/80">Provider Requests</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-4 pb-4">
                  <PieChart width={140} height={140}>
                    <Pie data={pieData} cx={65} cy={65} innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => [fmt(v), "Requests"]} contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", fontSize: 11, fontFamily: "monospace" }} />
                  </PieChart>
                  <div className="space-y-1.5 flex-1">
                    {pieData.map((d, i) => (
                      <div key={d.name} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="size-2 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="text-xs font-mono capitalize">{d.name}</span>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground tabular-nums">{fmt(d.value)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Cost by provider bar chart */}
            {filteredProviderBreakdown.some((p) => p.totalEstimatedCostUsd > 0) && (
              <Card className="border-border/50">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-mono font-semibold text-foreground/80">Cost by Provider</CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-4">
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={filteredProviderBreakdown} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="provider" tick={{ fontSize: 10, fontFamily: "monospace", fill: "rgba(255,255,255,0.4)" }} />
                      <YAxis tick={{ fontSize: 10, fontFamily: "monospace", fill: "rgba(255,255,255,0.4)" }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="totalEstimatedCostUsd" name="Cost (USD)" fill="#6366f1" radius={[3, 3, 0, 0]}>
                        {filteredProviderBreakdown.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Agent Performance Table */}
          {agentStats.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-mono font-semibold text-foreground/80">Agent Performance</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-border/50">
                        {["Agent", "Requests", "Tokens", "Est. Cost", "Avg Latency", "Success", "Approval", "Avg Rating"].map((h) => (
                          <th key={h} className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-4 py-2 font-medium first:pl-5 last:pr-5">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {agentStats.map((a, i) => (
                        <tr key={a.agentSlug} className={cn("border-b border-border/30 hover:bg-muted/20 transition-colors", i === agentStats.length - 1 && "border-0")}>
                          <td className="pl-5 py-3">
                            <div>
                              <p className="font-semibold text-foreground">{a.agentName}</p>
                              <p className="text-[10px] text-muted-foreground">{a.agentSlug}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3 tabular-nums">{fmt(a.totalRequests)}</td>
                          <td className="px-4 py-3 tabular-nums">{fmt(a.totalTokens)}</td>
                          <td className="px-4 py-3 tabular-nums text-green-400">{fmtCost(a.totalEstimatedCostUsd)}</td>
                          <td className="px-4 py-3 tabular-nums">{fmtMs(a.avgLatencyMs)}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={cn("text-[10px] border px-1.5 h-5", a.successRate >= 0.9 ? "border-green-500/30 text-green-400" : a.successRate >= 0.7 ? "border-yellow-500/30 text-yellow-400" : "border-red-500/30 text-red-400")}>
                              {fmtPct(a.successRate)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 tabular-nums">{a.approvalRate != null ? fmtPct(a.approvalRate) : "—"}</td>
                          <td className="pr-5 py-3"><StarDisplay value={a.avgRating} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Service Catalog Funnel */}
          {catalogAnalytics && (
            <Card className="border-border/50">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-mono font-semibold text-foreground/80 flex items-center gap-2">
                  <TrendingUp className="size-3.5 text-primary" />
                  Service Request Funnel
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <div className="bg-muted/20 border border-border/40 rounded-lg px-4 py-3">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Total Requests</p>
                    <p className="text-xl font-bold font-mono tabular-nums mt-1">{fmt(catalogAnalytics.totalRequests)}</p>
                  </div>
                  <div className="bg-muted/20 border border-border/40 rounded-lg px-4 py-3">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Brief Complete</p>
                    <p className="text-xl font-bold font-mono tabular-nums mt-1 text-blue-400">{catalogAnalytics.briefCompletionRate?.toFixed(1) ?? "—"}%</p>
                  </div>
                  <div className="bg-muted/20 border border-border/40 rounded-lg px-4 py-3">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Quotation Approved</p>
                    <p className="text-xl font-bold font-mono tabular-nums mt-1 text-amber-400">{catalogAnalytics.quotationApprovalRate?.toFixed(1) ?? "—"}%</p>
                  </div>
                  <div className="bg-muted/20 border border-border/40 rounded-lg px-4 py-3">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">To Project</p>
                    <p className="text-xl font-bold font-mono tabular-nums mt-1 text-green-400">{catalogAnalytics.requestToProjectRate?.toFixed(1) ?? "—"}%</p>
                  </div>
                </div>

                {catalogAnalytics.funnelCounts && (() => {
                  const fc = catalogAnalytics.funnelCounts!;
                  const stages = [
                    { label: "New Requests",      value: fc.newRequests,     color: "bg-slate-400" },
                    { label: "Brief In Progress",  value: fc.briefInProgress, color: "bg-blue-400" },
                    { label: "Brief Completed",    value: fc.briefCompleted,  color: "bg-indigo-400" },
                    { label: "Quotation Ready",    value: fc.quotationReady,  color: "bg-amber-400" },
                    { label: "Waiting Approval",   value: fc.waitingApproval, color: "bg-orange-400" },
                    { label: "Approved",           value: fc.approved,        color: "bg-lime-400" },
                    { label: "In Production",      value: fc.inProduction,    color: "bg-sky-400" },
                    { label: "Completed",          value: fc.completed,       color: "bg-green-400" },
                  ];
                  const maxVal = Math.max(...stages.map((s) => s.value), 1);
                  return (
                    <div className="space-y-1.5">
                      {stages.map((s) => (
                        <div key={s.label} className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-muted-foreground w-36 shrink-0 truncate">{s.label}</span>
                          <div className="flex-1 bg-muted/30 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${s.color}`}
                              style={{ width: `${Math.max((s.value / maxVal) * 100, s.value > 0 ? 3 : 0)}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono tabular-nums text-muted-foreground w-6 text-right shrink-0">{s.value}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <div className="mt-4 pt-3 border-t border-border/30 grid grid-cols-2 md:grid-cols-3 gap-3 text-[10px] font-mono">
                  {catalogAnalytics.averageQuotationValue != null && (
                    <div><span className="text-muted-foreground">Avg. Quotation Value — </span><span className="tabular-nums">{catalogAnalytics.averageQuotationValue.toLocaleString("id-ID")}</span></div>
                  )}
                  {catalogAnalytics.averageTimeToApprovalDays != null && (
                    <div><span className="text-muted-foreground">Avg. Time to Approval — </span><span className="tabular-nums">{catalogAnalytics.averageTimeToApprovalDays.toFixed(1)} days</span></div>
                  )}
                  {catalogAnalytics.approvalToPaymentRate != null && (
                    <div><span className="text-muted-foreground">Approval → Payment — </span><span className="tabular-nums text-emerald-400">{catalogAnalytics.approvalToPaymentRate.toFixed(1)}%</span></div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty state */}
          {!isLoading && !hasData && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
              <div className="size-14 rounded-xl border border-border/50 bg-muted/20 flex items-center justify-center">
                <BarChart2 className="size-7 text-muted-foreground/40" />
              </div>
              <div className="space-y-1.5">
                <p className="font-mono text-sm font-semibold text-foreground">No analytics data yet</p>
                <p className="text-xs text-muted-foreground font-mono max-w-sm">
                  Analytics data appears after Creative AI workflows run. Each completed workflow step records tokens, cost, and latency automatically.
                </p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRunTestData}
                  disabled={runningTestData}
                  className="gap-2 font-mono border-primary/30 text-primary hover:bg-primary/10"
                >
                  {runningTestData
                    ? <><Loader2 className="size-3.5 animate-spin" /> Creating test data…</>
                    : <><Play className="size-3.5" /> Run Test Data</>}
                </Button>
                <p className="text-[10px] text-muted-foreground font-mono">
                  Creates 5 synthetic projects to populate charts and agent stats.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
