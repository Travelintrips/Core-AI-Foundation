/**
 * WP-03A — Placement Engine Routes
 *
 * All routes are authenticated (admin key or session).
 * Tenant context is read ONLY from req.internalUser — never from the request body.
 *
 * Route prefix is relative to /api (mounted in app.ts).
 */

import { Router } from "express";
import { z } from "zod/v4";
import {
  createLayoutSession,
  getLayoutSession,
  listLayoutSessions,
  updateLayoutSession,
  archiveLayoutSession,
  restoreLayoutSession,
  softDeleteLayoutSession,
  createPlacement,
  getPlacement,
  listPlacements,
  updatePlacement,
  archivePlacement,
  deletePlacement,
  PlacementEngineError,
} from "../services/placementEngineService.js";
import type { Request, Response } from "express";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTenantId(req: Request): string {
  // In a real multi-tenant deployment, tenantId comes from the authenticated
  // session (internalUser.tenantId) or a trusted header set by the gateway.
  // For now we use internalUser.id as a stable per-user tenant scope.
  const user = req.internalUser as { id?: string; tenantId?: string } | undefined;
  const tenantId = user?.tenantId ?? user?.id;
  if (!tenantId) {
    throw new PlacementEngineError("Tenant context required.", "TENANT_REQUIRED", 401);
  }
  return tenantId;
}

function handleError(err: unknown, res: Response): void {
  if (err instanceof PlacementEngineError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error("[placement-engine] Unexpected error:", (err as Error).message ?? err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
}

// ── Validation schemas ────────────────────────────────────────────────────────

const createSessionSchema = z.object({
  name:            z.string().min(1).max(200),
  roomTemplateId:  z.string().uuid().nullable().optional(),
  widthCm:         z.number().positive().optional(),
  depthCm:         z.number().positive().optional(),
  heightCm:        z.number().positive().optional(),
  metadata:        z.record(z.unknown()).optional(),
}).strict();

const updateSessionSchema = z.object({
  name:     z.string().min(1).max(200).optional(),
  widthCm:  z.number().positive().optional(),
  depthCm:  z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

const createPlacementSchema = z.object({
  furnitureItemId:  z.string().uuid().nullable().optional(),
  label:            z.string().max(200).optional(),
  xCm:              z.number().finite(),
  yCm:              z.number().finite(),
  widthCm:          z.number().positive().finite(),
  depthCm:          z.number().positive().finite(),
  rotationDeg:      z.number().finite().optional(),
  anchorX:          z.number().min(0).max(1).optional(),
  anchorY:          z.number().min(0).max(1).optional(),
  clearanceFrontCm: z.number().nonnegative().optional(),
  clearanceSideCm:  z.number().nonnegative().optional(),
  clearanceBackCm:  z.number().nonnegative().optional(),
  metadata:         z.record(z.unknown()).optional(),
}).strict();

const updatePlacementSchema = z.object({
  label:            z.string().max(200).optional(),
  xCm:              z.number().finite().optional(),
  yCm:              z.number().finite().optional(),
  widthCm:          z.number().positive().finite().optional(),
  depthCm:          z.number().positive().finite().optional(),
  rotationDeg:      z.number().finite().optional(),
  anchorX:          z.number().min(0).max(1).optional(),
  anchorY:          z.number().min(0).max(1).optional(),
  clearanceFrontCm: z.number().nonnegative().optional(),
  clearanceSideCm:  z.number().nonnegative().optional(),
  clearanceBackCm:  z.number().nonnegative().optional(),
  metadata:         z.record(z.unknown()).optional(),
}).strict();

// ── Session routes ────────────────────────────────────────────────────────────

// GET /ai/layout-sessions
router.get("/ai/layout-sessions", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const q = req.query as Record<string, string | undefined>;
    const result = await listLayoutSessions(tenantId, {
      status:   q["status"],
      page:     q["page"]     ? parseInt(q["page"],     10) : undefined,
      pageSize: q["pageSize"] ? parseInt(q["pageSize"], 10) : undefined,
    });
    res.json(result);
  } catch (err) { handleError(err, res); }
});

// POST /ai/layout-sessions
router.post("/ai/layout-sessions", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } });
      return;
    }
    const createdBy = (req.internalUser as { email?: string } | undefined)?.email ?? "system";
    const session = await createLayoutSession({ ...parsed.data, tenantId, createdBy });
    res.status(201).json(session);
  } catch (err) { handleError(err, res); }
});

