/**
 * paymentScheduleService — Dual Commercial Flow payment tracking.
 *
 * Generates the ai_payment_schedule rows for a creative_project at checkout
 * time (Standard/fixed_price) or PO/quotation-approval time (Enterprise),
 * verifies individual installments, keeps creative_projects.payment_status /
 * files_unlocked in sync, and gates AI production on payment being verified —
 * per spec: "AI Build TIDAK boleh berjalan jika payment belum verified atau
 * deposit belum diterima."
 */
import { eq, and, ne } from "drizzle-orm";
import {
  db,
  aiPaymentScheduleTable,
  aiInvoicesTable,
  creativeProjectsTable,
  type AiPaymentSchedule,
  type CreativeProject,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";
import { runCreativeBriefWorkflow } from "./creativeWorkflowRunner.js";

export type PaymentPolicy = "full_payment" | "deposit" | "subscription" | "purchase_order";

// ── generateScheduleForProject ───────────────────────────────────────────────
// Idempotent: if a schedule already exists for the project, returns it unchanged.

export async function generateScheduleForProject(opts: {
  projectId: number;
  paymentPolicy: PaymentPolicy;
  depositPercentage: number;
  totalAmount: number;
  currency: string;
}): Promise<AiPaymentSchedule[]> {
  const existing = await db
    .select()
    .from(aiPaymentScheduleTable)
    .where(eq(aiPaymentScheduleTable.projectId, opts.projectId));
  if (existing.length > 0) return existing;

  const rows: (typeof aiPaymentScheduleTable.$inferInsert)[] = [];
  const total = Math.round(opts.totalAmount * 100) / 100;

  if (opts.paymentPolicy === "deposit") {
    const pct = Math.min(Math.max(opts.depositPercentage || 50, 1), 99);
    const depositAmount = Math.round(((total * pct) / 100) * 100) / 100;
    const remaining = Math.round((total - depositAmount) * 100) / 100;
    rows.push({
      projectId: opts.projectId,
      paymentType: "deposit",
      percentage: pct,
      amount: String(depositAmount),
      currency: opts.currency,
      status: "pending",
      displayOrder: 0,
    });
    rows.push({
      projectId: opts.projectId,
      paymentType: "remaining_balance",
      percentage: 100 - pct,
      amount: String(remaining),
      currency: opts.currency,
      status: "pending",
      displayOrder: 1,
    });
  } else if (opts.paymentPolicy === "subscription") {
    rows.push({
      projectId: opts.projectId,
      paymentType: "subscription_charge",
      amount: String(total),
      currency: opts.currency,
      status: "pending",
      displayOrder: 0,
    });
  } else if (opts.paymentPolicy === "purchase_order") {
    rows.push({
      projectId: opts.projectId,
      paymentType: "full_payment",
      amount: String(total),
      currency: opts.currency,
      status: "pending",
      notes: "purchase_order",
      displayOrder: 0,
    });
  } else {
    rows.push({
      projectId: opts.projectId,
      paymentType: "full_payment",
      amount: String(total),
      currency: opts.currency,
      status: "pending",
      displayOrder: 0,
    });
  }

  const inserted = await db.insert(aiPaymentScheduleTable).values(rows).returning();

  await logAudit(
    "payments",
    "schedule_generated",
    String(opts.projectId),
    "creative_project",
    "success",
    { paymentPolicy: opts.paymentPolicy, installments: inserted.length, total },
  );

  return inserted;
}

// ── getScheduleForProject ─────────────────────────────────────────────────────

export async function getScheduleForProject(projectId: number): Promise<AiPaymentSchedule[]> {
  return db
    .select()
    .from(aiPaymentScheduleTable)
    .where(eq(aiPaymentScheduleTable.projectId, projectId))
    .orderBy(aiPaymentScheduleTable.displayOrder);
}

// ── submitProof ───────────────────────────────────────────────────────────────
// Customer records a payment reference (bank transfer id / PO number). Does
// NOT mark the installment paid — an admin must verify it.

export async function submitPaymentProof(
  scheduleId: number,
  reference: string,
  proofImageUrl?: string | null,
): Promise<AiPaymentSchedule | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setPayload: any = { reference, updatedAt: new Date() };
  if (proofImageUrl) setPayload.proofImageUrl = proofImageUrl;
  const [row] = await db
    .update(aiPaymentScheduleTable)
    .set(setPayload)
    .where(and(eq(aiPaymentScheduleTable.id, scheduleId), eq(aiPaymentScheduleTable.status, "pending")))
    .returning();
  if (!row) return null;

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, row.projectId))
    .limit(1);
  if (project) {
    await db
      .update(creativeProjectsTable)
      .set({ status: "waiting_payment_verification", updatedAt: new Date() })
      .where(eq(creativeProjectsTable.id, project.id));
  }

  publishSafe({
    eventType: "payment.proof_submitted",
    sourceModule: "payments",
    sourceId: String(row.id),
    payload: { scheduleId: row.id, projectId: row.projectId, paymentType: row.paymentType, reference },
  });

  return row;
}

