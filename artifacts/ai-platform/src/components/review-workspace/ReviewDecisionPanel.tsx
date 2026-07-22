import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  Ban,
  ShieldCheck,
  ShieldOff,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useInternalSignOff,
  useRemoveSignOff,
  useCancelReview,
  type WorkspaceSummary,
  type ReviewPermission,
} from "@/hooks/use-review-workspace";

interface ReviewDecisionPanelProps {
  summary: WorkspaceSummary;
  /** Called after approve/reject/revision via public token — use existing public route */
  onPublicAction?: (action: "approve" | "reject" | "request-revision", notes?: string) => Promise<void>;
  adminName?: string;
  className?: string;
}

type ActiveAction = "approve" | "reject" | "revision" | "cancel" | "sign-off" | null;

function hasPermission(permissions: ReviewPermission[], perm: ReviewPermission) {
  return permissions.includes(perm);
}

function ConfirmDialog({
  title,
  description,
  danger,
  reasonLabel,
  reasonRequired,
  reasonPlaceholder,
  confirmLabel,
  onConfirm,
  onCancel,
  isLoading,
}: {
  title: string;
  description: string;
  danger?: boolean;
  reasonLabel?: string;
  reasonRequired?: boolean;
  reasonPlaceholder?: string;
  confirmLabel: string;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [reason, setReason] = useState("");
  const canSubmit = !reasonRequired || reason.trim().length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="decision-dialog-title"
      className="rounded-xl border border-border bg-card p-4 space-y-3"
    >
      <div>
        <h4 id="decision-dialog-title" className="text-sm font-semibold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      {reasonLabel && (
        <div>
          <label htmlFor="decision-reason" className="text-xs font-medium text-foreground block mb-1">
            {reasonLabel}{reasonRequired && <span className="text-destructive ml-0.5" aria-label="required">*</span>}
          </label>
          <Textarea
            id="decision-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder ?? "Add a note..."}
            className="resize-none text-sm"
            rows={3}
            aria-required={reasonRequired}
          />
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={isLoading || !canSubmit}
          onClick={() => onConfirm(reason || undefined)}
          className={cn(
            "flex-1 gap-2",
            danger ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : "",
          )}
          aria-busy={isLoading}
        >
          {isLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {confirmLabel}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ReviewDecisionPanel({
  summary,
  onPublicAction,
  adminName = "Internal",
  className,
}: ReviewDecisionPanelProps) {
  const { review, meta, permissions } = summary;
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicError, setPublicError] = useState<string | null>(null);

  const signOffMutation = useInternalSignOff(review.id);
  const removeSignOffMutation = useRemoveSignOff(review.id);
  const cancelMutation = useCancelReview(review.id);

  const isLoading =
    signOffMutation.isPending ||
    removeSignOffMutation.isPending ||
    cancelMutation.isPending ||
    publicLoading;

  async function handlePublicAction(action: "approve" | "reject" | "request-revision", notes?: string) {
    if (!onPublicAction) return;
    setPublicLoading(true);
    setPublicError(null);
    try {
      await onPublicAction(action, notes);
      setActiveAction(null);
    } catch (err) {
      setPublicError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPublicLoading(false);
    }
  }

  const isTerminal = ["approved", "rejected", "canceled", "revoked", "expired"].includes(review.wsStatus);

  return (
    <section
      className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)}
      aria-label="Review decision panel"
    >
      <h3 className="text-sm font-semibold text-foreground mb-1">Decision</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Manage internal workflow and client-facing decisions for this review.
      </p>

      {publicError && (
        <div role="alert" className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 mb-3">
          <AlertTriangle className="size-3.5 shrink-0" />
          {publicError}
        </div>
      )}

      {/* Active confirmation dialogs */}
      {activeAction === "approve" && (
        <ConfirmDialog
          title="Approve this review?"
          description="This will mark the review as approved and notify the team."
          reasonLabel="Final notes (optional)"
          confirmLabel="Confirm Approval"
          isLoading={isLoading}
          onConfirm={(notes) => handlePublicAction("approve", notes)}
          onCancel={() => setActiveAction(null)}
        />
      )}

      {activeAction === "reject" && (
        <ConfirmDialog
          title="Reject this review?"
          description="Tell the client why you're rejecting this submission."
          danger
          reasonLabel="Rejection reason"
          reasonRequired
          reasonPlaceholder="Explain why this is being rejected..."
          confirmLabel="Confirm Rejection"
          isLoading={isLoading}
          onConfirm={(notes) => handlePublicAction("reject", notes)}
          onCancel={() => setActiveAction(null)}
        />
      )}

      {activeAction === "revision" && (
        <ConfirmDialog
          title="Request revision?"
          description="Specify what changes are needed."
          reasonLabel="Revision notes"
          reasonRequired
          reasonPlaceholder="Describe the changes needed..."
          confirmLabel="Send Revision Request"
          isLoading={isLoading}
          onConfirm={(notes) => handlePublicAction("request-revision", notes)}
          onCancel={() => setActiveAction(null)}
        />
      )}

      {activeAction === "cancel" && (
        <ConfirmDialog
          title="Cancel this review?"
          description="The review link will be revoked. This cannot be undone."
          danger
          reasonLabel="Cancellation reason"
          reasonRequired
          reasonPlaceholder="Why is this review being canceled?"
          confirmLabel="Cancel Review"
          isLoading={isLoading}
          onConfirm={(reason) => {
            if (!reason) return;
            cancelMutation.mutate(
              { reason, cancelledBy: adminName },
              { onSuccess: () => setActiveAction(null) },
            );
          }}
          onCancel={() => setActiveAction(null)}
        />
      )}

      {activeAction === "sign-off" && (
        <ConfirmDialog
          title="Record internal sign-off?"
          description="Confirm that internal quality checks are complete."
          confirmLabel="Record Sign-Off"
          isLoading={isLoading}
          onConfirm={() =>
            signOffMutation.mutate(adminName, { onSuccess: () => setActiveAction(null) })
          }
          onCancel={() => setActiveAction(null)}
        />
      )}

      {/* Action buttons — only shown when no dialog is active */}
      {activeAction === null && (
        <div className="space-y-2" role="group" aria-label="Available actions">

          {/* Client-facing actions (proxied via public route) */}
          {hasPermission(permissions, "can_approve") && onPublicAction && (
            <Button
              size="sm"
              className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
              onClick={() => setActiveAction("approve")}
              disabled={isLoading}
            >
              <CheckCircle2 className="size-4" aria-hidden /> Approve
            </Button>
          )}

          {hasPermission(permissions, "can_request_revision") && onPublicAction && (
            <Button
              size="sm"
              className="w-full gap-2 bg-yellow-500 hover:bg-yellow-600 text-white"
              onClick={() => setActiveAction("revision")}
              disabled={isLoading}
            >
              <RotateCcw className="size-4" aria-hidden /> Request Revision
            </Button>
          )}

          {hasPermission(permissions, "can_reject") && onPublicAction && (
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-2 border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => setActiveAction("reject")}
              disabled={isLoading}
            >
              <XCircle className="size-4" aria-hidden /> Reject
            </Button>
          )}

          {/* Internal sign-off */}
          {hasPermission(permissions, "can_sign_off") && (
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-2 border-green-500 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
              onClick={() => setActiveAction("sign-off")}
              disabled={isLoading}
            >
              <ShieldCheck className="size-4" aria-hidden /> Internal Sign-Off
            </Button>
          )}

          {hasPermission(permissions, "can_remove_sign_off") && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => removeSignOffMutation.mutate()}
              disabled={isLoading}
            >
              {removeSignOffMutation.isPending
                ? <Loader2 className="size-4 animate-spin" aria-hidden />
                : <ShieldOff className="size-4" aria-hidden />}
              Remove Sign-Off
            </Button>
          )}

          {/* Cancel */}
          {hasPermission(permissions, "can_cancel") && !isTerminal && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full gap-2 text-muted-foreground hover:text-destructive"
              onClick={() => setActiveAction("cancel")}
              disabled={isLoading}
            >
              <Ban className="size-4" aria-hidden /> Cancel Review
            </Button>
          )}

          {/* Terminal state message */}
          {isTerminal && (
            <p className="text-xs text-muted-foreground text-center py-2" role="status">
              This review is in a terminal state — no further actions available.
            </p>
          )}

          {/* No actions available */}
          {!isTerminal &&
            !hasPermission(permissions, "can_approve") &&
            !hasPermission(permissions, "can_reject") &&
            !hasPermission(permissions, "can_request_revision") &&
            !hasPermission(permissions, "can_sign_off") &&
            !hasPermission(permissions, "can_remove_sign_off") &&
            !hasPermission(permissions, "can_cancel") && (
              <p className="text-xs text-muted-foreground text-center py-2">
                No actions available for the current review state.
              </p>
            )}
        </div>
      )}

      {/* Status badge when terminal */}
      {isTerminal && (
        <Badge
          variant="outline"
          className="mt-3 w-full justify-center text-xs capitalize py-1.5"
        >
          {review.wsStatus.replace(/_/g, " ")}
        </Badge>
      )}
    </section>
  );
}
