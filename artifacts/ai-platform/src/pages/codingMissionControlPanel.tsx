import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  GitFork,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Workflow,
} from "lucide-react";

type MissionControlSnapshot = {
  taskId: string;
  graphId: string;
  graphVersion: number;
  graphStatus: string;
  objective: string;
  planHash: string;
  progressPercent: number;
  totals: {
    workstreams: number;
    completed: number;
    running: number;
    waiting: number;
    reviewRequired: number;
    failed: number;
    ready: number;
  };
  active: Array<{
    id: string;
    key: string;
    title: string;
    role: string;
    status: string;
    workerId: string | null;
    branchName: string | null;
    attemptCount: number;
    dependencies: string[];
    errorMessage: string | null;
  }>;
  blockers: Array<{
    key: string;
    title: string;
    status: string;
    dependencies: string[];
    errorMessage: string | null;
  }>;
  nextActions: string[];
};

type TaskGraphWorkstream = {
  id: string;
  key: string;
  status: string;
  baseSha: string | null;
  resultJson: Record<string, unknown> | null;
};

type TaskGraphSnapshot = {
  graph: {
    id: string;
    status: string;
    version: number;
    planHash: string;
  };
  workstreams: TaskGraphWorkstream[];
};

type IntegrationManifest = {
  version: number;
  taskId: string;
  graphId: string;
  baseSha: string;
  manifestHash: string;
  patchCount: number;
  changedFiles: string[];
  nextAction: string;
  commitCreated: boolean;
  pushed: boolean;
  merged: boolean;
};

type WorkstreamAiExecution = {
  status?: string;
  reviewStatus?: string;
};

const SHA40_RE = /^[0-9a-f]{40}$/i;

function shortHash(value: string): string {
  return value ? value.slice(0, 12) : "—";
}

function statusTone(status: string): string {
  if (status === "COMPLETED") return "text-emerald-300";
  if (status === "FAILED" || status === "BLOCKED") return "text-rose-300";
  if (status === "RUNNING" || status === "CLAIMED") return "text-cyan-300";
  if (status === "REVIEW_REQUIRED") return "text-amber-300";
  if (status === "READY") return "text-violet-300";
  return "text-slate-400";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function workstreamAiExecution(
  workstream: TaskGraphWorkstream | undefined,
): WorkstreamAiExecution | null {
  const result = record(workstream?.resultJson);
  const execution = record(result?.workstreamAiExecution);
  return execution
    ? {
        status:
          typeof execution.status === "string" ? execution.status : undefined,
        reviewStatus:
          typeof execution.reviewStatus === "string"
            ? execution.reviewStatus
            : undefined,
      }
    : null;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // fall through to status text
  }
  return response.statusText || `HTTP ${response.status}`;
}

