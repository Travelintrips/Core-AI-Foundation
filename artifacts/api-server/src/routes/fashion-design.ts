/**
 * fashion-design.ts — Fashion & Apparel Design routes (Team 18)
 *
 * All routes mounted under /api (via app.ts → routes/index.ts).
 * Auth: admin routes require ADMIN_API_KEY (global middleware).
 *       Public service-listing route is excluded via adminAuthWithExceptions.
 *
 * Route prefix: paths do NOT include /api (applied by app.ts mount point).
 *
 * Domain: POST /ai/fashion-design/*
 *
 * IMPORTANT: Do NOT import zod/v4 here. Use plain zod for request parsing.
 * IMPORTANT: Route paths do NOT include the /api prefix.
 */

import { Router } from "express";
import { z } from "zod";
import {
  createOrder,
  listOrders,
  getOrder,
  updateOrderStatus,
  updateOrderColorways,
  deleteOrder,
  saveBlueprint,
  getBlueprint,
  runTrademarkCheck,
  generateOutputs,
  getAvailableServices,
  validateServiceType,
  validateStatus,
} from "../services/fashionDesignService.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function handleError(res: import("express").Response, err: unknown) {
  const msg = err instanceof Error ? err.message : "Unexpected error";
  logger.error({ err }, "[fashion-design] Route error");
  if (msg.includes("Invalid") || msg.includes("Cannot") || msg.includes("No blueprint")) {
    return res.status(400).json({ error: msg });
  }
  return res.status(500).json({ error: msg });
}

function parseId(raw: string | undefined): number | null {
  const n = parseInt(raw ?? "", 10);
  return isNaN(n) ? null : n;
}

// ── Request schemas ───────────────────────────────────────────────────────────

