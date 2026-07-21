/**
 * asset-browser.ts — Universal Asset Browser admin routes (Team 14)
 *
 * These routes require the admin API key (enforced by the global
 * adminAuthWithExceptions middleware in app.ts — do NOT add per-route guards).
 *
 * Tenant isolation: emailHash is always resolved server-side, never trusted
 * from raw client input without authorization context.
 *
 * No zod imports — manual validation per project convention.
 */
import { Router } from "express";
import {
  listAssetBrowserItems,
  getAssetBrowserItem,
  toggleAssetArchive,
  listAssetBrowserSources,
} from "../services/assetBrowserService.js";
import type { AssetBrowserFilter } from "../services/assetBrowserTypes.js";

const router = Router();

// ── GET /api/ai/asset-browser/sources ────────────────────────────────────────
// List available asset sources (static registry, no DB hit)
router.get("/ai/asset-browser/sources", (_req, res): void => {
  const sources = listAssetBrowserSources(true /* admin context */);
  res.json({ sources });
});

// ── GET /api/ai/asset-browser/assets ─────────────────────────────────────────
// Admin asset browser: list/search/filter assets.
// emailHash query param narrows to a single tenant; omitting it allows
// cross-tenant (platform admin only — gated by admin API key at app level).
router.get("/ai/asset-browser/assets", async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;

  // Validate sort
  const VALID_SORTS = ["newest", "oldest", "name", "size"] as const;
  type SortValue = typeof VALID_SORTS[number];
  const rawSort = q["sort"] ?? "newest";
  const sort: SortValue = (VALID_SORTS as readonly string[]).includes(rawSort)
    ? (rawSort as SortValue)
    : "newest";

  // Validate pagination
  const page = Math.max(1, parseInt(q["page"] ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(q["pageSize"] ?? "24", 10) || 24));

  const filter: AssetBrowserFilter = {
    emailHash: q["emailHash"] ?? undefined,
    search: q["search"] ?? undefined,
    category: q["category"] ?? undefined,
    assetType: q["assetType"] ?? undefined,
    sourceId: q["sourceId"] ?? undefined,
    tags: q["tags"] ? q["tags"].split(",").filter(Boolean) : undefined,
    showArchived: q["archived"] === "true",
    favoritedOnly: q["favorited"] === "true",
    projectId: q["projectId"] ?? undefined,
    sort,
    page,
    pageSize,
  };

  try {
    const result = await listAssetBrowserItems(filter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/ai/asset-browser/assets/:id ─────────────────────────────────────
// Get a single asset by id. Optional emailHash param for tenant guard.
router.get("/ai/asset-browser/assets/:id", async (req, res): Promise<void> => {
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }
  const emailHash = typeof req.query["emailHash"] === "string"
    ? req.query["emailHash"]
    : undefined;

  try {
    const item = await getAssetBrowserItem(id, emailHash);
    if (!item) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── PATCH /api/ai/asset-browser/assets/:id/archive ────────────────────────────
// Archive or restore an asset.
router.patch("/ai/asset-browser/assets/:id/archive", async (req, res): Promise<void> => {
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  if (typeof body["archive"] !== "boolean") {
    res.status(400).json({ error: "archive (boolean) is required" });
    return;
  }
  const emailHash = typeof body["emailHash"] === "string" ? body["emailHash"] : undefined;

  try {
    const item = await toggleAssetArchive(id, body["archive"] as boolean, emailHash);
    if (!item) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
