import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetJobStats,
  useListJobs,
  useListWorkers,
  useCancelJob,
  useRetryJob,
  getGetJobStatsQueryKey,
  getListJobsQueryKey,
  getListWorkersQueryKey,
  useGetDispatcherStatus,
  useStartDispatcher,
  useStopDispatcher,
  useTickDispatcher,
  type AiJob,
  type AiWorker,
  type JobStats,
  type DispatcherStatus,
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
  Activity,
  AlertCircle,
  Ban,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock,
  Cpu,
  Layers,
  ListOrdered,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
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
  isMutating,
}: {
  job: AiJob;
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
  isMutating: boolean;
}) {
  const canCancel = ["queued", "waiting", "running", "retrying", "blocked"].includes(job.status);
  const canRetry  = ["failed", "blocked", "cancelled"].includes(job.status);
  const age = formatDistanceToNow(new Date(job.createdAt), { addSuffix: true });

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 border-b border-border/30 hover:bg-muted/10 transition-colors text-xs font-mono">
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
            onClick={() => onRetry(job.id)}
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
            onClick={() => onCancel(job.id)}
            className="h-6 px-2 text-[10px] font-mono text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <XCircle className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Dispatcher Runtime Panel ──────────────────────────────────────────────────

function DispatcherPanel() {
  const { toast } = useToast();
  const { data: status, isLoading } = useGetDispatcherStatus();

  const start   = useStartDispatcher({
    onSuccess: () => toast({ title: "Dispatcher started" }),
    onError:   (e: unknown) => toast({ title: (e as { message?: string })?.message ?? "Failed", variant: "destructive" }),
  });
  const stop    = useStopDispatcher({
    onSuccess: () => toast({ title: "Dispatcher stopped" }),
    onError:   (e: unknown) => toast({ title: (e as { message?: string })?.message ?? "Failed", variant: "destructive" }),
  });
  const tick    = useTickDispatcher({
    onSuccess: (d) => toast({ title: `Tick: claimed ${d.tick.claimed}, completed ${d.tick.completed}` }),
    onError:   (e: unknown) => toast({ title: (e as { message?: string })?.message ?? "Failed", variant: "destructive" }),
  });

  const isMutating = start.isPending || stop.isPending || tick.isPending;

  const running = status?.running ?? false;

  function fmt(iso: string | null | undefined): string {
    if (!iso) return "—";
    try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); }
    catch { return "—"; }
  }

  return (
    <div className="border border-border/50 rounded-lg bg-card/40 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <span className="font-mono text-sm font-semibold">Dispatcher Runtime</span>
          <span className="text-[10px] font-mono text-muted-foreground">Phase 5.1</span>
        </div>
        {isLoading ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <Badge className={cn(
            "text-[10px] font-mono border px-1.5 py-0 h-4",
            running
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
          )}>
            {running ? "Running" : "Stopped"}
          </Badge>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          { label: "Workers",    value: status?.workerCount ?? 0,    icon: Cpu,      accent: "text-blue-400"    },
          { label: "Idle",       value: status?.idleWorkers ?? 0,    icon: Activity, accent: "text-green-400"   },
          { label: "Busy",       value: status?.busyWorkers ?? 0,    icon: Zap,      accent: "text-yellow-400"  },
          { label: "Queued",     value: status?.queueLength ?? 0,    icon: ListOrdered, accent: "text-blue-400" },
          { label: "Done Today", value: status?.processedToday ?? 0, icon: CheckCircle2, accent: "text-emerald-400" },
          { label: "Failed",     value: status?.failedToday ?? 0,    icon: XCircle,  accent: "text-red-400"     },
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
        {status && (
          <div className="flex items-center gap-1 ml-auto">
            <Clock className="size-2.5" />
            <span>Poll: {(status as DispatcherStatus & { running: boolean }) && typeof (status as any).workerPollIntervalMs === "number" ? `${(status as any).workerPollIntervalMs / 1000}s` : "5s"}</span>
          </div>
        )}
      </div>

      {/* Control buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant={running ? "ghost" : "default"}
          className="h-7 gap-1.5 text-xs font-mono"
          disabled={running || isMutating}
          onClick={() => start.mutate()}
        >
          {start.isPending ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
          Start
        </Button>
        <Button
          size="sm"
          variant={running ? "default" : "ghost"}
          className="h-7 gap-1.5 text-xs font-mono"
          disabled={!running || isMutating}
          onClick={() => stop.mutate()}
        >
          {stop.isPending ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />}
          Stop
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs font-mono"
          disabled={isMutating}
          onClick={() => tick.mutate()}
        >
          {tick.isPending ? <Loader2 className="size-3 animate-spin" /> : <SkipForward className="size-3" />}
          Tick Once
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs font-mono"
          disabled={isMutating}
          onClick={async () => {
            await stop.mutateAsync();
            await start.mutateAsync();
          }}
        >
          <RotateCw className="size-3" />
          Restart
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const ALL_STATUSES = ["queued","waiting","running","retrying","completed","failed","cancelled","blocked"];
const JOB_TYPES = ["llm_inference","creative_brief","image_generation","qc_review","noop","custom"];
const LIMIT = 50;

export default function QueuePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [typeFilter,   setTypeFilter]   = useState<string>("all");
  const [offset, setOffset] = useState(0);

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

  const isMutating = cancelJob.isPending || retryJob.isPending;

  const jobs = jobPage?.items ?? [];
  const total = jobPage?.total ?? 0;

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: getGetJobStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
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
          <DispatcherPanel />

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
    </div>
  );
}
