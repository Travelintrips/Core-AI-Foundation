import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetJobStats,
  useListJobs,
  useListWorkers,
  useCancelJob,
  useRetryJob,
  useGetDispatcherStatus,
  useStartDispatcher,
  useStopDispatcher,
  useTickDispatcher as useRunDispatcherTick,
  getGetJobStatsQueryKey,
  getListJobsQueryKey,
  getListWorkersQueryKey,
  getGetDispatcherStatusQueryKey,
  useGetClusterStatus,
  useGetClusterWorkers,
  useRebalanceCluster,
  useRecoverStaleWorkers,
  getClusterStatusQueryKey,
  getClusterWorkersQueryKey,
  type AiJob,
  type AiWorker,
  type JobStats,
  type DispatcherStatus,
  type ClusterStatus,
  type WorkerCapacityItem,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Ban,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock,
  Cpu,
  DatabaseZap,
  Layers,
  ListOrdered,
  Loader2,
  Network,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Server,
  SkipForward,
  Square,
  Timer,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

// ── Status helpers ────────────────────────────────────────────────────────────

const JOB_STATUS_CONFIG: Record<string, { color: string; icon: typeof CircleDot; label: string }> = {
  queued:    { color: "bg-blue-500/15 text-blue-400 border-blue-500/30",     icon: ListOrdered,  label: "Queued"    },
  waiting:   { color: "bg-slate-500/15 text-slate-400 border-slate-500/30",  icon: Clock,        label: "Waiting"   },
  running:   { color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: Zap,     label: "Running"   },
  retrying:  { color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", icon: RotateCcw,  label: "Retrying"  },
  completed: { color: "bg-green-500/15 text-green-400 border-green-500/30",  icon: CheckCircle2, label: "Completed" },
  failed:    { color: "bg-red-500/15 text-red-400 border-red-500/30",        icon: XCircle,      label: "Failed"    },
  cancelled: { color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",     icon: Ban,          label: "Cancelled" },
  blocked:   { color: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: AlertCircle, label: "Blocked"  },
};

const WORKER_STATUS_CONFIG: Record<string, { color: string; dot: string }> = {
  online:      { color: "text-blue-400",    dot: "bg-blue-400"    },
  idle:        { color: "text-green-400",   dot: "bg-green-400"   },
  busy:        { color: "text-yellow-400",  dot: "bg-yellow-400"  },
  maintenance: { color: "text-orange-400",  dot: "bg-orange-400"  },
  offline:     { color: "text-zinc-500",    dot: "bg-zinc-500"    },
  stale:       { color: "text-red-400",     dot: "bg-red-400"     },
};

function JobStatusBadge({ status }: { status: string }) {
  const cfg = JOB_STATUS_CONFIG[status] ?? JOB_STATUS_CONFIG["queued"]!;
  const Icon = cfg.icon;
  return (
    <Badge className={cn("text-[9px] border font-mono px-1.5 py-0 gap-0.5 h-4", cfg.color)}>
      <Icon className="size-2.5" />{cfg.label}
    </Badge>
  );
}

function priorityColor(p: number) {
  if (p >= 80) return "text-red-400";
  if (p >= 60) return "text-orange-400";
  if (p >= 40) return "text-yellow-400";
  return "text-muted-foreground";
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, accent,
}: {
  label: string;
  value: number | string;
  icon: typeof Cpu;
  accent?: string;
}) {
  return (
    <div className="border border-border/50 rounded-lg bg-card/40 p-3 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">{label}</span>
        <Icon className={cn("size-3.5", accent ?? "text-muted-foreground")} />
      </div>
      <span className={cn("text-xl font-bold font-mono", accent ?? "text-foreground")}>{value}</span>
    </div>
  );
}

// ── Worker Card ───────────────────────────────────────────────────────────────

function WorkerCard({ worker }: { worker: AiWorker }) {
  const cfg = WORKER_STATUS_CONFIG[worker.status] ?? WORKER_STATUS_CONFIG["offline"]!;
  const lastSeen = formatDistanceToNow(new Date(worker.lastHeartbeat), { addSuffix: true });

  return (
    <div className="border border-border/50 rounded-lg bg-card/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full inline-block", cfg.dot)} />
          <span className="font-mono text-xs font-semibold">{worker.workerName}</span>
        </div>
        <span className={cn("text-[10px] font-mono capitalize", cfg.color)}>{worker.status}</span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px] font-mono text-muted-foreground">
        <span title="Completed today">✓ {worker.completedToday}</span>
        <span title="Failed today">✗ {worker.failedToday}</span>
        <span title="Average latency">
          {worker.averageLatency != null ? `${Math.round(worker.averageLatency)}ms` : "—"}
        </span>
      </div>
      <div className="text-[9px] font-mono text-muted-foreground/60 truncate">
        {worker.currentJob ? `Job #${worker.currentJob}` : "idle"} · {lastSeen}
      </div>
    </div>
  );
}

