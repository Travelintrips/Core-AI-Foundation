import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, XCircle, RotateCcw, Eye, AlertCircle, Ban, GitBranch } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { WorkspaceReview, WorkspaceMeta, WorkspaceStatus } from "@/hooks/use-review-workspace";

interface ReviewStatusSummaryProps {
  review: WorkspaceReview;
  meta: WorkspaceMeta | null;
  commentCount: number;
  className?: string;
}

const STATUS_CONFIG: Record<WorkspaceStatus, { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }> = {
  pending:             { label: "Pending",             color: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300", Icon: Clock },
  in_review:          { label: "In Review",           color: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300", Icon: Eye },
  approved:           { label: "Approved",            color: "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-300", Icon: CheckCircle2 },
  rejected:           { label: "Rejected",            color: "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-300", Icon: XCircle },
  revision_requested: { label: "Revision Requested",  color: "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-300", Icon: RotateCcw },
  expired:            { label: "Expired",             color: "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300", Icon: AlertCircle },
  canceled:           { label: "Canceled",            color: "bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800 dark:text-gray-400", Icon: Ban },
  revoked:            { label: "Revoked",             color: "bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800 dark:text-gray-400", Icon: Ban },
  superseded:         { label: "Superseded",          color: "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/40 dark:text-purple-300", Icon: GitBranch },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

export function ReviewStatusSummary({ review, meta, commentCount, className }: ReviewStatusSummaryProps) {
  const cfg = STATUS_CONFIG[review.wsStatus] ?? STATUS_CONFIG["pending"];
  const { Icon } = cfg;

  return (
    <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)}>
      {/* Status header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Review Status</h3>
        <Badge
          variant="outline"
          className={cn("gap-1.5 font-semibold text-xs px-2.5 py-1 border", cfg.color)}
          aria-label={`Review status: ${cfg.label}`}
        >
          <Icon className="size-3.5" aria-hidden />
          {cfg.label}
        </Badge>
      </div>

      {/* Client info */}
      <div className="mb-4">
        <p className="text-sm font-medium text-foreground">{review.clientName}</p>
        {review.clientEmail && (
          <p className="text-xs text-muted-foreground">{review.clientEmail}</p>
        )}
      </div>

      {/* Timeline stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {review.sharedAt && (
          <Stat label="Shared" value={format(new Date(review.sharedAt), "d MMM yyyy")} />
        )}
        {review.viewedAt && (
          <Stat label="Viewed" value={format(new Date(review.viewedAt), "d MMM yyyy")} />
        )}
        {review.approvedAt && (
          <Stat label="Approved" value={format(new Date(review.approvedAt), "d MMM yyyy")} />
        )}
        {review.rejectedAt && (
          <Stat label="Rejected" value={format(new Date(review.rejectedAt), "d MMM yyyy")} />
        )}
        {review.revisionRequestedAt && (
          <Stat label="Revision req." value={format(new Date(review.revisionRequestedAt), "d MMM yyyy")} />
        )}
        <Stat label="Comments" value={String(commentCount)} />
        <Stat label="Expires" value={format(new Date(review.tokenExpiresAt), "d MMM yyyy")} />
      </div>

      {/* Due date */}
      {meta?.dueDate && (
        <div className={cn(
          "flex items-center gap-2 text-xs rounded-lg px-3 py-2 mb-3",
          new Date(meta.dueDate) < new Date()
            ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
            : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
        )}>
          <Clock className="size-3.5 shrink-0" aria-hidden />
          <span>
            {new Date(meta.dueDate) < new Date() ? "Overdue" : "Due"}{" "}
            {format(new Date(meta.dueDate), "d MMM yyyy, HH:mm")}
          </span>
        </div>
      )}

      {/* Internal sign-off */}
      {meta?.internalSignedOff && (
        <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
          <span>
            Signed off by <strong>{meta.internalSignedOffBy}</strong>
            {meta.internalSignedOffAt && (
              <> · {format(new Date(meta.internalSignedOffAt), "d MMM")}</>
            )}
          </span>
        </div>
      )}

      {/* Cancel reason */}
      {meta?.cancelReason && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 mt-2">
          <Ban className="size-3.5 shrink-0 mt-0.5" aria-hidden />
          <span>{meta.cancelReason}</span>
        </div>
      )}
    </div>
  );
}
