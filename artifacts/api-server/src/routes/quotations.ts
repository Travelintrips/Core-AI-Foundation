/**
 * Quotation (price offer) routes.
 *
 * Admin routes (adminAuth-protected, mounted normally):
 *   GET  /creative-ai/projects/:projectId/quotation
 *   PUT  /creative-ai/projects/:projectId/quotation        (create/update draft)
 *   POST /creative-ai/projects/:projectId/quotation/send
 *
 * Public routes (bypass admin auth via /public prefix, gated by the client's
 * review token — the same token issued at project submission):
 *   GET  /public/customer/quotation/:token
 *   POST /public/customer/quotation/:token/approve  → triggers AI generation
 *   POST /public/customer/quotation/:token/reject
 *
 * NOTE: no zod import here — api-server does not depend on zod directly.
 * Validation is done manually, matching customer-portal.ts / public.ts.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeProjectQuotationsTable,
  creativeAiClientReviewsTable,
  aiServiceRequestsTable,
  type QuotationLineItem,
} from "@workspace/db";
import { hashToken, isReviewValid } from "../services/clientReviewService.js";
import { publishSafe } from "../services/aiEventBusService.js";
import { logAudit } from "../services/aiAuditService.js";
import { createGateForQuotation } from "../services/commercialGateService.js";
import { checkAndMaybeConvert } from "../services/serviceRequestConversionService.js";
import { runCreativeBriefWorkflow } from "../services/creativeWorkflowRunner.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_MONEY = 1_000_000_000_000; // 1 trillion — sane upper bound for integer currency columns

function parseLineItems(raw: unknown): QuotationLineItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: QuotationLineItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { description, quantity, unitPrice } = entry as Record<string, unknown>;
    if (typeof description !== "string" || !description.trim()) return null;
    const qty = Number(quantity);
    const price = Number(unitPrice);
    if (!Number.isInteger(qty) || qty <= 0 || qty > 100000) return null;
    if (!Number.isInteger(price) || price < 0 || price > MAX_MONEY) return null;
    items.push({ description: description.trim().slice(0, 500), quantity: qty, unitPrice: price });
  }
  return items;
}

/** Parses an ISO date string; returns null on missing/invalid input, undefined on parse failure. */
function parseValidUntil(raw: unknown): Date | null | undefined {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

function computeTotals(lineItems: QuotationLineItem[], discount: number, taxPercent: number) {
  const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discounted = Math.max(0, subtotal - discount);
  const taxAmount = Math.round((discounted * taxPercent) / 100);
  const total = discounted + taxAmount;
  return { subtotal, taxAmount, total };
}

function serializeQuotation(q: typeof creativeProjectQuotationsTable.$inferSelect) {
  return {
    ...q,
    sentAt: q.sentAt?.toISOString() ?? null,
    respondedAt: q.respondedAt?.toISOString() ?? null,
    validUntil: q.validUntil?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// ── Admin: GET quotation for a project ───────────────────────────────────────

router.get("/creative-ai/projects/:projectId/quotation", async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };
  const [quotation] = await db
    .select()
    .from(creativeProjectQuotationsTable)
    .where(eq(creativeProjectQuotationsTable.projectId, projectId));

  if (!quotation) {
    res.status(404).json({ error: "No quotation for this project yet" });
    return;
  }
  res.json(serializeQuotation(quotation));
});

// ── Admin: update existing draft quotation (WP-11: creation path frozen) ─────
//
// WP-11 legacy freeze: new rows can NO LONGER be created in
// creative_project_quotations via this route. This table is frozen for writes
// as of this work package — all new quotations must originate from the
// service-catalog flow (POST /api/ai/catalog/services/:id/request).
//
// Existing pre-freeze draft rows on the table can still be edited so that
// projects created before the freeze are not left stranded mid-workflow.
// This handler now returns 410 Gone if no existing row exists for the project.

router.put("/creative-ai/projects/:projectId/quotation", async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [existing] = await db
    .select()
    .from(creativeProjectQuotationsTable)
    .where(eq(creativeProjectQuotationsTable.projectId, projectId));

  // WP-11 freeze gate: block creation of new legacy quotation rows.
  if (!existing) {
    res.status(410).json({
      error:
        "Legacy quotation creation is frozen. Use the service-catalog flow " +
        "(POST /api/ai/catalog/services/:id/request) to create new quotations.",
      code: "LEGACY_QUOTATION_FROZEN",
    });
    return;
  }

  if (existing.status !== "draft") {
    res.status(409).json({ error: `Quotation is already ${existing.status}; cannot edit.` });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const lineItems = parseLineItems(body.lineItems);
  if (!lineItems) {
    res.status(400).json({ error: "lineItems must be a non-empty array of { description, quantity, unitPrice }" });
    return;
  }

  const discount = Number.isInteger(Number(body.discount)) ? Math.min(MAX_MONEY, Math.max(0, Number(body.discount))) : 0;
  const taxPercent = Number.isInteger(Number(body.taxPercent)) ? Math.min(100, Math.max(0, Number(body.taxPercent))) : 0;
  const currency = typeof body.currency === "string" && body.currency.trim() ? body.currency.trim().toUpperCase().slice(0, 8) : "IDR";
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;

  const validUntil = parseValidUntil(body.validUntil);
  if (validUntil === undefined) {
    res.status(400).json({ error: "validUntil must be a valid ISO date string" });
    return;
  }

  const { subtotal, taxAmount, total } = computeTotals(lineItems, discount, taxPercent);

  const [saved] = await db
    .update(creativeProjectQuotationsTable)
    .set({ lineItems, discount, taxPercent, currency, notes, validUntil, subtotal, taxAmount, total })
    .where(eq(creativeProjectQuotationsTable.id, existing.id))
    .returning();

  await logAudit("quotation", "quotation_updated", projectId, "quotation", "success", {
    total: saved.total,
    currency: saved.currency,
  });

  res.json(serializeQuotation(saved));
});

// ── Admin: send quotation to client ──────────────────────────────────────────

router.post("/creative-ai/projects/:projectId/quotation/send", async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };

  const [quotation] = await db
    .select()
    .from(creativeProjectQuotationsTable)
    .where(eq(creativeProjectQuotationsTable.projectId, projectId));

  if (!quotation) {
    res.status(404).json({ error: "No quotation drafted for this project yet" });
    return;
  }
  if (quotation.status !== "draft") {
    res.status(409).json({ error: `Quotation already ${quotation.status}` });
    return;
  }

  const [saved] = await db
    .update(creativeProjectQuotationsTable)
    .set({ status: "sent", sentAt: new Date() })
    .where(eq(creativeProjectQuotationsTable.id, quotation.id))
    .returning();

  const [review] = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.projectId, projectId));

  await logAudit("quotation", "quotation_sent", projectId, "quotation", "success", { total: saved.total });
  publishSafe({
    eventType: "quotation.sent",
    sourceModule: "quotation",
    sourceId: projectId,
    payload: { projectId, total: saved.total, currency: saved.currency, clientName: review?.clientName },
  });

  res.json(serializeQuotation(saved));
});

