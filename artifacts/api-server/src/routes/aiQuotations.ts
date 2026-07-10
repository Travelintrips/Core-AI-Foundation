/**
 * AI Quotation routes (service-catalog flow).
 *
 * Admin routes (adminAuth-protected):
 *   GET  /ai/quotations                  — list all quotations
 *   POST /ai/quotations                  — create draft from service request
 *   GET  /ai/quotations/:id              — get quotation + items
 *   PUT  /ai/quotations/:id/items        — update line items (draft only)
 *   POST /ai/quotations/:id/issue        — issue to customer (generates token)
 *
 * Public routes (token-gated, bypass adminAuth via /public prefix):
 *   GET  /public/quotations/:token       — view quotation
 *   POST /public/quotations/:token/approve
 *   POST /public/quotations/:token/request-change
 *   POST /public/quotations/:token/reject
 *
 * No zod import — api-server does not depend on zod directly.
 */

import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, aiQuotationsTable, aiServiceRequestsTable } from "@workspace/db";
import {
  createQuotation,
  updateQuotationItems,
  issueQuotation,
  getByToken,
  markViewed,
  approveByToken,
  requestChangeByToken,
  rejectByToken,
  getQuotationWithItems,
} from "../services/aiQuotationService.js";
import { createGateForServiceQuotation } from "../services/commercialGateService.js";
import { checkAndMaybeConvertByServiceQuotation } from "../services/serviceRequestConversionService.js";

const router = Router();

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

function parseId(raw: string | undefined): number | null {
  const n = parseInt(raw ?? "", 10);
  return Number.isNaN(n) ? null : n;
}

// ── Admin: list ───────────────────────────────────────────────────────────────

router.get("/ai/quotations", async (req, res): Promise<void> => {
  const serviceRequestId = req.query.serviceRequestId
    ? parseInt(String(req.query.serviceRequestId), 10)
    : null;

  const rows = serviceRequestId && !Number.isNaN(serviceRequestId)
    ? await db
        .select()
        .from(aiQuotationsTable)
        .where(eq(aiQuotationsTable.serviceRequestId, serviceRequestId))
        .orderBy(desc(aiQuotationsTable.createdAt))
    : await db
        .select()
        .from(aiQuotationsTable)
        .orderBy(desc(aiQuotationsTable.createdAt));

  res.json(rows);
});

// ── Admin: create draft ───────────────────────────────────────────────────────

router.post("/ai/quotations", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const serviceRequestId = typeof body.serviceRequestId === "number"
    ? body.serviceRequestId
    : parseId(String(body.serviceRequestId ?? ""));

  if (!serviceRequestId) {
    res.status(400).json({ error: "serviceRequestId is required" });
    return;
  }

  const [sr] = await db
    .select()
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.id, serviceRequestId))
    .limit(1);
  if (!sr) {
    res.status(404).json({ error: "Service request not found" });
    return;
  }

  try {
    const q = await createQuotation({
      serviceRequestId,
      customerName: sr.customerName,
      customerEmail: sr.customerEmail,
      currency: sr.currency ?? "IDR",
      tenantId: sr.tenantId,
      validDays: typeof body.validDays === "number" ? body.validDays : 14,
    });
    res.status(201).json(q);
  } catch (err) {
    const msg = String(err);
    res.status(msg.includes("duplicate") || msg.includes("unique") ? 409 : 500).json({ error: msg });
  }
});

// ── Admin: get single ─────────────────────────────────────────────────────────

router.get("/ai/quotations/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const result = await getQuotationWithItems(id);
  if (!result) { res.status(404).json({ error: "Quotation not found" }); return; }

  res.json(result);
});

// ── Admin: update items (draft only) ─────────────────────────────────────────

router.put("/ai/quotations/:id/items", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    res.status(400).json({ error: "items array is required" });
    return;
  }

  const items: Array<{ itemType?: string; description: string; quantity: number; unitPrice: number; displayOrder?: number }> = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object") { res.status(400).json({ error: "Invalid item" }); return; }
    const { description, quantity, unitPrice, itemType, displayOrder } = item as Record<string, unknown>;
    if (typeof description !== "string" || !description.trim()) { res.status(400).json({ error: "item.description required" }); return; }
    const qty = Number(quantity);
    const price = Number(unitPrice);
    if (!Number.isInteger(qty) || qty <= 0) { res.status(400).json({ error: "item.quantity must be positive integer" }); return; }
    if (!Number.isInteger(price) || price < 0) { res.status(400).json({ error: "item.unitPrice must be non-negative integer" }); return; }
    items.push({
      description: description.trim().slice(0, 500),
      quantity: qty,
      unitPrice: price,
      itemType: typeof itemType === "string" ? itemType : "service",
      displayOrder: typeof displayOrder === "number" ? displayOrder : undefined,
    });
  }

  const discount = typeof body.discount === "number" ? Math.max(0, body.discount) : 0;
  const taxPercent = typeof body.taxPercent === "number" ? Math.max(0, Math.min(100, body.taxPercent)) : 0;

  try {
    const result = await updateQuotationItems(id, items, { discount, taxPercent });
    res.json(result);
  } catch (err) {
    const msg = String(err);
    res.status(msg.includes("not found") ? 404 : 400).json({ error: msg });
  }
});

