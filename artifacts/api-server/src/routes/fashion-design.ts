/**
 * fashion-design.ts — Fashion & Apparel Design routes (Team 18)
 *
 * Auth: fashionDesignAuthGuard + adminAuth on ALL admin routes (explicit,
 *       router-level). Public service-listing route has NO auth middleware.
 *
 * Rate limiting: aiGenerationLimiter (existing shared middleware) on /generate.
 *
 * Idempotency: x-idempotency-key header on POST /generate.
 *
 * Route prefix: paths do NOT include /api (applied by app.ts mount point).
 * IMPORTANT: Do NOT import zod/v4. Use plain zod only.
 * IMPORTANT: This router is NOT mounted in routes/index.ts (locked file).
 *            See integration/manifests/team-18.json → routesToMount.
 */

import { Router } from "express";
import { z } from "zod";
import { adminAuth } from "../middleware/adminAuth.js";
import { aiGenerationLimiter } from "../middleware/rateLimiter.js";
import { fashionDesignAuthGuard } from "../domains/fashion-design/authGuard.js";
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
import {
  requestRevision,
  assignDesigner,
  uploadRevision,
  listRevisions,
} from "../services/fashionRevisionService.js";
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

function getCallerId(req: import("express").Request): string {
  const key = req.headers["x-admin-api-key"] ?? req.headers["x-admin-key"];
  if (typeof key === "string" && key) return `key:${key.slice(-8)}`;
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
  return `ip:${ip}`;
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

// ── Public routes ─────────────────────────────────────────────────────────────

/**
 * GET /ai/fashion-design/services
 * Lists available apparel service types with panel/output metadata.
 * Public — no auth middleware. When mounted, Team 24 must also add
 * PUBLIC_ROUTE_RULES exception in adminAuth.ts.
 */
router.get("/ai/fashion-design/services", (_req, res) => {
  try {
    const services = getAvailableServices();
    res.json({ services });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Orders (admin) ────────────────────────────────────────────────────────────

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

router.get("/ai/fashion-design/orders", fashionDesignAuthGuard, adminAuth, async (req, res) => {
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

router.get("/ai/fashion-design/orders/:id", async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const [order, blueprint] = await Promise.all([getOrder(id), getBlueprint(id)]);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }

    res.json({ ...order, blueprint: blueprint ?? null });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch("/ai/fashion-design/orders/:id/status", fashionDesignAuthGuard, adminAuth, async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
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

router.patch("/ai/fashion-design/orders/:id/colorways", fashionDesignAuthGuard, adminAuth, async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const parsed = colorwaysSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const updated = await updateOrderColorways(id, parsed.data.colorways, parsed.data.motifConfig);
    if (!updated) { res.status(404).json({ error: "Order not found" }); return; }
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

router.delete("/ai/fashion-design/orders/:id", fashionDesignAuthGuard, adminAuth, async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const deleted = await deleteOrder(id);
    if (!deleted) { res.status(404).json({ error: "Order not found" }); return; }
    res.status(204).send();
  } catch (err) {
    handleError(res, err);
  }
});

// ── Blueprint (admin) ─────────────────────────────────────────────────────────

router.get("/ai/fashion-design/orders/:id/blueprint", fashionDesignAuthGuard, adminAuth, async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const order = await getOrder(id);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }

    const blueprint = await getBlueprint(id);
    res.json({ order, blueprint: blueprint ?? null });
  } catch (err) {
    handleError(res, err);
  }
});

router.put("/ai/fashion-design/orders/:id/blueprint", fashionDesignAuthGuard, adminAuth, async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
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

// ── Trademark check (admin) ───────────────────────────────────────────────────

router.post("/ai/fashion-design/orders/:id/trademark-check", fashionDesignAuthGuard, adminAuth, async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const result = await runTrademarkCheck(id);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Generation (admin + rate-limited + idempotency) ───────────────────────────

/**
 * POST /ai/fashion-design/orders/:id/generate
 *
 * Protected by:
 *   1. fashionDesignAuthGuard — blocks if ADMIN_API_KEY not configured
 *   2. adminAuth              — validates the key / session
 *   3. aiGenerationLimiter    — shared 10 req / 10 min per-IP limiter
 *
 * Idempotency: pass x-idempotency-key header to get cached result on retry.
 * Cost guards:  per-caller rate limit + budget preflight inside generateOutputs.
 */
router.post(
  "/ai/fashion-design/orders/:id/generate",
  fashionDesignAuthGuard,
  adminAuth,
  aiGenerationLimiter,
  async (req, res) => {
    try {
      const id = parseId(req.params["id"] as string);
      if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

      const idempotencyKey = typeof req.headers["x-idempotency-key"] === "string"
        ? req.headers["x-idempotency-key"]
        : undefined;
      const callerId = getCallerId(req);

      const result = await generateOutputs(id, { idempotencyKey, callerId });

      if (result.fromCache) {
        res.setHeader("X-Idempotent-Replayed", "true");
      }
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      if (msg.includes("rate_limited") || msg.includes("Rate limit")) {
        res.status(429).json({ error: msg, code: "RATE_LIMIT_EXCEEDED" });
        return;
      }
      if (msg.includes("budget") || msg.includes("Budget")) {
        res.status(402).json({ error: msg, code: "BUDGET_EXCEEDED" });
        return;
      }
      handleError(res, err);
    }
  },
);

router.get("/ai/fashion-design/orders/:id/outputs", fashionDesignAuthGuard, adminAuth, async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
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

// ── Revision flow ─────────────────────────────────────────────────────────────

/**
 * POST /ai/fashion-design/orders/:id/revision-request
 * Customer requests a human designer revision. Validates customerEmail against order.
 * PUBLIC — no admin auth (customer-facing).
 */
router.post("/ai/fashion-design/orders/:id/revision-request", async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const schema = z.object({
      customerEmail: z.string().email(),
      feedback: z.string().min(10).max(2000),
      referenceUrls: z.array(z.string().url()).max(5).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const revision = await requestRevision(id, parsed.data);
    res.status(201).json({ revision });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /ai/fashion-design/orders/:id/assign-designer
 * Admin assigns a human designer to work on a revision.
 */
router.post("/ai/fashion-design/orders/:id/assign-designer", fashionDesignAuthGuard, adminAuth, async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const schema = z.object({
      designerName: z.string().min(1).max(200),
      designerEmail: z.string().email(),
      notes: z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const result = await assignDesigner(id, parsed.data);
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /ai/fashion-design/orders/:id/revision-upload
 * Admin/designer uploads revised design file URLs.
 * Returns order to "review" status for final approval.
 */
router.post("/ai/fashion-design/orders/:id/revision-upload", fashionDesignAuthGuard, adminAuth, async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    const schema = z.object({
      revisedFileUrls: z.array(z.string().url()).min(1).max(20),
      notes: z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const result = await uploadRevision(id, parsed.data);
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /ai/fashion-design/orders/:id/revisions
 * List all revisions for an order.
 * Admin: full access. Customer: must pass ?customerEmail= matching the order.
 */
router.get("/ai/fashion-design/orders/:id/revisions", async (req, res) => {
  try {
    const id = parseId(req.params["id"] as string);
    if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

    // Allow either admin key OR matching customerEmail query param
    const adminKey = req.headers["x-admin-api-key"] ?? req.headers["x-admin-key"];
    const isAdmin = typeof adminKey === "string" && adminKey === process.env["ADMIN_API_KEY"];

    if (!isAdmin) {
      const customerEmail = typeof req.query["customerEmail"] === "string" ? req.query["customerEmail"] : null;
      if (!customerEmail) {
        res.status(401).json({ error: "Provide x-admin-api-key header or ?customerEmail= query param" });
        return;
      }
      // Verify email against order
      const { getOrder: fetchOrder } = await import("../services/fashionDesignService.js");
      const order = await fetchOrder(id);
      if (!order) { res.status(404).json({ error: "Order not found" }); return; }
      if (order.customerEmail.toLowerCase() !== customerEmail.toLowerCase()) {
        res.status(403).json({ error: "Email tidak sesuai dengan data order" });
        return;
      }
    }

    const revisions = await listRevisions(id);
    res.json({ revisions });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
