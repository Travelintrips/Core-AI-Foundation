// ============================================================
// TEAM 12 — Layout Composer Routes
// Mount point: /ai/layout-composer  (Team 24 wires this)
//
// AUTH: adminAuth is applied explicitly at the router level for
//       all mutation/composition endpoints. This makes the module
//       self-contained when Team 24 mounts it — auth is not
//       delegated to a surrounding app.use() call.
//       GET /operations is read-only static data and is exempt.
//
// ROUTE COLLISION AUDIT (P1):
//   Existing /ai/canvas routes live in design-studio.ts:
//     GET /ai/design/projects/:id/canvas
//     PUT /ai/design/projects/:id/canvas
//   Our prefix /ai/layout-composer/* does NOT collide.
//   Documented in integration/manifests/team-12.json.
//   Final mount path determined by Team 24.
// ============================================================

import { Router, type Request, type Response, type NextFunction } from "express";
import { adminAuth } from "../../middleware/adminAuth.js";
import {
  composeLayout,
  validateLayout,
  generateOperationPlan,
  getSupportedOperations,
} from "../../services/layout-composer/index.js";
import { prevalidateRequest } from "../../services/layout-composer/prevalidation.js";
import { LAYOUT_LIMITS } from "../../services/layout-composer/constants.js";
import type {
  LayoutRequest,
  ValidateRequest,
} from "../../types/layout-composer/index.js";

const router = Router();

// ── P0: Payload size pre-check ────────────────────────────────
// The global app.use() parses JSON with a 10 MB limit. We enforce
// a tighter 512 KB domain limit via Content-Length header before
// the solver sees any data.
router.use((req: Request, res: Response, next: NextFunction): void => {
  const cl = Number(req.headers["content-length"] ?? 0);
  if (cl > LAYOUT_LIMITS.MAX_PAYLOAD_BYTES) {
    res.status(413).json({
      error: `Payload too large. Maximum ${Math.floor(LAYOUT_LIMITS.MAX_PAYLOAD_BYTES / 1024)} KB allowed.`,
    });
    return;
  }
  next();
});

// ── Helper: shared input validation ──────────────────────────
// Returns false and sends a 400/422 response if validation fails.
// Returns true if the caller should continue processing.
function validateSolveInput(
  body: Partial<LayoutRequest>,
  res: Response,
): boolean {
  if (!body.canvas || !body.elements || !body.constraints) {
    res.status(400).json({
      error: "Missing required fields: canvas, elements, constraints",
    });
    return false;
  }
  if (!Number.isFinite(body.canvas.width) || body.canvas.width <= 0) {
    res.status(400).json({ error: "canvas.width must be a positive number" });
    return false;
  }
  if (!Number.isFinite(body.canvas.height) || body.canvas.height <= 0) {
    res.status(400).json({ error: "canvas.height must be a positive number" });
    return false;
  }
  if (body.canvas.width > LAYOUT_LIMITS.MAX_CANVAS_DIM || body.canvas.height > LAYOUT_LIMITS.MAX_CANVAS_DIM) {
    res.status(400).json({
      error: `canvas dimensions must not exceed ${LAYOUT_LIMITS.MAX_CANVAS_DIM}px`,
    });
    return false;
  }
  if (!Array.isArray(body.elements)) {
    res.status(400).json({ error: "elements must be an array" });
    return false;
  }
  if (!Array.isArray(body.constraints)) {
    res.status(400).json({ error: "constraints must be an array" });
    return false;
  }
  if (body.elements.length > LAYOUT_LIMITS.MAX_ELEMENTS) {
    res.status(400).json({
      error: `elements must not exceed ${LAYOUT_LIMITS.MAX_ELEMENTS} items`,
    });
    return false;
  }
  if (body.constraints.length > LAYOUT_LIMITS.MAX_CONSTRAINTS) {
    res.status(400).json({
      error: `constraints must not exceed ${LAYOUT_LIMITS.MAX_CONSTRAINTS} items`,
    });
    return false;
  }
  if (body.zones && body.zones.length > LAYOUT_LIMITS.MAX_ZONES) {
    res.status(400).json({
      error: `zones must not exceed ${LAYOUT_LIMITS.MAX_ZONES} items`,
    });
    return false;
  }

  // Unique element IDs
  const ids = body.elements.map((e) => e.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    res.status(400).json({ error: "Element ids must be unique" });
    return false;
  }

  // P2: structural pre-validation (cyclic refs, unknown IDs, duplicate constraints)
  const precheck = prevalidateRequest(body.elements, body.constraints);
  if (!precheck.valid) {
    res.status(422).json({
      error: "Layout request failed pre-validation",
      details: precheck.errors,
    });
    return false;
  }

  return true;
}

// ── GET /ai/layout-composer/operations ───────────────────────
// Read-only static list — no auth required.
router.get(
  "/ai/layout-composer/operations",
  (_req: Request, res: Response): void => {
    res.json({ operations: getSupportedOperations() });
  }
);

// ── POST /ai/layout-composer/solve ───────────────────────────
// Mutation: requires adminAuth explicitly at router level.
router.post(
  "/ai/layout-composer/solve",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Partial<LayoutRequest>;

    if (!validateSolveInput(body, res)) return;

    const request: LayoutRequest = {
      id: body.id,
      canvas: body.canvas!,
      elements: body.elements!,
      constraints: body.constraints!,
      zones: body.zones,
      maxIterations:
        typeof body.maxIterations === "number"
          ? Math.min(body.maxIterations, LAYOUT_LIMITS.MAX_ITERATIONS)
          : undefined,
      includeResponsive: body.includeResponsive ?? false,
    };

    const plan = await composeLayout(request);
    res.status(200).json(plan);
  }
);

// ── POST /ai/layout-composer/validate ────────────────────────
// Mutation: requires adminAuth explicitly at router level.
router.post(
  "/ai/layout-composer/validate",
  adminAuth,
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
    if (body.elements.length > LAYOUT_LIMITS.MAX_ELEMENTS) {
      res.status(400).json({
        error: `elements must not exceed ${LAYOUT_LIMITS.MAX_ELEMENTS} items`,
      });
      return;
    }
    if (body.constraints.length > LAYOUT_LIMITS.MAX_CONSTRAINTS) {
      res.status(400).json({
        error: `constraints must not exceed ${LAYOUT_LIMITS.MAX_CONSTRAINTS} items`,
      });
      return;
    }
    if (body.zones && body.zones.length > LAYOUT_LIMITS.MAX_ZONES) {
      res.status(400).json({
        error: `zones must not exceed ${LAYOUT_LIMITS.MAX_ZONES} items`,
      });
      return;
    }

    // P2: pre-validation
    const precheck = prevalidateRequest(body.elements, body.constraints);
    if (!precheck.valid) {
      res.status(422).json({
        error: "Layout request failed pre-validation",
        details: precheck.errors,
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
// Mutation: requires adminAuth explicitly at router level.
router.post(
  "/ai/layout-composer/plan",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Partial<LayoutRequest>;

    if (!validateSolveInput(body, res)) return;

    const plan = await generateOperationPlan({
      canvas: body.canvas!,
      elements: body.elements!,
      constraints: body.constraints!,
      zones: body.zones,
      maxIterations:
        typeof body.maxIterations === "number"
          ? Math.min(body.maxIterations, LAYOUT_LIMITS.MAX_ITERATIONS)
          : undefined,
    });

    res.status(200).json(plan);
  }
);

export default router;
