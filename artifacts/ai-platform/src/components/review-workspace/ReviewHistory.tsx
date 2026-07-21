import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  CheckCircle2, XCircle, RotateCcw, Eye, Link2, ShieldCheck, MessageSquare,
  Ban, AlertCircle, Loader2, PlusCircle,
} from "lucide-react";
import { useReviewHistory, type HistoryEvent } from "@/hooks/use-review-workspace";

interface ReviewHistoryProps {
  reviewId: number;
  className?: string;
}

function eventIcon(type: string) {
  switch (type) {
    case "approved":           return <CheckCircle2 className="size-4 text-green-500" aria-hidden />;
    case "rejected":           return <XCircle className="size-4 text-red-500" aria-hidden />;
    case "revision_requested": return <RotateCcw className="size-4 text-yellow-500" aria-hidden />;
    case "viewed":             return <Eye className="size-4 text-blue-500" aria-hidden />;
    case "shared":             return <Link2 className="size-4 text-blue-400" aria-hidden />;
    case "internal_sign_off":  return <ShieldCheck className="size-4 text-green-600" aria-hidden />;
    case "comment":            return <MessageSquare className="size-4 text-gray-400" aria-hidden />;
    case "revoked":
    case "canceled":           return <Ban className="size-4 text-gray-400" aria-hidden />;
    case "created":            return <PlusCircle className="size-4 text-gray-400" aria-hidden />;
    default:                   return <div className="size-2 rounded-full bg-muted-foreground/40 mt-1" aria-hidden />;
  }
}

function eventDotColor(type: string): string {
  switch (type) {
    case "approved":           return "border-green-500 bg-green-50 dark:bg-green-900/20";
    case "rejected":           return "border-red-500 bg-red-50 dark:bg-red-900/20";
    case "revision_requested": return "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20";
    case "viewed":
    case "shared":             return "border-blue-400 bg-blue-50 dark:bg-blue-900/20";
    case "internal_sign_off":  return "border-green-600 bg-green-50 dark:bg-green-900/20";
    case "comment":            return "border-border bg-muted/50";
    case "revoked":
    case "canceled":           return "border-gray-400 bg-gray-50 dark:bg-gray-800";
    default:                   return "border-border bg-muted/50";
  }
}

function actorBadge(actorType: HistoryEvent["actorType"]) {
  const map: Record<HistoryEvent["actorType"], { label: string; cls: string }> = {
    client:   { label: "Client",   cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
    internal: { label: "Internal", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
    agent:    { label: "Agent",    cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" },
    system:   { label: "System",   cls: "bg-muted text-muted-foreground" },
  };
  const { label, cls } = map[actorType];
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", cls)}>{label}</span>
  );
}

function HistoryItem({ event, isLast }: { event: HistoryEvent; isLast: boolean }) {
  return (
    <li className="flex gap-3">
      {/* Timeline dot + line */}
      <div className="flex flex-col items-center">
        <div
          className={cn("size-8 rounded-full border-2 flex items-center justify-center shrink-0", eventDotColor(event.eventType))}
          aria-hidden
        >
          {eventIcon(event.eventType)}
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-1" aria-hidden />}
      </div>

      {/* Content */}
      <div className={cn("flex-1 pb-4", isLast && "pb-0")}>
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-medium text-foreground">{event.label}</span>
          {actorBadge(event.actorType)}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{event.actor}</span>
          <span aria-hidden>·</span>
          <time dateTime={event.occurredAt}>{format(new Date(event.occurredAt), "d MMM yyyy, HH:mm")}</time>
        </div>
        {event.notes && (
          <p className="text-xs text-muted-foreground mt-1 bg-muted/40 rounded-lg px-3 py-2 italic">
            {event.notes}
          </p>
        )}
      </div>
    </li>
  );
}

export function ReviewHistory({ reviewId, className }: ReviewHistoryProps) {
  const { data, isLoading, error } = useReviewHistory(reviewId);

  return (
    <section className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)} aria-label="Review history">
      <h3 className="text-sm font-semibold text-foreground mb-4">
        History
        {data && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({data.history.length} event{data.history.length !== 1 ? "s" : ""})
          </span>
        )}
      </h3>

      {isLoading && (
        <div className="flex items-center gap-2" role="status" aria-label="Loading history">
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          <span className="text-sm text-muted-foreground">Loading history…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2" role="alert">
          <AlertCircle className="size-4 text-destructive" aria-hidden />
          <span className="text-sm text-destructive">Failed to load history</span>
        </div>
      )}

      {data && data.history.length === 0 && (
        <p className="text-sm text-muted-foreground">No history yet.</p>
      )}

      {data && data.history.length > 0 && (
        <ol className="space-y-0" aria-label="Timeline of review events">
          {data.history.map((event, idx) => (
            <HistoryItem
              key={event.id}
              event={event}
              isLast={idx === data.history.length - 1}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
