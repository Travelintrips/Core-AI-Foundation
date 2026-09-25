import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  GitFork,
  Loader2,
  ShieldAlert,
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

export function CodingMissionControlPanel({ taskId }: { taskId: string }) {
  const [snapshot, setSnapshot] = useState<MissionControlSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/ai/coding/tasks/${taskId}/mission-control`,
          {
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        );

        if (response.status === 404) {
          if (!cancelled) {
            setSnapshot(null);
            setUnavailable(true);
          }
          return;
        }

        if (!response.ok) return;
        const body = (await response.json()) as MissionControlSnapshot;
        if (!cancelled) {
          setSnapshot(body);
          setUnavailable(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [taskId]);

  const progressLabel = useMemo(() => {
    if (!snapshot) return "0 / 0";
    return `${snapshot.totals.completed} / ${snapshot.totals.workstreams}`;
  }, [snapshot]);

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
            {snapshot.active.map((item) => (
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

                {item.errorMessage && (
                  <div className="mt-2 rounded border border-rose-300/15 bg-rose-300/[0.03] p-2 text-[9px] text-rose-200">
                    {item.errorMessage}
                  </div>
                )}
              </div>
            ))}
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
    </section>
  );
}
