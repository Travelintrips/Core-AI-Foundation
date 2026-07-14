/**
 * asset-intelligence.ts — V4.2E Auto Asset Analyzer + Duplicate Detection routes
 *
 * Admin routes: require X-Admin-Api-Key (handled by middleware).
 * Public routes: token-based workspace auth.
 * No zod imports — manual validation per convention.
 */
import { Router } from "express";
import {
  analyzeAsset,
  getAssetIntelligence,
  getDuplicateReport,
  listAssetIntelligenceForClient,
} from "../services/assetIntelligenceService.js";
import { resolveWorkspaceSession } from "../services/customerWorkspaceService.js";

const router = Router();

// ── Admin: POST /ai/asset-intelligence/analyze ───────────────────────────────
router.post("/ai/asset-intelligence/analyze", async (req, res): Promise<void> => {
  const { assetId, assetSource, clientId } = req.body as {
    assetId?: number;
    assetSource?: string;
    clientId?: string;
  };
  if (!assetId || !assetSource || !clientId) {
    res.status(400).json({ error: "assetId, assetSource, and clientId are required" });
    return;
  }
  if (!["brand_kit", "library", "creative_asset"].includes(assetSource)) {
    res.status(400).json({ error: "assetSource must be brand_kit | library | creative_asset" });
    return;
  }
  const result = await analyzeAsset(assetId, assetSource as "brand_kit" | "library" | "creative_asset", clientId);
  res.json(result);
});

// ── Admin: POST /ai/asset-intelligence/analyze/:assetId ─────────────────────
router.post("/ai/asset-intelligence/analyze/:assetId", async (req, res): Promise<void> => {
  const assetId = parseInt(req.params["assetId"] ?? "0", 10);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }
  const { assetSource, clientId } = req.body as { assetSource?: string; clientId?: string };
  if (!assetSource || !clientId) {
    res.status(400).json({ error: "assetSource and clientId are required" });
    return;
  }
  const result = await analyzeAsset(assetId, assetSource as "brand_kit" | "library" | "creative_asset", clientId);
  res.json(result);
});

// ── Admin: GET /ai/asset-intelligence/:assetId ───────────────────────────────
router.get("/ai/asset-intelligence/:assetId", async (req, res): Promise<void> => {
  const assetId = parseInt(req.params["assetId"] ?? "0", 10);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }
  const assetSource = (req.query["source"] as string) ?? "library";
  const result = await getAssetIntelligence(assetId, assetSource);
  if (!result) {
    res.status(404).json({ error: "Asset intelligence not found. Run analyze first." });
    return;
  }
  res.json(result);
});

// ── Admin: GET /ai/asset-intelligence/duplicates/:clientId ───────────────────
router.get("/ai/asset-intelligence/duplicates/:clientId", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const report = await getDuplicateReport(clientId);
  res.json(report);
});

// ── Admin: GET /ai/asset-intelligence/client/:clientId ───────────────────────
router.get("/ai/asset-intelligence/client/:clientId", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const items = await listAssetIntelligenceForClient(clientId);
  res.json({ items, total: items.length });
});

// ── Public: GET /public/customer/workspace/:token/asset-intelligence ──────────
router.get("/public/customer/workspace/:token/asset-intelligence", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  const { session } = result;
  const items = await listAssetIntelligenceForClient(session.emailHash);
  const duplicates = await getDuplicateReport(session.emailHash);
  res.json({ items, total: items.length, duplicates });
});

// ── Public: POST /public/customer/workspace/:token/asset-intelligence/analyze/:assetId ─
router.post("/public/customer/workspace/:token/asset-intelligence/analyze/:assetId", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const assetId = parseInt(req.params["assetId"] ?? "0", 10);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  const { session } = result;
  const assetSource = (req.body as { assetSource?: string })?.assetSource ?? "library";
  const intelligence = await analyzeAsset(assetId, assetSource as "brand_kit" | "library" | "creative_asset", session.emailHash);
  res.json(intelligence);
});

export default router;
