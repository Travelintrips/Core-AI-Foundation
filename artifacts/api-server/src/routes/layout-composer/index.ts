// ============================================================
// TEAM 12 — Layout Composer Routes
// Mount point: /ai/layout-composer  (Team 24 wires this)
//
// Auth: covered globally by adminAuthWithExceptions in app.ts.
//       All /api/* routes require ADMIN_API_KEY — no per-route
//       middleware needed per the canonical admin-auth pattern.
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

// ── Resource caps (P0 — DoS prevention) ──────────────────────
const MAX_ELEMENTS = 500;
const MAX_CONSTRAINTS = 200;
const MAX_ZONES = 100;
const MAX_CANVAS_DIM = 10_000;   // px
const MAX_ITERATIONS_ALLOWED = 100;

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
    if (body.canvas.width > MAX_CANVAS_DIM || body.canvas.height > MAX_CANVAS_DIM) {
      res.status(400).json({ error: `canvas dimensions must not exceed ${MAX_CANVAS_DIM}px` });
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
    if (body.elements.length > MAX_ELEMENTS) {
      res.status(400).json({ error: `elements must not exceed ${MAX_ELEMENTS} items` });
      return;
    }
    if (body.constraints.length > MAX_CONSTRAINTS) {
      res.status(400).json({ error: `constraints must not exceed ${MAX_CONSTRAINTS} items` });
      return;
    }
    if (body.zones && body.zones.length > MAX_ZONES) {
      res.status(400).json({ error: `zones must not exceed ${MAX_ZONES} items` });
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
      maxIterations: typeof body.maxIterations === "number"
        ? Math.min(body.maxIterations, MAX_ITERATIONS_ALLOWED)
        : undefined,
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
    if (!Array.isArray(body.elements)) {
      res.status(400).json({ error: "elements must be an array" });
      return;
    }
    if (!Array.isArray(body.constraints)) {
      res.status(400).json({ error: "constraints must be an array" });
      return;
    }
    if (body.elements.length > MAX_ELEMENTS) {
      res.status(400).json({ error: `elements must not exceed ${MAX_ELEMENTS} items` });
      return;
    }
    if (body.constraints.length > MAX_CONSTRAINTS) {
      res.status(400).json({ error: `constraints must not exceed ${MAX_CONSTRAINTS} items` });
      return;
    }
    if (body.zones && body.zones.length > MAX_ZONES) {
      res.status(400).json({ error: `zones must not exceed ${MAX_ZONES} items` });
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
    if (!Array.isArray(body.elements)) {
      res.status(400).json({ error: "elements must be an array" });
      return;
    }
    if (!Array.isArray(body.constraints)) {
      res.status(400).json({ error: "constraints must be an array" });
      return;
    }
    if (body.elements.length > MAX_ELEMENTS) {
      res.status(400).json({ error: `elements must not exceed ${MAX_ELEMENTS} items` });
      return;
    }
    if (body.constraints.length > MAX_CONSTRAINTS) {
      res.status(400).json({ error: `constraints must not exceed ${MAX_CONSTRAINTS} items` });
      return;
    }
    if (body.zones && body.zones.length > MAX_ZONES) {
      res.status(400).json({ error: `zones must not exceed ${MAX_ZONES} items` });
      return;
    }

    const plan = await generateOperationPlan({
      canvas: body.canvas,
      elements: body.elements,
      constraints: body.constraints,
      zones: body.zones,
      maxIterations: typeof body.maxIterations === "number"
        ? Math.min(body.maxIterations, MAX_ITERATIONS_ALLOWED)
        : undefined,
    });

    res.status(200).json(plan);
  }
);

export default router;
