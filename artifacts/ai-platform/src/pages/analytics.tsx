/**
 * Analytics — Phase 4 real-data dashboard.
 *
 * Sections:
 *   1. KPI overview strip (requests, tokens, cost, latency)
 *   2. Daily cost + requests trend (AreaChart)
 *   3. Provider breakdown table
 *   4. Agent performance table (with approval rate, avg rating)
 */

import {
  useGetAnalyticsOverview,
  useGetAgentStats,
  useGetCostAnalytics,
  useGetProviderBreakdown,
} from "@workspace/api-client-react";
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
import {
  Activity,
  BarChart2,
  Cpu,
  DollarSign,
  Loader2,
  Star,
  TrendingUp,
  Zap,
  Users,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { data: overview, isLoading: overviewLoading } = useGetAnalyticsOverview();
  const { data: costData, isLoading: costLoading } = useGetCostAnalytics({ days: 14 });
  const { data: agentStats = [], isLoading: agentLoading } = useGetAgentStats({ days: 30 });
  const { data: providerBreakdown = [] } = useGetProviderBreakdown();

  const isLoading = overviewLoading || costLoading || agentLoading;

  // Merge daily cost trend with usage (cost + requests per day)
  const dailyData = (costData?.daily ?? []).map((d) => ({
    date: d.date.slice(5), // "MM-DD"
    cost: d.totalEstimatedCostUsd,
    requests: d.totalRequests,
    tokens: d.totalTokens,
    latency: d.avgLatencyMs ?? 0,
  }));

  // Provider pie data from cost records (or fallback to provider breakdown)
  const pieData =
    costData && (costData.byProvider?.length ?? 0) > 0
      ? costData.byProvider.map((p) => ({ name: p.provider, value: p.totalRequests }))
      : providerBreakdown.map((p) => ({ name: p.providerName, value: p.executions ?? 0 }));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-14 flex items-center gap-3 px-6 border-b border-border shrink-0">
        <BarChart2 className="size-4 text-primary" />
        <span className="font-mono text-sm font-semibold">Analytics</span>
        {isLoading && <Loader2 className="size-3.5 text-muted-foreground animate-spin ml-1" />}
        <div className="ml-auto">
          <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground border-border/50">
            Last 30 days
          </Badge>
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
            {pieData.length > 0 && (
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
            {(costData?.byProvider?.length ?? 0) > 0 && (
              <Card className="border-border/50">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-mono font-semibold text-foreground/80">Cost by Provider</CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-4">
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={costData!.byProvider} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="provider" tick={{ fontSize: 10, fontFamily: "monospace", fill: "rgba(255,255,255,0.4)" }} />
                      <YAxis tick={{ fontSize: 10, fontFamily: "monospace", fill: "rgba(255,255,255,0.4)" }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="totalEstimatedCostUsd" name="Cost (USD)" fill="#6366f1" radius={[3, 3, 0, 0]}>
                        {costData!.byProvider.map((_, i) => (
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

          {/* Empty state when no data yet */}
          {!isLoading && agentStats.length === 0 && dailyData.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <div className="size-12 rounded-xl border border-border/50 bg-muted/20 flex items-center justify-center">
                <BarChart2 className="size-6 text-muted-foreground/40" />
              </div>
              <p className="font-mono text-sm font-semibold text-foreground">No analytics data yet</p>
              <p className="text-xs text-muted-foreground font-mono max-w-xs">Run some Creative AI workflows to start collecting performance and cost data.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
