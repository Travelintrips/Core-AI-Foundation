/**
 * WP-03B — Collision Engine Routes
 *
 * All endpoints are authenticated (admin key or session).
 * tenantId is resolved from req.internalUser — NEVER from request body.
 *
 * Route prefix is relative to /api (mounted in app.ts).
 */

import { Router } from "express";
import {
  wp03StatelessCheckSchema,
  uuidParamSchema,
  MAX_PLACEMENTS_PER_COLLISION_SESSION,
} from "@workspace/api-zod";
import {
  checkSessionCollisionsService,
  checkPlacementCollisionService,
  getSessionCollisionSummary,
  checkGeometryCollision,
} from "../services/collisionEngineService.js";
import { PlacementEngineError } from "../services/placementEngineService.js";
import type { Request, Response } from "express";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTenantId(req: Request): string {
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
  const msg = (err as Error).message ?? String(err);
  // Parse structured error codes from geometry engine throws
  if (typeof msg === "string" && msg.startsWith("PLACEMENT_")) {
    const code = msg.split(":")[0]?.trim() ?? "PLACEMENT_GEOMETRY_INVALID";
    res.status(400).json({ error: { code, message: msg.split(":").slice(1).join(":").trim() || msg } });
    return;
  }
  console.error("[collision-engine] Unexpected error:", msg);
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

// ── POST /ai/layout-sessions/:sessionId/collision-check ───────────────────────
// Check all active placements in a session.
// Enforces MAX_PLACEMENTS_PER_COLLISION_SESSION limit before DB query.

router.post("/ai/layout-sessions/:sessionId/collision-check", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const result = await checkSessionCollisionsService(sessionId, tenantId, MAX_PLACEMENTS_PER_COLLISION_SESSION);
    res.json(result);
  } catch (err) { handleError(err, res); }
});

// ── GET /ai/layout-sessions/:sessionId/collisions ────────────────────────────
// Get collision summary for a session.

router.get("/ai/layout-sessions/:sessionId/collisions", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
    if (sessionId === null) return;
    const result = await getSessionCollisionSummary(sessionId, tenantId);
    res.json(result);
  } catch (err) { handleError(err, res); }
});

// ── POST /ai/layout-sessions/:sessionId/placements/:placementId/collision-check

router.post(
  "/ai/layout-sessions/:sessionId/placements/:placementId/collision-check",
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const sessionId = validateUuidParam(req.params["sessionId"], "sessionId", res);
      if (sessionId === null) return;
      const placementId = validateUuidParam(req.params["placementId"], "placementId", res);
      if (placementId === null) return;
      const result = await checkPlacementCollisionService(
        sessionId,
        placementId,
        tenantId,
      );
      res.json(result);
    } catch (err) { handleError(err, res); }
  },
);

// ── POST /ai/collision/check — stateless pure geometry endpoint ───────────────
// No DB access. Caller provides all geometry inline.
// Limit enforced by wp03StatelessCheckSchema (.max(MAX_PLACEMENTS_PER_COLLISION_SESSION)).

router.post("/ai/collision/check", async (req, res) => {
  try {
    // tenantId required even for stateless check (auth layer must be authenticated)
    getTenantId(req);

    const parsed = wp03StatelessCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } });
      return;
    }

    const result = checkGeometryCollision(parsed.data.placements, parsed.data.room);
    res.json(result);
  } catch (err) { handleError(err, res); }
});

export default router;
