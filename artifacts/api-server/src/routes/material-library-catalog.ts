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
import { adminAuth } from "../middleware/adminAuth.js";

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

/**
 * Determines the admin authentication status of the request.
 *
 * Returns:
 *   "admin"           — req.internalUser is set (verified browser session) OR
 *                       a valid ADMIN_API_KEY was provided in a header.
 *   "unauthenticated" — no credential was presented at all → 401.
 *   "unauthorized"    — a credential was presented but is wrong → 403.
 *
 * Note: GET /material-library is in PUBLIC_ROUTE_RULES so the global
 * adminAuthWithExceptions bypasses adminAuth for it.  req.internalUser is
 * populated by optionalSessionAuth (app.ts) which runs before the router and
 * always attempts to hydrate the session cookie — meaning browser admin users
 * correctly receive "admin" here even though adminAuth itself was bypassed.
 */
function getAdminStatus(
  req: import("express").Request,
): "admin" | "unauthenticated" | "unauthorized" {
  // Path 1: validated internal-user session (populated by optionalSessionAuth)
  if ((req as unknown as Record<string, unknown>).internalUser) return "admin";

  // Path 2: ADMIN_API_KEY header (server-to-server compat)
  const adminKey = process.env["ADMIN_API_KEY"];
  const authHeader = req.headers["authorization"] as string | undefined;
  const xKey = (req.headers["x-admin-api-key"] ?? req.headers["x-admin-key"]) as string | undefined;
  const provided = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : xKey?.trim();

  if (!provided) return "unauthenticated"; // no credential at all
  if (!adminKey || provided !== adminKey) return "unauthorized"; // wrong credential
  return "admin";
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
// status=inactive is admin-only; all other params are open to authenticated callers.
router.get("/material-library", async (req, res) => {
  try {
    const rawStatus = (req.query as Record<string, unknown>)["status"];
    if (typeof rawStatus === "string" && rawStatus === "inactive") {
      const authStatus = getAdminStatus(req);
      if (authStatus === "unauthenticated") {
        res.status(401).json({ error: "Authentication required to query inactive materials" });
        return;
      }
      if (authStatus === "unauthorized") {
        res.status(403).json({ error: "Admin access required for status=inactive" });
        return;
      }
    }
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
// adminAuth is applied explicitly here as belt-and-suspenders: the global
// adminAuthWithExceptions already protects this route (it is not in
// PUBLIC_ROUTE_RULES), but making it explicit at the route level documents
// the intent clearly and ensures it is never accidentally exempted.
router.post("/material-library/seed", adminAuth, async (req, res) => {
  try {
    const result = await seedMaterialLibrary();
    res.json({ success: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
