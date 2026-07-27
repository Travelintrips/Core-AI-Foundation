/**
 * WP-01 — Room Template Library Routes
 *
 * Endpoints implemented:
 *   A1. GET  /ai/room-templates               — list (admin)
 *   A2. GET  /ai/room-templates/:id           — get one (admin)
 *   A3. POST /ai/room-templates               — create (admin)
 *   A4. POST /ai/room-templates/:id/publish   — publish (admin)
 *   A5. POST /ai/room-templates/:id/archive   — archive (admin)
 *
 *   Admin UI extensions (required to support approved admin catalog views):
 *   PATCH /ai/room-templates/:id              — edit/update (admin)
 *   POST  /ai/room-templates/:id/restore      — restore from archive (admin)
 *   POST  /ai/room-templates/:id/duplicate    — duplicate as draft (admin)
 *
 *   B1. GET  /ai/room-types   — list room types (public)
 *   B2. GET  /ai/room-styles  — list room styles (public)
 *   B3. GET  /ai/room-themes  — list room themes (public)
 *
 *   Admin seed:
 *   POST /ai/room-templates/seed — seed catalog (admin)
 *
 * All A-group endpoints require admin auth (handled by adminAuthWithExceptions).
 * B1–B3 are declared as public exceptions in adminAuth.ts.
 * Route paths are relative to the /api prefix mounted in app.ts.
 */

import { Router } from "express";
import { z } from "zod/v4";
import {
  listRoomTemplates,
  getRoomTemplate,
  createRoomTemplate,
  updateRoomTemplate,
  publishRoomTemplate,
  archiveRoomTemplate,
  restoreRoomTemplate,
  duplicateRoomTemplate,
  listRoomTypes,
  listRoomStyles,
  listRoomThemes,
  seedRoomCatalog,
  RoomTemplateServiceError,
} from "../services/roomTemplateService.js";

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

const dimensionsSchema = z.object({
  widthCm:  z.number().positive(),
  depthCm:  z.number().positive(),
  heightCm: z.number().positive(),
});

const createTemplateSchema = z.object({
  _v:              z.string().optional(),
  name:            z.string().min(1).max(200),
  slug:            z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
  description:     z.string().max(2000).optional(),
  roomTypeId:      z.string().uuid(),
  styleId:         z.string().uuid().nullable().optional(),
  dimensions:      dimensionsSchema.optional(),
  fixedElements:   z.array(z.unknown()).optional(),
  previewImageUrl: z.string().url().nullable().optional(),
  thumbnailUrl:    z.string().url().nullable().optional(),
  tags:            z.array(z.string()).optional(),
  tenantId:        z.string().uuid().nullable().optional(),
  metadata:        z.record(z.unknown()).optional(),
});

const updateTemplateSchema = z.object({
  name:            z.string().min(1).max(200).optional(),
  description:     z.string().max(2000).nullable().optional(),
  styleId:         z.string().uuid().nullable().optional(),
  dimensions:      dimensionsSchema.optional(),
  fixedElements:   z.array(z.unknown()).optional(),
  previewImageUrl: z.string().url().nullable().optional(),
  thumbnailUrl:    z.string().url().nullable().optional(),
  tags:            z.array(z.string()).optional(),
  metadata:        z.record(z.unknown()).optional(),
});

// ── Error handler ─────────────────────────────────────────────────────────────