// ── Job Row ───────────────────────────────────────────────────────────────────

function JobRow({
  job,
  onCancel,
  onRetry,
  onView,
  isMutating,
}: {
  job: AiJob;
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
  onView: (job: AiJob) => void;
  isMutating: boolean;
}) {
  const canCancel = ["queued", "waiting", "running", "retrying", "blocked"].includes(job.status);
  const canRetry  = ["failed", "blocked", "cancelled"].includes(job.status);
  const age = formatDistanceToNow(new Date(job.createdAt), { addSuffix: true });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onView(job)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onView(job);
        }
      }}
      className="flex items-center gap-3 py-2.5 px-3 border-b border-border/30 hover:bg-muted/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/60 focus-visible:-outline-offset-2 transition-colors text-xs font-mono cursor-pointer"
    >
      {/* Job code + type */}
      <div className="w-40 min-w-0">
        <p className="text-foreground truncate">{job.jobCode}</p>
        <p className="text-muted-foreground text-[10px] truncate">{job.jobType}</p>
      </div>

      {/* Status */}
      <div className="w-24 shrink-0">
        <JobStatusBadge status={job.status} />
      </div>

      {/* Priority */}
      <div className="w-14 shrink-0 text-right">
        <span className={cn("font-semibold", priorityColor(job.priority))}>P{job.priority}</span>
        {job.priorityScore != null && (
          <p className="text-[9px] text-muted-foreground">{job.priorityScore.toFixed(0)}pts</p>
        )}
      </div>

      {/* Retry */}
      <div className="w-12 shrink-0 text-center text-muted-foreground text-[10px]">
        {job.retryCount}/{job.maxRetry}
      </div>

      {/* Age */}
      <div className="flex-1 text-muted-foreground text-[10px] truncate">{age}</div>

      {/* Error snippet */}
      {job.errorMessage && (
        <div className="flex-1 text-red-400/70 text-[10px] truncate max-w-[120px]" title={job.errorMessage}>
          {job.errorMessage}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1 shrink-0">
        {canRetry && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isMutating}
            onClick={(e) => { e.stopPropagation(); onRetry(job.id); }}
            className="h-6 px-2 text-[10px] font-mono text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10"
          >
            <RotateCcw className="size-3" />
          </Button>
        )}
        {canCancel && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isMutating}
            onClick={(e) => { e.stopPropagation(); onCancel(job.id); }}
            className="h-6 px-2 text-[10px] font-mono text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <XCircle className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Job Detail Dialog ─────────────────────────────────────────────────────────

