/**
 * Production Pipeline — V4.4 monitoring & control dashboard.
 *
 * Shows all pipeline runs, per-stage progress, retry/cancel controls,
 * and aggregate production monitoring stats.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Activity,
  RefreshCw,
  Play,
  X,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  SkipForward,
  Loader2,
  AlertTriangle,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface PipelineTotals {
  totalRuns: number;
  runningRuns: number;
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  pendingRuns: number;
}

interface PipelineStageStat {
  stageName: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  avgLatencyMs: number | null;
}

interface PipelineStageDefinition {
  name: string;
  order: number;
  label: string;
}

interface ProductionPipeline {
  id: number;
  runId: string;
  projectId: number;
  status: string;
  currentStage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  retryCount: number;
  executionSummary: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface ProductionPipelineStage {
  id: number;
  runId: number;
  stageName: string;
  stageOrder: number;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  latencyMs: number | null;
  retryCount: number;
  errorMessage: string | null;
  agentSlug: string | null;
  model: string | null;
  provider: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MonitoringStats {
  totals: PipelineTotals;
  stageStats: PipelineStageStat[];
  recentRuns: ProductionPipeline[];
  stageDefinitions: PipelineStageDefinition[];
}

interface PipelineDetail extends ProductionPipeline {
  stages: ProductionPipelineStage[];
}

// ── API helpers ───────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {

  const headers: Record<string, string> = {
    "Content-Type": "application/json",

  };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers, ...(opts?.headers as Record<string, string> | undefined ?? {}) } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  pending:       "bg-slate-700 text-slate-300",
  running:       "bg-blue-900 text-blue-300",
  completed:     "bg-emerald-900 text-emerald-300",
  failed:        "bg-red-900 text-red-300",
  cancelled:     "bg-orange-900 text-orange-300",
  skipped:       "bg-slate-800 text-slate-400",
  waiting_retry: "bg-yellow-900 text-yellow-300",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending:   <Clock className="size-3" />,
  running:   <Loader2 className="size-3 animate-spin" />,
  completed: <CheckCircle2 className="size-3" />,
  failed:    <XCircle className="size-3" />,
  cancelled: <X className="size-3" />,
  skipped:   <SkipForward className="size-3" />,
};

const STAGE_LABELS: Record<string, string> = {
  creative_director: "Creative Direction",
  copywriter:        "Copywriter AI",
  designer:          "Designer AI",
  presentation:      "Presentation AI",
  qa:                "QA AI",
  renderer:          "Renderer",
  customer_review:   "Customer Review",
};

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLOR[status] ?? "bg-slate-700 text-slate-300"}`}
    >
      {STATUS_ICON[status]}
      {status}
    </span>
  );
}

function StageProgressBar({ stages }: { stages: ProductionPipelineStage[] }) {
  const ordered = [...stages].sort((a, b) => a.stageOrder - b.stageOrder);
  return (
    <div className="flex gap-1 items-center mt-2">
      {ordered.map((stage, i) => (
        <div key={stage.stageName} className="flex items-center gap-1">
          <div
            className={`h-2 w-8 rounded-full transition-all ${
              stage.status === "completed"
                ? "bg-emerald-500"
                : stage.status === "running"
                ? "bg-blue-500 animate-pulse"
                : stage.status === "failed"
                ? "bg-red-500"
                : stage.status === "skipped"
                ? "bg-slate-600"
                : "bg-slate-700"
            }`}
            title={`${STAGE_LABELS[stage.stageName] ?? stage.stageName}: ${stage.status}`}
          />
          {i < ordered.length - 1 && (
            <div className="h-px w-1 bg-slate-700" />
          )}
        </div>
      ))}
    </div>
  );
}

function PipelineRow({
  run,
  onSelect,
  onRetry,
  onCancel,
}: {
  run: ProductionPipeline;
  onSelect: (runId: string) => void;
  onRetry: (runId: string) => void;
  onCancel: (runId: string) => void;
}) {
  const summary = run.executionSummary as Record<string, unknown> | null;
  const totalStages = (summary?.totalStages as number) ?? 7;
  const completedStages = (summary?.completedStages as number) ?? 0;

  return (
    <div
      className="p-4 rounded-xl border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors"
      style={{ background: "#0D1829" }}
      onClick={() => onSelect(run.runId)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[11px] text-slate-500 font-mono">{run.runId.slice(0, 8)}…</code>
            <StatusBadge status={run.status} />
            {run.retryCount > 0 && (
              <span className="text-[10px] text-yellow-500">↻ {run.retryCount}</span>
            )}
            {run.currentStage && (
              <span className="text-[11px] text-blue-400">
                → {STAGE_LABELS[run.currentStage] ?? run.currentStage}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Project #{run.projectId} · Started {fmtDate(run.startedAt)} ·{" "}
            {run.completedAt ? `Completed ${fmtDate(run.completedAt)}` : "In progress"}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <span>{completedStages}/{totalStages} stages</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {(run.status === "failed" || run.status === "cancelled") && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => onRetry(run.runId)}
            >
              <RotateCcw className="size-3" /> Retry
            </Button>
          )}
          {(run.status === "running" || run.status === "pending") && (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs gap-1"
              onClick={() => onCancel(run.runId)}
            >
              <X className="size-3" /> Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelineDetailPanel({
  detail,
  onRetry,
  onCancel,
  onClose,
}: {
  detail: PipelineDetail;
  onRetry: (runId: string, stageName?: string) => void;
  onCancel: (runId: string) => void;
  onClose: () => void;
}) {
  const ordered = [...detail.stages].sort((a, b) => a.stageOrder - b.stageOrder);
  const summary = detail.executionSummary as Record<string, unknown> | null;

  return (
    <div
      className="rounded-xl border border-slate-700 p-5"
      style={{ background: "#0D1829" }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-100">Pipeline Detail</h3>
            <StatusBadge status={detail.status} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5 font-mono">{detail.runId}</p>
        </div>
        <div className="flex items-center gap-2">
          {(detail.status === "failed" || detail.status === "cancelled") && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onRetry(detail.runId)}>
              <RotateCcw className="size-3" /> Retry All
            </Button>
          )}
          {(detail.status === "running" || detail.status === "pending") && (
            <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={() => onCancel(detail.runId)}>
              <X className="size-3" /> Cancel
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>
            ✕
          </Button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { label: "Total", value: summary.totalStages as number },
            { label: "Done", value: summary.completedStages as number, color: "text-emerald-400" },
            { label: "Failed", value: summary.failedStages as number, color: "text-red-400" },
            { label: "Skipped", value: summary.skippedStages as number, color: "text-slate-400" },
          ].map((item) => (
            <div key={item.label} className="text-center p-2 rounded-lg bg-slate-900/50">
              <div className={`text-lg font-bold ${item.color ?? "text-slate-100"}`}>{item.value ?? 0}</div>
              <div className="text-[10px] text-slate-500">{item.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {ordered.map((stage) => (
          <div
            key={stage.stageName}
            className="flex items-center gap-3 p-3 rounded-lg"
            style={{ background: "#111827" }}
          >
            <div className={`size-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
              stage.status === "completed" ? "bg-emerald-900 text-emerald-300"
              : stage.status === "running"  ? "bg-blue-900 text-blue-300"
              : stage.status === "failed"   ? "bg-red-900 text-red-300"
              : stage.status === "skipped"  ? "bg-slate-800 text-slate-500"
              : "bg-slate-800 text-slate-500"
            }`}>
              {stage.stageOrder}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-200">
                  {STAGE_LABELS[stage.stageName] ?? stage.stageName}
                </span>
                <StatusBadge status={stage.status} />
                {stage.retryCount > 0 && (
                  <span className="text-[10px] text-yellow-500">↻{stage.retryCount}</span>
                )}
              </div>
              {stage.errorMessage && (
                <p className="text-[11px] text-red-400 mt-0.5 truncate">{stage.errorMessage}</p>
              )}
              <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-500">
                {stage.model && <span>{stage.provider}/{stage.model}</span>}
                {stage.latencyMs != null && <span>⏱ {fmtMs(stage.latencyMs)}</span>}
                {stage.startedAt && <span>▶ {fmtDate(stage.startedAt)}</span>}
              </div>
            </div>
            {stage.status === "failed" && (detail.status === "failed" || detail.status === "cancelled") && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] gap-1 flex-shrink-0"
                onClick={() => onRetry(detail.runId, stage.stageName)}
              >
                <RotateCcw className="size-2.5" /> Retry
              </Button>
            )}
          </div>
        ))}
      </div>

      {detail.errorMessage && (
        <div className="mt-3 p-3 rounded-lg bg-red-950/40 border border-red-900/30">
          <div className="flex items-center gap-2 text-xs text-red-400">
            <AlertTriangle className="size-3" />
            {detail.errorMessage}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Start Pipeline Modal ──────────────────────────────────────────────────────

function StartPipelineModal({
  onStart,
  onClose,
  isLoading,
}: {
  onStart: (projectId: string, forceRestart: boolean) => void;
  onClose: () => void;
  isLoading: boolean;
}) {
  const [projectId, setProjectId] = useState("");
  const [force, setForce] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 p-6" style={{ background: "#0D1829" }}>
        <h3 className="text-sm font-semibold text-slate-100 mb-4">Start Production Pipeline</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Project ID (UUID or integer)</label>
            <Input
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="e.g. 42 or uuid-…"
              className="bg-slate-900 border-slate-700 text-sm h-8"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="rounded"
            />
            Force restart (override active pipeline)
          </label>
        </div>
        <div className="flex gap-2 mt-5">
          <Button
            className="flex-1 h-8 text-xs"
            disabled={!projectId.trim() || isLoading}
            onClick={() => onStart(projectId.trim(), force)}
          >
            {isLoading ? <Loader2 className="size-3 animate-spin mr-1" /> : <Play className="size-3 mr-1" />}
            Start Pipeline
          </Button>
          <Button variant="outline" className="h-8 text-xs" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProductionPipelinePage() {
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showStartModal, setShowStartModal] = useState(false);

  // Monitoring stats (polling every 5s for running pipelines)
  const statsQuery = useQuery<MonitoringStats>({
    queryKey: ["production-pipeline-monitoring"],
    queryFn: () => apiFetch("/api/creative-ai/production-pipeline/monitoring"),
    refetchInterval: 5000,
  });

  // Detail panel
  const detailQuery = useQuery<PipelineDetail>({
    queryKey: ["production-pipeline-detail", selectedRunId],
    queryFn: () => apiFetch(`/api/creative-ai/production-pipeline/${selectedRunId}`),
    enabled: !!selectedRunId,
    refetchInterval: selectedRunId ? 3000 : false,
  });

  // Mutations
  const startMutation = useMutation({
    mutationFn: ({ projectId, forceRestart }: { projectId: string; forceRestart: boolean }) =>
      apiFetch("/api/creative-ai/production-pipeline", {
        method: "POST",
        body: JSON.stringify({ projectId, forceRestart }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-pipeline-monitoring"] });
      setShowStartModal(false);
    },
  });

  const retryMutation = useMutation({
    mutationFn: ({ runId, stageName }: { runId: string; stageName?: string }) =>
      apiFetch(`/api/creative-ai/production-pipeline/${runId}/retry`, {
        method: "POST",
        body: JSON.stringify(stageName ? { stageName } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-pipeline-monitoring"] });
      if (selectedRunId) {
        qc.invalidateQueries({ queryKey: ["production-pipeline-detail", selectedRunId] });
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (runId: string) =>
      apiFetch(`/api/creative-ai/production-pipeline/${runId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-pipeline-monitoring"] });
      if (selectedRunId) {
        qc.invalidateQueries({ queryKey: ["production-pipeline-detail", selectedRunId] });
      }
    },
  });

  const stats = statsQuery.data;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div
            className="size-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}
          >
            <Activity className="size-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-100">Production Pipeline</h1>
            <p className="text-[11px] text-slate-500">V4.4 · 7-stage AI production orchestrator</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs gap-1"
            onClick={() => statsQuery.refetch()}
            disabled={statsQuery.isFetching}
          >
            <RefreshCw className={`size-3 ${statsQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setShowStartModal(true)}
          >
            <Play className="size-3" /> Start Pipeline
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Totals */}
        {stats && (
          <div className="grid grid-cols-6 gap-3">
            {[
              { key: "totalRuns",     label: "Total",     color: "text-slate-100" },
              { key: "runningRuns",   label: "Running",   color: "text-blue-400" },
              { key: "completedRuns", label: "Completed", color: "text-emerald-400" },
              { key: "failedRuns",    label: "Failed",    color: "text-red-400" },
              { key: "cancelledRuns", label: "Cancelled", color: "text-orange-400" },
              { key: "pendingRuns",   label: "Pending",   color: "text-slate-400" },
            ].map((item) => (
              <Card key={item.key} className="border-slate-800 bg-slate-900/50">
                <CardContent className="p-3 text-center">
                  <div className={`text-2xl font-bold ${item.color}`}>
                    {stats.totals[item.key as keyof PipelineTotals]}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{item.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className={`grid gap-6 ${selectedRunId ? "grid-cols-2" : "grid-cols-1"}`}>
          {/* Left: runs list + stage stats */}
          <div className="space-y-5">
            {/* Stage stats */}
            {stats && stats.stageStats.length > 0 && (
              <Card className="border-slate-800 bg-slate-900/50">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-xs text-slate-400 uppercase tracking-wider">Stage Health</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-2">
                    {stats.stageDefinitions.map((def) => {
                      const stageStat = stats.stageStats.find((s) => s.stageName === def.name);
                      if (!stageStat) return null;
                      const successRate = stageStat.totalCount > 0
                        ? Math.round((stageStat.completedCount / stageStat.totalCount) * 100)
                        : null;
                      return (
                        <div key={def.name} className="flex items-center gap-3">
                          <div className="w-28 flex-shrink-0">
                            <span className="text-[11px] text-slate-400">{def.label}</span>
                          </div>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${successRate ?? 0}%` }}
                            />
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 text-[10px] text-slate-500 w-24 justify-end">
                            <span>{successRate != null ? `${successRate}%` : "—"}</span>
                            <span>·</span>
                            <span>{fmtMs(stageStat.avgLatencyMs)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Pipeline runs list */}
            <Card className="border-slate-800 bg-slate-900/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs text-slate-400 uppercase tracking-wider">
                  Recent Pipeline Runs
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {statsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-8 text-slate-500">
                    <Loader2 className="size-4 animate-spin mr-2" /> Loading…
                  </div>
                ) : !stats || stats.recentRuns.length === 0 ? (
                  <div className="text-center py-8 text-sm text-slate-500">
                    No pipeline runs yet. Click <strong>Start Pipeline</strong> to begin.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {stats.recentRuns.map((run) => (
                      <PipelineRow
                        key={run.runId}
                        run={run}
                        onSelect={setSelectedRunId}
                        onRetry={(runId) => retryMutation.mutate({ runId })}
                        onCancel={(runId) => cancelMutation.mutate(runId)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: detail panel */}
          {selectedRunId && (
            <div>
              {detailQuery.isLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-500">
                  <Loader2 className="size-4 animate-spin mr-2" /> Loading detail…
                </div>
              ) : detailQuery.data ? (
                <PipelineDetailPanel
                  detail={detailQuery.data}
                  onRetry={(runId, stageName) => retryMutation.mutate({ runId, stageName })}
                  onCancel={(runId) => cancelMutation.mutate(runId)}
                  onClose={() => setSelectedRunId(null)}
                />
              ) : (
                <div className="text-center py-12 text-sm text-slate-500">
                  Pipeline not found.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pipeline flow diagram */}
        {stats && (
          <Card className="border-slate-800 bg-slate-900/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs text-slate-400 uppercase tracking-wider">Pipeline Flow</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-5">
              <div className="flex items-center gap-2 flex-wrap">
                {stats.stageDefinitions.map((def, i) => (
                  <div key={def.name} className="flex items-center gap-2">
                    <div
                      className="px-3 py-2 rounded-lg border border-slate-700 text-[11px] font-medium text-slate-300 text-center min-w-[100px]"
                      style={{ background: "#111827" }}
                    >
                      <div className="text-[9px] text-slate-500 mb-0.5">Stage {def.order}</div>
                      {def.label}
                    </div>
                    {i < stats.stageDefinitions.length - 1 && (
                      <div className="text-slate-600 text-xs">→</div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Start modal */}
      {showStartModal && (
        <StartPipelineModal
          isLoading={startMutation.isPending}
          onStart={(projectId, forceRestart) =>
            startMutation.mutate({ projectId, forceRestart })
          }
          onClose={() => setShowStartModal(false)}
        />
      )}
    </div>
  );
}
