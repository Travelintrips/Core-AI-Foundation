/**
 * routes/asset-intelligence-v2/index.ts — Team 06 API routes
 *
 * All routes are LOCAL to Team 06's path prefix: /ai/asset-intelligence/v2/...
 * This router is NOT mounted yet — Team 24 wires it into app.ts.
 *
 * Admin routes require X-Admin-Api-Key (enforced by global adminAuth middleware).
 * Public routes use token-based workspace auth (/public/... prefix).
 *
 * Convention: no zod imports — manual validation only.
 */

import { Router } from "express";
import {
  analyzeAssetV2,
  batchAnalyzeAssetsV2,
  getIntelligenceV2,
  listIntelligenceV2ForClient,
  getDuplicateReportV2,
} from "../../services/asset-intelligence-v2/orchestrator.js";
import { findSimilarAssets } from "../../services/asset-intelligence-v2/similarAsset.js";
import {
  getVersionChain,
  listVersionChainsForClient,
  autoGroupVersionChains,
  createVersionChain,
  addMemberToChain,
} from "../../services/asset-intelligence-v2/versionChain.js";
import {
  upsertLicensing,
  getLicensing,
  getLicensingRedacted,
} from "../../services/asset-intelligence-v2/licensing.js";
import {
  getAssetSafety,
  listUnsafeAssetsForClient,
} from "../../services/asset-intelligence-v2/assetSafety.js";
import {
  getKnowledgeTagsForAssetType,
  inferAssetTypeFromTags,
} from "../../services/asset-intelligence-v2/knowledgeTag.js";
import { normalizeTags } from "../../services/asset-intelligence-v2/tagNormalization.js";
import { ASSET_TYPE_V2, LICENSE_TYPES } from "../../services/asset-intelligence-v2/types.js";
import { resolveWorkspaceSession } from "../../services/customerWorkspaceService.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAssetId(raw: string | undefined): number | null {
  const n = parseInt(raw ?? "0", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function withSession(req: import("express").Request, res: import("express").Response) {
  const { token } = req.params as { token: string };
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return null;
  }
  return result.session;
}

// ════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES  (protected by global adminAuth middleware)
// ════════════════════════════════════════════════════════════════════════════

// ── POST /ai/asset-intelligence/v2/analyze/:assetId ──────────────────────────
router.post("/ai/asset-intelligence/v2/analyze/:assetId", async (req, res): Promise<void> => {
  const assetId = parseAssetId(req.params["assetId"]);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }

  const { assetSource, clientId, reanalyze, skipSafety, skipLicensing } = req.body as {
    assetSource?: string; clientId?: string;
    reanalyze?: boolean; skipSafety?: boolean; skipLicensing?: boolean;
  };

  if (!assetSource || !clientId) {
    res.status(400).json({ error: "assetSource and clientId are required" });
    return;
  }
  if (!["brand_kit", "library", "creative_asset"].includes(assetSource)) {
    res.status(400).json({ error: "assetSource must be brand_kit | library | creative_asset" });
    return;
  }

  const result = await analyzeAssetV2(
    assetId,
    assetSource as "brand_kit" | "library" | "creative_asset",
    clientId,
    { reanalyze: !!reanalyze, skipSafety: !!skipSafety, skipLicensing: !!skipLicensing },
  );
  res.json(result);
});

// ── POST /ai/asset-intelligence/v2/analyze-batch ─────────────────────────────
router.post("/ai/asset-intelligence/v2/analyze-batch", async (req, res): Promise<void> => {
  const { assets, clientId, options } = req.body as {
    assets?: Array<{ assetId: number; assetSource: string }>;
    clientId?: string;
    options?: { reanalyze?: boolean; skipSafety?: boolean; skipLicensing?: boolean };
  };

  if (!Array.isArray(assets) || assets.length === 0) {
    res.status(400).json({ error: "assets array is required and must not be empty" });
    return;
  }
  if (!clientId) {
    res.status(400).json({ error: "clientId is required" });
    return;
  }
  if (assets.length > 100) {
    res.status(400).json({ error: "Batch size cannot exceed 100 assets" });
    return;
  }

  const validSources = new Set(["brand_kit", "library", "creative_asset"]);
  for (const a of assets) {
    if (!a.assetId || !a.assetSource || !validSources.has(a.assetSource)) {
      res.status(400).json({ error: `Invalid asset entry: assetId=${a.assetId} assetSource=${a.assetSource}` });
      return;
    }
  }

  const result = await batchAnalyzeAssetsV2({
    assets: assets as Array<{ assetId: number; assetSource: "brand_kit" | "library" | "creative_asset" }>,
    clientId,
    options,
  });
  res.json(result);
});