// GET /ai/layout-sessions/:sessionId
router.get("/ai/layout-sessions/:sessionId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const session = await getLayoutSession(req.params["sessionId"]!, tenantId);
    res.json(session);
  } catch (err) { handleError(err, res); }
});

// PATCH /ai/layout-sessions/:sessionId
router.patch("/ai/layout-sessions/:sessionId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } });
      return;
    }
    const session = await updateLayoutSession(req.params["sessionId"]!, tenantId, parsed.data);
    res.json(session);
  } catch (err) { handleError(err, res); }
});

// POST /ai/layout-sessions/:sessionId/archive
router.post("/ai/layout-sessions/:sessionId/archive", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const session = await archiveLayoutSession(req.params["sessionId"]!, tenantId);
    res.json({ id: session.id, status: session.status });
  } catch (err) { handleError(err, res); }
});

// POST /ai/layout-sessions/:sessionId/restore
router.post("/ai/layout-sessions/:sessionId/restore", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const session = await restoreLayoutSession(req.params["sessionId"]!, tenantId);
    res.json({ id: session.id, status: session.status });
  } catch (err) { handleError(err, res); }
});

// DELETE /ai/layout-sessions/:sessionId
router.delete("/ai/layout-sessions/:sessionId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    await softDeleteLayoutSession(req.params["sessionId"]!, tenantId);
    res.status(204).send();
  } catch (err) { handleError(err, res); }
});

// ── Placement routes ──────────────────────────────────────────────────────────

// GET /ai/layout-sessions/:sessionId/placements
router.get("/ai/layout-sessions/:sessionId/placements", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const includeArchived = req.query["includeArchived"] === "true";
    const placements = await listPlacements(req.params["sessionId"]!, tenantId, { includeArchived });
    res.json({ data: placements });
  } catch (err) { handleError(err, res); }
});

// POST /ai/layout-sessions/:sessionId/placements
router.post("/ai/layout-sessions/:sessionId/placements", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const parsed = createPlacementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } });
      return;
    }
    const placement = await createPlacement({
      ...parsed.data,
      sessionId: req.params["sessionId"]!,
      tenantId,
    });
    res.status(201).json(placement);
  } catch (err) { handleError(err, res); }
});

// GET /ai/layout-sessions/:sessionId/placements/:placementId
router.get("/ai/layout-sessions/:sessionId/placements/:placementId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const placement = await getPlacement(req.params["placementId"]!, req.params["sessionId"]!, tenantId);
    res.json(placement);
  } catch (err) { handleError(err, res); }
});

// PATCH /ai/layout-sessions/:sessionId/placements/:placementId
router.patch("/ai/layout-sessions/:sessionId/placements/:placementId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const parsed = updatePlacementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } });
      return;
    }
    const placement = await updatePlacement(req.params["placementId"]!, req.params["sessionId"]!, tenantId, parsed.data);
    res.json(placement);
  } catch (err) { handleError(err, res); }
});

// POST /ai/layout-sessions/:sessionId/placements/:placementId/archive
router.post("/ai/layout-sessions/:sessionId/placements/:placementId/archive", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const placement = await archivePlacement(req.params["placementId"]!, req.params["sessionId"]!, tenantId);
    res.json({ id: placement.id, isArchived: placement.isArchived });
  } catch (err) { handleError(err, res); }
});

// DELETE /ai/layout-sessions/:sessionId/placements/:placementId
router.delete("/ai/layout-sessions/:sessionId/placements/:placementId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    await deletePlacement(req.params["placementId"]!, req.params["sessionId"]!, tenantId);
    res.status(204).send();
  } catch (err) { handleError(err, res); }
});

export default router;
