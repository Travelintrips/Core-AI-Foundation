/**
 * WP-03A — Placement Engine Routes (v2 rebuild)
 *
 * All endpoints require admin auth (x-admin-api-key).
 * No public routes. No collision routes. No publish routes. No undo/redo.
 *
 * Session endpoints:
 *   POST   /ai/layout-sessions
 *   GET    /ai/layout-sessions
 *   GET    /ai/layout-sessions/:sessionId
 *   PATCH  /ai/layout-sessions/:sessionId
 *   POST   /ai/layout-sessions/:sessionId/archive
 *   POST   /ai/layout-sessions/:sessionId/restore
 *
 * Placement endpoints:
 *   POST   /ai/layout-sessions/:sessionId/placements
 *   GET    /ai/layout-sessions/:sessionId/placements
 *   GET    /ai/layout-sessions/:sessionId/placements/:placementId
 *   PATCH  /ai/layout-sessions/:sessionId/placements/:placementId
 *   DELETE /ai/layout-sessions/:sessionId/placements/:placementId
 *   POST   /ai/layout-sessions/:sessionId/placements/:placementId/restore
 *   POST   /ai/layout-sessions/:sessionId/placements/:placementId/duplicate
 *
 * Route paths are relative to the /api prefix in app.ts.
 * No raw SQL errors surfaced. Trigger text is mapped by service layer.
 */

import { Router } from "express";
import { z } from "zod/v4";
import {
  createSession,
  getSession,
  listSessions,
  updateSession,
  archiveSession,
  restoreSession,
  createPlacement,
  getPlacement,
  listPlacements,
  movePlacement,
  rotatePlacement,
  duplicatePlacement,
  archivePlacement,
  restorePlacement,
  serializeSession,
  serializePlacement,
  PlacementEngineError,
} from "../services/placementEngineService.js";

const router = Router();

// ── Error handler ─────────────────────────────────────────────────────────────

function handleError(err: unknown, res: import("express").Response): void {
  if (err instanceof PlacementEngineError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  // Map common Postgres error codes
  const pgErr = err as { code?: string; message?: string };
  if (pgErr.code === "23505") {
    res.status(409).json({ error: "A record with that identifier already exists.", code: "CONFLICT" });
    return;
  }
  if (pgErr.code === "23503") {
    res.status(400).json({ error: "Referenced record does not exist.", code: "FK_VIOLATION" });
    return;
  }
  // Never surface raw SQL trigger text
  console.error("[placement-engine] Unexpected error:", err);
  res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createSessionSchema = z.object({
  tenantId:       z.string().uuid().nullable().optional(),
  roomTemplateId: z.string().uuid().nullable().optional(),
  name:           z.string().min(1).max(200),
  coordinateUnit: z.string().max(20).optional(),
  roomWidthCm:    z.number().positive(),
  roomLengthCm:   z.number().positive(),
  metadata:       z.record(z.unknown()).optional(),
  createdBy:      z.string().max(100).optional(),
});

const updateSessionSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  roomWidthCm: z.number().positive().optional(),
  roomLengthCm: z.number().positive().optional(),
  metadata:    z.record(z.unknown()).optional(),
});

const createPlacementSchema = z.object({
  tenantId:        z.string().uuid().nullable().optional(),
  furnitureItemId: z.string().uuid(),
  xCm:             z.number().optional(),
  yCm:             z.number().optional(),
  widthCm:         z.number().positive(),
  depthCm:         z.number().positive(),
  heightCm:        z.number().positive(),
  rotationDeg:     z.number().min(0).optional(),
  anchorType:      z.enum(["none", "wall", "corner", "item"]).optional(),
  anchorData:      z.record(z.unknown()).optional(),
  snapType:        z.enum(["none", "grid", "wall", "corner", "item_anchor"]).optional(),
  snapData:        z.record(z.unknown()).optional(),
  metadata:        z.record(z.unknown()).optional(),
  createdBy:       z.string().max(100).optional(),
});

const patchPlacementSchema = z.object({
  xCm:         z.number().optional(),
  yCm:         z.number().optional(),
  rotationDeg: z.number().min(0).optional(),
  widthCm:     z.number().positive().optional(),
  depthCm:     z.number().positive().optional(),
  heightCm:    z.number().positive().optional(),
  anchorType:  z.enum(["none", "wall", "corner", "item"]).optional(),
  anchorData:  z.record(z.unknown()).optional(),
  snapType:    z.enum(["none", "grid", "wall", "corner", "item_anchor"]).optional(),
  snapData:    z.record(z.unknown()).optional(),
  metadata:    z.record(z.unknown()).optional(),
});

// ── Session routes ─────────────────────────────────────────────────────────────