// ── verifyPayment ─────────────────────────────────────────────────────────────
// Admin action. Marks an installment paid, recomputes the project's aggregate
// payment_status, unlocks files once the LAST unpaid installment clears, and
// (for deposit/full_payment on a still-pending project) kicks off AI Build.

export interface VerifyPaymentResult {
  schedule: AiPaymentSchedule;
  project: CreativeProject;
  productionStarted: boolean;
}

export async function verifyPayment(
  scheduleId: number,
  verifiedBy: string,
  reference?: string | null,
): Promise<VerifyPaymentResult | null> {
  const [schedule] = await db
    .update(aiPaymentScheduleTable)
    .set({
      status: "paid",
      verifiedBy,
      paidAt: new Date(),
      reference: reference ?? undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(aiPaymentScheduleTable.id, scheduleId), ne(aiPaymentScheduleTable.status, "paid")))
    .returning();

  if (!schedule) return null;

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, schedule.projectId))
    .limit(1);
  if (!project) return null;

  const allInstallments = await getScheduleForProject(project.id);
  const unpaid = allInstallments.filter((s) => s.status !== "paid" && s.status !== "cancelled");
  const anyPaid = allInstallments.some((s) => s.status === "paid");
  const fullyPaid = unpaid.length === 0;

  let nextStatus = project.status;
  let filesUnlocked = project.filesUnlocked;
  let paymentStatus = project.paymentStatus;
  let productionStarted = false;

  // Production may already have finished (or failed) by the time a payment gets
  // verified — e.g. admin skipped the commercial gate and ran production directly.
  // Never let a payment-status transition clobber that terminal production state.
  const productionAlreadyTerminal = project.status === "completed" || project.status === "failed";

  if (fullyPaid) {
    paymentStatus = "paid";
    filesUnlocked = true;
    if (!productionAlreadyTerminal) {
      nextStatus = schedule.paymentType === "remaining_balance" ? "remaining_paid" : "payment_verified";
    }
  } else if (anyPaid) {
    paymentStatus = "partially_paid";
    if (!productionAlreadyTerminal) {
      if (schedule.paymentType === "deposit") nextStatus = "deposit_paid";
      else if (schedule.paymentType === "subscription_charge") nextStatus = "payment_verified";
    }
  }

  await db
    .update(creativeProjectsTable)
    .set({
      status: nextStatus,
      paymentStatus,
      filesUnlocked,
      updatedAt: new Date(),
    })
    .where(eq(creativeProjectsTable.id, project.id));

  await logAudit(
    "payments",
    "payment_verified",
    String(schedule.id),
    "ai_payment_schedule",
    "success",
    { verifiedBy, projectId: project.id, paymentType: schedule.paymentType, nextStatus },
  );

  publishSafe({
    eventType: "payment.verified",
    sourceModule: "payments",
    sourceId: String(schedule.id),
    payload: { scheduleId: schedule.id, projectId: project.id, paymentType: schedule.paymentType, verifiedBy },
  });

  if (filesUnlocked) {
    publishSafe({
      eventType: "files.unlocked",
      sourceModule: "payments",
      sourceId: String(project.id),
      payload: { projectId: project.id },
    });
  }

  // ── AI Build guard: only start production once payment is verified or a
  // deposit has been received — never before. ──
  const paymentReadyForProduction =
    schedule.paymentType === "deposit" || schedule.paymentType === "full_payment" || fullyPaid;

  if (paymentReadyForProduction && project.status === "waiting_payment_verification" || project.status === "waiting_payment") {
    // Re-fetch to get the just-updated row for an accurate status check.
    const [freshProject] = await db
      .select()
      .from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.id, project.id))
      .limit(1);
    if (freshProject && (freshProject.status === "deposit_paid" || freshProject.status === "payment_verified")) {
      productionStarted = true;
      runCreativeBriefWorkflow(project.id).catch(async (err) => {
        console.error(`[payments] Workflow failed for project ${project.projectId}:`, err);
        await db
          .update(creativeProjectsTable)
          .set({ status: "failed" })
          .where(eq(creativeProjectsTable.id, project.id));
      });
    }
  }

  const [finalProject] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, project.id))
    .limit(1);

  return { schedule, project: finalProject ?? project, productionStarted };
}

