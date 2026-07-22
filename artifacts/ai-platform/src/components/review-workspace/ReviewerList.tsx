import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { CheckCircle2, Clock, Eye, XCircle, RotateCcw, Ban } from "lucide-react";
import type { WorkspaceReview, WorkspaceMeta, WorkspaceStatus } from "@/hooks/use-review-workspace";

interface ReviewerEntry {
  id: number;
  name: string;
  email: string | null;
  wsStatus: WorkspaceStatus;
  sharedAt: string | null;
  viewedAt: string | null;
  decisionAt: string | null;
  internalSignedOff: boolean;
  internalSignedOffBy: string | null;
}

interface ReviewerListProps {
  review: WorkspaceReview;
  meta: WorkspaceMeta | null;
  /** Additional reviewers (future: support multi-reviewer scenarios) */
  additionalReviewers?: ReviewerEntry[];
  className?: string;
}

function statusIcon(status: WorkspaceStatus) {
  switch (status) {
    case "approved":           return <CheckCircle2 className="size-4 text-green-500" aria-label="Approved" />;
    case "rejected":           return <XCircle className="size-4 text-red-500" aria-label="Rejected" />;
    case "revision_requested": return <RotateCcw className="size-4 text-yellow-500" aria-label="Revision requested" />;
    case "in_review":          return <Eye className="size-4 text-blue-500" aria-label="In review" />;
    case "canceled":
    case "revoked":            return <Ban className="size-4 text-gray-400" aria-label="Canceled" />;
    default:                   return <Clock className="size-4 text-gray-400" aria-label="Pending" />;
  }
}

function statusLabel(status: WorkspaceStatus): string {
  const map: Record<WorkspaceStatus, string> = {
    pending: "Awaiting review",
    in_review: "Reviewing",
    approved: "Approved",
    rejected: "Rejected",
    revision_requested: "Requested revision",
    expired: "Expired",
    canceled: "Canceled",
    revoked: "Revoked",
    superseded: "Superseded",
  };
  return map[status] ?? status;
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="size-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0"
    >
      {name[0]?.toUpperCase()}
    </span>
  );
}

export function ReviewerList({ review, meta, additionalReviewers = [], className }: ReviewerListProps) {
  const primaryReviewer: ReviewerEntry = {
    id: review.id,
    name: review.clientName,
    email: review.clientEmail,
    wsStatus: review.wsStatus,
    sharedAt: review.sharedAt,
    viewedAt: review.viewedAt,
    decisionAt:
      review.approvedAt ??
      review.rejectedAt ??
      review.revisionRequestedAt ??
      review.revokedAt ??
      null,
    internalSignedOff: meta?.internalSignedOff ?? false,
    internalSignedOffBy: meta?.internalSignedOffBy ?? null,
  };

  const all = [primaryReviewer, ...additionalReviewers];

  return (
    <section
      className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)}
      aria-label="Reviewer list"
    >
      <h3 className="text-sm font-semibold text-foreground mb-4">
        Reviewers
        <span className="ml-2 text-xs font-normal text-muted-foreground">({all.length})</span>
      </h3>

      <ul className="space-y-3" role="list">
        {all.map((r) => (
          <li key={r.id} className="flex items-center gap-3">
            <Avatar name={r.name} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">{r.name}</span>
                {r.internalSignedOff && r.internalSignedOffBy && (
                  <span className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                    ✓ Signed off
                  </span>
                )}
              </div>
              {r.email && (
                <span className="text-xs text-muted-foreground truncate block">{r.email}</span>
              )}
              <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                {r.viewedAt && (
                  <span>Viewed {format(new Date(r.viewedAt), "d MMM")}</span>
                )}
                {r.decisionAt && (
                  <>
                    {r.viewedAt && <span aria-hidden>·</span>}
                    <span>{statusLabel(r.wsStatus)} {format(new Date(r.decisionAt), "d MMM")}</span>
                  </>
                )}
                {!r.viewedAt && !r.decisionAt && r.sharedAt && (
                  <span>Sent {format(new Date(r.sharedAt), "d MMM")}</span>
                )}
              </div>
            </div>
            <div className="shrink-0" aria-hidden>
              {statusIcon(r.wsStatus)}
            </div>
          </li>
        ))}
      </ul>

      {all.length === 0 && (
        <p className="text-sm text-muted-foreground">No reviewers assigned yet.</p>
      )}
    </section>
  );
}
