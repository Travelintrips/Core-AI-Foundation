/**
 * WP-02 — Furniture & Object Library Routes
 *
 * Admin endpoints (require adminAuthWithExceptions):
 *   GET    /ai/furniture-library/items
 *   GET    /ai/furniture-library/items/:id
 *   POST   /ai/furniture-library/items
 *   PATCH  /ai/furniture-library/items/:id
 *   DELETE /ai/furniture-library/items/:id          (soft delete)
 *   POST   /ai/furniture-library/items/:id/publish
 *   POST   /ai/furniture-library/items/:id/archive
 *   POST   /ai/furniture-library/items/:id/restore
 *   POST   /ai/furniture-library/items/:id/duplicate
 *   GET    /ai/furniture-library/items/:id/history
 *   GET/POST/PATCH/DELETE /ai/furniture-library/categories
 *   GET/POST/PATCH        /ai/furniture-library/brands
 *   GET/POST/PATCH        /ai/furniture-library/collections
 *   GET/POST/PATCH        /ai/furniture-library/tags
 *   POST   /ai/furniture-library/seed
 *
 * Public catalog (declared in adminAuth.ts PUBLIC_ROUTE_RULES):
 *   GET    /ai/furniture-catalog/items
 *   GET    /ai/furniture-catalog/items/:id
 *   GET    /ai/furniture-catalog/categories
 *   GET    /ai/furniture-catalog/brands
 *   GET    /ai/furniture-catalog/collections
 *   GET    /ai/furniture-catalog/tags
 *
 * All route paths are relative to the /api prefix mounted in app.ts.
 * No zod/v4 import — manual validation per api-server convention.
 */

import { Router } from "express";
import {
  listFurnitureItems,
  getFurnitureItem,
  createFurnitureItem,
  updateFurnitureItem,
  softDeleteFurnitureItem,
  publishFurnitureItem,
  archiveFurnitureItem,
  restoreFurnitureItem,
  duplicateFurnitureItem,
  getFurnitureItemHistory,
  listFurnitureCategories,
  createFurnitureCategory,
  updateFurnitureCategory,
  deleteFurnitureCategory,
  listFurnitureBrands,
  createFurnitureBrand,
  updateFurnitureBrand,
  listFurnitureCollections,
  createFurnitureCollection,
  updateFurnitureCollection,
  listFurnitureTags,
  createFurnitureTag,
  updateFurnitureTag,
  seedFurnitureCatalog,
  FurnitureLibraryError,
} from "../services/furnitureLibraryService.js";

const router = Router();

// ── Error handler ─────────────────────────────────────────────────────────────

function handleError(err: unknown, res: import("express").Response): void {
  if (err instanceof FurnitureLibraryError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  const pgErr = err as { code?: string };
  if (pgErr.code === "23505") {
    res.status(409).json({ error: { code: "CONFLICT", message: "A record with that slug or code already exists." } });
    return;
  }
  if (pgErr.code === "23503") {
    res.status(400).json({ error: { code: "FK_VIOLATION", message: "Referenced record does not exist." } });
    return;
  }
  console.error("[furniture-library] Unexpected error:", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseListQuery(q: Record<string, string | undefined>) {
  const page     = parseInt(q["page"]     ?? "1",  10);
  const pageSize = parseInt(q["pageSize"] ?? "20", 10);
  return {
    search:       q["search"]?.trim() || undefined,
    categoryId:   q["categoryId"]?.trim() || undefined,
    brandId:      q["brandId"]?.trim() || undefined,
    collectionId: q["collectionId"]?.trim() || undefined,
    style:        q["style"]?.trim() || undefined,
    furnitureType: q["furnitureType"]?.trim() || undefined,
    priceTier:    q["priceTier"]?.trim() || undefined,
    status:       q["status"]?.trim() || undefined,
    sortBy:       (q["sortBy"] as "name" | "created_at" | "updated_at" | "status" | "price_tier") ?? "updated_at",
    sortDir:      (q["sortDir"] as "asc" | "desc") ?? "desc",
    page:         isNaN(page) ? 1 : page,
    pageSize:     isNaN(pageSize) ? 20 : pageSize,
    includeDeleted: q["include_deleted"] === "true",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — ITEMS
// ─────────────────────────────────────────────────────────────────────────────

// POST /ai/furniture-library/seed — MUST be before /:id routes
router.post("/ai/furniture-library/seed", async (_req, res) => {
  try {
    const result = await seedFurnitureCatalog();
    res.json({ ok: true, seeded: result });
  } catch (err) { handleError(err, res); }
});

// GET /ai/furniture-library/items
router.get("/ai/furniture-library/items", async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const result = await listFurnitureItems(parseListQuery(q));
    res.json(result);
  } catch (err) { handleError(err, res); }
});

// GET /ai/furniture-library/items/:id
router.get("/ai/furniture-library/items/:id", async (req, res) => {
  try {
    const item = await getFurnitureItem(req.params["id"]!);
    if (!item) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Furniture item not found." } });
      return;
    }
    res.json(item);
  } catch (err) { handleError(err, res); }
});

// GET /ai/furniture-library/items/:id/history
router.get("/ai/furniture-library/items/:id/history", async (req, res) => {
  try {
    const history = await getFurnitureItemHistory(req.params["id"]!);
    res.json({ data: history, total: history.length });
  } catch (err) { handleError(err, res); }
});

// POST /ai/furniture-library/items
router.post("/ai/furniture-library/items", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b["name"] || typeof b["name"] !== "string" || !b["name"].trim()) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
      return;
    }
    if (!b["categoryId"] || typeof b["categoryId"] !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "categoryId is required" } });
      return;
    }
    const createdBy = (req.internalUser as { email?: string } | undefined)?.email ?? "admin";
    const item = await createFurnitureItem({ ...b as unknown as Parameters<typeof createFurnitureItem>[0], createdBy });
    res.status(201).json(item);
  } catch (err) { handleError(err, res); }
});

