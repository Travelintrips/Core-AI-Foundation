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
import { eq, and, ne, inArray } from "drizzle-orm";
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

// ── Status helpers ────────────────────────────────────────────────────────────

/** Statuses from which a customer may submit / re-submit a payment proof. */
const PROOF_SUBMITTABLE_STATUSES = ["pending", "failed"] as const;

/** Statuses that can be transitioned to "paid" by an admin. */
const VERIFIABLE_STATUSES = ["pending", "failed"] as const;

/** Terminal statuses that must never be changed by the payment flow. */
const TERMINAL_STATUSES = new Set(["paid", "refunded", "cancelled"]);

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
// Customer records a payment reference (bank transfer id / PO number).
// Accepts status "pending" (first upload) or "failed" (re-upload after rejection).
// Does NOT mark the installment paid — an admin must verify it.
//
// Phase 5 change: proofStoragePath is now a private-bucket path (not a public URL).
// Legacy rows that contain a public URL are kept as-is for backward compatibility.

export async function submitPaymentProof(
  scheduleId: number,
  reference: string,
  proofStoragePath?: string | null,
): Promise<AiPaymentSchedule | null> {
  // Read current state so we can detect re-submission and preserve audit context.
  const [current] = await db
    .select()
    .from(aiPaymentScheduleTable)
    .where(eq(aiPaymentScheduleTable.id, scheduleId))
    .limit(1);

  if (!current) return null;
  if (!PROOF_SUBMITTABLE_STATUSES.includes(current.status as typeof PROOF_SUBMITTABLE_STATUSES[number])) {
    return null; // paid, cancelled, refunded — cannot accept proof
  }

  const wasResubmit = current.status === "failed";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setPayload: any = {
    reference,
    status: "pending", // reset to pending for re-verification on resubmit
    updatedAt: new Date(),
  };

  if (proofStoragePath !== undefined) {
    setPayload.proofImageUrl = proofStoragePath; // stores path or legacy URL
  }

  // On resubmit: clear previous rejection notes so admin sees clean state.
  if (wasResubmit) {
    setPayload.notes = null;
  }

  const [row] = await db
    .update(aiPaymentScheduleTable)
    .set(setPayload)
    .where(
      and(
        eq(aiPaymentScheduleTable.id, scheduleId),
        inArray(aiPaymentScheduleTable.status, [...PROOF_SUBMITTABLE_STATUSES]),
      ),
    )
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
    payload: {
      scheduleId: row.id,
      projectId: row.projectId,
      paymentType: row.paymentType,
      reference,
      wasResubmit,
    },
  });

  await logAudit(
    "payments",
    wasResubmit ? "payment_proof_resubmitted" : "payment_proof_submitted",
    String(row.id),
    "ai_payment_schedule",
    "success",
    { scheduleId: row.id, projectId: row.projectId, wasResubmit },
  );

  return row;
}

// ── verifyPayment ─────────────────────────────────────────────────────────────
// Admin action. All payment+project state changes happen inside a single
// db.transaction() for atomicity. If any step fails, everything rolls back.
//
// Valid source statuses: pending, failed (with proof already submitted).
// Invalid transitions (paid→paid, cancelled→paid) return null.
//
// Workflow dispatch is idempotent: we only start the AI workflow when the
// project is still in the payment-waiting states; if it has already progressed
// (running, completed, etc.), we skip the dispatch to prevent duplicates.

export interface VerifyPaymentResult {
  schedule: AiPaymentSchedule;
  project: CreativeProject;
  productionStarted: boolean;
  alreadyPaid?: boolean;
}

