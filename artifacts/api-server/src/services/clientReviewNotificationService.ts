import { logAudit } from "./aiAuditService.js";
import { sendEmail } from "./emailService.js";

/**
 * Modular notification hooks for client review events.
 * Logs to audit log + sends email where a client email is available.
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

  async notifyRevisionComplete(
    projectId: string,
    reviewId: number,
    clientName: string,
    clientEmail: string,
    reviewUrl?: string,
  ): Promise<void> {
    console.log(`[client-review] Revision complete — project=${projectId} reviewId=${reviewId} client=${clientName} email=${clientEmail}`);
    await logAudit("client-review", "revision_complete_notified", String(reviewId), "client_review", "success", {
      projectId,
      clientName,
      clientEmail,
    });

    const linkHtml = reviewUrl
      ? `<p style="text-align:center;margin:24px 0;">
           <a href="${reviewUrl}"
              style="background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
             Lihat Hasil Revisi →
           </a>
         </p>
         <p style="font-size:12px;color:#888;text-align:center;">
           Atau copy link ini ke browser Anda:<br/>
           <a href="${reviewUrl}" style="color:#7c3aed;">${reviewUrl}</a>
         </p>`
      : `<p style="color:#555;font-size:14px;">Silakan gunakan link review yang telah kami kirimkan sebelumnya untuk melihat hasil revisi.</p>`;

    await sendEmail({
      to: clientEmail,
      subject: `✅ Revisi Anda sudah selesai — Creative AI Studio`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <div style="background:#0f0f1a;padding:28px 32px;text-align:center;">
            <span style="color:#7c3aed;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Creative AI Studio</span>
          </div>
          <div style="padding:32px;">
            <h2 style="font-size:20px;font-weight:700;color:#111;margin:0 0 8px;">
              Halo ${clientName}, revisi Anda sudah siap! 🎉
            </h2>
            <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 20px;">
              Tim kami telah menyelesaikan revisi berdasarkan permintaan Anda.
              Silakan buka link di bawah ini untuk melihat hasil terbaru dan memberikan persetujuan akhir.
            </p>
            ${linkHtml}
            <hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0;" />
            <p style="font-size:12px;color:#aaa;text-align:center;margin:0;">
              Email ini dikirim oleh Creative AI Studio • Butuh bantuan? Balas email ini.
            </p>
          </div>
        </div>
      `,
      module: "client-review",
      action: "revision_complete_email_sent",
      resourceId: String(reviewId),
    });
  },
};
