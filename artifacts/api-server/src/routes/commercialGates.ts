/**
 * Admin routes for ai_commercial_gates.
 *
 * All routes are protected by the adminAuth middleware (applied in app.ts via
 * adminAuthWithExceptions — the same mechanism used for all other /api/* routes).
 *
 * POST /api/commercial-gates/:id/verify  — verify a gate (requires verifiedBy)
 * POST /api/commercial-gates/:id/fail    — fail a gate (requires reason)
 * POST /api/commercial-gates/:id/waive   — waive a gate (requires waivedBy + reason)
 * GET  /api/commercial-gates/:id         — fetch a single gate
 * GET  /api/commercial-gates             — list gates (optionally ?quotationId= or ?serviceRequestId=)
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, aiCommercialGatesTable } from "@workspace/db";
import {
  verifyGate,
  failGate,
  waiveGate,
} from "../services/commercialGateService.js";
import {
  checkAndMaybeConvert,
  checkAndMaybeConvertByServiceQuotation,
} from "../services/serviceRequestConversionService.js";

// Fires the right conversion path depending on which flow the gate belongs
// to (legacy creative_project_quotations vs. new service-catalog ai_quotations).
// Without this, service-catalog requests never get a createdProjectId after
// their gate clears, so they can never reach "completed" and customers never
// see their results (see .agents/memory/... commercial-gate conversion gap).
function triggerConversion(gate: { quotationId: number | null; serviceQuotationId: number | null }) {
  if (gate.quotationId != null) {
    checkAndMaybeConvert(gate.quotationId).catch((err) => {
      console.warn("[commercial-gates] checkAndMaybeConvert non-fatal error:", err);
    });
  } else if (gate.serviceQuotationId != null) {
    checkAndMaybeConvertByServiceQuotation(gate.serviceQuotationId).catch((err) => {
      console.warn("[commercial-gates] checkAndMaybeConvertByServiceQuotation non-fatal error:", err);
    });
  }
}

const router = Router();

function parseId(raw: string | undefined): number | null {
  const id = parseInt(raw ?? "", 10);
  return Number.isNaN(id) ? null : id;
}

// ── GET /api/commercial-gates ─────────────────────────────────────────────────

router.get("/commercial-gates", async (req, res): Promise<void> => {
  const quotationId = req.query.quotationId ? parseInt(String(req.query.quotationId), 10) : null;
  const serviceRequestId = req.query.serviceRequestId ? parseInt(String(req.query.serviceRequestId), 10) : null;

  let rows;
  if (serviceRequestId && !Number.isNaN(serviceRequestId)) {
    rows = await db
      .select()
      .from(aiCommercialGatesTable)
      .where(eq(aiCommercialGatesTable.serviceRequestId, serviceRequestId));
  } else if (quotationId && !Number.isNaN(quotationId)) {
    rows = await db
      .select()
      .from(aiCommercialGatesTable)
      .where(eq(aiCommercialGatesTable.quotationId, quotationId));
  } else {
    rows = await db.select().from(aiCommercialGatesTable);
  }
  res.json(rows);
});

// ── GET /api/commercial-gates/:id ─────────────────────────────────────────────

router.get("/commercial-gates/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [gate] = await db
    .select()
    .from(aiCommercialGatesTable)
    .where(eq(aiCommercialGatesTable.id, id))
    .limit(1);

  if (!gate) { res.status(404).json({ error: "Gate not found" }); return; }
  res.json(gate);
});

// ── POST /api/commercial-gates/:id/verify ─────────────────────────────────────

router.post("/commercial-gates/:id/verify", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const verifiedBy = typeof body.verifiedBy === "string" ? body.verifiedBy.trim() : "";
  if (!verifiedBy) { res.status(400).json({ error: "verifiedBy is required" }); return; }

  const verifiedAmount = body.verifiedAmount != null ? Number(body.verifiedAmount) : null;
  const referenceNumber = typeof body.referenceNumber === "string" ? body.referenceNumber.trim() : null;

  try {
    const gate = await verifyGate(id, verifiedBy, verifiedAmount, referenceNumber);

    // Attempt conversion now that gate is cleared (fire-and-forget)
    triggerConversion(gate);

    res.json(gate);
  } catch (err) {
    res.status(404).json({ error: String(err) });
  }
});

// ── POST /api/commercial-gates/:id/fail ───────────────────────────────────────

router.post("/commercial-gates/:id/fail", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) { res.status(400).json({ error: "reason is required" }); return; }

  try {
    const gate = await failGate(id, reason);
    res.json(gate);
  } catch (err) {
    res.status(404).json({ error: String(err) });
  }
});

// ── POST /api/commercial-gates/:id/waive ──────────────────────────────────────

router.post("/commercial-gates/:id/waive", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const waivedBy = typeof body.waivedBy === "string" ? body.waivedBy.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!waivedBy) { res.status(400).json({ error: "waivedBy is required" }); return; }
  if (!reason) { res.status(400).json({ error: "reason is required" }); return; }

  try {
    const gate = await waiveGate(id, waivedBy, reason);

    // Attempt conversion now that gate is cleared (fire-and-forget)
    triggerConversion(gate);

    res.json(gate);
  } catch (err) {
    res.status(404).json({ error: String(err) });
  }
});

export default router;