export async function verifyPayment(
  scheduleId: number,
  verifiedBy: string,
  reference?: string | null,
): Promise<VerifyPaymentResult | null> {
  // First check: does the schedule exist and is it in a verifiable state?
  // Do this OUTSIDE the transaction for a clean 409 vs 404 distinction.
  const [existing] = await db
    .select()
    .from(aiPaymentScheduleTable)
    .where(eq(aiPaymentScheduleTable.id, scheduleId))
    .limit(1);

  if (!existing) return null; // 404 — caller returns 404

  if (existing.status === "paid") {
    // Already paid — idempotent, return the current state
    const [project] = await db
      .select()
      .from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.id, existing.projectId))
      .limit(1);
    return { schedule: existing, project: project ?? ({} as CreativeProject), productionStarted: false, alreadyPaid: true };
  }

  if (TERMINAL_STATUSES.has(existing.status) && existing.status !== "paid") {
    // cancelled or refunded — cannot approve
    return null; // caller returns 409
  }

  // ── Atomic transaction ────────────────────────────────────────────────────
  let schedule!: AiPaymentSchedule;
  let project!: CreativeProject;
  let productionStarted = false;
  let filesUnlocked = false;
  let nextStatus = "";
  let paymentStatus = "";

  await db.transaction(async (tx) => {
    // 1. Mark the installment as paid (atomic CAS — only if still not paid)
    const [updated] = await tx
      .update(aiPaymentScheduleTable)
      .set({
        status: "paid",
        verifiedBy,
        paidAt: new Date(),
        reference: reference ?? undefined,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiPaymentScheduleTable.id, scheduleId),
          inArray(aiPaymentScheduleTable.status, [...VERIFIABLE_STATUSES, "pending"]),
        ),
      )
      .returning();

    if (!updated) {
      // Another concurrent request already paid it — roll back (no-op, nothing changed)
      throw Object.assign(new Error("ALREADY_PAID"), { code: "ALREADY_PAID" });
    }

    schedule = updated;

    // 2. Load the project (must exist — FK constraint ensures this)
    const [proj] = await tx
      .select()
      .from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.id, schedule.projectId))
      .limit(1);

    if (!proj) throw new Error("Project not found for payment schedule");

    // 3. Recompute aggregate project payment status
    const allInstallments = await tx
      .select()
      .from(aiPaymentScheduleTable)
      .where(eq(aiPaymentScheduleTable.projectId, proj.id));

    const unpaid = allInstallments.filter((s) => s.status !== "paid" && s.status !== "cancelled");
    const anyPaid = allInstallments.some((s) => s.status === "paid");
    const fullyPaid = unpaid.length === 0;

    nextStatus = proj.status;
    filesUnlocked = proj.filesUnlocked;
    paymentStatus = proj.paymentStatus;

    const productionAlreadyTerminal = proj.status === "completed" || proj.status === "failed";

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

    // 4. Update the project — this is the critical second write in the transaction
    const [updatedProject] = await tx
      .update(creativeProjectsTable)
      .set({
        status: nextStatus,
        paymentStatus,
        filesUnlocked,
        updatedAt: new Date(),
      })
      .where(eq(creativeProjectsTable.id, proj.id))
      .returning();

    if (!updatedProject) throw new Error("Failed to update project payment state");
    project = updatedProject;
  });

  // ── Post-transaction: audit + events + idempotent workflow dispatch ────────

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

  // ── Idempotent AI Build guard ─────────────────────────────────────────────
  // Only start production if:
  //   1. The payment type is a production-gating type (deposit, full_payment)
  //   2. The project is still in a payment-waiting state (not already running/completed)
  //
  // We re-fetch the project to get the post-transaction status, which prevents
  // duplicate dispatches on concurrent verify calls or admin retries.
  const paymentReadyForProduction =
    schedule.paymentType === "deposit" ||
    schedule.paymentType === "full_payment" ||
    schedule.paymentType === "subscription_charge";

  const [freshProject] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, project.id))
    .limit(1);

  // Idempotency: only dispatch if project is in a state that expects production start.
  // If it's already running/completed/failed, skip — a workflow was already dispatched.
  const PRODUCTION_TRIGGER_STATUSES = new Set(["deposit_paid", "payment_verified"]);

  if (
    paymentReadyForProduction &&
    freshProject &&
    PRODUCTION_TRIGGER_STATUSES.has(freshProject.status)
  ) {
    productionStarted = true;
    runCreativeBriefWorkflow(project.id).catch(async (err) => {
      console.error(`[payments] Workflow failed for project ${project.id}:`, err);
      await logAudit("payments", "workflow_dispatch_failed", String(project.id), "creative_project", "error", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Payment stays paid — do NOT revert. Admin can retry via admin panel.
    });
  }

  return { schedule, project: freshProject ?? project, productionStarted };
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
// P0-5 Admin action: reject a submitted payment proof.
// Actor identity must be provided server-side (never trusted from req.body).
// Rejection reason is stored in the schedule's `notes` field as JSON.

export async function rejectPayment(
  scheduleId: number,
  actor: string,         // server-derived admin identity
  reason: string,
): Promise<AiPaymentSchedule | null> {
  // Read current state for the audit trail
  const [current] = await db
    .select()
    .from(aiPaymentScheduleTable)
    .where(eq(aiPaymentScheduleTable.id, scheduleId))
    .limit(1);

  if (!current) return null;
  if (TERMINAL_STATUSES.has(current.status)) return null;

  // Preserve rejection metadata in notes for customer UX (rejection reason display).
  const rejectionMeta = JSON.stringify({
    rejectedBy: actor,
    rejectionReason: reason,
    rejectedAt: new Date().toISOString(),
  });

  const [schedule] = await db
    .update(aiPaymentScheduleTable)
    .set({
      status: "failed",
      notes: rejectionMeta,
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

  // Revert project status if still in waiting_payment_verification
  const [project] = await db
    .select({ id: creativeProjectsTable.id, status: creativeProjectsTable.status })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, schedule.projectId))
    .limit(1);
  if (project && project.status === "waiting_payment_verification") {
    await db
      .update(creativeProjectsTable)
      .set({ status: "waiting_payment", updatedAt: new Date() })
      .where(eq(creativeProjectsTable.id, project.id));
  }

  await logAudit(
    "payments",
    "payment_rejected",
    String(schedule.id),
    "ai_payment_schedule",
    "success",
    { rejectedBy: actor, reason, projectId: schedule.projectId },
  );

  publishSafe({
    eventType: "payment.rejected",
    sourceModule: "payments",
    sourceId: String(schedule.id),
    payload: { scheduleId: schedule.id, projectId: schedule.projectId, rejectedBy: actor, reason },
  });

  return schedule;
}
