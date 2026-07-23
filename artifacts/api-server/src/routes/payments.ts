/**
 * payments.ts — Dual Commercial Flow payment tracking & invoices.
 *
 * Admin routes (adminAuth-protected, mounted normally under /api):
 *   GET  /ai/payments/pending                          — worklist of pending installments
 *   GET  /ai/payments/project/:projectId               — list a project's schedule
 *   GET  /ai/payments/kpi                              — P0-5 payment KPIs dashboard
 *   POST /ai/payments/:scheduleId/verify               — verify a submitted payment
 *   POST /ai/payments/:scheduleId/reject               — P0-5 reject a submitted payment
 *   POST /ai/payments/:scheduleId/invoice              — generate an invoice for an installment
 *   GET  /ai/payments/invoices/project/:projectId      — list a project's invoices
 *   POST /ai/payments/project/:projectId/unlock        — P0-5 manual admin file unlock
 *
 * Public routes (bypass adminAuth via the /public prefix — no admin key needed;
 * customers only see their own project's schedule via the dashboard token flow,
 * so these are intentionally read/append-only, never expose other customers'
 * financial detail beyond what customer-portal.ts already returns):
 *   POST /public/payments/:scheduleId/submit-proof     — customer submits a payment reference
 */
import { Router } from "express";
import { eq, ne, inArray, and, sql } from "drizzle-orm";
import { db, aiInvoicesTable, aiPaymentScheduleTable, creativeProjectsTable } from "@workspace/db";
import {
  getScheduleForProject,
  verifyPayment,
  rejectPayment,
  submitPaymentProof,
  generateInvoiceForSchedule,
} from "../services/paymentScheduleService.js";
import { logAudit } from "../services/aiAuditService.js";
import { paymentLimiter } from "../middleware/rateLimiter.js";

const router = Router();

function parseId(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(s ?? "", 10);
  return Number.isNaN(id) ? null : id;
}

// ── GET /ai/payments/pending ───────────────────────────────────────────────────
// Admin overview: every creative_project that has at least one non-paid,
// non-cancelled installment — the "Payment Verification" worklist.

router.get("/ai/payments/pending", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(aiPaymentScheduleTable)
    .where(inArray(aiPaymentScheduleTable.status, ["pending", "partially_paid", "failed"]));

  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const projects = projectIds.length > 0
    ? await db.select().from(creativeProjectsTable).where(inArray(creativeProjectsTable.id, projectIds))
    : [];

  const byProject = new Map(projects.map((p) => [p.id, p]));
  const grouped = projectIds.map((id) => ({
    project: byProject.get(id) ?? null,
    schedule: rows.filter((r) => r.projectId === id),
  })).filter((g) => g.project !== null);

  res.json(grouped);
});

// ── GET /ai/payments/project/:projectId ───────────────────────────────────────

router.get("/ai/payments/project/:projectId", async (req, res): Promise<void> => {
  const projectId = parseId(req.params.projectId);
  if (projectId === null) { res.status(400).json({ error: "Invalid projectId" }); return; }
  const schedule = await getScheduleForProject(projectId);
  res.json(schedule);
});

// ── POST /ai/payments/:scheduleId/verify ──────────────────────────────────────

router.post("/ai/payments/:scheduleId/verify", async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const verifiedBy = typeof body.verifiedBy === "string" ? body.verifiedBy.trim() : "";
  if (!verifiedBy) { res.status(400).json({ error: "verifiedBy is required" }); return; }
  const reference = typeof body.reference === "string" ? body.reference.trim() : null;

  const result = await verifyPayment(scheduleId, verifiedBy, reference);
  if (!result) { res.status(404).json({ error: "Payment schedule not found or already verified" }); return; }
  res.json(result);
});

// ── POST /ai/payments/:scheduleId/invoice ─────────────────────────────────────

router.post("/ai/payments/:scheduleId/invoice", async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const invoice = await generateInvoiceForSchedule(scheduleId);
  if (!invoice) { res.status(404).json({ error: "Payment schedule not found" }); return; }
  res.status(201).json(invoice);
});

// ── GET /ai/payments/invoices/project/:projectId ──────────────────────────────

router.get("/ai/payments/invoices/project/:projectId", async (req, res): Promise<void> => {
  const projectId = parseId(req.params.projectId);
  if (projectId === null) { res.status(400).json({ error: "Invalid projectId" }); return; }
  const rows = await db.select().from(aiInvoicesTable).where(eq(aiInvoicesTable.projectId, projectId));
  res.json(rows);
});

// ── GET /ai/payments/kpi ───────────────────────────────────────────────────────
// P0-5 Payment KPIs for admin dashboard.