function handleServiceError(err: unknown, res: import("express").Response): void {
  if (err instanceof RoomTemplateServiceError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if ((err as NodeJS.ErrnoException).code === "23505") {
    // Postgres unique constraint violation (slug conflict)
    res.status(409).json({ error: { code: "SLUG_CONFLICT", message: "A template with that slug already exists." } });
    return;
  }
  console.error("[room-templates] Unexpected error:", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
}

// ── B1. GET /ai/room-types ────────────────────────────────────────────────────
// Public — declared in PUBLIC_ROUTE_RULES in adminAuth.ts
router.get("/ai/room-types", async (_req, res) => {
  try {
    const data = await listRoomTypes();
    res.json({ data });
  } catch (err) {
    handleServiceError(err, res);
  }
});

// ── B2. GET /ai/room-styles ───────────────────────────────────────────────────
// Public — declared in PUBLIC_ROUTE_RULES in adminAuth.ts
router.get("/ai/room-styles", async (req, res) => {
  try {
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const data = await listRoomStyles({ status });
    res.json({ data });
  } catch (err) {
    handleServiceError(err, res);
  }
});

// ── B3. GET /ai/room-themes ───────────────────────────────────────────────────
// Public — declared in PUBLIC_ROUTE_RULES in adminAuth.ts
router.get("/ai/room-themes", async (_req, res) => {
  try {
    const data = await listRoomThemes();
    res.json({ data });
  } catch (err) {
    handleServiceError(err, res);
  }
});

// ── POST /ai/room-templates/seed (admin) — MUST be before /:id routes ─────────
router.post("/ai/room-templates/seed", async (_req, res) => {
  try {
    const result = await seedRoomCatalog();
    res.json({ ok: true, seeded: result });
  } catch (err) {
    handleServiceError(err, res);
  }
});

// ── A1. GET /ai/room-templates ────────────────────────────────────────────────
router.get("/ai/room-templates", async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const page     = parseInt(q["page"]     ?? "1",  10);
    const pageSize = parseInt(q["pageSize"] ?? "20", 10);

    const result = await listRoomTemplates({
      roomTypeId: q["roomTypeId"],
      status:     q["status"],
      search:     q["search"],
      sortBy:     (q["sortBy"] as "name" | "created_at" | "updated_at" | "status") ?? "updated_at",
      sortDir:    (q["sortDir"] as "asc" | "desc") ?? "desc",
      page:       isNaN(page) ? 1 : page,
      pageSize:   isNaN(pageSize) ? 20 : pageSize,
    });

    res.json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
});

// ── A2. GET /ai/room-templates/:id ───────────────────────────────────────────
router.get("/ai/room-templates/:id", async (req, res) => {
  try {
    const template = await getRoomTemplate(req.params["id"]!);
    if (!template) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Room template not found." } });
      return;
    }
    res.json(template);
  } catch (err) {
    handleServiceError(err, res);
  }
});

// ── A3. POST /ai/room-templates ───────────────────────────────────────────────
router.post("/ai/room-templates", async (req, res) => {
  try {
    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } });
      return;
    }

    const createdBy = (req.internalUser as { email?: string } | undefined)?.email ?? "admin";
    const template = await createRoomTemplate({ ...parsed.data, createdBy });
    res.status(201).json({ id: template.id, status: template.status });
  } catch (err) {
    handleServiceError(err, res);
  }
});

// ── PATCH /ai/room-templates/:id (admin UI edit) ──────────────────────────────
router.patch("/ai/room-templates/:id", async (req, res) => {
  try {
    const parsed = updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } });
      return;
    }

    const template = await updateRoomTemplate(req.params["id"]!, parsed.data);
    res.json(template);
  } catch (err) {
    handleServiceError(err, res);
  }
});

// ── A4. POST /ai/room-templates/:id/publish ───────────────────────────────────
router.post("/ai/room-templates/:id/publish", async (req, res) => {
  try {
    const template = await publishRoomTemplate(req.params["id"]!);
    res.json({ id: template.id, status: template.status });
  } catch (err) {
    handleServiceError(err, res);
  }
});

// ── A5. POST /ai/room-templates/:id/archive ───────────────────────────────────
router.post("/ai/room-templates/:id/archive", async (req, res) => {
  try {
    const template = await archiveRoomTemplate(req.params["id"]!);
    res.json({ id: template.id, status: template.status });
  } catch (err) {
    handleServiceError(err, res);
  }
});

// ── POST /ai/room-templates/:id/restore (admin UI restore) ───────────────────
router.post("/ai/room-templates/:id/restore", async (req, res) => {
  try {
    const template = await restoreRoomTemplate(req.params["id"]!);
    res.json({ id: template.id, status: template.status });
  } catch (err) {
    handleServiceError(err, res);
  }
});

// ── POST /ai/room-templates/:id/duplicate (admin UI duplicate) ───────────────
router.post("/ai/room-templates/:id/duplicate", async (req, res) => {
  try {
    const createdBy = (req.internalUser as { email?: string } | undefined)?.email ?? "admin";
    const template = await duplicateRoomTemplate(req.params["id"]!, createdBy);
    res.status(201).json({ id: template.id, status: template.status, name: template.name, slug: template.slug });
  } catch (err) {
    handleServiceError(err, res);
  }
});

export default router;
