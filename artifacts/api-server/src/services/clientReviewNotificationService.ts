import { logAudit } from "./aiAuditService.js";

/**
 * Modular notification hooks for client review events.
 * Currently logs to audit log + console.
 * Future: connect to WhatsApp (Fonnte), email, etc.
 */
export const clientReviewNotificationService = {
  async notifyReviewLinkCreated(projectId: string, reviewId: number, clientName: string): Promise<void> {
    console.log(`[client-review] Review link created — project=${projectId} reviewId=${reviewId} client=${clientName}`);
    await logAudit("client-review", "review_link_created", String(reviewId), "client_review", "success", {
      projectId,
      clientName,
    });
  },

  async notifyClientViewed(projectId: string, reviewId: number, clientName: string): Promise<void> {
    console.log(`[client-review] Client viewed review — project=${projectId} reviewId=${reviewId} client=${clientName}`);
    await logAudit("client-review", "review_viewed", String(reviewId), "client_review", "success", {
      projectId,
      clientName,
    });
  },

  async notifyClientApproved(projectId: string, reviewId: number, clientName: string, notes?: string): Promise<void> {
    console.log(`[client-review] Project approved — project=${projectId} reviewId=${reviewId} client=${clientName}`);
    await logAudit("client-review", "project_approved", String(reviewId), "client_review", "success", {
      projectId,
      clientName,
      notes,
    });
  },

  async notifyClientRejected(projectId: string, reviewId: number, clientName: string, reason?: string): Promise<void> {
    console.log(`[client-review] Project rejected — project=${projectId} reviewId=${reviewId} client=${clientName}`);
    await logAudit("client-review", "project_rejected", String(reviewId), "client_review", "success", {
      projectId,
      clientName,
      reason,
    });
  },

  async notifyRevisionRequested(projectId: string, reviewId: number, clientName: string, notes?: string): Promise<void> {
    console.log(`[client-review] Revision requested — project=${projectId} reviewId=${reviewId} client=${clientName}`);
    await logAudit("client-review", "revision_requested", String(reviewId), "client_review", "success", {
      projectId,
      clientName,
      notes,
    });
  },

  async notifyCommentAdded(projectId: string, reviewId: number, commentId: number, authorName: string): Promise<void> {
    console.log(`[client-review] Comment added — project=${projectId} reviewId=${reviewId} commentId=${commentId} author=${authorName}`);
    await logAudit("client-review", "comment_added", String(commentId), "client_comment", "success", {
      projectId,
      reviewId,
      authorName,
    });
  },
};