// ── Public: resolve token → review record (client-facing) ───────────────────

async function resolveClientToken(token: string) {
  const hash = hashToken(token);
  const [review] = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.reviewTokenHash, hash));
  return review ?? null;
}

// ── Public: GET quotation by client token ────────────────────────────────────

router.get("/public/customer/quotation/:token", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const review = await resolveClientToken(token);
  if (!review || !isReviewValid(review)) {
    res.status(401).json({ error: "Invalid, expired, or revoked link" });
    return;
  }

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, review.projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [quotation] = await db
    .select()
    .from(creativeProjectQuotationsTable)
    .where(eq(creativeProjectQuotationsTable.projectId, review.projectId));

  if (!quotation || quotation.status === "draft") {
    res.status(404).json({ error: "No quotation has been sent for this project yet" });
    return;
  }

  res.json({
    ...serializeQuotation(quotation),
    brandName: project.brandName,
    clientName: review.clientName,
    projectStatus: project.status,
  });
});

// ── Public: approve quotation → kicks off AI generation ─────────────────────

router.post("/public/customer/quotation/:token/approve", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const { token } = req.params as { token: string };
  const review = await resolveClientToken(token);
  if (!review || !isReviewValid(review)) {
    res.status(401).json({ error: "Invalid, expired, or revoked link" });
    return;
  }

  // Atomic compare-and-set: only transitions rows that are still "sent",
  // so concurrent approve/reject calls cannot both succeed and double-trigger the workflow.
  const [saved] = await db
    .update(creativeProjectQuotationsTable)
    .set({ status: "approved", respondedAt: new Date() })
    .where(and(
      eq(creativeProjectQuotationsTable.projectId, review.projectId),
      eq(creativeProjectQuotationsTable.status, "sent"),
    ))
    .returning();

  if (!saved) {
    res.status(409).json({ error: "No pending quotation to approve" });
    return;
  }

  await logAudit("quotation", "quotation_approved", review.projectId, "quotation", "success", { total: saved.total });
  publishSafe({
    eventType: "quotation.approved",
    sourceModule: "quotation",
    sourceId: review.projectId,
    payload: { projectId: review.projectId, total: saved.total, currency: saved.currency },
  });

  // Look up the associated project to check whether this is a service-catalog request
  // (has serviceRequestId) or a legacy Creative AI project (serviceRequestId is null).
  const [project] = await db
    .select({ id: creativeProjectsTable.id, serviceRequestId: creativeProjectsTable.serviceRequestId, status: creativeProjectsTable.status })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, review.projectId))
    .limit(1);

  const serviceRequestId = project?.serviceRequestId ?? null;

  if (serviceRequestId != null) {
    // ── New service-catalog flow: commercial gate gates the conversion ──────
    await createGateForQuotation({ quotationId: saved.id, serviceRequestId }).catch((err) => {
      console.warn("[quotation] createGateForQuotation non-fatal error:", err);
    });
    // Trigger conversion if gate is already cleared (pre-verified/waived by admin).
    checkAndMaybeConvert(saved.id).catch((err) => {
      console.warn("[quotation] checkAndMaybeConvert non-fatal error:", err);
    });
    res.json({ success: true, status: "approved", message: "Quotation approved — awaiting commercial gate clearance" });
  } else {
    // ── Legacy Creative AI flow: start AI workflow directly (no gate) ───────
    if (project && project.status === "pending") {
      runCreativeBriefWorkflow(project.id).catch((err) => {
        console.error("[quotation] Workflow failed:", err);
      });
    }
    res.json({ success: true, status: "approved", message: "Quotation approved — your project is now in production" });
  }
});

