import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEvents,
  useGetEventTimeline,
  usePublishEvent,
  useReplayEvent,
  useListEventSubscriptions,
  useCreateEventSubscription,
  useUpdateEventSubscription,
  useDeleteEventSubscription,
  getListEventsQueryKey,
  getListEventSubscriptionsQueryKey,
  getGetEventTimelineQueryKey,
  type AiEvent,
  type AiEventSubscription,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  GitMerge,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending:    "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  published:  "bg-blue-500/10 text-blue-400 border-blue-500/20",
  processing: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  processed:  "bg-green-500/10 text-green-400 border-green-500/20",
  failed:     "bg-red-500/10 text-red-400 border-red-500/20",
  ignored:    "bg-muted/30 text-muted-foreground border-border",
  active:     "bg-green-500/10 text-green-400 border-green-500/20",
  paused:     "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  disabled:   "bg-muted/30 text-muted-foreground border-border",
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

// ── Event Row ──────────────────────────────────────────────────────────────────

function EventRow({
  event,
  selected,
  onClick,
}: {
  event: AiEvent;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border hover:bg-muted/30 transition-colors",
        selected && "bg-primary/5 border-l-2 border-l-primary",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-primary truncate">{event.eventType}</span>
        <StatusBadge status={event.status} />
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-muted-foreground">{event.sourceModule}</span>
        <span className="text-muted-foreground/30">·</span>
        <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px]">
          {event.correlationId.slice(0, 8)}…
        </span>
        <span className="text-muted-foreground/30 ml-auto">·</span>
        <span className="text-xs text-muted-foreground">{formatTs(event.createdAt)}</span>
      </div>
    </button>
  );
}

// ── Event Detail Panel ─────────────────────────────────────────────────────────