router.get("/ai/payments/kpi", async (_req, res): Promise<void> => {
  const [scheduleStats] = await db
    .select({
      totalPaidRaw: sql<string>`COALESCE(SUM(CASE WHEN status = 'paid' THEN amount::numeric ELSE 0 END), 0)`,
      totalPendingRaw: sql<string>`COALESCE(SUM(CASE WHEN status != 'paid' AND status != 'cancelled' THEN amount::numeric ELSE 0 END), 0)`,
      countPending: sql<number>`COUNT(CASE WHEN status IN ('pending','partially_paid','failed') THEN 1 END)::int`,
    })
    .from(aiPaymentScheduleTable);

  const [projectStats] = await db
    .select({
      locked: sql<number>`COUNT(CASE WHEN files_unlocked = false AND status NOT IN ('draft','cancelled') THEN 1 END)::int`,
      unlocked: sql<number>`COUNT(CASE WHEN files_unlocked = true THEN 1 END)::int`,
    })
    .from(creativeProjectsTable);

  res.json({
    paidRevenue: parseFloat(scheduleStats?.totalPaidRaw ?? "0"),
    outstandingBalance: parseFloat(scheduleStats?.totalPendingRaw ?? "0"),
    pendingVerificationCount: scheduleStats?.countPending ?? 0,
    lockedProjects: projectStats?.locked ?? 0,
    unlockedProjects: projectStats?.unlocked ?? 0,
  });
});

// ── POST /ai/payments/:scheduleId/reject ──────────────────────────────────────
// P0-5 Admin: reject a submitted payment proof.

router.post("/ai/payments/:scheduleId/reject", async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rejectedBy = typeof body.rejectedBy === "string" ? body.rejectedBy.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!rejectedBy) { res.status(400).json({ error: "rejectedBy is required" }); return; }
  if (!reason) { res.status(400).json({ error: "reason is required" }); return; }

  const result = await rejectPayment(scheduleId, rejectedBy, reason);
  if (!result) { res.status(404).json({ error: "Payment schedule not found or already in terminal state" }); return; }
  res.json(result);
});

// ── POST /ai/payments/project/:projectId/unlock ───────────────────────────────
// P0-5 Admin: manually unlock a project's final files (override).

router.post("/ai/payments/project/:projectId/unlock", async (req, res): Promise<void> => {
  const projectId = parseId(req.params.projectId);
  if (projectId === null) { res.status(400).json({ error: "Invalid projectId" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const unlockedBy = typeof body.unlockedBy === "string" ? body.unlockedBy.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  // B-02 fix: both unlockedBy and reason are required for admin override.
  // Reason is mandatory so that every manual unlock has an auditable justification.
  if (!unlockedBy) { res.status(400).json({ error: "unlockedBy is required" }); return; }
  if (!reason) { res.status(400).json({ error: "reason is required — every admin override must have an auditable justification" }); return; }

  const [project] = await db
    .update(creativeProjectsTable)
    .set({ filesUnlocked: true, updatedAt: new Date() })
    .where(and(eq(creativeProjectsTable.id, projectId), ne(creativeProjectsTable.filesUnlocked, true)))
    .returning();

  if (!project) {
    // Check if already unlocked
    const [existing] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.id, projectId)).limit(1);
    if (existing?.filesUnlocked) {
      res.json({ ok: true, alreadyUnlocked: true, projectId });
      return;
    }
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await logAudit("payments", "manual_unlock", String(projectId), "creative_project", "success", {
    unlockedBy,
    reason: reason || "Manual admin override",
  });

  res.json({ ok: true, projectId, filesUnlocked: true, unlockedBy });
});

// ── POST /public/payments/:scheduleId/submit-proof ────────────────────────────

router.post("/public/payments/:scheduleId/submit-proof", paymentLimiter, async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (!reference) { res.status(400).json({ error: "reference is required" }); return; }

  // Optional: base64-encoded image of bank transfer proof
  let proofImageUrl: string | null = null;
  const proofImageBase64 = typeof body.proofImageBase64 === "string" ? body.proofImageBase64 : null;
  const proofImageMimeType = typeof body.proofImageMimeType === "string" ? body.proofImageMimeType : "image/jpeg";

  if (proofImageBase64) {
    try {
      const { uploadPaymentProofImage } = await import("../lib/supabaseStorage.js");
      proofImageUrl = await uploadPaymentProofImage(proofImageBase64, proofImageMimeType, scheduleId);
    } catch (err) {
      console.warn("[payments] Proof image upload failed (proceeding without image):", err);
    }
  }

  const schedule = await submitPaymentProof(scheduleId, reference, proofImageUrl);
  if (!schedule) { res.status(404).json({ error: "Payment schedule not found or already paid" }); return; }
  res.json({ ok: true, schedule, proofImageUrl });
});

// ── GET /public/payments/:scheduleId/status ───────────────────────────────────
// Lightweight polling endpoint for real-time payment status updates.

router.get("/public/payments/:scheduleId/status", async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const [schedule] = await db
    .select({
      id: aiPaymentScheduleTable.id,
      status: aiPaymentScheduleTable.status,
      reference: aiPaymentScheduleTable.reference,
      paidAt: aiPaymentScheduleTable.paidAt,
      updatedAt: aiPaymentScheduleTable.updatedAt,
    })
    .from(aiPaymentScheduleTable)
    .where(eq(aiPaymentScheduleTable.id, scheduleId))
    .limit(1);

  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
  res.json({ scheduleId, status: schedule.status, reference: schedule.reference, paidAt: schedule.paidAt, updatedAt: schedule.updatedAt });
});

export default router;