const createOrderSchema = z.object({
  customerName: z.string().min(1).max(200),
  customerEmail: z.string().email(),
  orderName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  serviceType: z.string(),
  quantity: z.number().int().min(1).max(10000).optional(),
  colorways: z.array(z.string().regex(/^#[0-9A-Fa-f]{3,8}$/, "Must be a hex color")).max(20).optional(),
  motifConfig: z.record(z.unknown()).optional(),
});

const updateStatusSchema = z.object({
  status: z.string(),
  adminNotes: z.string().max(2000).optional(),
});

const colorwaysSchema = z.object({
  colorways: z.array(z.string().regex(/^#[0-9A-Fa-f]{3,8}$/, "Must be a hex color")).max(20),
  motifConfig: z.record(z.unknown()).optional(),
});

const saveBlueprintSchema = z.object({
  panels: z.record(z.unknown()).optional(),
  placementSpec: z.record(z.unknown()).optional(),
  panelConstraints: z.record(z.unknown()).optional(),
  logoPlacement: z.record(z.unknown()).optional(),
  numberValue: z.string().max(3).optional(),
  nameValue: z.string().max(50).optional(),
  numberFont: z.string().max(100).optional(),
  numberColor: z.string().regex(/^#[0-9A-Fa-f]{3,8}$/).optional(),
  sponsors: z.array(z.record(z.unknown())).max(10).optional(),
});

// ── Public routes (no admin key required) ─────────────────────────────────────

/**
 * GET /ai/fashion-design/services
 * Lists available apparel service types with panel/output metadata.
 * Public — excluded from admin auth via app.ts PUBLIC_ROUTE_RULES.
 */
router.get("/ai/fashion-design/services", (_req, res) => {
  try {
    const services = getAvailableServices();
    res.json({ services });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Orders ────────────────────────────────────────────────────────────────────

/**
 * POST /ai/fashion-design/orders
 * Create a new fashion design order.
 */
router.post("/ai/fashion-design/orders", async (req, res) => {
  try {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }
    const order = await createOrder(parsed.data);
    res.status(201).json(order);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /ai/fashion-design/orders
 * List all orders (admin).
 */
router.get("/ai/fashion-design/orders", async (req, res) => {
  try {
    const page = parseInt(String(req.query["page"] ?? "1"), 10);
    const pageSize = Math.min(parseInt(String(req.query["pageSize"] ?? "20"), 10), 100);
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const serviceType = typeof req.query["serviceType"] === "string" ? req.query["serviceType"] : undefined;
    const search = typeof req.query["search"] === "string" ? req.query["search"] : undefined;

    const result = await listOrders({ page, pageSize, status, serviceType, search });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /ai/fashion-design/orders/:id
 * Get a single order with its blueprint.
 */
router.get("/ai/fashion-design/orders/:id", async (req, res) => {
  try {
    const id = parseId(req.params["id"]);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const [order, blueprint] = await Promise.all([getOrder(id), getBlueprint(id)]);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }

    res.json({ ...order, blueprint: blueprint ?? null });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * PATCH /ai/fashion-design/orders/:id/status
 * Update order status (admin).
 */
router.patch("/ai/fashion-design/orders/:id/status", async (req, res) => {
  try {
    const id = parseId(req.params["id"]);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const updated = await updateOrderStatus(id, parsed.data as Parameters<typeof updateOrderStatus>[1]);
    if (!updated) { res.status(404).json({ error: "Order not found" }); return; }
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * PATCH /ai/fashion-design/orders/:id/colorways
 * Update colorways and motif config.
 */
router.patch("/ai/fashion-design/orders/:id/colorways", async (req, res) => {
  try {
    const id = parseId(req.params["id"]);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const parsed = colorwaysSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const updated = await updateOrderColorways(
      id,
      parsed.data.colorways,
      parsed.data.motifConfig,
    );
    if (!updated) { res.status(404).json({ error: "Order not found" }); return; }
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * DELETE /ai/fashion-design/orders/:id
 * Delete a draft/cancelled order.
 */
router.delete("/ai/fashion-design/orders/:id", async (req, res) => {
  try {
    const id = parseId(req.params["id"]);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const deleted = await deleteOrder(id);
    if (!deleted) { res.status(404).json({ error: "Order not found" }); return; }
    res.status(204).send();
  } catch (err) {
    handleError(res, err);
  }
});

// ── Blueprint ─────────────────────────────────────────────────────────────────

/**
 * GET /ai/fashion-design/orders/:id/blueprint
 * Get blueprint for an order.
 */
router.get("/ai/fashion-design/orders/:id/blueprint", async (req, res) => {
  try {
    const id = parseId(req.params["id"]);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const order = await getOrder(id);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }

    const blueprint = await getBlueprint(id);
    res.json({ order, blueprint: blueprint ?? null });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * PUT /ai/fashion-design/orders/:id/blueprint
 * Save/update blueprint spec for an order.
 * Validates panel constraints, numbering, logo placement, motif repeat.
 */
router.put("/ai/fashion-design/orders/:id/blueprint", async (req, res) => {
  try {
    const id = parseId(req.params["id"]);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const parsed = saveBlueprintSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const result = await saveBlueprint(id, parsed.data);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Trademark check ───────────────────────────────────────────────────────────

/**
 * POST /ai/fashion-design/orders/:id/trademark-check
 * Run trademark safety check against known brand blocklist.
 */
router.post("/ai/fashion-design/orders/:id/trademark-check", async (req, res) => {
  try {
    const id = parseId(req.params["id"]);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const result = await runTrademarkCheck(id);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Generation ────────────────────────────────────────────────────────────────

/**
 * POST /ai/fashion-design/orders/:id/generate
 * Generate outputs: composition JSON, placement spec, colorways.
 * Image generation (flat-design, front/back preview) requires AI pipeline.
 */
router.post("/ai/fashion-design/orders/:id/generate", async (req, res) => {
  try {
    const id = parseId(req.params["id"]);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const result = await generateOutputs(id);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /ai/fashion-design/orders/:id/outputs
 * Get generated outputs for an order.
 */
router.get("/ai/fashion-design/orders/:id/outputs", async (req, res) => {
  try {
    const id = parseId(req.params["id"]);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const order = await getOrder(id);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }

    res.json({
      orderId: id,
      status: order.status,
      outputs: order.outputs,
      compositionJson: order.compositionJson,
      trademarkSafe: order.trademarkSafe,
      trademarkNotes: order.trademarkNotes,
    });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
