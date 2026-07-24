/**
 * Design Observability — Team 35
 *
 * Admin view for Universal Design Platform observability:
 *   • Overview cards (throughput, success rate, failure rate, queue depth, cost, stuck)
 *   • Health table (workflows, providers, renderers, plugins)
 *   • Stage metrics
 *   • Incident list with severity
 *   • Time-range filter (1h, 6h, 24h, 7d)
 *   • Honest unavailable / empty / loading states
 *   • Drill-down links to existing pages
 */

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Server,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  WifiOff,
  XCircle,
  Zap,
  BarChart2,
} from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ── API helper ─────────────────────────────────────────────────────────────────

const API_BASE = "";

async function apiFetch<T>(path: string): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: key ? { "x-admin-api-key": key } : {},
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type DesignHealthStatus = "healthy" | "degraded" | "unavailable" | "unknown";

interface DesignOperationMetric {
  name: string;
  value: number | null;
  unit: string;
  windowHours: number;
  recordedAt: string;
}

interface DesignWorkflowHealth {
  workflowId: string;
  name: string;
  status: DesignHealthStatus;
  successRate: number | null;
  avgLatencyMs: number | null;
  recentFailures: number;
  lastSeenAt: string | null;
}

interface DesignStageHealth {
  stageName: string;
  status: DesignHealthStatus;
  avgDurationMs: number | null;
  failureCount: number;
  windowHours: number;
}

interface DesignPluginHealth {
  pluginId: string;
  pluginName: string;
  status: DesignHealthStatus;
  lastError: string | null;
  lastCheckedAt: string;
}

interface DesignRendererHealth {
  rendererId: string;
  rendererType: string;
  status: DesignHealthStatus;
  successRate: number | null;
  failureCount: number;
  avgDurationMs: number | null;
  windowHours: number;
}

interface DesignProviderHealth {
  providerName: string;
  status: DesignHealthStatus;
  successRate: number | null;
  failureCount: number;
  avgLatencyMs: number | null;
  recentErrors: string[];
  windowHours: number;
}

interface DesignIncident {
  id: string;
  ruleKey: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  detectedAt: string;
  affectedResource: string | null;
  suppressed: boolean;
}

interface DesignOperationalAlert {
  alertId: string;
  level: "error" | "warning" | "info";
  message: string;
  source: string;
  triggeredAt: string;
}

interface DesignOperationHealth {
  overallStatus: DesignHealthStatus;
  computedAt: string;
  windowHours: number;
  workflows: DesignWorkflowHealth[];
  stages: DesignStageHealth[];
  renderers: DesignRendererHealth[];
  providers: DesignProviderHealth[];
  plugins: DesignPluginHealth[];
  incidents: DesignIncident[];
  alerts: DesignOperationalAlert[];
}