// PATCH /ai/furniture-library/items/:id
router.patch("/ai/furniture-library/items/:id", async (req, res) => {
  try {
    const item = await updateFurnitureItem(req.params["id"]!, req.body);
    res.json(item);
  } catch (err) { handleError(err, res); }
});

// DELETE /ai/furniture-library/items/:id  (soft delete)
router.delete("/ai/furniture-library/items/:id", async (req, res) => {
  try {
    const item = await softDeleteFurnitureItem(req.params["id"]!);
    res.json({ id: item.id, deletedAt: item.deletedAt });
  } catch (err) { handleError(err, res); }
});

// POST /ai/furniture-library/items/:id/publish
router.post("/ai/furniture-library/items/:id/publish", async (req, res) => {
  try {
    const item = await publishFurnitureItem(req.params["id"]!);
    res.json({ id: item.id, status: item.status, version: item.version });
  } catch (err) { handleError(err, res); }
});

// POST /ai/furniture-library/items/:id/archive
router.post("/ai/furniture-library/items/:id/archive", async (req, res) => {
  try {
    const item = await archiveFurnitureItem(req.params["id"]!);
    res.json({ id: item.id, status: item.status });
  } catch (err) { handleError(err, res); }
});

// POST /ai/furniture-library/items/:id/restore
router.post("/ai/furniture-library/items/:id/restore", async (req, res) => {
  try {
    const item = await restoreFurnitureItem(req.params["id"]!);
    res.json({ id: item.id, status: item.status });
  } catch (err) { handleError(err, res); }
});

// POST /ai/furniture-library/items/:id/duplicate
router.post("/ai/furniture-library/items/:id/duplicate", async (req, res) => {
  try {
    const createdBy = (req.internalUser as { email?: string } | undefined)?.email ?? "admin";
    const item = await duplicateFurnitureItem(req.params["id"]!, createdBy);
    res.status(201).json({ id: item.id, status: item.status, name: item.name, slug: item.slug });
  } catch (err) { handleError(err, res); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ai/furniture-library/categories", async (req, res) => {
  try {
    const includeInactive = (req.query as Record<string, string>)["include_inactive"] === "true";
    const data = await listFurnitureCategories(includeInactive);
    res.json({ data, total: data.length });
  } catch (err) { handleError(err, res); }
});

router.post("/ai/furniture-library/categories", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b["name"] || typeof b["name"] !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
      return;
    }
    const cat = await createFurnitureCategory(b as unknown as Parameters<typeof createFurnitureCategory>[0]);
    res.status(201).json(cat);
  } catch (err) { handleError(err, res); }
});

router.patch("/ai/furniture-library/categories/:id", async (req, res) => {
  try {
    const cat = await updateFurnitureCategory(req.params["id"]!, req.body);
    res.json(cat);
  } catch (err) { handleError(err, res); }
});

