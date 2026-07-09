import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSchedules,
  useGetSchedulerStatus,
  useGetSchedulerSettings,
  useUpdateSchedulerSettings,
  useStartScheduler,
  useStopScheduler,
  useTickScheduler,
  useCreateSchedule,
  usePauseSchedule,
  useResumeSchedule,
  useCancelSchedule,
  useRunScheduleNow,
  useListRunsForSchedule,
  getListSchedulesQueryKey,
  getGetSchedulerStatusQueryKey,
  getGetSchedulerSettingsQueryKey,
  getListRunsForScheduleQueryKey,
  CreateScheduleBodyTriggerType,
  CreateScheduleBodyTargetType,
  type AiSchedule,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CalendarClock,
  ChevronRight,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active:    "bg-green-500/10 text-green-400 border-green-500/20",
  paused:    "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  completed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  failed:    "bg-red-500/10 text-red-400 border-red-500/20",
  cancelled: "bg-muted/30 text-muted-foreground border-border",
  pending:   "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  running:   "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  skipped:   "bg-muted/30 text-muted-foreground border-border",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("text-xs font-mono", STATUS_COLORS[status] ?? "bg-muted/30 text-muted-foreground")}>
      {status}
    </Badge>
  );
}

function formatTs(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

// ── Create Schedule Dialog ─────────────────────────────────────────────────────

const TRIGGER_TYPES = Object.values(CreateScheduleBodyTriggerType);
const TARGET_TYPES = Object.values(CreateScheduleBodyTargetType);

function CreateScheduleDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    scheduleName: "",
    description: "",
    triggerType: "cron" as typeof TRIGGER_TYPES[number],
    cronExpression: "0 * * * *",
    intervalSeconds: "3600",
    runAt: "",
    timezone: "UTC",
    eventType: "",
    targetType: "audit_log" as typeof TARGET_TYPES[number],
    targetConfig: "{}",
    payload: "{}",
  });
  const { mutate: create, isPending } = useCreateSchedule();

  function handleSubmit() {
    let targetConfigJson: Record<string, unknown> = {};
    let payloadJson: Record<string, unknown> = {};
    try { targetConfigJson = JSON.parse(form.targetConfig); } catch { /* ignore */ }
    try { payloadJson = JSON.parse(form.payload); } catch { /* ignore */ }

    create(
      {
        data: {
          scheduleName: form.scheduleName,
          description: form.description || undefined,
          triggerType: form.triggerType,
          cronExpression: form.triggerType === "cron" ? form.cronExpression : undefined,
          intervalSeconds: form.triggerType === "interval" ? Number(form.intervalSeconds) : undefined,
          runAt: form.triggerType === "one_time" && form.runAt ? new Date(form.runAt).toISOString() : undefined,
          timezone: form.timezone || undefined,
          eventType: form.triggerType === "event_followup" ? form.eventType : undefined,
          targetType: form.targetType,
          targetConfigJson,
          payloadJson,
        },
      },
      { onSuccess: () => { setOpen(false); onSuccess(); } },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8">
          <Plus className="size-3.5 mr-1.5" />
          New Schedule
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Schedule</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
            <Input className="h-8 text-sm mt-1" value={form.scheduleName} onChange={(e) => setForm((f) => ({ ...f, scheduleName: e.target.value }))} placeholder="e.g. daily-report" />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea className="text-xs mt-1 h-16" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Trigger Type</Label>
            <Select value={form.triggerType} onValueChange={(v) => setForm((f) => ({ ...f, triggerType: v as typeof TRIGGER_TYPES[number] }))}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{TRIGGER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.triggerType === "cron" && (
            <div>
              <Label className="text-xs">Cron Expression</Label>
              <Input className="h-8 text-sm font-mono mt-1" value={form.cronExpression} onChange={(e) => setForm((f) => ({ ...f, cronExpression: e.target.value }))} placeholder="0 * * * *" />
            </div>
          )}
          {form.triggerType === "interval" && (
            <div>
              <Label className="text-xs">Interval (seconds)</Label>
              <Input className="h-8 text-sm mt-1" type="number" value={form.intervalSeconds} onChange={(e) => setForm((f) => ({ ...f, intervalSeconds: e.target.value }))} />
            </div>
          )}
          {form.triggerType === "one_time" && (
            <div>
              <Label className="text-xs">Run At</Label>
              <Input className="h-8 text-sm mt-1" type="datetime-local" value={form.runAt} onChange={(e) => setForm((f) => ({ ...f, runAt: e.target.value }))} />
            </div>
          )}
          {form.triggerType === "event_followup" && (
            <div>
              <Label className="text-xs">Event Type</Label>
              <Input className="h-8 text-sm font-mono mt-1" value={form.eventType} onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))} placeholder="e.g. job.completed" />
            </div>
          )}
          <div>
            <Label className="text-xs">Timezone</Label>
            <Input className="h-8 text-sm mt-1" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} placeholder="UTC" />
          </div>
          <div>
            <Label className="text-xs">Target Type</Label>
            <Select value={form.targetType} onValueChange={(v) => setForm((f) => ({ ...f, targetType: v as typeof TARGET_TYPES[number] }))}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{TARGET_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Target Config (JSON)</Label>
            <Textarea className="text-xs font-mono mt-1 h-20" value={form.targetConfig} onChange={(e) => setForm((f) => ({ ...f, targetConfig: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Payload (JSON)</Label>
            <Textarea className="text-xs font-mono mt-1 h-20" value={form.payload} onChange={(e) => setForm((f) => ({ ...f, payload: e.target.value }))} />
          </div>
        </div>
        <Button onClick={handleSubmit} disabled={!form.scheduleName || isPending} className="w-full">
          {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />}
          Create
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ── Schedule Detail Panel ──────────────────────────────────────────────────────

function ScheduleDetail({ schedule }: { schedule: AiSchedule }) {
  const { data: runsData, isLoading: runsLoading } = useListRunsForSchedule(schedule.id, { limit: 20 });
  const runs = runsData?.items ?? [];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">{schedule.scheduleName}</div>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono">{schedule.scheduleCode}</div>
        </div>
        <StatusBadge status={schedule.status} />
      </div>
      {schedule.description && (
        <p className="text-xs text-muted-foreground">{schedule.description}</p>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          ["Trigger", schedule.triggerType],
          ["Target", schedule.targetType],
          ["Cron", schedule.cronExpression ?? "—"],
          ["Interval (s)", schedule.intervalSeconds ?? "—"],
          ["Timezone", schedule.timezone],
          ["Run Count", schedule.runCount],
          ["Max Runs", schedule.maxRuns ?? "∞"],
          ["Last Run", formatTs(schedule.lastRunAt)],
          ["Next Run", formatTs(schedule.nextRunAt)],
          ["Created", formatTs(schedule.createdAt)],
        ].map(([label, value]) => (
          <div key={label} className="col-span-1">
            <div className="text-muted-foreground">{label}</div>
            <div className="font-mono text-foreground break-all">{String(value)}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Target Config</div>
        <pre className="text-xs bg-muted/30 rounded p-2 overflow-x-auto max-h-32 font-mono">
          {JSON.stringify(schedule.targetConfigJson, null, 2)}
        </pre>
      </div>

      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Run History ({runs.length})
        </div>
        {runsLoading ? (
          <div className="text-xs text-muted-foreground py-2">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No runs yet</div>
        ) : (
          <div className="space-y-1">
            {runs.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/50">
                <span className="font-mono text-muted-foreground">#{r.runNumber}</span>
                <StatusBadge status={r.status} />
                <span className="text-muted-foreground">{formatTs(r.startedAt)}</span>
                {r.errorMessage && <span className="text-red-400 truncate max-w-[160px]">{r.errorMessage}</span>}
                <span className="text-muted-foreground ml-auto">{formatTs(r.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Schedule Row ───────────────────────────────────────────────────────────────

function ScheduleRow({
  schedule,
  selected,
  onClick,
  onPause,
  onResume,
  onCancel,
  onRunNow,
}: {
  schedule: AiSchedule;
  selected: boolean;
  onClick: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRunNow: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border hover:bg-muted/30 transition-colors cursor-pointer",
        selected && "bg-primary/5 border-l-2 border-l-primary",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground truncate">{schedule.scheduleName}</span>
        <StatusBadge status={schedule.status} />
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-muted-foreground">{schedule.triggerType}</span>
        <span className="text-muted-foreground/30">·</span>
        <span className="text-xs text-muted-foreground">{schedule.targetType}</span>
        <span className="text-muted-foreground/30 ml-auto">·</span>
        <span className="text-xs text-muted-foreground">next: {formatTs(schedule.nextRunAt)}</span>
      </div>
      <div className="flex items-center gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
        {schedule.status === "active" && (
          <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={onPause}>
            <Pause className="size-3 mr-1" /> Pause
          </Button>
        )}
        {schedule.status === "paused" && (
          <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={onResume}>
            <Play className="size-3 mr-1" /> Resume
          </Button>
        )}
        {(schedule.status === "active" || schedule.status === "paused") && (
          <>
            <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={onRunNow}>
              <RotateCcw className="size-3 mr-1" /> Run Now
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-destructive" onClick={onCancel}>
              <X className="size-3 mr-1" /> Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Scheduler Page ────────────────────────────────────────────────────────

export default function SchedulerPage() {
  const queryClient = useQueryClient();
  const [selectedSchedule, setSelectedSchedule] = useState<AiSchedule | null>(null);
  const [filters, setFilters] = useState({ status: "", triggerType: "" });

  const listParams = {
    ...(filters.status      ? { status: filters.status }           : {}),
    ...(filters.triggerType ? { triggerType: filters.triggerType }  : {}),
    limit: 100,
  };

  const { data: schedulesData, isLoading: schedulesLoading, refetch: refetchSchedules } = useListSchedules(listParams);
  const { data: status, refetch: refetchStatus } = useGetSchedulerStatus({ query: { refetchInterval: 5000, queryKey: getGetSchedulerStatusQueryKey() } });
  const { data: settings } = useGetSchedulerSettings();

  const { mutate: start, isPending: starting } = useStartScheduler();
  const { mutate: stop, isPending: stopping } = useStopScheduler();
  const { mutate: tick, isPending: ticking } = useTickScheduler();
  const { mutate: updateSettings } = useUpdateSchedulerSettings();
  const { mutate: pauseSchedule } = usePauseSchedule();
  const { mutate: resumeSchedule } = useResumeSchedule();
  const { mutate: cancelSchedule } = useCancelSchedule();
  const { mutate: runNow } = useRunScheduleNow();

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() });
    if (selectedSchedule) {
      queryClient.invalidateQueries({ queryKey: getListRunsForScheduleQueryKey(selectedSchedule.id) });
    }
  }

  const schedules = schedulesData?.items ?? [];
  const total = schedulesData?.total ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <CalendarClock className="size-5 text-primary" />
          <div>
            <h1 className="text-sm font-semibold text-foreground">AI Scheduler</h1>
            <p className="text-xs text-muted-foreground">Cron, interval, one-time & event-driven automation</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CreateScheduleDialog onSuccess={() => refetchSchedules()} />
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { refetchSchedules(); refetchStatus(); }}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-6 px-6 py-3 border-b border-border flex-shrink-0 bg-muted/10">
        <div className="flex items-center gap-2">
          <div className={cn("size-2 rounded-full", status?.running ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-muted-foreground")} />
          <span className="text-xs font-mono uppercase text-muted-foreground">
            {status?.running ? "Running" : "Stopped"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">Active: <span className="text-foreground font-mono">{status?.activeSchedules ?? 0}</span></div>
        <div className="text-xs text-muted-foreground">Due Now: <span className="text-foreground font-mono">{status?.dueNow ?? 0}</span></div>
        <div className="text-xs text-muted-foreground">Processed Today: <span className="text-foreground font-mono">{status?.processedToday ?? 0}</span></div>
        <div className="text-xs text-muted-foreground">Failed Today: <span className="text-foreground font-mono">{status?.failedToday ?? 0}</span></div>
        <div className="text-xs text-muted-foreground">Last Tick: <span className="text-foreground font-mono">{formatTs(status?.lastTick)}</span></div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Auto Poll</Label>
          <Switch
            checked={settings?.schedulerEnabled ?? false}
            onCheckedChange={(v) => updateSettings({ data: { schedulerEnabled: v, pollIntervalMs: settings?.pollIntervalMs ?? 30000, timezone: settings?.timezone ?? "UTC" } }, { onSuccess: () => refetchStatus() })}
          />
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={starting || status?.running} onClick={() => start(undefined, { onSuccess: () => refetchStatus() })}>
            {starting ? <Loader2 className="size-3 animate-spin mr-1" /> : <Play className="size-3 mr-1" />}
            Start
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={stopping || !status?.running} onClick={() => stop(undefined, { onSuccess: () => refetchStatus() })}>
            {stopping ? <Loader2 className="size-3 animate-spin mr-1" /> : <Pause className="size-3 mr-1" />}
            Stop
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ticking} onClick={() => tick(undefined, { onSuccess: () => invalidateAll() })}>
            {ticking ? <Loader2 className="size-3 animate-spin mr-1" /> : <Zap className="size-3 mr-1" />}
            Tick Now
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Schedule list */}
        <div className="w-[26rem] border-r border-border flex flex-col min-h-0">
          <div className="p-3 border-b border-border flex gap-2 flex-shrink-0">
            <Select value={filters.status || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "all" ? "" : v }))}>
              <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {["active", "paused", "completed", "failed", "cancelled"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.triggerType || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, triggerType: v === "all" ? "" : v }))}>
              <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Trigger" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Triggers</SelectItem>
                {TRIGGER_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="flex-1">
            {schedulesLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="size-4 animate-spin mr-2" /> Loading schedules…
              </div>
            ) : schedules.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <CalendarClock className="size-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No schedules yet</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Create a schedule to automate jobs and events</p>
              </div>
            ) : (
              schedules.map((s) => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  selected={selectedSchedule?.id === s.id}
                  onClick={() => setSelectedSchedule(s)}
                  onPause={() => pauseSchedule({ id: s.id }, { onSuccess: invalidateAll })}
                  onResume={() => resumeSchedule({ id: s.id }, { onSuccess: invalidateAll })}
                  onCancel={() => cancelSchedule({ id: s.id }, { onSuccess: invalidateAll })}
                  onRunNow={() => runNow({ id: s.id }, { onSuccess: invalidateAll })}
                />
              ))
            )}
          </ScrollArea>
          <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground flex-shrink-0">
            {total} schedule{total === 1 ? "" : "s"}
          </div>
        </div>

        {/* Right: Detail */}
        <div className="flex-1 min-h-0 overflow-auto">
          {selectedSchedule ? (
            <ScheduleDetail schedule={selectedSchedule} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 text-muted-foreground">
              <CalendarClock className="size-10 mb-3 text-muted-foreground/20" />
              <p className="text-sm">Select a schedule to view details</p>
              <p className="text-xs mt-1 text-muted-foreground/60 flex items-center gap-1">
                <ChevronRight className="size-3" /> Click any schedule on the left to inspect runs and configuration
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
