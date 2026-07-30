/**
 * WP-03A — Placement Engine Routes
 *
 * All routes are authenticated (admin key or session).
 * Tenant context is read ONLY from req.internalUser — never from the request body.
 *
 * Route prefix is relative to /api (mounted in app.ts).
 */

import { Router } from "express";
import {
  wp03CreateSessionSchema,
  wp03UpdateSessionSchema,
  wp03CreatePlacementSchema,
  wp03UpdatePlacementSchema,
  uuidParamSchema,
} from "@workspace/api-zod";
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

/** Validates a UUID path param and returns 400 if invalid, without touching the DB. */
function validateUuidParam(value: string | undefined, name: string, res: Response): string | null {
  const parsed = uuidParamSchema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "INVALID_UUID", message: `Invalid ${name}: must be a valid UUID.` } });
    return null;
  }
  return parsed.data;
}

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
    const parsed = wp03CreateSessionSchema.safeParse(req.body);
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
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const session = await getLayoutSession(sessionId, tenantId);
    res.json(session);
  } catch (err) { handleError(err, res); }
});

// PATCH /ai/layout-sessions/:sessionId
router.patch("/ai/layout-sessions/:sessionId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const parsed = wp03UpdateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } });
      return;
    }
    const session = await updateLayoutSession(sessionId, tenantId, parsed.data);
    res.json(session);
  } catch (err) { handleError(err, res); }
});

// POST /ai/layout-sessions/:sessionId/archive
router.post("/ai/layout-sessions/:sessionId/archive", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const session = await archiveLayoutSession(sessionId, tenantId);
    res.json({ id: session.id, status: session.status });
  } catch (err) { handleError(err, res); }
});

// POST /ai/layout-sessions/:sessionId/restore
router.post("/ai/layout-sessions/:sessionId/restore", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const session = await restoreLayoutSession(sessionId, tenantId);
    res.json({ id: session.id, status: session.status });
  } catch (err) { handleError(err, res); }
});

// DELETE /ai/layout-sessions/:sessionId
router.delete("/ai/layout-sessions/:sessionId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    await softDeleteLayoutSession(sessionId, tenantId);
    res.status(204).send();
  } catch (err) { handleError(err, res); }
});

// ── Placement routes ──────────────────────────────────────────────────────────

// GET /ai/layout-sessions/:sessionId/placements
router.get("/ai/layout-sessions/:sessionId/placements", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const includeArchived = req.query["includeArchived"] === "true";
    const placements = await listPlacements(sessionId, tenantId, { includeArchived });
    res.json({ data: placements });
  } catch (err) { handleError(err, res); }
});

// POST /ai/layout-sessions/:sessionId/placements
router.post("/ai/layout-sessions/:sessionId/placements", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const parsed = wp03CreatePlacementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } });
      return;
    }
    const placement = await createPlacement({
      ...parsed.data,
      sessionId,
      tenantId,
    });
    res.status(201).json(placement);
  } catch (err) { handleError(err, res); }
});

// GET /ai/layout-sessions/:sessionId/placements/:placementId
router.get("/ai/layout-sessions/:sessionId/placements/:placementId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const placementId = validateUuidParam(req.params["placementId"], "placementId", res);
    if (placementId === null) return;
    const placement = await getPlacement(placementId, sessionId, tenantId);
    res.json(placement);
  } catch (err) { handleError(err, res); }
});

// PATCH /ai/layout-sessions/:sessionId/placements/:placementId
router.patch("/ai/layout-sessions/:sessionId/placements/:placementId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const placementId = validateUuidParam(req.params["placementId"], "placementId", res);
    if (placementId === null) return;
    const parsed = wp03UpdatePlacementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } });
      return;
    }
    const placement = await updatePlacement(placementId, sessionId, tenantId, parsed.data);
    res.json(placement);
  } catch (err) { handleError(err, res); }
});

// POST /ai/layout-sessions/:sessionId/placements/:placementId/archive
router.post("/ai/layout-sessions/:sessionId/placements/:placementId/archive", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const placementId = validateUuidParam(req.params["placementId"], "placementId", res);
    if (placementId === null) return;
    const placement = await archivePlacement(placementId, sessionId, tenantId);
    res.json({ id: placement.id, isArchived: placement.isArchived });
  } catch (err) { handleError(err, res); }
});

// DELETE /ai/layout-sessions/:sessionId/placements/:placementId
router.delete("/ai/layout-sessions/:sessionId/placements/:placementId", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const placementId = validateUuidParam(req.params["placementId"], "placementId", res);
    if (placementId === null) return;
    await deletePlacement(placementId, sessionId, tenantId);
    res.status(204).send();
  } catch (err) { handleError(err, res); }
});

export default router;
