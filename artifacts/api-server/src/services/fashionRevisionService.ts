/**
 * fashionRevisionService.ts — Human-touch revision flow for Fashion Design (Team 18)
 *
 * Revision lifecycle:
 *   review → revision_requested  (customer requests changes via requestRevision)
 *   revision_requested → revision_in_progress  (admin assigns a human designer)
 *   revision_in_progress → review  (designer uploads revised files)
 *
 * Rules:
 *   - Customer can only request revision when order is in "review" status.
 *   - customerEmail must match the order's customerEmail (prevents cross-order access).
 *   - Admin assigns a designer name + email; an email notification is sent to the designer.
 *   - On upload, revised file URLs are stored and order returns to "review" for final admin approval.
 *   - Email failures are non-fatal (logged only).
 */

import { db } from "@workspace/db";
import {
  fashionDesignOrdersTable,
  fashionDesignRevisionsTable,
  type FashionDesignRevision,
} from "../domains/fashion-design/schema.js";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { sendEmail } from "./emailService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RequestRevisionInput {
  /** Must match the order's customerEmail to prevent cross-order access */
  customerEmail: string;
  feedback: string;
  referenceUrls?: string[];
}

export interface AssignDesignerInput {
  designerName: string;
  designerEmail: string;
  notes?: string;
}