// POST /ai/layout-sessions
router.post("/ai/layout-sessions", async (req, res) => {
  try {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
      return;
    }
    const session = await createSession(parsed.data);
    res.status(201).json({ session: serializeSession(session) });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /ai/layout-sessions
router.get("/ai/layout-sessions", async (req, res) => {
  try {
    const { tenantId, status, search, limit, offset } = req.query as Record<string, string | undefined>;
    const filter: Parameters<typeof listSessions>[0] = {};
    if (tenantId !== undefined) filter.tenantId = tenantId === "null" ? null : tenantId;
    if (status === "active" || status === "archived") filter.status = status;
    if (search) filter.search = search;
    if (limit) filter.limit = Math.min(parseInt(limit, 10) || 50, 200);
    if (offset) filter.offset = parseInt(offset, 10) || 0;

    const { sessions, total } = await listSessions(filter);
    res.json({
      sessions: sessions.map(serializeSession),
      total,
      limit: filter.limit ?? 50,
      offset: filter.offset ?? 0,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /ai/layout-sessions/:sessionId
router.get("/ai/layout-sessions/:sessionId", async (req, res) => {
  try {
    const session = await getSession(req.params["sessionId"] as string);
    res.json({ session: serializeSession(session) });
  } catch (err) {
    handleError(err, res);
  }
});

// PATCH /ai/layout-sessions/:sessionId
router.patch("/ai/layout-sessions/:sessionId", async (req, res) => {
  try {
    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
      return;
    }
    const session = await updateSession(req.params["sessionId"] as string, parsed.data);
    res.json({ session: serializeSession(session) });
  } catch (err) {
    handleError(err, res);
  }
});

// POST /ai/layout-sessions/:sessionId/archive
router.post("/ai/layout-sessions/:sessionId/archive", async (req, res) => {
  try {
    const session = await archiveSession(req.params["sessionId"] as string);
    res.json({ session: serializeSession(session) });
  } catch (err) {
    handleError(err, res);
  }
});

// POST /ai/layout-sessions/:sessionId/restore
router.post("/ai/layout-sessions/:sessionId/restore", async (req, res) => {
  try {
    const session = await restoreSession(req.params["sessionId"] as string);
    res.json({ session: serializeSession(session) });
  } catch (err) {
    handleError(err, res);
  }
});

// ── Placement routes ───────────────────────────────────────────────────────────

// POST /ai/layout-sessions/:sessionId/placements
router.post("/ai/layout-sessions/:sessionId/placements", async (req, res) => {
  try {
    const parsed = createPlacementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
      return;
    }
    const placement = await createPlacement(req.params["sessionId"] as string, parsed.data);
    res.status(201).json({ placement: serializePlacement(placement) });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /ai/layout-sessions/:sessionId/placements
router.get("/ai/layout-sessions/:sessionId/placements", async (req, res) => {
  try {
    const { includeArchived, limit, offset } = req.query as Record<string, string | undefined>;
    const filter: Parameters<typeof listPlacements>[1] = {};
    if (includeArchived === "true") filter.includeArchived = true;
    if (limit) filter.limit = Math.min(parseInt(limit, 10) || 200, 1000);
    if (offset) filter.offset = parseInt(offset, 10) || 0;

    const { placements, total } = await listPlacements(req.params["sessionId"] as string, filter);
    res.json({
      placements: placements.map(serializePlacement),
      total,
      limit: filter.limit ?? 200,
      offset: filter.offset ?? 0,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /ai/layout-sessions/:sessionId/placements/:placementId
router.get(
  "/ai/layout-sessions/:sessionId/placements/:placementId",
  async (req, res) => {
    try {
      const placement = await getPlacement(
        req.params["sessionId"] as string,
        req.params["placementId"] as string,
      );
      res.json({ placement: serializePlacement(placement) });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// PATCH /ai/layout-sessions/:sessionId/placements/:placementId
router.patch(
  "/ai/layout-sessions/:sessionId/placements/:placementId",
  async (req, res) => {
    try {
      const parsed = patchPlacementSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
        return;
      }
      const { xCm, yCm, rotationDeg, snapType, snapData, ...rest } = parsed.data;
      const sessionId = req.params["sessionId"] as string;
      const placementId = req.params["placementId"] as string;

      let placement = await getPlacement(sessionId, placementId);

      // Apply move if position changed
      if (xCm !== undefined || yCm !== undefined) {
        placement = await movePlacement(sessionId, placementId, {
          xCm: xCm ?? Number(placement.xCm),
          yCm: yCm ?? Number(placement.yCm),
          snapType: snapType ?? undefined,
          snapData: snapData ?? undefined,
        });
      }
      // Apply rotate if rotation changed
      if (rotationDeg !== undefined) {
        placement = await rotatePlacement(sessionId, placementId, { rotationDeg });
      }

      res.json({ placement: serializePlacement(placement) });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// DELETE /ai/layout-sessions/:sessionId/placements/:placementId
router.delete(
  "/ai/layout-sessions/:sessionId/placements/:placementId",
  async (req, res) => {
    try {
      const placement = await archivePlacement(
        req.params["sessionId"] as string,
        req.params["placementId"] as string,
      );
      res.json({ placement: serializePlacement(placement) });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST /ai/layout-sessions/:sessionId/placements/:placementId/restore
router.post(
  "/ai/layout-sessions/:sessionId/placements/:placementId/restore",
  async (req, res) => {
    try {
      const placement = await restorePlacement(
        req.params["sessionId"] as string,
        req.params["placementId"] as string,
      );
      res.json({ placement: serializePlacement(placement) });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST /ai/layout-sessions/:sessionId/placements/:placementId/duplicate
router.post(
  "/ai/layout-sessions/:sessionId/placements/:placementId/duplicate",
  async (req, res) => {
    try {
      const placement = await duplicatePlacement(
        req.params["sessionId"] as string,
        req.params["placementId"] as string,
      );
      res.status(201).json({ placement: serializePlacement(placement) });
    } catch (err) {
      handleError(err, res);
    }
  },
);

export default router;
