/**
 * branding-identity/routes.ts — Team 27
 *
 * Express router for the Branding & Identity plugin.
 *
 * All paths are prefixed with /ai/branding (no /api — app.ts adds that).
 *
 * Endpoints:
 *   GET  /ai/branding/manifest                     — plugin manifest + artifact registry
 *   POST /ai/branding/briefs                       — create brand brief
 *   GET  /ai/branding/briefs                       — list briefs (paginated)
 *   GET  /ai/branding/briefs/:id                   — get brief detail
 *   GET  /ai/branding/briefs/:id/workflow          — get workflow state + progress
 *   POST /ai/branding/briefs/:id/workflow/advance  — advance to next/review stage
 *   GET  /ai/branding/briefs/:id/artifacts         — list registered artifacts
 *   POST /ai/branding/briefs/:id/artifacts         — register an artifact
 *   GET  /ai/branding/briefs/:id/guideline         — guideline export readiness
 *   POST /ai/branding/briefs/:id/ai/brief-extract  — AI brief extraction (Creative Director)
 *   POST /ai/branding/briefs/:id/ai/brand-strategy — AI brand strategy (Brand Strategist)
 *
 * RULES:
 *   - No direct DB access from routes.
 *   - Request contexts and authorization use existing middleware.
 *   - No hard-coded provider/model/tenant/domain.
 *   - Branding fields must not leak to core schemas.
 */

import { Router } from "express";
import {
  BrandingBriefSchema,
  StageAdvanceSchema,
  ArtifactRegistrationSchema,
} from "./schema.js";
import {
  createBrief,
  getBrief,
  listBriefs,
  advanceBriefStage,
  getBriefWorkflow,
  registerArtifact,
  listArtifacts,
  exportGuideline,
  runCreativeBriefExtraction,
  runBrandStrategyForBrief,
} from "./service.js";
import { buildBrandingManifest } from "./manifest.js";
import { defaultBrandingAgentAdapter } from "./agentAdapter.js";
import { z } from "zod";
import type { BrandingStatus, BrandingStage } from "./schema.js";

const router = Router();

// ── Utility ───────────────────────────────────────────────────────────────────

function sendError(
  res:     import("express").Response,
  status:  number,
  message: string,
): void {
  res.status(status).json({ error: message });
}

// ── Plugin manifest ───────────────────────────────────────────────────────────

/** GET /ai/branding/manifest */
router.get("/ai/branding/manifest", (_req, res): void => {
  res.json(buildBrandingManifest());
});

// ── Briefs ────────────────────────────────────────────────────────────────────

/** POST /ai/branding/briefs */
router.post("/ai/branding/briefs", (req, res): void => {
  const parsed = BrandingBriefSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message);
    return;
  }
  try {
    const result = createBrief(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    sendError(res, e.status ?? 500, e.message ?? "Internal error");
  }
});

/** GET /ai/branding/briefs */
router.get("/ai/branding/briefs", (req, res): void => {
  const status   = typeof req.query["status"]   === "string" ? req.query["status"]   as BrandingStatus : undefined;
  const stage    = typeof req.query["stage"]    === "string" ? req.query["stage"]    as BrandingStage  : undefined;
  const page     = Math.max(1, parseInt(String(req.query["page"]     ?? "1"),  10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query["pageSize"] ?? "20"), 10)));
  res.json(listBriefs({ status, stage, page, pageSize }));
});

/** GET /ai/branding/briefs/:id */
router.get("/ai/branding/briefs/:id", (req, res): void => {
  try {
    const record = getBrief(req.params["id"] ?? "");
    res.json(record);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    sendError(res, e.status ?? 500, e.message ?? "Not found");
  }
});

// ── Workflow ──────────────────────────────────────────────────────────────────

/** GET /ai/branding/briefs/:id/workflow */
router.get("/ai/branding/briefs/:id/workflow", (req, res): void => {
  try {
    const result = getBriefWorkflow(req.params["id"] ?? "");
    res.json(result);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    sendError(res, e.status ?? 500, e.message ?? "Not found");
  }
});

/** POST /ai/branding/briefs/:id/workflow/advance */
router.post("/ai/branding/briefs/:id/workflow/advance", (req, res): void => {
  const parsed = StageAdvanceSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message);
    return;
  }
  try {
    const result = advanceBriefStage(
      req.params["id"] ?? "",
      parsed.data.targetStage,
      parsed.data.note,
    );
    res.json(result);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    sendError(res, e.status ?? 500, e.message ?? "Internal error");
  }
});

// ── Artifacts ─────────────────────────────────────────────────────────────────

/** GET /ai/branding/briefs/:id/artifacts */
router.get("/ai/branding/briefs/:id/artifacts", (req, res): void => {
  try {
    const items = listArtifacts(req.params["id"] ?? "");
    res.json({ items, total: items.length });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    sendError(res, e.status ?? 500, e.message ?? "Not found");
  }
});

/** POST /ai/branding/briefs/:id/artifacts */
router.post("/ai/branding/briefs/:id/artifacts", (req, res): void => {
  const parsed = ArtifactRegistrationSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message);
    return;
  }
  try {
    const artifact = registerArtifact(req.params["id"] ?? "", parsed.data);
    res.status(201).json(artifact);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    sendError(res, e.status ?? 500, e.message ?? "Internal error");
  }
});

// ── Guideline export ──────────────────────────────────────────────────────────

/** GET /ai/branding/briefs/:id/guideline */
router.get("/ai/branding/briefs/:id/guideline", (req, res): void => {
  try {
    const result = exportGuideline(req.params["id"] ?? "");
    res.json(result);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    sendError(res, e.status ?? 500, e.message ?? "Not found");
  }
});

// ── AI-assisted endpoints ─────────────────────────────────────────────────────

const BriefExtractSchema = z.object({
  userPrompt: z.string().min(10).max(5000),
});

/** POST /ai/branding/briefs/:id/ai/brief-extract */
router.post("/ai/branding/briefs/:id/ai/brief-extract", async (req, res): Promise<void> => {
  // Validate brief exists first
  try {
    getBrief(req.params["id"] ?? "");
  } catch (err) {
    const e = err as { status?: number; message?: string };
    sendError(res, e.status ?? 404, e.message ?? "Brief not found");
    return;
  }

  const parsed = BriefExtractSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message);
    return;
  }

  try {
    const result = await runCreativeBriefExtraction(
      parsed.data.userPrompt,
      defaultBrandingAgentAdapter,
    );
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI extraction failed";
    sendError(res, 500, msg);
  }
});

/** POST /ai/branding/briefs/:id/ai/brand-strategy */
router.post("/ai/branding/briefs/:id/ai/brand-strategy", async (req, res): Promise<void> => {
  try {
    getBrief(req.params["id"] ?? "");
  } catch (err) {
    const e = err as { status?: number; message?: string };
    sendError(res, e.status ?? 404, e.message ?? "Brief not found");
    return;
  }

  try {
    const result = await runBrandStrategyForBrief(
      req.params["id"] ?? "",
      defaultBrandingAgentAdapter,
    );
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Brand strategy generation failed";
    sendError(res, 500, msg);
  }
});

export default router;
