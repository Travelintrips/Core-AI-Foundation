/**
 * asset-library.ts — V4.2D Customer Enterprise Asset Library routes
 *
 * CRUD, search, filter, favorite, archive, replace, tag, download.
 * Public routes are token-auth only (no admin key required).
 * No zod import — manual validation per convention.
 */
import { Router } from "express";
import { logAudit } from "../services/aiAuditService.js";
import { resolveWorkspaceSession } from "../services/customerWorkspaceService.js";
import {
  listAssetLibrary,
  getAssetLibraryItem,
  getAssetVersionHistory,
  createAssetLibraryItem,
  replaceAssetLibraryItem,
  renameAssetLibraryItem,
  toggleFavorite,
  archiveAssetLibraryItem,
  tagAssetLibraryItem,
  signAssetLibraryDownload,
  promoteCreativeAssetToLibrary,
  getAdminAssetLibraryStats,
} from "../services/assetLibraryService.js";
import { ASSET_LIBRARY_CATEGORIES } from "@workspace/db";

const router = Router();

async function withSession(req: import("express").Request, res: import("express").Response) {
  const { token } = req.params as { token: string };
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return null;
  }
  return result.session;
}

// ── GET /public/customer/workspace/:token/assets ──────────────────────────────
// List + search/filter asset library
router.get("/public/customer/workspace/:token/assets", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const q = req.query as Record<string, string | undefined>;
  const items = await listAssetLibrary(session.emailHash, {
    category: q["category"],
    search: q["search"],
    favorited: q["favorited"] === "true",
    archived: q["archived"] === "true",
    tags: q["tags"] ? q["tags"].split(",") : undefined,
    sort: q["sort"] as "newest" | "oldest" | "name" | "size" | undefined,
    projectId: q["projectId"],
  });
  res.json({ items, total: items.length });
});

// ── GET /public/customer/workspace/:token/assets/:id ─────────────────────────
router.get("/public/customer/workspace/:token/assets/:id", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const item = await getAssetLibraryItem(session.emailHash, id);
  if (!item) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(item);
});

// ── GET /public/customer/workspace/:token/assets/:id/history ─────────────────
router.get("/public/customer/workspace/:token/assets/:id/history", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const history = await getAssetVersionHistory(session.emailHash, id);
  res.json({ items: history, total: history.length });
});

// ── POST /public/customer/workspace/:token/assets ─────────────────────────────
// Create new asset library item
router.post("/public/customer/workspace/:token/assets", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const body = req.body as Record<string, unknown>;

  const category = typeof body["category"] === "string" ? body["category"] : "";
  const title = typeof body["title"] === "string" ? body["title"].trim() : "";
  const fileName = typeof body["fileName"] === "string" ? body["fileName"].trim() : "";

  if (!category || !ASSET_LIBRARY_CATEGORIES.includes(category as never)) {
    res.status(400).json({ error: `category is required. Valid: ${ASSET_LIBRARY_CATEGORIES.join(", ")}` });
    return;
  }
  if (!title) { res.status(400).json({ error: "title is required" }); return; }
  if (!fileName) { res.status(400).json({ error: "fileName is required" }); return; }

  const item = await createAssetLibraryItem({
    emailHash: session.emailHash,
    projectId: typeof body["projectId"] === "string" ? body["projectId"] : undefined,
    category,
    title,
    fileName,
    storagePath: typeof body["storagePath"] === "string" ? body["storagePath"] : undefined,
    previewUrl: typeof body["previewUrl"] === "string" ? body["previewUrl"] : undefined,
    mimeType: typeof body["mimeType"] === "string" ? body["mimeType"] : undefined,
    fileSizeBytes: typeof body["fileSizeBytes"] === "number" ? body["fileSizeBytes"] : undefined,
    uploadedBy: session.clientEmail,
    tags: Array.isArray(body["tags"]) ? (body["tags"] as string[]) : undefined,
  });

  res.status(201).json(item);
});

