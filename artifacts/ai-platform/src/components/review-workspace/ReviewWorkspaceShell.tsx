/**
 * ReviewWorkspaceShell — Team 16
 *
 * Top-level shell that composes all review workspace components.
 * Accepts a reviewId, fetches workspace data, and renders the
 * full review management UI.
 *
 * Integration points:
 *  - Team 11: pass reviewId via slot (workspace slot review)
 *  - Team 15: review is version-aware via reviewId → projectId
 *  - Team 18: comment annotation adapter can be wired via onCommentPin prop
 *  - Team 08: lifecycle transitions use the public review API routes,
 *             not frontend status mutation
 */

import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkspaceSummary } from "@/hooks/use-review-workspace";
import { ReviewStatusSummary } from "./ReviewStatusSummary";
import { ReviewerList } from "./ReviewerList";
import { ReviewDecisionPanel } from "./ReviewDecisionPanel";
import { ReviewChecklist } from "./ReviewChecklist";
import { ReviewHistory } from "./ReviewHistory";
import { ReviewDeadline } from "./ReviewDeadline";

interface ReviewWorkspaceShellProps {
  reviewId: number;
  /** Admin user name for sign-off and audit attribution */
  adminName?: string;
  /**
   * Callback to perform client-facing actions (approve/reject/revision).
   * The shell does NOT call public routes directly — the parent provides this
   * to keep the public token out of admin components and ensure Team 08
   * lifecycle transitions are handled by the canonical service.
   */
  onPublicAction?: (
    action: "approve" | "reject" | "request-revision",
    notes?: string,
  ) => Promise<void>;
  /**
   * Integration Note (Team 18): wire comment pin/annotation via this adapter.
   * When provided, comment events will carry annotation metadata.
   */
  onCommentPin?: (assetId: number, position: { x: number; y: number }) => void;
  className?: string;
}

export function ReviewWorkspaceShell({
  reviewId,
  adminName = "Internal",
  onPublicAction,
  className,
}: ReviewWorkspaceShellProps) {
  const { data: summary, isLoading, error, refetch } = useWorkspaceSummary(reviewId);

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div
        className={cn("flex items-center justify-center min-h-64", className)}
        role="status"
        aria-label="Loading review workspace"
      >
        <div className="text-center space-y-2">
          <Loader2 className="size-7 text-primary animate-spin mx-auto" aria-hidden />
          <p className="text-sm text-muted-foreground">Loading workspace…</p>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error || !summary) {
    const msg = error instanceof Error ? error.message : "Review not found.";
    return (
      <div
        className={cn("rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3", className)}
        role="alert"
      >
        <AlertCircle className="size-8 text-destructive mx-auto" aria-hidden />
        <p className="text-sm font-medium text-foreground">Failed to load review workspace</p>
        <p className="text-xs text-muted-foreground">{msg}</p>
        <Button size="sm" variant="outline" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="size-3.5" aria-hidden /> Retry
        </Button>
      </div>
    );
  }

  const { review, meta, permissions, commentCount, project } = summary;
  const canManageChecklist = permissions.includes("can_manage_checklist");
  const canSetDueDate = permissions.includes("can_set_due_date");

  // ── Shell layout ──────────────────────────────────────────────────────────

  return (
    <div
      className={cn("space-y-4", className)}
      aria-label={`Review workspace for ${review.clientName}`}
    >
      {/* Project context header */}
      {project && (
        <header className="px-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
            {project.businessType}
          </p>
          <h2 className="text-lg font-bold text-foreground">{project.brandName}</h2>
          <p className="text-xs text-muted-foreground">Review #{review.id}</p>
        </header>
      )}

      {/* Two-column layout on larger screens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column: Status + Reviewer + Deadline */}
        <div className="space-y-4">
          <ReviewStatusSummary
            review={review}
            meta={meta}
            commentCount={commentCount}
          />
          <ReviewerList review={review} meta={meta} />
          <ReviewDeadline
            reviewId={reviewId}
            meta={meta}
            canEdit={canSetDueDate}
          />
        </div>

        {/* Middle column: Decision + Checklist */}
        <div className="space-y-4">
          <ReviewDecisionPanel
            summary={summary}
            onPublicAction={onPublicAction}
            adminName={adminName}
          />
          <ReviewChecklist
            reviewId={reviewId}
            canManage={canManageChecklist}
            completedBy={adminName}
          />
        </div>

        {/* Right column: History */}
        <div>
          <ReviewHistory reviewId={reviewId} />
        </div>
      </div>
    </div>
  );
}