// ── GET /ai/asset-intelligence/v2/client/:clientId ───────────────────────────
router.get("/ai/asset-intelligence/v2/client/:clientId", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const items = await listIntelligenceV2ForClient(clientId);
  res.json({ items, total: items.length });
});

// ── GET /ai/asset-intelligence/v2/duplicates/:clientId ───────────────────────
router.get("/ai/asset-intelligence/v2/duplicates/:clientId", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const report = await getDuplicateReportV2(clientId);
  res.json(report);
});

// ── GET /ai/asset-intelligence/v2/similar/:assetId ───────────────────────────
router.get("/ai/asset-intelligence/v2/similar/:assetId", async (req, res): Promise<void> => {
  const assetId = parseAssetId(req.params["assetId"]);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }

  const q = req.query as Record<string, string | undefined>;
  const assetSource = q["source"] ?? "library";
  const clientId    = q["clientId"];
  const limit       = Math.min(parseInt(q["limit"] ?? "10", 10), 20);

  if (!clientId) { res.status(400).json({ error: "clientId query param is required" }); return; }

  const results = await findSimilarAssets(assetId, assetSource, clientId, limit);
  res.json({ assetId, assetSource, similar: results, total: results.length });
});

// ── GET /ai/asset-intelligence/v2/:assetId ───────────────────────────────────
router.get("/ai/asset-intelligence/v2/:assetId", async (req, res): Promise<void> => {
  const assetId = parseAssetId(req.params["assetId"]);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }

  const q = req.query as Record<string, string | undefined>;
  const assetSource = q["source"] ?? "library";
  const clientId    = q["clientId"];

  if (!clientId) { res.status(400).json({ error: "clientId query param is required" }); return; }

  const result = await getIntelligenceV2(assetId, assetSource, clientId);
  if (!result) {
    res.status(404).json({ error: "No v2 intelligence found. Run /analyze first." });
    return;
  }
  res.json(result);
});

// ── Version chain routes ──────────────────────────────────────────────────────

// GET /ai/asset-intelligence/v2/version-chains/:clientId
router.get("/ai/asset-intelligence/v2/version-chains/:clientId", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const chains = await listVersionChainsForClient(clientId);
  res.json({ chains, total: chains.length });
});

// GET /ai/asset-intelligence/v2/version-chain/:chainId
router.get("/ai/asset-intelligence/v2/version-chain/:chainId", async (req, res): Promise<void> => {
  const chainId = parseAssetId(req.params["chainId"]);
  if (!chainId) { res.status(400).json({ error: "Invalid chainId" }); return; }
  const chain = await getVersionChain(chainId);
  if (!chain) { res.status(404).json({ error: "Version chain not found" }); return; }
  res.json(chain);
});

// POST /ai/asset-intelligence/v2/version-chains/auto-group
router.post("/ai/asset-intelligence/v2/version-chains/auto-group", async (req, res): Promise<void> => {
  const { clientId } = req.body as { clientId?: string };
  if (!clientId) { res.status(400).json({ error: "clientId is required" }); return; }
  const result = await autoGroupVersionChains(clientId);
  res.json(result);
});