// ── generateInvoice ────────────────────────────────────────────────────────────

const INVOICE_TYPE_BY_PAYMENT_TYPE: Record<string, string> = {
  deposit: "deposit",
  remaining_balance: "remaining",
  full_payment: "final",
  subscription_charge: "receipt",
  custom_installment: "final",
};

export async function generateInvoiceForSchedule(scheduleId: number) {
  const [schedule] = await db
    .select()
    .from(aiPaymentScheduleTable)
    .where(eq(aiPaymentScheduleTable.id, scheduleId))
    .limit(1);
  if (!schedule) return null;

  const year = new Date().getFullYear();
  const countRow = await db
    .select({ id: aiInvoicesTable.id })
    .from(aiInvoicesTable);
  const seq = countRow.length + 1;
  const invoiceNumber = `INV-${year}-${String(seq).padStart(4, "0")}`;
  const invoiceType = schedule.status === "paid"
    ? (INVOICE_TYPE_BY_PAYMENT_TYPE[schedule.paymentType] === "final" ? "receipt" : INVOICE_TYPE_BY_PAYMENT_TYPE[schedule.paymentType] ?? "final")
    : (INVOICE_TYPE_BY_PAYMENT_TYPE[schedule.paymentType] ?? "final");

  const [invoice] = await db
    .insert(aiInvoicesTable)
    .values({
      invoiceNumber,
      projectId: schedule.projectId,
      paymentScheduleId: schedule.id,
      invoiceType,
      amount: schedule.amount,
      currency: schedule.currency,
      status: schedule.status === "paid" ? "paid" : "issued",
      lineItemsJson: [{ label: `${schedule.paymentType} payment`, amount: Number(schedule.amount) }],
      paidAt: schedule.paidAt ?? null,
    })
    .returning();

  await logAudit("payments", "invoice_generated", String(invoice.id), "ai_invoice", "success", {
    scheduleId,
    invoiceType,
    amount: schedule.amount,
  });

  return invoice;
}

// ── isProjectUnlocked ──────────────────────────────────────────────────────────

export function isProjectUnlocked(project: Pick<CreativeProject, "filesUnlocked">): boolean {
  return project.filesUnlocked === true;
}

// ── rejectPayment ──────────────────────────────────────────────────────────────
// P0-5 Admin action: reject a submitted payment proof. Transitions status back
// to "pending" and logs the reason. Does not start/stop AI production.

export async function rejectPayment(
  scheduleId: number,
  rejectedBy: string,
  reason: string,
): Promise<AiPaymentSchedule | null> {
  const [schedule] = await db
    .update(aiPaymentScheduleTable)
    .set({
      status: "failed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiPaymentScheduleTable.id, scheduleId),
        ne(aiPaymentScheduleTable.status, "paid"),
        ne(aiPaymentScheduleTable.status, "cancelled"),
      ),
    )
    .returning();

  if (!schedule) return null;

  await logAudit(
    "payments",
    "payment_rejected",
    String(schedule.id),
    "ai_payment_schedule",
    "success",
    { rejectedBy, reason, projectId: schedule.projectId },
  );

  publishSafe({
    eventType: "payment.rejected",
    sourceModule: "payments",
    sourceId: String(schedule.id),
    payload: { scheduleId: schedule.id, projectId: schedule.projectId, rejectedBy, reason },
  });

  return schedule;
}