router.delete("/ai/furniture-library/categories/:id", async (req, res) => {
  try {
    await deleteFurnitureCategory(req.params["id"]!);
    res.json({ ok: true });
  } catch (err) { handleError(err, res); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — BRANDS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ai/furniture-library/brands", async (req, res) => {
  try {
    const status = (req.query as Record<string, string>)["status"];
    const data = await listFurnitureBrands(status);
    res.json({ data, total: data.length });
  } catch (err) { handleError(err, res); }
});

router.post("/ai/furniture-library/brands", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b["name"] || typeof b["name"] !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
      return;
    }
    const brand = await createFurnitureBrand(b as unknown as Parameters<typeof createFurnitureBrand>[0]);
    res.status(201).json(brand);
  } catch (err) { handleError(err, res); }
});

router.patch("/ai/furniture-library/brands/:id", async (req, res) => {
  try {
    const brand = await updateFurnitureBrand(req.params["id"]!, req.body);
    res.json(brand);
  } catch (err) { handleError(err, res); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — COLLECTIONS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ai/furniture-library/collections", async (req, res) => {
  try {
    const brandId = (req.query as Record<string, string>)["brandId"];
    const data = await listFurnitureCollections(brandId);
    res.json({ data, total: data.length });
  } catch (err) { handleError(err, res); }
});

router.post("/ai/furniture-library/collections", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b["name"] || typeof b["name"] !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
      return;
    }
    const col = await createFurnitureCollection(b as unknown as Parameters<typeof createFurnitureCollection>[0]);
    res.status(201).json(col);
  } catch (err) { handleError(err, res); }
});

router.patch("/ai/furniture-library/collections/:id", async (req, res) => {
  try {
    const col = await updateFurnitureCollection(req.params["id"]!, req.body);
    res.json(col);
  } catch (err) { handleError(err, res); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — TAGS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ai/furniture-library/tags", async (req, res) => {
  try {
    const data = await listFurnitureTags();
    res.json({ data, total: data.length });
  } catch (err) { handleError(err, res); }
});

router.post("/ai/furniture-library/tags", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b["name"] || typeof b["name"] !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
      return;
    }
    const tag = await createFurnitureTag(b as Parameters<typeof createFurnitureTag>[0]);
    res.status(201).json(tag);
  } catch (err) { handleError(err, res); }
});

router.patch("/ai/furniture-library/tags/:id", async (req, res) => {
  try {
    const tag = await updateFurnitureTag(req.params["id"]!, req.body);
    res.json(tag);
  } catch (err) { handleError(err, res); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CATALOG
// Routes declared in adminAuth.ts PUBLIC_ROUTE_RULES — no admin key required.
// All public list routes enforce status=published AND deleted_at IS NULL.
// ─────────────────────────────────────────────────────────────────────────────

// GET /ai/furniture-catalog/items
router.get("/ai/furniture-catalog/items", async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const opts = parseListQuery(q);
    // Public catalog always shows published, non-deleted only
    opts.status = "published";
    opts.includeDeleted = false;
    const result = await listFurnitureItems(opts);
    res.json(result);
  } catch (err) { handleError(err, res); }
});

// GET /ai/furniture-catalog/items/:id
router.get("/ai/furniture-catalog/items/:id", async (req, res) => {
  try {
    const item = await getFurnitureItem(req.params["id"]!);
    if (!item || item.status !== "published" || item.deletedAt) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Furniture item not found." } });
      return;
    }
    res.json(item);
  } catch (err) { handleError(err, res); }
});

// GET /ai/furniture-catalog/categories
router.get("/ai/furniture-catalog/categories", async (_req, res) => {
  try {
    const data = await listFurnitureCategories(false);
    res.json({ data, total: data.length });
  } catch (err) { handleError(err, res); }
});

// GET /ai/furniture-catalog/brands
router.get("/ai/furniture-catalog/brands", async (_req, res) => {
  try {
    const data = await listFurnitureBrands("active");
    res.json({ data, total: data.length });
  } catch (err) { handleError(err, res); }
});

// GET /ai/furniture-catalog/collections
router.get("/ai/furniture-catalog/collections", async (_req, res) => {
  try {
    const data = await listFurnitureCollections();
    res.json({ data, total: data.length });
  } catch (err) { handleError(err, res); }
});

// GET /ai/furniture-catalog/tags
router.get("/ai/furniture-catalog/tags", async (_req, res) => {
  try {
    const data = await listFurnitureTags();
    res.json({ data, total: data.length });
  } catch (err) { handleError(err, res); }
});

export default router;