// POST /ai/asset-intelligence/v2/version-chains
router.post("/ai/asset-intelligence/v2/version-chains", async (req, res): Promise<void> => {
  const { clientId, primaryAssetId } = req.body as { clientId?: string; primaryAssetId?: number };
  if (!clientId) { res.status(400).json({ error: "clientId is required" }); return; }
  const chainId = await createVersionChain(clientId, primaryAssetId ?? null);
  res.status(201).json({ chainId });
});

// POST /ai/asset-intelligence/v2/version-chains/:chainId/members
router.post("/ai/asset-intelligence/v2/version-chains/:chainId/members", async (req, res): Promise<void> => {
  const chainId = parseAssetId(req.params["chainId"]);
  if (!chainId) { res.status(400).json({ error: "Invalid chainId" }); return; }

  const { assetId, assetSource, versionType, versionLabel, role } = req.body as {
    assetId?: number; assetSource?: string; versionType?: string;
    versionLabel?: string; role?: "primary" | "variant";
  };
  if (!assetId || !assetSource) {
    res.status(400).json({ error: "assetId and assetSource are required" });
    return;
  }

  await addMemberToChain(
    chainId,
    assetId,
    assetSource,
    versionType ?? "original",
    versionLabel ?? versionType ?? "original",
    role ?? "variant",
  );
  res.json({ ok: true, chainId, assetId });
});

// ── Licensing routes ──────────────────────────────────────────────────────────

// GET /ai/asset-intelligence/v2/licensing/:assetId
router.get("/ai/asset-intelligence/v2/licensing/:assetId", async (req, res): Promise<void> => {
  const assetId = parseAssetId(req.params["assetId"]);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }
  const assetSource = (req.query["source"] as string) ?? "library";
  const result = await getLicensing(assetId, assetSource);
  if (!result) { res.status(404).json({ error: "No licensing record found" }); return; }
  res.json(result);
});

// PUT /ai/asset-intelligence/v2/licensing/:assetId
router.put("/ai/asset-intelligence/v2/licensing/:assetId", async (req, res): Promise<void> => {
  const assetId = parseAssetId(req.params["assetId"]);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }

  const { assetSource, clientId, licenseType, licenseOwner, attribution, usageRights, restrictions, expiresAt, notes } =
    req.body as {
      assetSource?: string; clientId?: string; licenseType?: string;
      licenseOwner?: string; attribution?: string; usageRights?: string[];
      restrictions?: string[]; expiresAt?: string; notes?: string;
    };

  if (!assetSource || !clientId || !licenseType) {
    res.status(400).json({ error: "assetSource, clientId, and licenseType are required" });
    return;
  }
  if (!LICENSE_TYPES.includes(licenseType as never)) {
    res.status(400).json({ error: `licenseType must be one of: ${LICENSE_TYPES.join(", ")}` });
    return;
  }

  const result = await upsertLicensing({
    assetId, assetSource, clientId,
    licenseType: licenseType as import("../../services/asset-intelligence-v2/types.js").LicenseType,
    licenseOwner, attribution, usageRights, restrictions, expiresAt, notes,
  });
  res.json(result);
});

// ── Safety routes ─────────────────────────────────────────────────────────────

// GET /ai/asset-intelligence/v2/safety/:assetId
router.get("/ai/asset-intelligence/v2/safety/:assetId", async (req, res): Promise<void> => {
  const assetId = parseAssetId(req.params["assetId"]);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }
  const assetSource = (req.query["source"] as string) ?? "library";
  const result = await getAssetSafety(assetId, assetSource);
  if (!result) { res.status(404).json({ error: "No safety record found. Run /analyze first." }); return; }
  res.json(result);
});

// GET /ai/asset-intelligence/v2/safety-report/:clientId
router.get("/ai/asset-intelligence/v2/safety-report/:clientId", async (req, res): Promise<void> => {
  const { clientId } = req.params as { clientId: string };
  const unsafe = await listUnsafeAssetsForClient(clientId);
  res.json({ clientId, flaggedAssets: unsafe, total: unsafe.length });
});

// ── Knowledge tags ────────────────────────────────────────────────────────────

