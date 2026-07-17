/**
 * graphic-design/routes.ts — Team 15
 *
 * Config-only Express router for the Graphic Design domain.
 *
 * This router exposes:
 *   (a) Adapter config routes — static blueprint/package/catalog data
 *   (b) Brief state management routes — brief CRUD + job list
 *
 * EXECUTION routes (approve + QC callback) are intentionally NOT here.
 * They are declared in integration/manifests/team-15.json → routesToMount
 * and must be applied by Team 24 after wiring the canonical adapter to
 * the designStudioService export pipeline.
 *
 * PATH TRAVERSAL PROTECTION:
 *   - :serviceCode params are sanitized before any lookup.
 *   - No user-supplied filenames or paths are accepted anywhere.
 *   - File format strings from request bodies are validated in service.ts.
 *
 * NOTE: This router is NOT mounted in routes/index.ts (locked file).
 *       See integration/manifests/team-15.json → routesToMount.
 */

import { Router } from "express";
import { GraphicDesignBriefSchema, GdStatusUpdateSchema, GD_SERVICE_CODES, GD_SERVICE_LABELS } from "./schema.js";
import {
  createBrief,
  listBriefs,
  getBrief,
  updateBriefStatus,
  getBriefManifest,
  getBriefQcResult,
  listBriefJobs,
} from "./service.js";
import { getAllBlueprints, getBlueprint } from "./blueprints.js";
import { getAllPolicies, getPackagePolicy, getEffectivePrice, BASE_PRICES_IDR } from "./packagePolicy.js";
import { sanitizeServiceCode } from "./sanitize.js";
import type { GdServiceCode, GdStatus } from "./schema.js";

const router = Router();

// ── Utility ───────────────────────────────────────────────────────────────────

function sendError(res: import("express").Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

// ── Briefs — state management (no execution) ──────────────────────────────────

/** POST /ai/graphic-design/briefs — create brief */
router.post("/ai/graphic-design/briefs", async (req, res): Promise<void> => {
  const parsed = GraphicDesignBriefSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message);
    return;
  }

  try {
    // No ports/adapter needed — createBrief is pure state management
    const result = await createBrief(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    sendError(res, (err as { status?: number }).status ?? 500, msg);
  }
});

/** GET /ai/graphic-design/briefs — list briefs (paginated) */
router.get("/ai/graphic-design/briefs", (req, res): void => {
  const serviceCode = typeof req.query["serviceCode"] === "string"
    ? sanitizeServiceCode(req.query["serviceCode"]) as GdServiceCode
    : undefined;
  const status   = typeof req.query["status"]   === "string" ? req.query["status"]   as GdStatus : undefined;
  const page     = Math.max(1, parseInt(String(req.query["page"]     ?? "1"),  10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query["pageSize"] ?? "20"), 10)));

  res.json(listBriefs({ serviceCode, status, page, pageSize }));
});

/** GET /ai/graphic-design/briefs/:id */
router.get("/ai/graphic-design/briefs/:id", (req, res): void => {
  try {
    res.json(getBrief(req.params["id"] ?? ""));
  } catch (err) {
    sendError(res, (err as { status?: number }).status ?? 500, err instanceof Error ? err.message : "Not found");
  }
});

/** PATCH /ai/graphic-design/briefs/:id/status */
router.patch("/ai/graphic-design/briefs/:id/status", async (req, res): Promise<void> => {
  const parsed = GdStatusUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message);
    return;
  }

  try {
    const result = await updateBriefStatus(req.params["id"] ?? "", parsed.data.status, parsed.data.note);
    res.json(result);
  } catch (err) {
    sendError(res, (err as { status?: number }).status ?? 500, err instanceof Error ? err.message : "Internal error");
  }
});

/** GET /ai/graphic-design/briefs/:id/manifest */
router.get("/ai/graphic-design/briefs/:id/manifest", (req, res): void => {
  try {
    res.json(getBriefManifest(req.params["id"] ?? ""));
  } catch (err) {
    sendError(res, (err as { status?: number }).status ?? 404, err instanceof Error ? err.message : "Not found");
  }
});

/** GET /ai/graphic-design/briefs/:id/qc — last QC result (read-only) */
router.get("/ai/graphic-design/briefs/:id/qc", (req, res): void => {
  try {
    const result = getBriefQcResult(req.params["id"] ?? "");
    if (!result) { sendError(res, 404, "No QC result yet for this brief"); return; }
    res.json(result);
  } catch (err) {
    sendError(res, (err as { status?: number }).status ?? 404, err instanceof Error ? err.message : "Not found");
  }
});

/** GET /ai/graphic-design/briefs/:id/jobs — paginated job list (P2) */
router.get("/ai/graphic-design/briefs/:id/jobs", (req, res): void => {
  const page     = Math.max(1, parseInt(String(req.query["page"]     ?? "1"),  10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query["pageSize"] ?? "20"), 10)));

  try {
    res.json(listBriefJobs(req.params["id"] ?? "", { page, pageSize }));
  } catch (err) {
    sendError(res, (err as { status?: number }).status ?? 404, err instanceof Error ? err.message : "Not found");
  }
});

// ── Blueprints — adapter config (static) ─────────────────────────────────────

/** GET /ai/graphic-design/blueprints */
router.get("/ai/graphic-design/blueprints", (_req, res): void => {
  res.json(getAllBlueprints());
});

/** GET /ai/graphic-design/blueprints/:serviceCode */
router.get("/ai/graphic-design/blueprints/:serviceCode", (req, res): void => {
  const code = sanitizeServiceCode(req.params["serviceCode"] ?? "") as GdServiceCode;
  try {
    res.json(getBlueprint(code));
  } catch {
    sendError(res, 404, `No blueprint for service code: ${code}`);
  }
});

// ── Packages — adapter config (static) ───────────────────────────────────────

/** GET /ai/graphic-design/packages */
router.get("/ai/graphic-design/packages", (_req, res): void => {
  const result: Record<string, ReturnType<typeof getAllPolicies>> = {};
  for (const code of GD_SERVICE_CODES) {
    result[code] = getAllPolicies(code);
  }
  res.json(result);
});

/** GET /ai/graphic-design/packages/:serviceCode */
router.get("/ai/graphic-design/packages/:serviceCode", (req, res): void => {
  const code = sanitizeServiceCode(req.params["serviceCode"] ?? "") as GdServiceCode;
  if (!(GD_SERVICE_CODES as readonly string[]).includes(code)) {
    sendError(res, 404, `Unknown service code: ${code}`);
    return;
  }
  res.json(getAllPolicies(code));
});

// ── Service catalog summary — adapter config (static) ────────────────────────

/** GET /ai/graphic-design/services */
router.get("/ai/graphic-design/services", (_req, res): void => {
  const services = GD_SERVICE_CODES.map((code) => ({
    serviceCode:  code,
    serviceName:  GD_SERVICE_LABELS[code],
    basePriceIdr: BASE_PRICES_IDR[code],
    packages: {
      basic:    { price: getEffectivePrice(code, "basic"),    ...getPackagePolicy(code, "basic") },
      standard: { price: getEffectivePrice(code, "standard"), ...getPackagePolicy(code, "standard") },
      premium:  { price: getEffectivePrice(code, "premium"),  ...getPackagePolicy(code, "premium") },
    },
  }));
  res.json({ services, total: services.length });
});

export default router;
