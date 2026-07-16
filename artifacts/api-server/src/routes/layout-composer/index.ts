// ============================================================
// TEAM 12 — Layout Composer Routes
// Mount point: /ai/layout-composer  (Team 24 wires this)
// ============================================================

import { Router, type Request, type Response } from "express";
import {
  composeLayout,
  validateLayout,
  generateOperationPlan,
  getSupportedOperations,
} from "../../services/layout-composer/index.js";
import type {
  LayoutRequest,
  ValidateRequest,
} from "../../types/layout-composer/index.js";

const router = Router();

// ── GET /ai/layout-composer/operations ───────────────────────
// List all supported layout operation types
router.get(
  "/ai/layout-composer/operations",
  async (_req: Request, res: Response): Promise<void> => {
    res.json({ operations: getSupportedOperations() });
  }
);

// ── POST /ai/layout-composer/solve ────────────────────────────
// Run the constraint solver; returns a full LayoutPlan
router.post(
  "/ai/layout-composer/solve",
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Partial<LayoutRequest>;

    if (!body.canvas || !body.elements || !body.constraints) {
      res.status(400).json({
        error: "Missing required fields: canvas, elements, constraints",
      });
      return;
    }

    if (!Number.isFinite(body.canvas.width) || body.canvas.width <= 0) {
      res.status(400).json({ error: "canvas.width must be a positive number" });
      return;
    }
    if (!Number.isFinite(body.canvas.height) || body.canvas.height <= 0) {
      res.status(400).json({ error: "canvas.height must be a positive number" });
      return;
    }
    if (!Array.isArray(body.elements)) {
      res.status(400).json({ error: "elements must be an array" });
      return;
    }
    if (!Array.isArray(body.constraints)) {
      res.status(400).json({ error: "constraints must be an array" });
      return;
    }

    // Validate element ids are unique
    const ids = body.elements.map((e) => e.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      res.status(400).json({ error: "Element ids must be unique" });
      return;
    }

    const request: LayoutRequest = {
      id: body.id,
      canvas: body.canvas,
      elements: body.elements,
      constraints: body.constraints,
      zones: body.zones,
      maxIterations: typeof body.maxIterations === "number" ? Math.min(body.maxIterations, 200) : undefined,
      includeResponsive: body.includeResponsive ?? false,
    };

    const plan = await composeLayout(request);
    res.status(200).json(plan);
  }
);

// ── POST /ai/layout-composer/validate ────────────────────────
// Validate constraints against current element positions (no solving)
router.post(
  "/ai/layout-composer/validate",
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Partial<ValidateRequest>;

    if (!body.canvas || !body.elements || !body.constraints) {
      res.status(400).json({
        error: "Missing required fields: canvas, elements, constraints",
      });
      return;
    }

    const result = validateLayout({
      canvas: body.canvas,
      elements: body.elements,
      constraints: body.constraints,
      zones: body.zones,
    });

    res.status(200).json(result);
  }
);

// ── POST /ai/layout-composer/plan ────────────────────────────
// Dry-run: return only the operation list, no full plan
router.post(
  "/ai/layout-composer/plan",
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Partial<LayoutRequest>;

    if (!body.canvas || !body.elements || !body.constraints) {
      res.status(400).json({
        error: "Missing required fields: canvas, elements, constraints",
      });
      return;
    }

    const plan = await generateOperationPlan({
      canvas: body.canvas,
      elements: body.elements,
      constraints: body.constraints,
      zones: body.zones,
      maxIterations: typeof body.maxIterations === "number" ? Math.min(body.maxIterations, 200) : undefined,
    });

    res.status(200).json(plan);
  }
);

export default router;