// ── POST /public/customer/workspace/:token/assets/:id/replace ────────────────
// Replace (new version) of an existing asset
router.post("/public/customer/workspace/:token/assets/:id/replace", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body as Record<string, unknown>;
  const fileName = typeof body["fileName"] === "string" ? body["fileName"].trim() : "";
  if (!fileName) { res.status(400).json({ error: "fileName is required" }); return; }

  try {
    const item = await replaceAssetLibraryItem({
      parentId: id,
      emailHash: session.emailHash,
      category: typeof body["category"] === "string" ? body["category"] : "",
      title: typeof body["title"] === "string" ? body["title"] : "",
      fileName,
      storagePath: typeof body["storagePath"] === "string" ? body["storagePath"] : undefined,
      previewUrl: typeof body["previewUrl"] === "string" ? body["previewUrl"] : undefined,
      mimeType: typeof body["mimeType"] === "string" ? body["mimeType"] : undefined,
      fileSizeBytes: typeof body["fileSizeBytes"] === "number" ? body["fileSizeBytes"] : undefined,
      uploadedBy: session.clientEmail,
      tags: Array.isArray(body["tags"]) ? (body["tags"] as string[]) : undefined,
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// ── PATCH /public/customer/workspace/:token/assets/:id/rename ────────────────
router.patch("/public/customer/workspace/:token/assets/:id/rename", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body as Record<string, unknown>;
  const title = typeof body["title"] === "string" ? body["title"].trim() : "";
  if (!title) { res.status(400).json({ error: "title is required" }); return; }

  const updated = await renameAssetLibraryItem(session.emailHash, id, title);
  if (!updated) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(updated);
});

// ── POST /public/customer/workspace/:token/assets/:id/favorite ───────────────
router.post("/public/customer/workspace/:token/assets/:id/favorite", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updated = await toggleFavorite(session.emailHash, id);
  if (!updated) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(updated);
});

// ── POST /public/customer/workspace/:token/assets/:id/archive ────────────────
router.post("/public/customer/workspace/:token/assets/:id/archive", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updated = await archiveAssetLibraryItem(session.emailHash, id);
  if (!updated) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(updated);
});

// ── PATCH /public/customer/workspace/:token/assets/:id/tags ──────────────────
router.patch("/public/customer/workspace/:token/assets/:id/tags", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body as Record<string, unknown>;
  const tags = Array.isArray(body["tags"]) ? (body["tags"] as string[]) : [];
  const updated = await tagAssetLibraryItem(session.emailHash, id, tags);
  if (!updated) { res.status(404).json({ error: "Asset not found" }); return; }
  res.json(updated);
});

// ── POST /public/customer/workspace/:token/assets/:id/sign ───────────────────
// Generate a signed download URL for an asset
router.post("/public/customer/workspace/:token/assets/:id/sign", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const id = parseInt((req.params as { id: string }).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const result = await signAssetLibraryDownload(session.emailHash, id);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(201).json({ ...result, downloadUrl: `/api${result.accessPath}` });
});

// ── POST /public/customer/workspace/:token/assets/promote/:sourceAssetId ──────
// Promote an AI-generated creative asset into the asset library
router.post(
  "/public/customer/workspace/:token/assets/promote/:sourceAssetId",
  async (req, res): Promise<void> => {
    const session = await withSession(req, res);
    if (!session) return;
    const sourceAssetId = parseInt((req.params as { sourceAssetId: string }).sourceAssetId, 10);
    if (isNaN(sourceAssetId)) { res.status(400).json({ error: "Invalid sourceAssetId" }); return; }

    const body = req.body as Record<string, unknown>;
    const item = await promoteCreativeAssetToLibrary(session.emailHash, sourceAssetId, {
      category: typeof body["category"] === "string" ? body["category"] : undefined,
      title: typeof body["title"] === "string" ? body["title"] : undefined,
      uploadedBy: session.clientEmail,
    });
    if (!item) { res.status(404).json({ error: "Source asset not found" }); return; }
    res.status(201).json(item);
  },
);

// ── Admin ─────────────────────────────────────────────────────────────────────

router.get("/ai/asset-library/stats", async (_req, res): Promise<void> => {
  const stats = await getAdminAssetLibraryStats();
  res.json(stats);
});

export default router;