function JobDetailDialog({ job, onOpenChange }: { job: AiJob | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!job} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl font-mono">
        {job && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                {job.jobCode}
                <JobStatusBadge status={job.status} />
              </DialogTitle>
              <DialogDescription className="text-xs">{job.jobType}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <DetailField label="Priority" value={`P${job.priority} (${job.priorityScore?.toFixed(0) ?? "—"} pts)`} />
                <DetailField label="Retry" value={`${job.retryCount} / ${job.maxRetry} (${job.retryStrategy})`} />
                <DetailField label="Created" value={new Date(job.createdAt).toLocaleString()} />
                <DetailField label="Started" value={job.startedAt ? new Date(job.startedAt).toLocaleString() : "—"} />
                <DetailField label="Completed" value={job.completedAt ? new Date(job.completedAt).toLocaleString() : "—"} />
                <DetailField label="Duration" value={job.actualDuration != null ? `${job.actualDuration}ms` : "—"} />
                <DetailField label="Est. cost" value={job.estimatedCost != null ? `${job.estimatedCost}` : "—"} />
                <DetailField label="Actual cost" value={job.actualCost != null ? `${job.actualCost}` : "—"} />
              </div>

              {job.errorMessage && (
                <div>
                  <p className="text-[10px] text-red-400 uppercase tracking-wide mb-1">Error</p>
                  <pre className="bg-red-500/10 border border-red-500/20 rounded p-2 text-[11px] text-red-300 whitespace-pre-wrap break-words">
                    {job.errorMessage}
                  </pre>
                </div>
              )}

              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Payload</p>
                <pre className="bg-muted/20 border border-border/40 rounded p-2 text-[11px] whitespace-pre-wrap break-words max-h-40 overflow-auto">
                  {JSON.stringify(job.payloadJson, null, 2) || "—"}
                </pre>
              </div>

              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Result</p>
                <pre className="bg-muted/20 border border-border/40 rounded p-2 text-[11px] whitespace-pre-wrap break-words max-h-40 overflow-auto">
                  {job.resultJson != null ? JSON.stringify(job.resultJson, null, 2) : "No result yet"}
                </pre>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-foreground">{value}</p>
    </div>
  );
}

// ── Dispatcher Runtime Panel ──────────────────────────────────────────────────

// ── Dispatcher Panel ──────────────────────────────────────────────────────────

