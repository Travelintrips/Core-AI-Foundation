/**
 * payments.ts — Dual Commercial Flow payment tracking & invoices.
 *
 * Admin routes (adminAuth-protected, mounted normally under /api):
 *   GET  /ai/payments/project/:projectId          — list a project's schedule
 *   POST /ai/payments/:scheduleId/verify          — verify a submitted payment
 *   POST /ai/payments/:scheduleId/invoice         — generate an invoice for an installment
 *   GET  /ai/payments/invoices/project/:projectId — list a project's invoices
 *
 * Public routes (bypass adminAuth via the /public prefix — no admin key needed;
 * customers only see their own project's schedule via the dashboard token flow,
 * so these are intentionally read/append-only, never expose other customers'
 * financial detail beyond what customer-portal.ts already returns):
 *   POST /public/payments/:scheduleId/submit-proof — customer submits a payment reference
 */
import { Router } from "express";
import { eq, ne, inArray } from "drizzle-orm";
import { db, aiInvoicesTable, aiPaymentScheduleTable, creativeProjectsTable } from "@workspace/db";
import {
  getScheduleForProject,
  verifyPayment,
  submitPaymentProof,
  generateInvoiceForSchedule,
} from "../services/paymentScheduleService.js";

const router = Router();

function parseId(raw: string | undefined): number | null {
  const id = parseInt(raw ?? "", 10);
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

// ── POST /public/payments/:scheduleId/submit-proof ────────────────────────────

router.post("/public/payments/:scheduleId/submit-proof", async (req, res): Promise<void> => {
  const scheduleId = parseId(req.params.scheduleId);
  if (scheduleId === null) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (!reference) { res.status(400).json({ error: "reference is required" }); return; }

  const schedule = await submitPaymentProof(scheduleId, reference);
  if (!schedule) { res.status(404).json({ error: "Payment schedule not found or already paid" }); return; }
  res.json({ ok: true, schedule });
});

export default router;