function EventDetail({ event, onReplay }: { event: AiEvent; onReplay: (id: string) => void }) {
  const [showTimeline, setShowTimeline] = useState(false);
  const { data: timeline, isLoading: timelineLoading } = useGetEventTimeline(
    event.correlationId,
    { query: { enabled: showTimeline, queryKey: getGetEventTimelineQueryKey(event.correlationId) } },
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm text-primary font-semibold">{event.eventType}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{event.sourceModule} · {event.sourceId ?? "—"}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={event.status} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReplay(event.eventId)}
            className="h-7 text-xs"
          >
            <RotateCcw className="size-3 mr-1" />
            Replay
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          ["Event ID", event.eventId],
          ["Correlation ID", event.correlationId],
          ["Causation ID", event.causationId ?? "—"],
          ["Published At", formatTs(event.publishedAt)],
          ["Processed At", formatTs(event.processedAt)],
          ["Created At", formatTs(event.createdAt)],
        ].map(([label, value]) => (
          <div key={label} className="col-span-1">
            <div className="text-muted-foreground">{label}</div>
            <div className="font-mono text-foreground break-all">{value}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Payload</div>
        <pre className="text-xs bg-muted/30 rounded p-2 overflow-x-auto max-h-40 font-mono">
          {JSON.stringify(event.payloadJson, null, 2)}
        </pre>
      </div>

      <div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs w-full"
          onClick={() => setShowTimeline(!showTimeline)}
        >
          <GitMerge className="size-3 mr-1" />
          {showTimeline ? "Hide" : "Show"} Correlation Timeline
        </Button>
        {showTimeline && (
          <div className="mt-2 space-y-1">
            {timelineLoading && <div className="text-xs text-muted-foreground">Loading timeline…</div>}
            {timeline?.events?.map((e) => (
              <div key={e.eventId} className="flex items-center gap-2 text-xs py-1 border-b border-border/50">
                <ChevronRight className="size-3 text-muted-foreground flex-shrink-0" />
                <span className="font-mono text-primary">{e.eventType}</span>
                <StatusBadge status={e.status} />
                <span className="text-muted-foreground ml-auto">{formatTs(e.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Publish Event Dialog ───────────────────────────────────────────────────────

function PublishEventDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    eventType: "",
    sourceModule: "manual",
    sourceId: "",
    payload: "{}",
  });
  const { mutate: publish, isPending } = usePublishEvent();

  function handleSubmit() {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(form.payload); } catch { /* ignore */ }
    publish(
      { data: { eventType: form.eventType, sourceModule: form.sourceModule, sourceId: form.sourceId || undefined, payload } },
      {
        onSuccess: () => { setOpen(false); onSuccess(); },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8">
          <Plus className="size-3.5 mr-1.5" />
          Publish Event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Publish Manual Event</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Event Type <span className="text-destructive">*</span></Label>
            <Input
              className="h-8 text-sm font-mono mt-1"
              placeholder="e.g. job.completed"
              value={form.eventType}
              onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Source Module</Label>
            <Input
              className="h-8 text-sm mt-1"
              value={form.sourceModule}
              onChange={(e) => setForm((f) => ({ ...f, sourceModule: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Source ID (optional)</Label>
            <Input
              className="h-8 text-sm mt-1"
              value={form.sourceId}
              onChange={(e) => setForm((f) => ({ ...f, sourceId: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs">Payload (JSON)</Label>
            <Textarea
              className="text-xs font-mono mt-1 h-24"
              value={form.payload}
              onChange={(e) => setForm((f) => ({ ...f, payload: e.target.value }))}
            />
          </div>
        </div>
        <Button onClick={handleSubmit} disabled={!form.eventType || isPending} className="w-full">
          {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Zap className="size-4 mr-2" />}
          Publish
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Subscription Dialog ─────────────────────────────────────────────────

const HANDLER_TYPES = [
  "create_job",
  "audit_log",
  "notification_hook",
  "update_project_status",
  "call_webhook",
] as const;

function CreateSubscriptionDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    subscriptionName: "",
    eventType: "",
    handlerType: "audit_log" as typeof HANDLER_TYPES[number],
    handlerConfig: "{}",
  });
  const { mutate: create, isPending } = useCreateEventSubscription();

  function handleSubmit() {
    let handlerConfig: Record<string, unknown> = {};
    try { handlerConfig = JSON.parse(form.handlerConfig); } catch { /* ignore */ }
    create(
      { data: { subscriptionName: form.subscriptionName, eventType: form.eventType, handlerType: form.handlerType, handlerConfig } },
      { onSuccess: () => { setOpen(false); onSuccess(); } },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8">
          <Plus className="size-3.5 mr-1.5" />
          New Subscription
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Event Subscription</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
            <Input className="h-8 text-sm mt-1" value={form.subscriptionName} onChange={(e) => setForm((f) => ({ ...f, subscriptionName: e.target.value }))} placeholder="e.g. job-failed-alert" />
          </div>
          <div>
            <Label className="text-xs">Event Type <span className="text-destructive">*</span></Label>
            <Input className="h-8 text-sm font-mono mt-1" value={form.eventType} onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))} placeholder="e.g. job.failed or *" />
          </div>
          <div>
            <Label className="text-xs">Handler</Label>
            <Select value={form.handlerType} onValueChange={(v) => setForm((f) => ({ ...f, handlerType: v as typeof HANDLER_TYPES[number] }))}>
              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{HANDLER_TYPES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Handler Config (JSON)</Label>
            <Textarea className="text-xs font-mono mt-1 h-24" value={form.handlerConfig} onChange={(e) => setForm((f) => ({ ...f, handlerConfig: e.target.value }))} />
          </div>
        </div>
        <Button onClick={handleSubmit} disabled={!form.subscriptionName || !form.eventType || isPending} className="w-full">
          {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />}
          Create
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Events Page ───────────────────────────────────────────────────────────

export default function EventsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"stream" | "subscriptions">("stream");
  const [selectedEvent, setSelectedEvent] = useState<AiEvent | null>(null);
  const [filters, setFilters] = useState({ eventType: "", sourceModule: "", status: "" });

  const eventsParams = {
    ...(filters.eventType    ? { eventType:    filters.eventType }    : {}),
    ...(filters.sourceModule ? { sourceModule: filters.sourceModule } : {}),
    ...(filters.status       ? { status:       filters.status }       : {}),
    limit: 100,
  };

  const { data: eventsData, isLoading: eventsLoading, refetch: refetchEvents } = useListEvents(eventsParams);
  const { data: subsData, isLoading: subsLoading, refetch: refetchSubs } = useListEventSubscriptions();

  const { mutate: replay } = useReplayEvent();
  const { mutate: updateSub } = useUpdateEventSubscription();
  const { mutate: deleteSub } = useDeleteEventSubscription();

  function handleReplay(eventId: string) {
    replay({ id: eventId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
      },
    });
  }

  function handleToggleSub(sub: AiEventSubscription) {
    const newStatus = sub.status === "active" ? "paused" : "active";
    updateSub({ id: sub.id, data: { status: newStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEventSubscriptionsQueryKey() });
      },
    });
  }

  function handleDeleteSub(id: number) {
    deleteSub({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEventSubscriptionsQueryKey() });
      },
    });
  }

  const events = eventsData?.events ?? [];
  const total = eventsData?.total ?? 0;
  const subs = subsData?.subscriptions ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <Zap className="size-5 text-primary" />
          <div>
            <h1 className="text-sm font-semibold text-foreground">AI Event Bus</h1>
            <p className="text-xs text-muted-foreground">Inter-module event stream</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PublishEventDialog onSuccess={() => refetchEvents()} />
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { refetchEvents(); refetchSubs(); }}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 px-6 border-b border-border flex-shrink-0">
        {(["stream", "subscriptions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize",
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "stream" ? `Event Stream (${total})` : `Subscriptions (${subs.length})`}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "stream" ? (
        <div className="flex flex-1 min-h-0">
          {/* Left: Event list */}
          <div className="w-96 border-r border-border flex flex-col min-h-0">
            {/* Filters */}
            <div className="p-3 border-b border-border space-y-2 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  className="h-7 text-xs pl-7"
                  placeholder="Filter by event type…"
                  value={filters.eventType}
                  onChange={(e) => setFilters((f) => ({ ...f, eventType: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                <Input
                  className="h-7 text-xs flex-1"
                  placeholder="Source module…"
                  value={filters.sourceModule}
                  onChange={(e) => setFilters((f) => ({ ...f, sourceModule: e.target.value }))}
                />
                <Select value={filters.status || "all"} onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "all" ? "" : v }))}>
                  <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {["pending","published","processing","processed","failed","ignored"].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* List */}
            <ScrollArea className="flex-1">
              {eventsLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin mr-2" /> Loading events…
                </div>
              ) : events.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                  <Zap className="size-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">No events yet</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Events appear when modules publish them</p>
                </div>
              ) : (
                events.map((e) => (
                  <EventRow
                    key={e.eventId}
                    event={e}
                    selected={selectedEvent?.eventId === e.eventId}
                    onClick={() => setSelectedEvent(e)}
                  />
                ))
              )}
            </ScrollArea>
          </div>

          {/* Right: Event detail */}
          <div className="flex-1 min-h-0 overflow-auto">
            {selectedEvent ? (
              <EventDetail event={selectedEvent} onReplay={handleReplay} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-6 text-muted-foreground">
                <Zap className="size-10 mb-3 text-muted-foreground/20" />
                <p className="text-sm">Select an event to view details</p>
                <p className="text-xs mt-1 text-muted-foreground/60">Click any event on the left to inspect its payload, replay it, or view its correlation timeline</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Subscriptions tab */
        <div className="flex flex-1 min-h-0 flex-col">
          <div className="flex items-center justify-between px-6 py-3 flex-shrink-0">
            <p className="text-xs text-muted-foreground">
              Active subscriptions route matching events to handler functions.
            </p>
            <CreateSubscriptionDialog onSuccess={() => refetchSubs()} />
          </div>
          <Separator />
          <ScrollArea className="flex-1">
            {subsLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="size-4 animate-spin mr-2" /> Loading…
              </div>
            ) : subs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <GitMerge className="size-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No subscriptions yet</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Create a subscription to route events to handler functions</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {subs.map((sub) => (
                  <div key={sub.id} className="flex items-start justify-between gap-4 px-6 py-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{sub.subscriptionName}</span>
                        <StatusBadge status={sub.status} />
                        <Badge variant="outline" className="text-xs font-mono text-indigo-400 border-indigo-500/20 bg-indigo-500/10">
                          {sub.handlerType}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Event: <span className="font-mono text-foreground">{sub.eventType}</span></span>
                        {sub.targetType && <><span>·</span><span>Target: {sub.targetType}</span></>}
                      </div>
                      {sub.handlerConfigJson && Object.keys(sub.handlerConfigJson as object).length > 0 && (
                        <pre className="text-xs font-mono mt-1.5 text-muted-foreground bg-muted/20 rounded px-2 py-1 max-w-lg overflow-x-auto">
                          {JSON.stringify(sub.handlerConfigJson, null, 2)}
                        </pre>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="size-3" />
                        {formatTs(sub.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => handleToggleSub(sub)}
                      >
                        {sub.status === "active" ? (
                          <AlertTriangle className="size-3 mr-1 text-yellow-400" />
                        ) : (
                          <CheckCircle2 className="size-3 mr-1 text-green-400" />
                        )}
                        {sub.status === "active" ? "Pause" : "Activate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteSub(sub.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