interface SummaryResponse {
  health: DesignOperationHealth;
  metrics: DesignOperationMetric[];
  windowHours: number;
  fetchedAt: string;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtCost(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v === 0) return "$0.00";
  if (v < 0.0001) return `<$0.0001`;
  return `$${v.toFixed(4)}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// ── Health status UI ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  DesignHealthStatus,
  { icon: React.ElementType; color: string; badge: string; label: string }
> = {
  healthy: {
    icon: CheckCircle2,
    color: "text-green-400",
    badge: "bg-green-500/10 text-green-400 border-green-500/30",
    label: "Healthy",
  },
  degraded: {
    icon: AlertTriangle,
    color: "text-amber-400",
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    label: "Degraded",
  },
  unavailable: {
    icon: XCircle,
    color: "text-destructive",
    badge: "bg-destructive/10 text-destructive border-destructive/30",
    label: "Unavailable",
  },
  unknown: {
    icon: Info,
    color: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground border-muted",
    label: "Unknown",
  },
};

function HealthBadge({ status }: { status: DesignHealthStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  const Icon = cfg.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-mono text-[10px] uppercase", cfg.badge)}
    >
      <Icon className="size-3" />
      {cfg.label}
    </Badge>
  );
}

const SEVERITY_CONFIG: Record<
  DesignIncident["severity"],
  { badge: string; icon: React.ElementType }
> = {
  critical: { badge: "bg-destructive/10 text-destructive border-destructive/30", icon: ShieldAlert },
  high:     { badge: "bg-orange-500/10 text-orange-400 border-orange-500/30", icon: AlertTriangle },
  medium:   { badge: "bg-amber-500/10 text-amber-400 border-amber-500/30", icon: AlertTriangle },
  low:      { badge: "bg-muted text-muted-foreground border-muted", icon: Info },
};

function SeverityBadge({ severity }: { severity: DesignIncident["severity"] }) {
  const cfg = SEVERITY_CONFIG[severity];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 font-mono text-[10px] uppercase", cfg.badge)}>
      <Icon className="size-3" />
      {severity}
    </Badge>
  );
}

// ── Overview KPI card ─────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  trend,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  trend?: "up" | "down" | null;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div
          className={cn(
            "size-9 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5",
            accent ?? "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
          <div className="flex items-end gap-1.5">
            <p className="text-2xl font-bold leading-none">{value}</p>
            {trend === "up" && <TrendingUp className="size-3.5 text-green-400 mb-0.5" />}
            {trend === "down" && <TrendingDown className="size-3.5 text-destructive mb-0.5" />}
          </div>
          {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Overall health banner ──────────────────────────────────────────────────────

function OverallHealthBanner({
  status,
  computedAt,
  alerts,
}: {
  status: DesignHealthStatus;
  computedAt: string;
  alerts: DesignOperationalAlert[];
}) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  const Icon = cfg.icon;
  const activeAlerts = alerts.filter((a) => a.level === "error");

  return (
    <div
      className={cn(
        "border rounded-lg p-4 flex items-start gap-4",
        status === "healthy" && "border-green-500/20 bg-green-500/5",
        status === "degraded" && "border-amber-500/20 bg-amber-500/5",
        status === "unavailable" && "border-destructive/20 bg-destructive/5",
        status === "unknown" && "border-muted bg-muted/20",
      )}
    >
      <Icon className={cn("size-6 mt-0.5 flex-shrink-0", cfg.color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn("font-semibold text-sm", cfg.color)}>
            Design Platform: {cfg.label}
          </span>
          {activeAlerts.length > 0 && (
            <Badge variant="outline" className="text-[10px] font-mono bg-destructive/10 text-destructive border-destructive/30">
              {activeAlerts.length} alert{activeAlerts.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Last computed: {fmtDate(computedAt)}</p>
        {activeAlerts.length > 0 && (
          <div className="mt-2 space-y-1">
            {activeAlerts.slice(0, 3).map((a) => (
              <p key={a.alertId} className="text-xs text-destructive font-mono truncate">
                ⚠ {a.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Health table ───────────────────────────────────────────────────────────────

function HealthTable({
  title,
  icon: Icon,
  rows,
}: {
  title: string;
  icon: React.ElementType;
  rows: Array<{
    name: string;
    status: DesignHealthStatus;
    successRate?: number | null;
    failureCount?: number;
    latencyMs?: number | null;
    detail?: string | null;
    drillLink?: string;
  }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Success Rate</TableHead>
              <TableHead className="text-right">Failures</TableHead>
              <TableHead className="text-right">Avg Latency</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-6">
                  No data for this window. Data appears once the pipeline runs.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs font-medium">{r.name}</TableCell>
                <TableCell><HealthBadge status={r.status} /></TableCell>
                <TableCell className="text-right text-xs font-mono">
                  {r.successRate != null ? fmtPct(r.successRate * 100) : "—"}
                </TableCell>
                <TableCell className="text-right text-xs font-mono">
                  <span className={r.failureCount && r.failureCount > 0 ? "text-destructive" : ""}>
                    {r.failureCount ?? "—"}
                  </span>
                </TableCell>
                <TableCell className="text-right text-xs">
                  {r.latencyMs != null ? fmtMs(r.latencyMs) : "—"}
                </TableCell>
                <TableCell>
                  {r.drillLink && (
                    <Link href={r.drillLink}>
                      <Button variant="ghost" size="sm" className="h-6 text-xs gap-1">
                        <ExternalLink className="size-3" /> View
                      </Button>
                    </Link>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Stage metrics table ────────────────────────────────────────────────────────

function StageMetricsTable({ stages }: { stages: DesignStageHealth[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="size-4 text-primary" /> Stage Latency
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Avg Duration</TableHead>
              <TableHead className="text-right">Failures</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stages.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-6">
                  No stage data yet.
                </TableCell>
              </TableRow>
            )}
            {stages.map((s, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{s.stageName}</TableCell>
                <TableCell><HealthBadge status={s.status} /></TableCell>
                <TableCell className="text-right text-xs">{fmtMs(s.avgDurationMs)}</TableCell>
                <TableCell className="text-right text-xs">
                  <span className={s.failureCount > 0 ? "text-destructive" : ""}>
                    {s.failureCount}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Incident list ──────────────────────────────────────────────────────────────

function IncidentList({ incidents }: { incidents: DesignIncident[] }) {
  const active = incidents.filter((i) => !i.suppressed);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldAlert className="size-4 text-primary" />
          Active Incidents
          {active.length > 0 && (
            <Badge
              variant="outline"
              className="ml-auto text-[10px] font-mono bg-destructive/10 text-destructive border-destructive/30"
            >
              {active.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {active.length === 0 && (
          <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
            <CheckCircle2 className="size-5 text-green-400 flex-shrink-0" />
            No active incidents detected in this window.
          </div>
        )}
        <div className="space-y-3">
          {active.map((inc) => (
            <div
              key={inc.id}
              className={cn(
                "border rounded-lg p-3 space-y-1",
                inc.severity === "critical" && "border-destructive/30 bg-destructive/5",
                inc.severity === "high" && "border-orange-500/30 bg-orange-500/5",
                inc.severity === "medium" && "border-amber-500/30 bg-amber-500/5",
                inc.severity === "low" && "border-muted bg-muted/20",
              )}
            >
              <div className="flex items-center gap-2">
                <SeverityBadge severity={inc.severity} />
                <span className="text-sm font-medium">{inc.title}</span>
              </div>
              <p className="text-xs text-muted-foreground">{inc.description}</p>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-mono">
                {inc.affectedResource && <span>resource: {inc.affectedResource}</span>}
                <span>detected: {fmtDate(inc.detectedAt)}</span>
                <span>rule: {inc.ruleKey}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Metric lookup helper ───────────────────────────────────────────────────────

function metricVal(
  metrics: DesignOperationMetric[],
  name: string,
): number | null {
  return metrics.find((m) => m.name === name)?.value ?? null;
}

// ── Main page ──────────────────────────────────────────────────────────────────

const WINDOW_OPTIONS = [
  { label: "Last 1h", value: "1" },
  { label: "Last 6h", value: "6" },
  { label: "Last 24h", value: "24" },
  { label: "Last 7d", value: "168" },
];

export default function DesignObservabilityPage() {
  const [windowHours, setWindowHours] = useState("24");

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<SummaryResponse>({
    queryKey: ["design-observability-summary", windowHours],
    queryFn: () =>
      apiFetch(`/api/ai/design-observability/summary?windowHours=${windowHours}`),
    refetchInterval: 60_000,
    retry: 1,
  });

  const handleWindowChange = useCallback(
    (v: string) => setWindowHours(v),
    [],
  );

  const health = data?.health;
  const metrics = data?.metrics ?? [];

  // KPI values from metrics array
  const throughput = metricVal(metrics, "throughput");
  const successRate = metricVal(metrics, "success_rate");
  const failureRate = metricVal(metrics, "failure_rate");
  const queueDepth = metricVal(metrics, "queue_depth");
  const costPerRun = metricVal(metrics, "avg_cost_per_run");
  const stuckCount = metricVal(metrics, "stuck_job_count");
  const p95 = metricVal(metrics, "p95_latency");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="size-5 text-primary" />
          <h1 className="font-semibold text-lg">Design Operations</h1>
          <span className="text-[10px] uppercase tracking-widest font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded ml-1">
            Team 35
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Select value={windowHours} onValueChange={handleWindowChange}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8"
          >
            <RefreshCw className={cn("size-3.5 mr-1.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error state */}
        {isError && !isLoading && (
          <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-6 text-center space-y-2">
            <WifiOff className="size-10 mx-auto text-destructive/60" />
            <p className="font-medium text-sm">Observability unavailable</p>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error ? error.message : "Failed to fetch observability data"}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="size-3.5 mr-1.5" /> Try again
            </Button>
          </div>
        )}

        {/* Data loaded */}
        {!isLoading && data && health && (
          <>
            {/* Overall health banner */}
            <OverallHealthBanner
              status={health.overallStatus}
              computedAt={health.computedAt}
              alerts={health.alerts}
            />

            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <KpiCard
                icon={Zap}
                label="Throughput"
                value={throughput != null ? String(throughput) : "—"}
                sub="completed jobs"
              />
              <KpiCard
                icon={CheckCircle2}
                label="Success Rate"
                value={successRate != null ? fmtPct(successRate) : "—"}
                accent="bg-green-500/10 text-green-400"
              />
              <KpiCard
                icon={XCircle}
                label="Failure Rate"
                value={failureRate != null ? fmtPct(failureRate) : "—"}
                accent={failureRate && failureRate > 10 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}
              />
              <KpiCard
                icon={Database}
                label="Queue Depth"
                value={queueDepth != null ? String(queueDepth) : "—"}
                sub="queued + waiting"
                accent={queueDepth && queueDepth > 50 ? "bg-amber-500/10 text-amber-400" : undefined}
              />
              <KpiCard
                icon={Clock}
                label="P95 Latency"
                value={p95 != null ? fmtMs(p95) : "—"}
              />
              <KpiCard
                icon={Cpu}
                label="Cost / Run"
                value={costPerRun != null ? fmtCost(costPerRun) : "—"}
                sub="avg actual cost"
              />
              <KpiCard
                icon={AlertTriangle}
                label="Stuck Jobs"
                value={stuckCount != null ? String(stuckCount) : "—"}
                sub="> 30 min"
                accent={stuckCount && stuckCount > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}
              />
            </div>

            {/* Incident list */}
            <IncidentList incidents={health.incidents} />

            {/* Workflow + Provider health */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <HealthTable
                title="Workflow Health (by Job Type)"
                icon={BarChart2}
                rows={health.workflows.map((w) => ({
                  name: w.name,
                  status: w.status,
                  successRate: w.successRate,
                  failureCount: w.recentFailures,
                  latencyMs: w.avgLatencyMs,
                  drillLink: "/queue",
                }))}
              />
              <HealthTable
                title="AI Provider Health"
                icon={Server}
                rows={health.providers.map((p) => ({
                  name: p.providerName,
                  status: p.status,
                  successRate: p.successRate,
                  failureCount: p.failureCount,
                  latencyMs: p.avgLatencyMs,
                  drillLink: "/observability",
                }))}
              />
            </div>

            {/* Renderer + Plugin health */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <HealthTable
                title="Renderer Health"
                icon={Activity}
                rows={health.renderers.map((r) => ({
                  name: `${r.rendererType} (${r.rendererId})`,
                  status: r.status,
                  successRate: r.successRate,
                  failureCount: r.failureCount,
                  latencyMs: r.avgDurationMs,
                  drillLink: "/design-render-batches",
                }))}
              />
              <HealthTable
                title="Worker / Plugin Health"
                icon={Cpu}
                rows={health.plugins.map((p) => ({
                  name: p.pluginName,
                  status: p.status,
                  successRate: null,
                  failureCount: p.lastError ? 1 : 0,
                  latencyMs: null,
                  detail: p.lastError,
                  drillLink: "/queue",
                }))}
              />
            </div>

            {/* Stage metrics */}
            {health.stages.length > 0 && (
              <StageMetricsTable stages={health.stages} />
            )}

            {/* Metric detail table */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart2 className="size-4 text-primary" /> Metric Details
                  <span className="ml-auto text-xs text-muted-foreground font-normal">
                    Window: last {windowHours}h
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-6">
                          No metrics available for this window.
                        </TableCell>
                      </TableRow>
                    )}
                    {metrics.map((m, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{m.name}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {m.value != null ? String(m.value) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{m.unit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Footer drill-down links */}
            <div className="flex flex-wrap gap-2 pb-2">
              <Link href="/queue">
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <ExternalLink className="size-3" /> Job Queue
                </Button>
              </Link>
              <Link href="/observability">
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <ExternalLink className="size-3" /> AI Observability
                </Button>
              </Link>
              <Link href="/design-render-batches">
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <ExternalLink className="size-3" /> Render Batches
                </Button>
              </Link>
              <Link href="/operations">
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <ExternalLink className="size-3" /> AI Operations Center
                </Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
