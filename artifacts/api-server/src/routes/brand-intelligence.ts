/**
 * brand-intelligence.ts — V4.2E Brand DNA Engine routes
 *
 * Admin routes: require X-Admin-Api-Key (handled by middleware).
 * No zod imports — manual validation per convention.
 * No direct zod/v4 import — uses @workspace/api-zod via convention.
 */
import { Router } from "express";
import {
  analyzeBrand,
  getBrandDNA,
  getBrandRecommendations,
  getBrandConsistencyReport,
  getCreativeMemory,
  getCreativeDirectorRecommendation,
  getAdminBrandIntelligenceStats,
} from "../services/creativeBrandIntelligenceService.js";
import { logAudit } from "../services/aiAuditService.js";
import { resolveWorkspaceSession } from "../services/customerWorkspaceService.js";

const router = Router();

// ── Admin: GET /ai/brand-intelligence/stats ───────────────────────────────────
router.get("/ai/brand-intelligence/stats", async (_req, res): Promise<void> => {
  const stats = await getAdminBrandIntelligenceStats();
  res.json(stats);
});

// ── Admin: POST /ai/brand-intelligence/analyze ────────────────────────────────
// Trigger brand analysis for a clientId (email hash or explicit clientId).
router.post("/ai/brand-intelligence/analyze", async (req, res): Promise<void> => {
  const { clientId } = req.body as { clientId?: string };
  if (!clientId || typeof clientId !== "string" || clientId.trim() === "") {
    res.status(400).json({ error: "clientId is required" });
    return;
  }
  const dna = await analyzeBrand(clientId.trim());
  res.json(dna);
});

// ── Admin: GET /ai/brand-intelligence/:clientId ────────────────────────────────
router.get("/ai/brand-intelligence/:clientId", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const dna = await getBrandDNA(clientId);
  if (!dna) {
    res.status(404).json({ error: "Brand DNA not found. Run POST /ai/brand-intelligence/analyze first." });
    return;
  }
  res.json(dna);
});

// ── Admin: POST /ai/brand-intelligence/:clientId/refresh ─────────────────────
router.post("/ai/brand-intelligence/:clientId/refresh", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const dna = await analyzeBrand(clientId);
  await logAudit({ action: "brand_dna_refreshed", entityType: "brand_dna", entityId: clientId, details: {} });
  res.json(dna);
});

// ── Admin: GET /ai/brand-intelligence/:clientId/recommendations ───────────────
router.get("/ai/brand-intelligence/:clientId/recommendations", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const recs = await getBrandRecommendations(clientId);
  res.json({ items: recs, total: recs.length });
});

// ── Admin: GET /ai/brand-intelligence/:clientId/consistency-report ────────────
router.get("/ai/brand-intelligence/:clientId/consistency-report", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const report = await getBrandConsistencyReport(clientId);
  res.json(report);
});

// ── Admin: GET /ai/brand-intelligence/:clientId/creative-memory ───────────────
router.get("/ai/brand-intelligence/:clientId/creative-memory", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const memory = await getCreativeMemory(clientId);
  res.json(memory);
});

// ── Admin: GET /ai/brand-intelligence/:clientId/creative-director ─────────────
router.get("/ai/brand-intelligence/:clientId/creative-director", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const rec = await getCreativeDirectorRecommendation(clientId);
  res.json(rec);
});

// ── Public (token-auth): GET /public/customer/workspace/:token/brand-intelligence ──────
router.get("/public/customer/workspace/:token/brand-intelligence", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const { session } = result;
  const clientId = session.emailHash;

  // Auto-analyze if no DNA exists yet
  let dna = await getBrandDNA(clientId);
  if (!dna) {
    dna = await analyzeBrand(clientId);
  }

  const [recs, consistencyReport, memory] = await Promise.all([
    getBrandRecommendations(clientId),
    getBrandConsistencyReport(clientId),
    getCreativeMemory(clientId),
  ]);

  res.json({ dna, recommendations: recs, consistencyReport, memory });
});

// ── Public (token-auth): POST /public/customer/workspace/:token/brand-intelligence/refresh ─
router.post("/public/customer/workspace/:token/brand-intelligence/refresh", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const { session } = result;
  const dna = await analyzeBrand(session.emailHash);
  res.json(dna);
});

// ── Public (token-auth): GET /public/customer/workspace/:token/brand-intelligence/creative-director ─
router.get("/public/customer/workspace/:token/brand-intelligence/creative-director", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const { session } = result;
  const rec = await getCreativeDirectorRecommendation(session.emailHash);
  res.json(rec);
});

export default router;
