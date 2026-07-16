/**
 * graphic-design/routes.ts — Team 15
 *
 * Express router for the Graphic Design domain.
 * All routes are prefixed /ai/graphic-design (the /api prefix is added by app.ts).
 *
 * Routes:
 *   POST   /ai/graphic-design/briefs              — create brief
 *   GET    /ai/graphic-design/briefs              — list briefs (?serviceCode=&status=&page=&pageSize=)
 *   GET    /ai/graphic-design/briefs/:id          — get brief detail
 *   PATCH  /ai/graphic-design/briefs/:id/status   — update status
 *   POST   /ai/graphic-design/briefs/:id/approve  — approve + dispatch jobs
 *   POST   /ai/graphic-design/briefs/:id/qc       — run QC (renderer callback)
 *   GET    /ai/graphic-design/briefs/:id/manifest — deliverable manifest
 *   GET    /ai/graphic-design/briefs/:id/qc       — last QC result
 *   GET    /ai/graphic-design/blueprints          — list all blueprints
 *   GET    /ai/graphic-design/blueprints/:serviceCode — single blueprint
 *   GET    /ai/graphic-design/packages            — package policies for all services
 *   GET    /ai/graphic-design/packages/:serviceCode — policies for one service
 *   GET    /ai/graphic-design/services            — service catalog summary
 */

import { Router } from "express";
import { GraphicDesignBriefSchema, GdStatusUpdateSchema, GD_SERVICE_CODES, GD_SERVICE_LABELS } from "./schema.js";
import {
  createBrief,
  listBriefs,
  getBrief,
  updateBriefStatus,
  approveBriefAndDispatch,
  runBriefQc,
  getBriefManifest,
  getBriefQcResult,
  resolveAdapters,
} from "./service.js";
import { getAllBlueprints, getBlueprint } from "./blueprints.js";
import { getAllPolicies, getPackagePolicy, getEffectivePrice, BASE_PRICES_IDR } from "./packagePolicy.js";
import type { GdServiceCode } from "./schema.js";

const router = Router();

// Resolve adapters once at module load (lazy async init on first request)
let _ports: Awaited<ReturnType<typeof resolveAdapters>> | null = null;
async function getPorts() {
  if (!_ports) _ports = await resolveAdapters();
  return _ports;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sendError(res: import("express").Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

// ── Briefs ────────────────────────────────────────────────────────────────────

/** POST /ai/graphic-design/briefs */
router.post("/ai/graphic-design/briefs", async (req, res): Promise<void> => {
  const parsed = GraphicDesignBriefSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message);
    return;
  }

  try {
    const ports  = await getPorts();
    const result = await createBrief(parsed.data, ports);
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    sendError(res, (err as { status?: number }).status ?? 500, msg);
  }
});

/** GET /ai/graphic-design/briefs */
router.get("/ai/graphic-design/briefs", (req, res): void => {
  const serviceCode = typeof req.query["serviceCode"] === "string" ? req.query["serviceCode"] as GdServiceCode : undefined;
  const status      = typeof req.query["status"]      === "string" ? req.query["status"]      as import("./schema.js").GdStatus : undefined;
  const page        = parseInt(String(req.query["page"] ?? "1"), 10);
  const pageSize    = Math.min(parseInt(String(req.query["pageSize"] ?? "20"), 10), 100);

  const result = listBriefs({ serviceCode, status, page, pageSize });
  res.json(result);
});

/** GET /ai/graphic-design/briefs/:id */
router.get("/ai/graphic-design/briefs/:id", (req, res): void => {
  try {
    const record = getBrief(req.params["id"] ?? "");
    res.json(record);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Not found";
    sendError(res, (err as { status?: number }).status ?? 500, msg);
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
    const msg = err instanceof Error ? err.message : "Internal error";
    sendError(res, (err as { status?: number }).status ?? 500, msg);
  }
});

/** POST /ai/graphic-design/briefs/:id/approve */
router.post("/ai/graphic-design/briefs/:id/approve", async (req, res): Promise<void> => {
  try {
    const ports  = await getPorts();
    const result = await approveBriefAndDispatch(req.params["id"] ?? "", ports);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    sendError(res, (err as { status?: number }).status ?? 500, msg);
  }
});

/** POST /ai/graphic-design/briefs/:id/qc  — called by renderer (Team 7-8) after render */
router.post("/ai/graphic-design/briefs/:id/qc", async (req, res): Promise<void> => {
  try {
    const result = await runBriefQc(req.params["id"] ?? "", req.body);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    sendError(res, (err as { status?: number }).status ?? 500, msg);
  }
});

/** GET /ai/graphic-design/briefs/:id/manifest */
router.get("/ai/graphic-design/briefs/:id/manifest", (req, res): void => {
  try {
    res.json(getBriefManifest(req.params["id"] ?? ""));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Not found";
    sendError(res, (err as { status?: number }).status ?? 404, msg);
  }
});

/** GET /ai/graphic-design/briefs/:id/qc */
router.get("/ai/graphic-design/briefs/:id/qc", (req, res): void => {
  try {
    const result = getBriefQcResult(req.params["id"] ?? "");
    if (!result) { sendError(res, 404, "No QC result yet for this brief"); return; }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Not found";
    sendError(res, (err as { status?: number }).status ?? 404, msg);
  }
});

// ── Blueprints ────────────────────────────────────────────────────────────────

/** GET /ai/graphic-design/blueprints */
router.get("/ai/graphic-design/blueprints", (_req, res): void => {
  res.json(getAllBlueprints());
});

/** GET /ai/graphic-design/blueprints/:serviceCode */
router.get("/ai/graphic-design/blueprints/:serviceCode", (req, res): void => {
  const code = req.params["serviceCode"] as GdServiceCode;
  try {
    res.json(getBlueprint(code));
  } catch {
    sendError(res, 404, `No blueprint for service code: ${code}`);
  }
});

// ── Packages ──────────────────────────────────────────────────────────────────

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
  const code = req.params["serviceCode"] as GdServiceCode;
  if (!(GD_SERVICE_CODES as readonly string[]).includes(code)) {
    sendError(res, 404, `Unknown service code: ${code}`);
    return;
  }
  res.json(getAllPolicies(code));
});

// ── Service catalog summary ───────────────────────────────────────────────────

/** GET /ai/graphic-design/services */
router.get("/ai/graphic-design/services", (_req, res): void => {
  const services = GD_SERVICE_CODES.map((code) => ({
    serviceCode:   code,
    serviceName:   GD_SERVICE_LABELS[code],
    basePriceIdr:  BASE_PRICES_IDR[code],
    packages: {
      basic:    { price: getEffectivePrice(code, "basic"),    ...getPackagePolicy(code, "basic") },
      standard: { price: getEffectivePrice(code, "standard"), ...getPackagePolicy(code, "standard") },
      premium:  { price: getEffectivePrice(code, "premium"),  ...getPackagePolicy(code, "premium") },
    },
  }));
  res.json({ services, total: services.length });
});

export default router;
