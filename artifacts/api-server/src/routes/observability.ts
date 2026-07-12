/**
 * observability.ts — AI Observability & Cost Intelligence API routes
 *
 * GET  /ai/observability/execution-logs   — list execution logs (filterable)
 * GET  /ai/observability/cost-summary     — totals + breakdowns by provider/model/agent/order
 * GET  /ai/observability/workflow-costs   — list aggregated workflow cost rows
 * GET  /ai/observability/provider-pricing — list dynamic pricing table
 * POST /ai/observability/provider-pricing — create/update a pricing row
 * PATCH /ai/observability/provider-pricing/:id — update a specific pricing row
 * POST /ai/observability/seed-pricing    — seed default pricing rows
 * POST /ai/observability/init            — run DDL to create tables (idempotent)
 */

import { Router, type Request, type Response } from "express";
import {
  listExecutionLogs,
  getCostSummary,
  listWorkflowCosts,
  listProviderPricing,
  upsertProviderPricing,
  updateProviderPricing,
  seedDefaultPricing,
  ensureObservabilityTables,
} from "../services/observabilityService.js";

const router = Router();

// ── GET /ai/observability/execution-logs ──────────────────────────────────────
router.get("/ai/observability/execution-logs", async (req: Request, res: Response) => {
  try {
    const limit  = Math.min(Number(req.query.limit  ?? 50),  200);
    const offset = Number(req.query.offset ?? 0);
    const result = await listExecutionLogs({
      provider:   req.query.provider   ? String(req.query.provider)   : undefined,
      agent:      req.query.agent      ? String(req.query.agent)      : undefined,
      status:     req.query.status     ? String(req.query.status)     : undefined,
      jobId:      req.query.jobId      ? Number(req.query.jobId)      : undefined,
      workflowId: req.query.workflowId ? Number(req.query.workflowId) : undefined,
      orderId:    req.query.orderId    ? String(req.query.orderId)    : undefined,
      limit,
      offset,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "[observability] Failed to list execution logs");
    res.status(500).json({ error: "Failed to list execution logs" });
  }
});

// ── GET /ai/observability/cost-summary ────────────────────────────────────────
router.get("/ai/observability/cost-summary", async (req: Request, res: Response) => {
  try {
    const summary = await getCostSummary();
    res.json(summary);
  } catch (err) {
    req.log.error({ err }, "[observability] Failed to get cost summary");
    res.status(500).json({ error: "Failed to get cost summary" });
  }
});

// ── GET /ai/observability/workflow-costs ──────────────────────────────────────
router.get("/ai/observability/workflow-costs", async (req: Request, res: Response) => {
  try {
    const limit  = Math.min(Number(req.query.limit  ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const result = await listWorkflowCosts(limit, offset);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "[observability] Failed to list workflow costs");
    res.status(500).json({ error: "Failed to list workflow costs" });
  }
});

// ── GET /ai/observability/provider-pricing ────────────────────────────────────
router.get("/ai/observability/provider-pricing", async (req: Request, res: Response) => {
  try {
    const rows = await listProviderPricing();
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "[observability] Failed to list provider pricing");
    res.status(500).json({ error: "Failed to list provider pricing" });
  }
});

// ── POST /ai/observability/provider-pricing ───────────────────────────────────
router.post("/ai/observability/provider-pricing", async (req: Request, res: Response) => {
  try {
    const { provider, model, inputPricePer1m, outputPricePer1m, cachedInputPrice, reasoningPrice, effectiveDate, active } = req.body as Record<string, unknown>;
    if (!provider || !model || inputPricePer1m == null || outputPricePer1m == null) {
      res.status(400).json({ error: "provider, model, inputPricePer1m, and outputPricePer1m are required" });
      return;
    }
    const row = await upsertProviderPricing({
      provider:         String(provider),
      model:            String(model),
      inputPricePer1m:  Number(inputPricePer1m),
      outputPricePer1m: Number(outputPricePer1m),
      cachedInputPrice: cachedInputPrice != null ? Number(cachedInputPrice) : null,
      reasoningPrice:   reasoningPrice   != null ? Number(reasoningPrice)   : null,
      effectiveDate:    effectiveDate    != null ? String(effectiveDate)    : null,
      active:           active           != null ? Boolean(active)          : true,
    });
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "[observability] Failed to upsert provider pricing");
    res.status(500).json({ error: "Failed to save provider pricing" });
  }
});

// ── PATCH /ai/observability/provider-pricing/:id ──────────────────────────────
router.patch("/ai/observability/provider-pricing/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const { inputPricePer1m, outputPricePer1m, cachedInputPrice, reasoningPrice, active, effectiveDate } = req.body as Record<string, unknown>;
    const updated = await updateProviderPricing(id, {
      ...(inputPricePer1m  !== undefined && { inputPricePer1m:  Number(inputPricePer1m)  }),
      ...(outputPricePer1m !== undefined && { outputPricePer1m: Number(outputPricePer1m) }),
      ...(cachedInputPrice !== undefined && { cachedInputPrice: cachedInputPrice != null ? Number(cachedInputPrice) : null }),
      ...(reasoningPrice   !== undefined && { reasoningPrice:   reasoningPrice   != null ? Number(reasoningPrice)   : null }),
      ...(active           !== undefined && { active: Boolean(active) }),
      ...(effectiveDate    !== undefined && { effectiveDate: effectiveDate != null ? String(effectiveDate) : null }),
    });
    if (!updated) { res.status(404).json({ error: "Pricing row not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "[observability] Failed to update provider pricing");
    res.status(500).json({ error: "Failed to update provider pricing" });
  }
});

// ── POST /ai/observability/seed-pricing ───────────────────────────────────────
router.post("/ai/observability/seed-pricing", async (req: Request, res: Response) => {
  try {
    const inserted = await seedDefaultPricing();
    res.json({ inserted, message: `Seeded ${inserted} default pricing rows` });
  } catch (err) {
    req.log.error({ err }, "[observability] Failed to seed pricing");
    res.status(500).json({ error: "Failed to seed pricing" });
  }
});

// ── POST /ai/observability/init ───────────────────────────────────────────────
router.post("/ai/observability/init", async (req: Request, res: Response) => {
  try {
    await ensureObservabilityTables();
    const seeded = await seedDefaultPricing();
    res.json({ ok: true, message: "Observability tables created (idempotent)", pricingRowsSeeded: seeded });
  } catch (err) {
    req.log.error({ err }, "[observability] Failed to init tables");
    res.status(500).json({ error: "Failed to init observability tables" });
  }
});

export default router;
