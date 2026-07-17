/**
 * packaging-design.ts — Team 19: Packaging Design Domain Routes
 *
 * Admin routes (x-admin-api-key via global adminAuthWithExceptions):
 *   GET    /ai/packaging-design/orders              list / filter
 *   POST   /ai/packaging-design/orders              create
 *   GET    /ai/packaging-design/orders/:id          get one (with variants + last validation)
 *   PATCH  /ai/packaging-design/orders/:id          update fields
 *   DELETE /ai/packaging-design/orders/:id          soft delete
 *   PATCH  /ai/packaging-design/orders/:id/status   transition status
 *   POST   /ai/packaging-design/orders/:id/validate run prepress validation
 *   GET    /ai/packaging-design/orders/:id/variants list variants
 *   POST   /ai/packaging-design/orders/:id/variants add variant
 *   PATCH  /ai/packaging-design/variants/:vid       update variant
 *   DELETE /ai/packaging-design/variants/:vid       archive variant
 *   GET    /ai/packaging-design/analytics           dashboard stats
 *
 * Public routes (no auth):
 *   POST   /public/packaging-design/submit          customer order submission
 *   GET    /public/packaging-design/orders/:orderId track by UUID
 */

import { Router, type Request, type Response } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import * as svc from "../domains/packaging-design/packagingDesignService.js";
import { REGULATED_SERVICE_TYPES, PACKAGING_SERVICE_TYPES } from "../domains/packaging-design/schema.js";

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

function intParam(req: Request, key: string): number | null {
  const raw = req.params[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return isNaN(n) ? null : n;
}

function statusLabels(): Record<string, string> {
  return {
    draft:               "Draft",
    submitted:           "Dikirim",
    in_review:           "Sedang Ditinjau",
    design_in_progress:  "Desain Berlangsung",
    prepress_validation: "Validasi Prepress",
    revision_requested:  "Perlu Revisi",
    print_ready:         "Siap Cetak",
    completed:           "Selesai",
    cancelled:           "Dibatalkan",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Orders
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design/orders",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, serviceType, email, limit, offset } = req.query as Record<string, string>;
      const result = await svc.listOrders({
        status,
        serviceType,
        email,
        limit:  limit  ? parseInt(limit, 10)  : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Failed to list orders", details: String(err) });
    }
  },
);

router.post(
  "/ai/packaging-design/orders",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { serviceType, customerName, customerEmail, brandName, productName } = req.body as Record<string, unknown>;
      if (!serviceType || !customerName || !customerEmail || !brandName || !productName) {
        res.status(400).json({ error: "serviceType, customerName, customerEmail, brandName, productName are required" });
        return;
      }
      if (!(PACKAGING_SERVICE_TYPES as readonly string[]).includes(String(serviceType))) {
        res.status(400).json({ error: `Invalid serviceType. Must be one of: ${PACKAGING_SERVICE_TYPES.join(", ")}` });
        return;
      }
      const order = await svc.createOrder(req.body as svc.CreateOrderInput);
      res.status(201).json(order);
    } catch (err) {
      res.status(500).json({ error: "Failed to create order", details: String(err) });
    }
  },
);

router.get(
  "/ai/packaging-design/orders/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = intParam(req, "id");
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      const [order, variants] = await Promise.all([
        svc.getOrderById(id),
        svc.listVariants(id),
      ]);
      if (!order) { res.status(404).json({ error: "Order not found" }); return; }
      res.json({ ...order, variants, lastValidation: order.prepressValidationJson ?? null });
    } catch (err) {
      res.status(500).json({ error: "Failed to get order", details: String(err) });
    }
  },
);

router.patch(
  "/ai/packaging-design/orders/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = intParam(req, "id");
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      // Prevent patching protected fields
      const { status: _s, orderId: _oid, id: _id, createdAt: _ca, deletedAt: _da, ...patch } = req.body as Record<string, unknown>;
      const updated = await svc.updateOrder(id, patch as Parameters<typeof svc.updateOrder>[1]);
      if (!updated) { res.status(404).json({ error: "Order not found" }); return; }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: "Failed to update order", details: String(err) });
    }
  },
);

router.delete(
  "/ai/packaging-design/orders/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = intParam(req, "id");
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      const deleted = await svc.softDeleteOrder(id);
      if (!deleted) { res.status(404).json({ error: "Order not found" }); return; }
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: "Failed to delete order", details: String(err) });
    }
  },
);

router.patch(
  "/ai/packaging-design/orders/:id/status",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = intParam(req, "id");
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const { status, notes } = req.body as { status?: string; notes?: string };
    if (!status) { res.status(400).json({ error: "status is required" }); return; }
    try {
      const result = await svc.updateOrderStatus(id, status, notes);
      if (!result.ok) {
        // Use 409 for print-ready guard violations, 400 for others
        const isGuard = result.error?.includes("print_ready") || result.error?.includes("validation") || result.error?.includes("variant");
        res.status(isGuard ? 409 : 400).json({ error: result.error });
        return;
      }
      res.json(result.order);
    } catch (err) {
      res.status(500).json({ error: "Failed to update status", details: String(err) });
    }
  },
);

