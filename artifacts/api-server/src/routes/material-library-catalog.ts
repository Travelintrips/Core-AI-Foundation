/**
 * material-library-catalog.ts — Phase 1 Interior Design Material Library API
 *
 * Routes (all under /api, mounted at /material-library):
 *   GET /material-library              — search/list materials
 *   GET /material-library/categories   — list all categories
 *   GET /material-library/brands       — distinct brand list
 *   GET /material-library/:id          — single material detail
 *   POST /material-library/seed        — trigger idempotent seed (admin)
 *
 * No Zod import — validation done manually per api-server convention.
 */

import { Router } from "express";
import {
  parseSearchParams,
  searchMaterials,
  getMaterialById,
  getCategories,
  getBrands,
  MaterialNotFoundError,
  MaterialValidationError,
} from "../domains/material-library/materialLibraryService.js";
import { seedMaterialLibrary } from "../domains/material-library/seed.js";

const router = Router();

function handleError(res: import("express").Response, err: unknown): void {
  if (err instanceof MaterialNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof MaterialValidationError) {
    res.status(400).json({ error: err.message, field: err.field });
    return;
  }
  const msg = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: msg });
}

// ── GET /material-library/categories ─────────────────────────────────────────
router.get("/material-library/categories", async (req, res) => {
  try {
    const categories = await getCategories();
    res.json({ categories, total: categories.length });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /material-library/brands ─────────────────────────────────────────────
router.get("/material-library/brands", async (req, res) => {
  try {
    const brands = await getBrands();
    res.json({ brands, total: brands.length });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /material-library ─────────────────────────────────────────────────────
// Query params: search, category, brand, priceTier, finish, color, status, page, pageSize, sort
router.get("/material-library", async (req, res) => {
  try {
    const params = parseSearchParams(req.query as Record<string, unknown>);
    const result = await searchMaterials(params);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /material-library/:id ─────────────────────────────────────────────────
router.get("/material-library/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "id must be a positive integer" });
      return;
    }
    const material = await getMaterialById(id);
    res.json({ material });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /material-library/seed ───────────────────────────────────────────────
router.post("/material-library/seed", async (req, res) => {
  try {
    const result = await seedMaterialLibrary();
    res.json({ success: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