// ── Public: reject quotation ──────────────────────────────────────────────────

router.post("/public/customer/quotation/:token/request-change", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const { token } = req.params as { token: string };
  const review = await resolveClientToken(token);
  if (!review || !isReviewValid(review)) {
    res.status(401).json({ error: "Invalid, expired, or revoked link" });
    return;
  }

  const notesRaw = (req.body as Record<string, unknown> | undefined)?.notes;
  const notes = typeof notesRaw === "string" ? notesRaw.slice(0, 2000).replace(/<[^>]*>/g, "").trim() : undefined;
  if (!notes) {
    res.status(400).json({ error: "notes (reason for change request) is required" });
    return;
  }

  // CAS: only transition from "sent" — terminal states must not be overwritten
  const [saved] = await db
    .update(creativeProjectQuotationsTable)
    .set({ status: "sent", respondedAt: new Date(), responseNotes: notes })
    .where(and(
      eq(creativeProjectQuotationsTable.projectId, review.projectId),
      eq(creativeProjectQuotationsTable.status, "sent"),
    ))
    .returning();

  if (!saved) {
    res.status(409).json({ error: "No pending quotation to request change on, or already responded" });
    return;
  }

  await logAudit("quotation", "quotation_change_requested", review.projectId, "quotation", "success", { notes });
  publishSafe({
    eventType: "quotation.change_requested",
    sourceModule: "quotation",
    sourceId: review.projectId,
    payload: { projectId: review.projectId, notes },
  });

  res.json({ success: true, status: "revision_requested", message: "Change request submitted" });
});

router.post("/public/customer/quotation/:token/reject", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const { token } = req.params as { token: string };
  const review = await resolveClientToken(token);
  if (!review || !isReviewValid(review)) {
    res.status(401).json({ error: "Invalid, expired, or revoked link" });
    return;
  }

  const notesRaw = (req.body as Record<string, unknown> | undefined)?.notes;
  const notes = typeof notesRaw === "string" ? notesRaw.slice(0, 2000).replace(/<[^>]*>/g, "").trim() : undefined;

  // Atomic compare-and-set — see approve handler for rationale.
  const [saved] = await db
    .update(creativeProjectQuotationsTable)
    .set({ status: "rejected", respondedAt: new Date(), responseNotes: notes ?? null })
    .where(and(
      eq(creativeProjectQuotationsTable.projectId, review.projectId),
      eq(creativeProjectQuotationsTable.status, "sent"),
    ))
    .returning();

  if (!saved) {
    res.status(409).json({ error: "No pending quotation to reject" });
    return;
  }

  await db
    .update(creativeProjectsTable)
    .set({ status: "failed" })
    .where(eq(creativeProjectsTable.projectId, review.projectId));

  await logAudit("quotation", "quotation_rejected", review.projectId, "quotation", "success", { notes });
  publishSafe({
    eventType: "quotation.rejected",
    sourceModule: "quotation",
    sourceId: review.projectId,
    payload: { projectId: review.projectId, notes },
  });

  res.json({ success: true, status: "rejected", message: "Quotation rejected" });
});

export default router;