router.post(
  "/ai/packaging-design/orders/:id/validate",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = intParam(req, "id");
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      const order = await svc.getOrderById(id);
      if (!order) { res.status(404).json({ error: "Order not found" }); return; }
      const { runBy, notes } = req.body as { runBy?: string; notes?: string };
      const result = await svc.runPrepressValidation(order, runBy ?? "admin", notes);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Validation run failed", details: String(err) });
    }
  },
);

// ── Admin: Variants ───────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design/orders/:id/variants",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = intParam(req, "id");
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      const variants = await svc.listVariants(id);
      res.json(variants);
    } catch (err) {
      res.status(500).json({ error: "Failed to list variants", details: String(err) });
    }
  },
);

router.post(
  "/ai/packaging-design/orders/:id/variants",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = intParam(req, "id");
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const { variantName } = req.body as { variantName?: string };
    if (!variantName) { res.status(400).json({ error: "variantName is required" }); return; }
    try {
      const variant = await svc.addVariant(id, req.body as Parameters<typeof svc.addVariant>[1]);
      res.status(201).json(variant);
    } catch (err) {
      res.status(500).json({ error: "Failed to add variant", details: String(err) });
    }
  },
);

router.patch(
  "/ai/packaging-design/variants/:vid",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const vid = intParam(req, "vid");
    if (!vid) { res.status(400).json({ error: "Invalid variant id" }); return; }
    try {
      const updated = await svc.updateVariant(vid, req.body as Parameters<typeof svc.updateVariant>[1]);
      if (!updated) { res.status(404).json({ error: "Variant not found" }); return; }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: "Failed to update variant", details: String(err) });
    }
  },
);

router.delete(
  "/ai/packaging-design/variants/:vid",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const vid = intParam(req, "vid");
    if (!vid) { res.status(400).json({ error: "Invalid variant id" }); return; }
    try {
      const archived = await svc.archiveVariant(vid);
      if (!archived) { res.status(404).json({ error: "Variant not found" }); return; }
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: "Failed to archive variant", details: String(err) });
    }
  },
);

// ── Admin: Analytics ──────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design/analytics",
  adminAuth,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const analytics = await svc.getAnalytics();
      res.json(analytics);
    } catch (err) {
      res.status(500).json({ error: "Failed to get analytics", details: String(err) });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Public: Customer-facing
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/public/packaging-design/submit",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as Record<string, unknown>;
      const required = ["serviceType", "customerName", "customerEmail", "brandName", "productName"] as const;
      for (const field of required) {
        if (!body[field]) {
          res.status(400).json({ error: `${field} is required` });
          return;
        }
      }

      const serviceType = String(body.serviceType ?? "");
      if (!(PACKAGING_SERVICE_TYPES as readonly string[]).includes(serviceType)) {
        res.status(400).json({
          error: `Invalid serviceType. Supported: ${PACKAGING_SERVICE_TYPES.join(", ")}`,
        });
        return;
      }

      // Validate mandatory info for regulated types
      const isRegulated = (REGULATED_SERVICE_TYPES as readonly string[]).includes(serviceType);
      if (isRegulated) {
        if (!body.hasIngredientsBlock || !body.hasLegalBlock) {
          res.status(400).json({
            error: `Service type '${serviceType}' requires hasIngredientsBlock and hasLegalBlock to be true.`,
          });
          return;
        }
      }

      const order = await svc.createOrder({
        ...body,
        serviceType,
        customerName: String(body.customerName),
        customerEmail: String(body.customerEmail),
        brandName: String(body.brandName),
        productName: String(body.productName),
        briefJson: { source: "customer_portal", ...body },
        status: "submitted",
      } as svc.CreateOrderInput);

      // Immediately set status to submitted for customer-initiated orders
      await svc.updateOrderStatus(order.id, "submitted");

      res.status(201).json({
        ok: true,
        orderId: order.orderId,
        message: "Pesanan desain kemasan Anda berhasil dikirim. Kami akan menghubungi Anda segera.",
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to submit order", details: String(err) });
    }
  },
);

router.get(
  "/public/packaging-design/orders/:orderId",
  async (req: Request, res: Response): Promise<void> => {
    const orderIdRaw = req.params["orderId"];
    const orderId = Array.isArray(orderIdRaw) ? orderIdRaw[0] : orderIdRaw;
    if (!orderId) { res.status(400).json({ error: "orderId is required" }); return; }
    try {
      const order = await svc.getOrderByOrderId(orderId);
      if (!order) { res.status(404).json({ error: "Order not found" }); return; }

      const labels = statusLabels();
      res.json({
        orderId: order.orderId,
        brandName: order.brandName,
        productName: order.productName,
        serviceType: order.serviceType,
        status: order.status,
        statusLabel: labels[order.status] ?? order.status,
        isPrintReady: !!order.printReadyAt,
        completionNotes: order.completionNotes ?? null,
        deliverableLinks: order.deliverableLinks ?? [],
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to track order", details: String(err) });
    }
  },
);

export default router;