// ── Admin: issue ──────────────────────────────────────────────────────────────

router.post("/ai/quotations/:id/issue", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const validDays = typeof body.validDays === "number" ? body.validDays : 14;

  try {
    const { quotation, reviewToken } = await issueQuotation(id, validDays);
    // Return the plaintext token once — admin passes it to customer (e.g. via email)
    res.json({ quotation, reviewToken });
  } catch (err) {
    const msg = String(err);
    res.status(msg.includes("not found") ? 404 : 400).json({ error: msg });
  }
});

// ── Public: view by token ─────────────────────────────────────────────────────

router.get("/public/quotations/:token", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) { res.status(429).json({ error: "Too many requests" }); return; }

  const { token } = req.params as { token: string };
  const result = await getByToken(token);
  if (!result) { res.status(404).json({ error: "Quotation not found or link expired" }); return; }

  const { quotation, items } = result;

  // Check token expiry
  if (quotation.reviewTokenExpiresAt && new Date() > quotation.reviewTokenExpiresAt) {
    res.status(410).json({ error: "This quotation link has expired" });
    return;
  }

  // Mark as viewed (idempotent)
  await markViewed(quotation.id);

  // Strip internal fields before sending to customer
  const { reviewTokenHash, reviewTokenExpiresAt, ...safeQuotation } = quotation;

  res.json({ quotation: safeQuotation, items });
});

// ── Public: approve ───────────────────────────────────────────────────────────

router.post("/public/quotations/:token/approve", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip, 10)) { res.status(429).json({ error: "Too many requests" }); return; }

  const { token } = req.params as { token: string };

  try {
    const quotation = await approveByToken(token);

    // Create commercial gate (idempotent)
    const gate = await createGateForServiceQuotation({
      serviceQuotationId: quotation.id,
      serviceRequestId: quotation.serviceRequestId ?? undefined,
    });

    // Attempt conversion (will no-op if gate not yet cleared)
    checkAndMaybeConvertByServiceQuotation(quotation.id).catch((err) => {
      console.warn("[aiQuotations] conversion non-fatal:", err);
    });

    const { reviewTokenHash, reviewTokenExpiresAt, ...safe } = quotation;
    res.json({ success: true, status: "approved", quotation: safe, gateId: gate.id });
  } catch (err) {
    const msg = String(err);
    res.status(msg.includes("terminal") || msg.includes("already") ? 409 : 400).json({ error: msg });
  }
});

// ── Public: request-change ────────────────────────────────────────────────────

router.post("/public/quotations/:token/request-change", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip, 10)) { res.status(429).json({ error: "Too many requests" }); return; }

  const { token } = req.params as { token: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "";

  if (!notes) {
    res.status(400).json({ error: "notes (reason for change request) is required" });
    return;
  }

  try {
    const quotation = await requestChangeByToken(token, notes);
    const { reviewTokenHash, reviewTokenExpiresAt, ...safe } = quotation;
    res.json({ success: true, status: "revision_requested", quotation: safe });
  } catch (err) {
    const msg = String(err);
    res.status(msg.includes("terminal") || msg.includes("already") ? 409 : 400).json({ error: msg });
  }
});

// ── Public: reject ────────────────────────────────────────────────────────────

router.post("/public/quotations/:token/reject", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip, 10)) { res.status(429).json({ error: "Too many requests" }); return; }

  const { token } = req.params as { token: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : undefined;

  try {
    const quotation = await rejectByToken(token, notes);
    const { reviewTokenHash, reviewTokenExpiresAt, ...safe } = quotation;
    res.json({ success: true, status: "rejected", quotation: safe });
  } catch (err) {
    const msg = String(err);
    res.status(msg.includes("terminal") || msg.includes("already") ? 409 : 400).json({ error: msg });
  }
});

export default router;