function DispatcherPanel({
  status,
  isLoading,
  onStart,
  onStop,
  onTick,
  isMutating,
}: {
  status: DispatcherStatus | undefined;
  isLoading: boolean;
  onStart: () => void;
  onStop: () => void;
  onTick: () => void;
  isMutating: boolean;
}) {
  const running = status?.running ?? false;

  function fmt(iso: string | null | undefined): string {
    if (!iso) return "—";
    try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); }
    catch { return "—"; }
  }

  return (
    <div className="border border-border/50 rounded-lg bg-card/40 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <span className="font-mono text-sm font-semibold">Dispatcher Runtime</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "size-2 rounded-full inline-block",
            running ? "bg-emerald-400 animate-pulse" : "bg-zinc-500",
          )} />
          <span className={cn(
            "text-[10px] font-mono",
            running ? "text-emerald-400" : "text-zinc-500",
          )}>
            {running ? "Running" : "Stopped"}
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          { label: "Workers",    value: status?.workerCount ?? 0,    icon: Cpu,         accent: "text-blue-400"    },
          { label: "Idle",       value: status?.idleWorkers ?? 0,    icon: Activity,    accent: "text-green-400"   },
          { label: "Busy",       value: status?.busyWorkers ?? 0,    icon: Zap,         accent: "text-yellow-400"  },
          { label: "Queued",     value: status?.queueLength ?? 0,    icon: ListOrdered, accent: "text-blue-400"    },
          { label: "Done Today", value: status?.processedToday ?? 0, icon: CheckCircle2,accent: "text-emerald-400" },
          { label: "Failed",     value: status?.failedToday ?? 0,    icon: XCircle,     accent: "text-red-400"     },
        ].map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className="bg-muted/20 rounded px-2 py-1.5 flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <Icon className={cn("size-2.5", accent)} />
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wide">{label}</span>
            </div>
            <span className="text-sm font-bold font-mono">{value}</span>
          </div>
        ))}
      </div>

      {/* Heartbeat / last tick */}
      <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground">
        <div className="flex items-center gap-1">
          <Wifi className="size-2.5" />
          <span>Heartbeat: {fmt(status?.lastHeartbeat)}</span>
        </div>
        <div className="flex items-center gap-1">
          <RotateCw className="size-2.5" />
          <span>Last Tick: {fmt(status?.lastTick)}</span>
        </div>
      </div>

      {/* Control buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant={running ? "ghost" : "default"}
          className="h-7 gap-1.5 text-xs font-mono"
          disabled={running || isMutating}
          onClick={onStart}
        >
          <Play className="size-3" />
          Start
        </Button>
        <Button
          size="sm"
          variant={running ? "default" : "ghost"}
          className="h-7 gap-1.5 text-xs font-mono"
          disabled={!running || isMutating}
          onClick={onStop}
        >
          <Square className="size-3" />
          Stop
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs font-mono"
          disabled={isMutating}
          onClick={onTick}
        >
          <SkipForward className="size-3" />
          Tick Once
        </Button>
      </div>
    </div>
  );
}


// ── Worker Cluster Panel ──────────────────────────────────────────────────────

function WorkerTypeChip({ type }: { type: string }) {
  const colors: Record<string, string> = {
    text_worker:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
    image_worker:  "bg-purple-500/15 text-purple-400 border-purple-500/30",
    export_worker: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    system_worker: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  };
  return (
    <Badge className={cn("text-[9px] border font-mono px-1.5 py-0 h-4", colors[type] ?? colors["system_worker"])}>
      {type.replace("_worker", "")}
    </Badge>
  );
}

function ClusterPanel({
  statuses,
  workers,
  isLoading,
  onRebalance,
  onRecover,
  isMutating,
}: {
  statuses: ClusterStatus[];
  workers: WorkerCapacityItem[];
  isLoading: boolean;
  onRebalance: () => void;
  onRecover: () => void;
  isMutating: boolean;
}) {
  const now = new Date();
  const cs = statuses[0];

  return (
    <div className="border border-border/50 rounded-lg bg-card/40 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="size-4 text-primary" />
          <span className="font-mono text-sm font-semibold">Worker Cluster</span>
          <Badge variant="outline" className="text-[9px] font-mono h-4 px-1.5 border-border/50 text-muted-foreground">
            Phase 5.2
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isMutating}
            onClick={onRecover}
            className="h-6 gap-1.5 text-[10px] font-mono border-border/50 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10"
          >
            <AlertTriangle className="size-3" />
            Recover Stale
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isMutating}
            onClick={onRebalance}
            className="h-6 gap-1.5 text-[10px] font-mono border-border/50 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
          >
            <DatabaseZap className="size-3" />
            Rebalance
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Cluster summary */}
          {cs && (
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {[
                { label: "Total",    value: cs.totalWorkers,   accent: "text-foreground" },
                { label: "Online",   value: cs.onlineWorkers,  accent: "text-blue-400"   },
                { label: "Idle",     value: cs.idleWorkers,    accent: "text-green-400"  },
                { label: "Busy",     value: cs.busyWorkers,    accent: "text-yellow-400" },
                { label: "Stale",    value: cs.staleWorkers,   accent: cs.staleWorkers > 0 ? "text-red-400" : "text-muted-foreground" },
                { label: "Offline",  value: cs.offlineWorkers, accent: "text-zinc-500"   },
                { label: "Capacity", value: `${cs.capacityPct}%`, accent: cs.capacityPct > 80 ? "text-red-400" : "text-emerald-400" },
              ].map(({ label, value, accent }) => (
                <div key={label} className="border border-border/30 rounded bg-muted/10 p-2 text-center">
                  <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wide">{label}</div>
                  <div className={cn("text-sm font-bold font-mono mt-0.5", accent)}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Capacity bar */}
          {cs && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground">
                <span>{cs.usedCapacity} / {cs.totalCapacity} slots used</span>
                <span>{cs.nodes.length} node{cs.nodes.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", cs.capacityPct > 80 ? "bg-red-500" : "bg-emerald-500")}
                  style={{ width: `${Math.min(100, cs.capacityPct)}%` }}
                />
              </div>
            </div>
          )}

          {/* Worker rows */}
          {workers.length === 0 ? (
            <p className="text-xs font-mono text-muted-foreground text-center py-2">No workers registered</p>
          ) : (
            <div className="space-y-1.5">
              {workers.map((w) => {
                const cfg = WORKER_STATUS_CONFIG[w.status] ?? WORKER_STATUS_CONFIG["offline"]!;
                const leaseExpired = !w.leaseValid && w.leaseExpiresAt !== null;
                const lastSeen = formatDistanceToNow(new Date(w.lastHeartbeat), { addSuffix: true });
                const slotPct = w.maxConcurrentJobs > 0
                  ? Math.round((w.runningJobs / w.maxConcurrentJobs) * 100)
                  : 0;

                return (
                  <div key={w.id} className="border border-border/30 rounded-lg bg-muted/5 p-2.5 grid grid-cols-[auto_1fr_auto] gap-x-3 items-center">
                    {/* Status dot */}
                    <span className={cn("size-2 rounded-full shrink-0", cfg.dot)} />

                    {/* Main info */}
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-xs font-semibold">{w.workerName}</span>
                        <WorkerTypeChip type={w.workerType} />
                        {leaseExpired && (
                          <Badge className="text-[8px] border font-mono px-1 py-0 h-3.5 bg-red-500/10 text-red-400 border-red-500/30">
                            lease expired
                          </Badge>
                        )}
                        {w.leaseValid && (
                          <Badge className="text-[8px] border font-mono px-1 py-0 h-3.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                            lease ok
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground">
                        <span title="Region">{w.region}</span>
                        <span>·</span>
                        <span title="Node">{w.nodeId}</span>
                        <span>·</span>
                        <span>{lastSeen}</span>
                        <span>·</span>
                        <span>{w.runningJobs}/{w.maxConcurrentJobs} jobs</span>
                      </div>
                      {w.capabilities.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {w.capabilities.slice(0, 6).map((cap) => (
                            <span key={cap} className="text-[8px] font-mono bg-muted/30 px-1 py-0.5 rounded text-muted-foreground">
                              {cap}
                            </span>
                          ))}
                          {w.capabilities.length > 6 && (
                            <span className="text-[8px] font-mono text-muted-foreground/60">+{w.capabilities.length - 6}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Slot mini-bar */}
                    <div className="w-10 flex flex-col items-end gap-0.5 shrink-0">
                      <span className={cn("text-[9px] font-mono font-semibold", cfg.color)}>{w.availableSlots} free</span>
                      <div className="w-10 h-1 bg-muted/30 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", slotPct > 80 ? "bg-red-500" : "bg-emerald-500")}
                          style={{ width: `${slotPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const ALL_STATUSES = ["queued","waiting","running","retrying","completed","failed","cancelled","blocked"];
const JOB_TYPES = ["llm_inference","creative_brief","image_generation","qc_review","noop","custom","analytics","cleanup","pdf_export","csv_export"];
const LIMIT = 50;

export default function QueuePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [typeFilter,   setTypeFilter]   = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const [viewedJob, setViewedJob] = useState<AiJob | null>(null);

  // Derive status param
  const statusParam =
    statusFilter === "active"  ? "queued,waiting,running,retrying" :
    statusFilter === "all"     ? undefined :
    statusFilter;

  const jobsQueryParams = {
    status:   statusParam,
    jobType:  typeFilter === "all" ? undefined : typeFilter,
    limit:    LIMIT,
    offset,
  };

  const { data: dispatcherStatus, isLoading: dispatcherLoading } = useGetDispatcherStatus({
    query: { queryKey: getGetDispatcherStatusQueryKey(), refetchInterval: 3000 },
  });

  const startDispatcher = useStartDispatcher({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDispatcherStatusQueryKey() });
        toast({ title: "Dispatcher started" });
      },
      onError: (e: unknown) => toast({
        title: (e as { message?: string })?.message ?? "Start failed",
        variant: "destructive",
      }),
    },
  });

  const stopDispatcher = useStopDispatcher({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDispatcherStatusQueryKey() });
        toast({ title: "Dispatcher stopped" });
      },
      onError: (e: unknown) => toast({
        title: (e as { message?: string })?.message ?? "Stop failed",
        variant: "destructive",
      }),
    },
  });

  const runTick = useRunDispatcherTick({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDispatcherStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetJobStatsQueryKey() });
        toast({ title: "Tick completed" });
      },
      onError: (e: unknown) => toast({
        title: (e as { message?: string })?.message ?? "Tick failed",
        variant: "destructive",
      }),
    },
  });

  const { data: stats, isLoading: statsLoading } = useGetJobStats({
    query: { queryKey: getGetJobStatsQueryKey(), refetchInterval: 5000 },
  });

  const { data: jobPage, isLoading: jobsLoading } = useListJobs(
    jobsQueryParams,
    { query: { queryKey: getListJobsQueryKey(jobsQueryParams), refetchInterval: 5000 } },
  );

  const { data: workers = [], isLoading: workersLoading } = useListWorkers({
    query: { queryKey: getListWorkersQueryKey(), refetchInterval: 8000 },
  });

  const cancelJob = useCancelJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetJobStatsQueryKey() });
        toast({ title: "Job cancelled" });
      },
      onError: (e: unknown) => toast({
        title: (e as { message?: string })?.message ?? "Cancel failed",
        variant: "destructive",
      }),
    },
  });

  const retryJob = useRetryJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetJobStatsQueryKey() });
        toast({ title: "Job requeued" });
      },
      onError: (e: unknown) => toast({
        title: (e as { message?: string })?.message ?? "Retry failed",
        variant: "destructive",
      }),
    },
  });

  // ── Phase 5.2: Cluster hooks ───────────────────────────────────────────────
  const { data: clusterStatuses = [], isLoading: clusterLoading } = useGetClusterStatus({
    query: { queryKey: getClusterStatusQueryKey(), refetchInterval: 5000 },
  });

  const { data: clusterWorkers = [], isLoading: clusterWorkersLoading } = useGetClusterWorkers({
    query: { queryKey: getClusterWorkersQueryKey(), refetchInterval: 5000 },
  });

  const rebalance = useRebalanceCluster({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getClusterStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getClusterWorkersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetJobStatsQueryKey() });
        toast({ title: `Rebalanced — ${data.recoveredJobs} job(s) recovered, ${data.staleWorkers} stale worker(s) cleared` });
      },
      onError: (e: unknown) => toast({
        title: (e as { message?: string })?.message ?? "Rebalance failed",
        variant: "destructive",
      }),
    },
  });

  const recoverStale = useRecoverStaleWorkers({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getClusterStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getClusterWorkersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetJobStatsQueryKey() });
        toast({ title: `Recovery complete — ${data.recoveredJobs} job(s) recovered` });
      },
      onError: (e: unknown) => toast({
        title: (e as { message?: string })?.message ?? "Recovery failed",
        variant: "destructive",
      }),
    },
  });

  const isClusterMutating = rebalance.isPending || recoverStale.isPending;
  const isDispatcherMutating = startDispatcher.isPending || stopDispatcher.isPending || runTick.isPending;
  const isMutating = cancelJob.isPending || retryJob.isPending;

  const jobs = jobPage?.items ?? [];
  const total = jobPage?.total ?? 0;

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: getGetJobStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getClusterStatusQueryKey() });
    queryClient.invalidateQueries({ queryKey: getClusterWorkersQueryKey() });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <ListOrdered className="size-5 text-primary" />
            <h1 className="font-bold text-lg font-mono">AI Queue Center</h1>
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            Job queue, worker pool, and priority engine — Phase 5
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="h-7 gap-1.5 text-xs font-mono"
        >
          <RefreshCw className="size-3" />
          Refresh
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {statsLoading ? (
              <div className="col-span-8 flex items-center justify-center py-6">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : stats ? (
              <>
                <StatCard label="Queued"   value={stats.jobs["queued"]   ?? 0} icon={ListOrdered}  accent="text-blue-400"    />
                <StatCard label="Waiting"  value={stats.jobs["waiting"]  ?? 0} icon={Clock}        accent="text-slate-400"   />
                <StatCard label="Running"  value={stats.jobs["running"]  ?? 0} icon={Zap}          accent="text-emerald-400" />
                <StatCard label="Retrying" value={stats.jobs["retrying"] ?? 0} icon={RotateCcw}    accent="text-yellow-400"  />
                <StatCard label="Failed"   value={stats.jobs["failed"]   ?? 0} icon={XCircle}      accent="text-red-400"     />
                <StatCard label="Blocked"  value={stats.jobs["blocked"]  ?? 0} icon={AlertCircle}  accent="text-orange-400"  />
                <StatCard label="Done Today" value={stats.completedToday ?? 0} icon={CheckCircle2} accent="text-green-400"   />
                <StatCard
                  label="Avg Wait"
                  value={stats.avgWaitMs != null ? `${(stats.avgWaitMs / 1000).toFixed(1)}s` : "—"}
                  icon={Timer}
                />
              </>
            ) : null}
          </div>

          {/* Dispatcher Runtime Panel */}
          <DispatcherPanel
            status={dispatcherStatus}
            isLoading={dispatcherLoading}
            onStart={() => startDispatcher.mutate()}
            onStop={() => stopDispatcher.mutate()}
            onTick={() => runTick.mutate()}
            isMutating={isDispatcherMutating}
          />

          {/* Worker Cluster Panel — Phase 5.2 */}
          <ClusterPanel
            statuses={clusterStatuses}
            workers={clusterWorkers}
            isLoading={clusterLoading || clusterWorkersLoading}
            onRebalance={() => rebalance.mutate()}
            onRecover={() => recoverStale.mutate()}
            isMutating={isClusterMutating}
          />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Worker Panel */}
            <div className="lg:col-span-1 space-y-3">
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-primary" />
                <span className="font-mono text-sm font-semibold">Workers</span>
                <Badge variant="outline" className="text-[10px] font-mono h-5 px-1.5 border-border/50 text-muted-foreground">
                  {workers.length}
                </Badge>
              </div>
              {workersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : workers.length === 0 ? (
                <div className="border border-dashed border-border/40 rounded-lg p-6 text-center">
                  <p className="text-xs text-muted-foreground font-mono">No workers registered</p>
                  <p className="text-[10px] text-muted-foreground/60 font-mono mt-1">Run pnpm seed to add defaults</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {workers.map((w) => <WorkerCard key={w.id} worker={w} />)}
                </div>
              )}

              {/* Worker summary */}
              {stats && workers.length > 0 && (
                <>
                  <Separator className="border-border/30" />
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                    {Object.entries(stats.workers).map(([status, count]) => count > 0 && (
                      <div key={status} className="flex items-center justify-between bg-muted/20 rounded px-2 py-1">
                        <span className="text-muted-foreground capitalize">{status}</span>
                        <span className="font-semibold">{count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Job Table */}
            <div className="lg:col-span-3 space-y-3">
              {/* Filters */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Layers className="size-4 text-primary" />
                  <span className="font-mono text-sm font-semibold">Jobs</span>
                  {total > 0 && (
                    <Badge variant="outline" className="text-[10px] font-mono h-5 px-1.5 border-border/50 text-muted-foreground">
                      {total}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setOffset(0); }}>
                    <SelectTrigger className="h-7 text-[11px] font-mono w-36 border-border/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="all">All statuses</SelectItem>
                      {ALL_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setOffset(0); }}>
                    <SelectTrigger className="h-7 text-[11px] font-mono w-36 border-border/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {JOB_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Table header */}
              <div className="border border-border/50 rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 py-2 px-3 bg-muted/20 border-b border-border/50 text-[10px] font-mono text-muted-foreground">
                  <span className="w-40">Job</span>
                  <span className="w-24">Status</span>
                  <span className="w-14 text-right">Priority</span>
                  <span className="w-12 text-center">Retry</span>
                  <span className="flex-1">Age</span>
                  <span className="w-16 text-right">Actions</span>
                </div>

                {jobsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <ListOrdered className="size-8 text-muted-foreground/30" />
                    <p className="text-sm font-mono text-muted-foreground">No jobs matching this filter</p>
                  </div>
                ) : (
                  <div>
                    {jobs.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        onCancel={(id) => cancelJob.mutate({ id })}
                        onRetry={(id) => retryJob.mutate({ id })}
                        onView={setViewedJob}
                        isMutating={isMutating}
                      />
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {total > LIMIT && (
                  <div className="flex items-center justify-between px-3 py-2 border-t border-border/30 bg-muted/10 text-[10px] font-mono text-muted-foreground">
                    <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={offset === 0}
                        onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
                        className="h-5 px-2 text-[10px] font-mono"
                      >
                        Prev
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={offset + LIMIT >= total}
                        onClick={() => setOffset((o) => o + LIMIT)}
                        className="h-5 px-2 text-[10px] font-mono"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      <JobDetailDialog job={viewedJob} onOpenChange={(open) => !open && setViewedJob(null)} />
    </div>
  );
}