export interface UploadRevisionInput {
  revisedFileUrls: string[];
  notes?: string;
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * requestRevision — Customer requests human designer changes after AI output review.
 * Sets order status to "revision_requested".
 */
export async function requestRevision(
  orderId: number,
  input: RequestRevisionInput,
): Promise<FashionDesignRevision> {
  const [order] = await db
    .select()
    .from(fashionDesignOrdersTable)
    .where(eq(fashionDesignOrdersTable.id, orderId))
    .limit(1);

  if (!order) throw new Error("Order not found");
  if (order.customerEmail.toLowerCase() !== input.customerEmail.toLowerCase()) {
    throw new Error("Email tidak sesuai dengan data order. Pastikan email yang Anda masukkan benar.");
  }
  if (!["review", "revision_in_progress"].includes(order.status)) {
    throw new Error(
      `Revisi hanya bisa diminta saat status order adalah "review" atau "revision_in_progress". Status saat ini: "${order.status}"`,
    );
  }
  if (!input.feedback || input.feedback.trim().length < 10) {
    throw new Error("Feedback revisi minimal 10 karakter. Jelaskan perubahan yang diinginkan.");
  }

  const [revision] = await db
    .insert(fashionDesignRevisionsTable)
    .values({
      orderId,
      type: "customer_request",
      feedback: input.feedback.trim(),
      referenceUrls: input.referenceUrls ?? [],
      status: "pending",
    })
    .returning();

  await db
    .update(fashionDesignOrdersTable)
    .set({ status: "revision_requested" })
    .where(eq(fashionDesignOrdersTable.id, orderId));

  logger.info({ orderId, revisionId: revision!.id }, "[fashion-revision] Revision requested by customer");
  return revision!;
}

/**
 * assignDesigner — Admin assigns a human designer to work on the revision.
 * Sets order status to "revision_in_progress" and emails the designer.
 */
export async function assignDesigner(
  orderId: number,
  input: AssignDesignerInput,
): Promise<{ revision: FashionDesignRevision; emailSent: boolean }> {
  const [order] = await db
    .select()
    .from(fashionDesignOrdersTable)
    .where(eq(fashionDesignOrdersTable.id, orderId))
    .limit(1);

  if (!order) throw new Error("Order not found");
  if (!["revision_requested", "review"].includes(order.status)) {
    throw new Error(
      `Designer hanya bisa di-assign saat status "revision_requested" atau "review". Status saat ini: "${order.status}"`,
    );
  }

  // Get latest customer revision request for context
  const [latestRequest] = await db
    .select()
    .from(fashionDesignRevisionsTable)
    .where(eq(fashionDesignRevisionsTable.orderId, orderId))
    .orderBy(desc(fashionDesignRevisionsTable.createdAt))
    .limit(1);

  const [revision] = await db
    .insert(fashionDesignRevisionsTable)
    .values({
      orderId,
      type: "designer_assignment",
      designerName: input.designerName,
      designerEmail: input.designerEmail,
      notes: input.notes ?? null,
      status: "in_progress",
    })
    .returning();

  // Update order: store designer info + advance status
  await db
    .update(fashionDesignOrdersTable)
    .set({
      status: "revision_in_progress",
      designerName: input.designerName,
      designerEmail: input.designerEmail,
    })
    .where(eq(fashionDesignOrdersTable.id, orderId));

  // Send email to designer (non-fatal)
  const emailResult = await sendEmail({
    to: input.designerEmail,
    subject: `[Creative Studio] Tugas Desain: Order #${orderId} — ${order.orderName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7c3aed;">Creative Studio — Tugas Desain</h2>
        <p>Halo <strong>${input.designerName}</strong>,</p>
        <p>Anda telah ditugaskan untuk mengerjakan revisi desain berikut:</p>
        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
          <tr><td style="padding: 8px; background: #f3f4f6; font-weight: bold;">Order ID</td><td style="padding: 8px;">#${orderId}</td></tr>
          <tr><td style="padding: 8px; background: #f3f4f6; font-weight: bold;">Nama Order</td><td style="padding: 8px;">${order.orderName}</td></tr>
          <tr><td style="padding: 8px; background: #f3f4f6; font-weight: bold;">Pelanggan</td><td style="padding: 8px;">${order.customerName}</td></tr>
          <tr><td style="padding: 8px; background: #f3f4f6; font-weight: bold;">Jenis Pakaian</td><td style="padding: 8px;">${order.serviceType}</td></tr>
        </table>
        ${latestRequest?.feedback ? `<p><strong>Feedback pelanggan:</strong></p><blockquote style="border-left: 3px solid #7c3aed; margin: 0; padding: 8px 16px; color: #374151;">${latestRequest.feedback}</blockquote>` : ""}
        ${input.notes ? `<p><strong>Catatan dari admin:</strong> ${input.notes}</p>` : ""}
        <p style="margin-top: 24px;">Setelah selesai, hubungi admin untuk upload file revisi.</p>
        <p style="color: #6b7280; font-size: 12px;">Creative Studio — AI Platform</p>
      </div>
    `,
    text: `Halo ${input.designerName}, Anda ditugaskan untuk order #${orderId} — ${order.orderName}. Feedback: ${latestRequest?.feedback ?? "-"}`,
    module: "fashion-design",
    action: "designer_assigned",
    resourceId: String(orderId),
  });

  logger.info(
    { orderId, designerEmail: input.designerEmail, emailSent: emailResult.ok },
    "[fashion-revision] Designer assigned",
  );

  return { revision: revision!, emailSent: emailResult.ok };
}

/**
 * uploadRevision — Admin/designer uploads revised design files.
 * Returns order to "review" status so admin can approve.
 * Sends email notification to customer.
 */
export async function uploadRevision(
  orderId: number,
  input: UploadRevisionInput,
): Promise<{ revision: FashionDesignRevision; emailSent: boolean }> {
  const [order] = await db
    .select()
    .from(fashionDesignOrdersTable)
    .where(eq(fashionDesignOrdersTable.id, orderId))
    .limit(1);

  if (!order) throw new Error("Order not found");
  if (!["revision_in_progress", "revision_requested"].includes(order.status)) {
    throw new Error(
      `Upload revisi hanya bisa dilakukan saat status "revision_in_progress" atau "revision_requested". Status saat ini: "${order.status}"`,
    );
  }
  if (!input.revisedFileUrls.length) {
    throw new Error("Minimal satu file URL diperlukan untuk upload revisi");
  }

  const [revision] = await db
    .insert(fashionDesignRevisionsTable)
    .values({
      orderId,
      type: "designer_upload",
      revisedFileUrls: input.revisedFileUrls,
      notes: input.notes ?? null,
      designerName: order.designerName ?? null,
      designerEmail: order.designerEmail ?? null,
      status: "completed",
    })
    .returning();

  // Return order to review for admin final approval
  await db
    .update(fashionDesignOrdersTable)
    .set({ status: "review" })
    .where(eq(fashionDesignOrdersTable.id, orderId));

  // Notify customer (non-fatal)
  const emailResult = await sendEmail({
    to: order.customerEmail,
    subject: `[Creative Studio] Revisi Desain Siap Direview — Order #${orderId}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7c3aed;">Creative Studio</h2>
        <p>Halo <strong>${order.customerName}</strong>,</p>
        <p>Revisi desain untuk order Anda telah selesai dikerjakan dan siap untuk direview:</p>
        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
          <tr><td style="padding: 8px; background: #f3f4f6; font-weight: bold;">Order ID</td><td style="padding: 8px;">#${orderId}</td></tr>
          <tr><td style="padding: 8px; background: #f3f4f6; font-weight: bold;">Nama Order</td><td style="padding: 8px;">${order.orderName}</td></tr>
        </table>
        ${input.notes ? `<p><strong>Catatan desainer:</strong> ${input.notes}</p>` : ""}
        <p>Tim kami akan segera menghubungi Anda untuk review lebih lanjut.</p>
        <p style="color: #6b7280; font-size: 12px;">Creative Studio — AI Platform</p>
      </div>
    `,
    text: `Halo ${order.customerName}, revisi desain order #${orderId} sudah selesai dan siap direview.`,
    module: "fashion-design",
    action: "revision_uploaded",
    resourceId: String(orderId),
  });

  logger.info(
    { orderId, files: input.revisedFileUrls.length, emailSent: emailResult.ok },
    "[fashion-revision] Revision files uploaded",
  );

  return { revision: revision!, emailSent: emailResult.ok };
}

/**
 * listRevisions — Get all revision history for an order, newest first.
 */
export async function listRevisions(orderId: number): Promise<FashionDesignRevision[]> {
  return db
    .select()
    .from(fashionDesignRevisionsTable)
    .where(eq(fashionDesignRevisionsTable.orderId, orderId))
    .orderBy(desc(fashionDesignRevisionsTable.createdAt));
}