export function CodingMissionControlPanel({
  taskId,
  dispatchBaseSha,
}: {
  taskId: string;
  dispatchBaseSha?: string | null;
}) {
  const [snapshot, setSnapshot] = useState<MissionControlSnapshot | null>(null);
  const [graphSnapshot, setGraphSnapshot] = useState<TaskGraphSnapshot | null>(
    null,
  );
  const [manifest, setManifest] = useState<IntegrationManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const missionResponse = await fetch(
        `/api/ai/coding/tasks/${taskId}/mission-control`,
        {
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      );

      if (missionResponse.status === 404) {
        setSnapshot(null);
        setGraphSnapshot(null);
        setUnavailable(true);
        return;
      }
      if (!missionResponse.ok) return;

      const missionBody =
        (await missionResponse.json()) as MissionControlSnapshot;
      setSnapshot(missionBody);
      setUnavailable(false);

      const graphResponse = await fetch(
        `/api/ai/coding/tasks/${taskId}/task-graph`,
        {
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      );
      if (graphResponse.ok) {
        setGraphSnapshot((await graphResponse.json()) as TaskGraphSnapshot);
      }
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;

    const loadSafe = async () => {
      if (cancelled) return;
      await load();
    };

    void loadSafe();
    const timer = window.setInterval(() => void loadSafe(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  const progressLabel = useMemo(() => {
    if (!snapshot) return "0 / 0";
    return `${snapshot.totals.completed} / ${snapshot.totals.workstreams}`;
  }, [snapshot]);

  const effectiveBaseSha = useMemo(() => {
    if (dispatchBaseSha && SHA40_RE.test(dispatchBaseSha)) {
      return dispatchBaseSha.toLowerCase();
    }
    const persisted = graphSnapshot?.workstreams.find(
      (item) => item.baseSha && SHA40_RE.test(item.baseSha),
    )?.baseSha;
    return persisted?.toLowerCase() ?? null;
  }, [dispatchBaseSha, graphSnapshot]);

  const postAction = useCallback(
    async (
      actionKey: string,
      path: string,
      body?: Record<string, unknown>,
    ) => {
      setActionBusy(actionKey);
      setActionError(null);
      try {
        const response = await fetch(path, {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body ?? {}),
        });
        if (!response.ok) {
          throw new Error(await responseError(response));
        }
        setManifest(null);
        await load();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setActionBusy(null);
      }
    },
    [load],
  );

  const loadIntegrationManifest = useCallback(async () => {
    if (!snapshot) return;
    setActionBusy("manifest");
    setActionError(null);
    try {
      const response = await fetch(
        `/api/ai/coding/tasks/${taskId}/task-graph/${snapshot.graphId}/integration-manifest`,
        {
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setManifest((await response.json()) as IntegrationManifest);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(null);
    }
  }, [snapshot, taskId]);

  if (loading) {
    return (
      <div
        className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] text-slate-500"
        data-testid="panel-coding-mission-control-loading"
      >
        <Loader2 className="size-3 animate-spin" />
        Loading multi-worker mission control…
      </div>
    );
  }

  if (unavailable || !snapshot) return null;

  const canApproveGraph = snapshot.graphStatus === "PREPARED";
  const canDispatch =
    ["APPROVED", "RUNNING"].includes(snapshot.graphStatus) &&
    snapshot.totals.ready > 0 &&
    Boolean(effectiveBaseSha);
  const canReviewIntegration =
    snapshot.graphStatus === "COMPLETED" &&
    snapshot.totals.workstreams > 0 &&
    snapshot.totals.completed === snapshot.totals.workstreams;

  return (
    <section
      className="mt-4 rounded-xl border border-cyan-300/15 bg-[#07101d] p-4"
      data-testid="panel-coding-mission-control"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
            <Workflow className="size-3.5" />
            Multi-worker mission control
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
            {snapshot.objective}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] text-slate-500">
          <span>graph v{snapshot.graphVersion}</span>
          <span>·</span>
          <span>{snapshot.graphStatus}</span>
          <span>·</span>
          <span title={snapshot.planHash}>plan {shortHash(snapshot.planHash)}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {canApproveGraph && (
          <button
            type="button"
            disabled={actionBusy !== null}
            onClick={() =>
              void postAction(
                "approve-graph",
                `/api/ai/coding/tasks/${taskId}/task-graph/${snapshot.graphId}/approve`,
              )
            }
            className="inline-flex items-center gap-1.5 rounded border border-emerald-300/20 bg-emerald-300/[0.05] px-2.5 py-1.5 text-[10px] font-medium text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="button-approve-task-graph"
          >
            {actionBusy === "approve-graph" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ShieldCheck className="size-3" />
            )}
            Approve task graph
          </button>
        )}

        {["APPROVED", "RUNNING"].includes(snapshot.graphStatus) &&
          snapshot.totals.ready > 0 && (
            <button
              type="button"
              disabled={!canDispatch || actionBusy !== null}
              onClick={() =>
                void postAction(
                  "dispatch",
                  `/api/ai/coding/tasks/${taskId}/task-graph/${snapshot.graphId}/dispatch`,
                  {
                    baseSha: effectiveBaseSha,
                    maxParallel: Math.min(4, snapshot.totals.ready),
                  },
                )
              }
              className="inline-flex items-center gap-1.5 rounded border border-cyan-300/20 bg-cyan-300/[0.05] px-2.5 py-1.5 text-[10px] font-medium text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="button-dispatch-ready-workstreams"
              title={
                effectiveBaseSha
                  ? `Dispatch from ${effectiveBaseSha}`
                  : "Repository HEAD SHA is unavailable; run repository analysis first."
              }
            >
              {actionBusy === "dispatch" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Play className="size-3" />
              )}
              Dispatch ready workers
            </button>
          )}

        {canReviewIntegration && (
          <button
            type="button"
            disabled={actionBusy !== null}
            onClick={() => void loadIntegrationManifest()}
            className="inline-flex items-center gap-1.5 rounded border border-violet-300/20 bg-violet-300/[0.05] px-2.5 py-1.5 text-[10px] font-medium text-violet-200 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="button-review-integration-manifest"
          >
            {actionBusy === "manifest" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <GitFork className="size-3" />
            )}
            Review integration manifest
          </button>
        )}

        <button
          type="button"
          disabled={actionBusy !== null}
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded border border-white/[0.08] bg-white/[0.025] px-2.5 py-1.5 text-[10px] text-slate-400 disabled:opacity-40"
        >
          <RefreshCw className="size-3" />
          Refresh
        </button>
      </div>

      {!effectiveBaseSha &&
        ["APPROVED", "RUNNING"].includes(snapshot.graphStatus) &&
        snapshot.totals.ready > 0 && (
          <div className="mt-2 text-[9px] text-amber-300/80">
            Dispatch is locked until a verified repository HEAD SHA is available.
          </div>
        )}

      {actionError && (
        <div className="mt-3 rounded border border-rose-300/15 bg-rose-300/[0.035] px-3 py-2 text-[10px] text-rose-200">
          {actionError}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-500">
          <span>Progress</span>
          <span className="font-mono">
            {progressLabel} · {snapshot.progressPercent}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-cyan-300 transition-[width]"
            style={{ width: `${Math.min(100, Math.max(0, snapshot.progressPercent))}%` }}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-7">
        {[
          ["total", snapshot.totals.workstreams],
          ["completed", snapshot.totals.completed],
          ["running", snapshot.totals.running],
          ["ready", snapshot.totals.ready],
          ["review", snapshot.totals.reviewRequired],
          ["waiting", snapshot.totals.waiting],
          ["failed", snapshot.totals.failed],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"
          >
            <div className="text-[9px] uppercase tracking-wider text-slate-600">
              {label}
            </div>
            <div className="mt-1 font-mono text-sm text-slate-200">
              {value}
            </div>
          </div>
        ))}
      </div>

      {snapshot.nextActions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {snapshot.nextActions.map((action) => (
            <span
              key={action}
              className="rounded border border-violet-300/15 bg-violet-300/[0.04] px-2 py-1 font-mono text-[9px] text-violet-200"
            >
              {action}
            </span>
          ))}
        </div>
      )}

      {snapshot.active.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            <Activity className="size-3" />
            Active workstreams
          </div>
          <div className="grid gap-2 xl:grid-cols-2">
            {snapshot.active.map((item) => {
              const persisted = graphSnapshot?.workstreams.find(
                (candidate) => candidate.id === item.id,
              );
              const aiExecution = workstreamAiExecution(persisted);
              const needsAiPatchApproval =
                item.status === "REVIEW_REQUIRED" &&
                aiExecution?.status === "CANDIDATE_READY" &&
                aiExecution.reviewStatus !== "APPROVED";
              const canCompleteReviewed =
                item.status === "REVIEW_REQUIRED" &&
                (!aiExecution ||
                  aiExecution.status !== "CANDIDATE_READY" ||
                  aiExecution.reviewStatus === "APPROVED");

              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3"
                  data-testid={`card-coding-workstream-${item.key}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[9px] text-cyan-300">
                          {item.key}
                        </span>
                        <span className="truncate text-xs text-slate-200">
                          {item.title}
                        </span>
                      </div>
                      <div className="mt-1 text-[9px] uppercase tracking-wider text-slate-600">
                        {item.role}
                      </div>
                    </div>
                    <div className={`font-mono text-[9px] ${statusTone(item.status)}`}>
                      {item.status}
                    </div>
                  </div>

                  <div className="mt-2 grid gap-1 text-[9px] text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <GitFork className="size-3" />
                      <span>
                        worker {item.workerId ?? "unassigned"} · attempt {item.attemptCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <GitBranch className="size-3" />
                      <span className="truncate font-mono">
                        {item.branchName ?? "branch pending"}
                      </span>
                    </div>
                    <div>
                      deps {item.dependencies.length > 0 ? item.dependencies.join(", ") : "none"}
                    </div>
                  </div>

                  {(needsAiPatchApproval || canCompleteReviewed) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {needsAiPatchApproval && (
                        <button
                          type="button"
                          disabled={actionBusy !== null}
                          onClick={() =>
                            void postAction(
                              `approve-patch-${item.id}`,
                              `/api/ai/coding/tasks/${taskId}/task-graph/${snapshot.graphId}/workstreams/${item.id}/approve-ai-patch`,
                            )
                          }
                          className="rounded border border-amber-300/20 bg-amber-300/[0.05] px-2 py-1 text-[9px] text-amber-200 disabled:opacity-40"
                          data-testid={`button-approve-ai-patch-${item.key}`}
                        >
                          {actionBusy === `approve-patch-${item.id}`
                            ? "Approving…"
                            : "Approve AI patch"}
                        </button>
                      )}
                      {canCompleteReviewed && (
                        <button
                          type="button"
                          disabled={actionBusy !== null}
                          onClick={() =>
                            void postAction(
                              `complete-${item.id}`,
                              `/api/ai/coding/tasks/${taskId}/task-graph/${snapshot.graphId}/workstreams/${item.id}/complete`,
                            )
                          }
                          className="rounded border border-emerald-300/20 bg-emerald-300/[0.05] px-2 py-1 text-[9px] text-emerald-200 disabled:opacity-40"
                          data-testid={`button-complete-reviewed-${item.key}`}
                        >
                          {actionBusy === `complete-${item.id}`
                            ? "Completing…"
                            : "Complete reviewed workstream"}
                        </button>
                      )}
                    </div>
                  )}

                  {item.errorMessage && (
                    <div className="mt-2 rounded border border-rose-300/15 bg-rose-300/[0.03] p-2 text-[9px] text-rose-200">
                      {item.errorMessage}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {snapshot.blockers.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300/15 bg-amber-300/[0.025] p-3">
          <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-300">
            <ShieldAlert className="size-3" />
            Blockers / waiting dependencies
          </div>
          <div className="space-y-2">
            {snapshot.blockers.map((item) => (
              <div
                key={item.key}
                className="flex flex-col gap-1 rounded border border-white/[0.05] bg-black/10 px-2.5 py-2 text-[9px] sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <span className="font-mono text-slate-300">{item.key}</span>
                  <span className="ml-2 text-slate-500">{item.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  {item.status === "FAILED" ? (
                    <AlertTriangle className="size-3 text-rose-300" />
                  ) : (
                    <CheckCircle2 className="size-3 text-amber-300" />
                  )}
                  <span className={statusTone(item.status)}>{item.status}</span>
                  <span className="text-slate-600">
                    deps {item.dependencies.length > 0 ? item.dependencies.join(", ") : "none"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {manifest && (
        <div
          className="mt-4 rounded-lg border border-violet-300/15 bg-violet-300/[0.025] p-3"
          data-testid="panel-integration-manifest"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-violet-300">
              Integration manifest — review only
            </div>
            <div className="font-mono text-[9px] text-slate-500">
              {shortHash(manifest.manifestHash)}
            </div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div className="rounded border border-white/[0.06] p-2 text-[9px] text-slate-400">
              patches <span className="font-mono text-slate-200">{manifest.patchCount}</span>
            </div>
            <div className="rounded border border-white/[0.06] p-2 text-[9px] text-slate-400">
              files <span className="font-mono text-slate-200">{manifest.changedFiles.length}</span>
            </div>
            <div className="rounded border border-white/[0.06] p-2 text-[9px] text-slate-400">
              next <span className="font-mono text-violet-200">{manifest.nextAction}</span>
            </div>
          </div>
          <div className="mt-2 max-h-32 overflow-auto rounded border border-white/[0.05] bg-black/10 p-2 font-mono text-[9px] text-slate-500">
            {manifest.changedFiles.length > 0
              ? manifest.changedFiles.join("\n")
              : "No changed files"}
          </div>
          <div className="mt-2 text-[9px] text-slate-600">
            Review surface only — commit {String(manifest.commitCreated)}, push {String(manifest.pushed)}, merge {String(manifest.merged)}.
          </div>
        </div>
      )}
    </section>
  );
}