// GET /ai/asset-intelligence/v2/knowledge-tags
router.get("/ai/asset-intelligence/v2/knowledge-tags", async (req, res): Promise<void> => {
  const assetType = req.query["assetType"] as string | undefined;
  if (assetType) {
    if (!ASSET_TYPE_V2.includes(assetType as never)) {
      res.status(400).json({ error: `assetType must be one of: ${ASSET_TYPE_V2.join(", ")}` });
      return;
    }
    const tags = getKnowledgeTagsForAssetType(assetType as import("../../services/asset-intelligence-v2/types.js").AssetTypeV2);
    res.json({ assetType, tags });
    return;
  }
  // Return full taxonomy grouped by asset type
  const taxonomy: Record<string, unknown[]> = {};
  for (const t of ASSET_TYPE_V2) {
    taxonomy[t] = getKnowledgeTagsForAssetType(t);
  }
  res.json({ taxonomy, assetTypes: ASSET_TYPE_V2 });
});

// POST /ai/asset-intelligence/v2/tags/normalize
router.post("/ai/asset-intelligence/v2/tags/normalize", async (req, res): Promise<void> => {
  const { tags, mimeType, fileName } = req.body as {
    tags?: string[]; mimeType?: string; fileName?: string;
  };
  if (!Array.isArray(tags)) {
    res.status(400).json({ error: "tags must be an array of strings" });
    return;
  }
  const normalized = normalizeTags(tags);
  const inferredType = inferAssetTypeFromTags(normalized, mimeType ?? null, fileName ?? "");
  res.json({ input: tags, normalized, inferredAssetType: inferredType });
});

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES  (token-based workspace auth — no admin key)
// ════════════════════════════════════════════════════════════════════════════

// GET /public/customer/workspace/:token/asset-intelligence/v2
router.get("/public/customer/workspace/:token/asset-intelligence/v2", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const items = await listIntelligenceV2ForClient(session.emailHash);
  // Redact: strip licenseOwner and notes from licensing
  const safe = items.map((item) => ({
    ...item,
    licensing: item.licensing
      ? (({ licenseOwner: _lo, notes: _n, ...rest }) => rest)(item.licensing)
      : null,
  }));
  res.json({ items: safe, total: safe.length });
});

// GET /public/customer/workspace/:token/asset-intelligence/v2/:assetId
router.get("/public/customer/workspace/:token/asset-intelligence/v2/:assetId", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const assetId = parseAssetId(req.params["assetId"]);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }
  const assetSource = (req.query["source"] as string) ?? "library";

  const result = await getIntelligenceV2(assetId, assetSource, session.emailHash);
  if (!result) { res.status(404).json({ error: "Not found" }); return; }

  // Ownership check
  if (result.clientId !== session.emailHash) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Redact sensitive licensing fields
  const safe = {
    ...result,
    licensing: result.licensing
      ? (({ licenseOwner: _lo, notes: _n, ...rest }) => rest)(result.licensing)
      : null,
  };
  res.json(safe);
});

// GET /public/customer/workspace/:token/asset-intelligence/v2/:assetId/similar
router.get("/public/customer/workspace/:token/asset-intelligence/v2/:assetId/similar", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const assetId = parseAssetId(req.params["assetId"]);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }
  const assetSource = (req.query["source"] as string) ?? "library";

  const similar = await findSimilarAssets(assetId, assetSource, session.emailHash, 10);
  res.json({ assetId, similar, total: similar.length });
});

// GET /public/customer/workspace/:token/asset-intelligence/v2/:assetId/licensing
router.get("/public/customer/workspace/:token/asset-intelligence/v2/:assetId/licensing", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const assetId = parseAssetId(req.params["assetId"]);
  if (!assetId) { res.status(400).json({ error: "Invalid assetId" }); return; }
  const assetSource = (req.query["source"] as string) ?? "library";
  // Always redacted for public
  const result = await getLicensingRedacted(assetId, assetSource);
  if (!result) { res.status(404).json({ error: "No licensing record found" }); return; }
  res.json(result);
});

export { router as assetIntelligenceV2Router };
export default router;
