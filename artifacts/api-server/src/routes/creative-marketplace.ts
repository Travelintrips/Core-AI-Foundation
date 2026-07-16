/**
 * creative-marketplace.ts — V4.7 Creative Marketplace routes
 *
 * Admin routes (x-admin-api-key via global adminAuthWithExceptions):
 *   GET    /ai/creative-marketplace/assets               list/filter
 *   POST   /ai/creative-marketplace/assets               create
 *   GET    /ai/creative-marketplace/assets/:id           get one
 *   PATCH  /ai/creative-marketplace/assets/:id           update
 *   POST   /ai/creative-marketplace/assets/:id/feature   toggle featured
 *   POST   /ai/creative-marketplace/assets/:id/activate  toggle active
 *   GET    /ai/creative-marketplace/creators             list
 *   POST   /ai/creative-marketplace/creators             create
 *   GET    /ai/creative-marketplace/creators/:id         get one
 *   PATCH  /ai/creative-marketplace/creators/:id         update
 *   GET    /ai/creative-marketplace/analytics            dashboard stats
 *   GET    /ai/creative-marketplace/downloads            download log
 *
 * Public routes (no auth):
 *   GET    /public/creative-marketplace/assets           browse
 *   GET    /public/creative-marketplace/assets/featured  featured
 *   GET    /public/creative-marketplace/assets/categories categories list
 *   GET    /public/creative-marketplace/assets/search    search
 *   GET    /public/creative-marketplace/assets/:id       get + record view
 *   POST   /public/creative-marketplace/assets/:id/download download
 *   POST   /public/creative-marketplace/assets/:id/rate  rate
 *   GET    /public/creative-marketplace/assets/:id/ratings ratings list
 *   GET    /public/creative-marketplace/creators         list creators
 *   GET    /public/creative-marketplace/creators/:id     creator profile+assets
 *
 * Workspace routes (token auth — no admin key, public route exception):
 *   GET    /public/customer/workspace/:token/creative-marketplace/favorites
 *   POST   /public/customer/workspace/:token/creative-marketplace/favorites
 *   DELETE /public/customer/workspace/:token/creative-marketplace/favorites/:type/:id
 *   GET    /public/customer/workspace/:token/creative-marketplace/downloads
 *   GET    /public/customer/workspace/:token/creative-marketplace/assets
 */

import { Router, type Request, type Response } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import { resolveWorkspaceSession } from "../services/customerWorkspaceService.js";
import * as svc from "../services/creativeMarketplaceService.js";

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

async function resolveSession(token: string) {
  const result = await resolveWorkspaceSession(token);
  if (!result.ok || !result.session) return null;
  return result.session; // { emailHash, clientEmail, clientName }
}

function ipOf(req: Request): string | undefined {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0]?.trim();
  return req.socket?.remoteAddress;
}

// ── Admin: Assets ─────────────────────────────────────────────────────────────

router.get(
  "/ai/creative-marketplace/assets",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        assetType,
        category,
        priceType,
        search,
        featured,
        creatorId,
        sortBy,
        limit,
        offset,
      } = req.query as Record<string, string>;

      const assets = await svc.listAssets({
        assetType,
        category,
        priceType,
        search,
        featured: featured === "true" ? true : featured === "false" ? false : undefined,
        creatorId: creatorId ? parseInt(creatorId, 10) : undefined,
        sortBy: (sortBy as svc.ListAssetsFilter["sortBy"]) ?? "newest",
        limit: limit ? parseInt(limit, 10) : 24,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json({ items: assets, total: assets.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.post(
  "/ai/creative-marketplace/assets",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!body.assetCode || !body.assetType || !body.title || !body.category) {
        res.status(400).json({ error: "assetCode, assetType, title, category required" });
        return;
      }
      const asset = await svc.createAsset({
        assetCode: body.assetCode as string,
        assetType: body.assetType as string,
        title: body.title as string,
        category: body.category as string,
        description: body.description as string | undefined,
        tags: (body.tags as string[]) ?? [],
        creatorId: body.creatorId ? parseInt(body.creatorId as string, 10) : undefined,
        priceType: (body.priceType as string) ?? "free",
        priceAmount: (body.priceAmount as string) ?? "0",
        currency: (body.currency as string) ?? "IDR",
        fileUrl: body.fileUrl as string | undefined,
        previewUrls: (body.previewUrls as string[]) ?? [],
        thumbnailUrl: body.thumbnailUrl as string | undefined,
        fileFormat: body.fileFormat as string | undefined,
        license: (body.license as string) ?? "standard",
        isFeatured: body.isFeatured === true,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      res.status(201).json(asset);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/ai/creative-marketplace/assets/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
      const asset = await svc.getAsset(id);
      if (!asset) { res.status(404).json({ error: "not found" }); return; }
      res.json(asset);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.patch(
  "/ai/creative-marketplace/assets/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
      const asset = await svc.updateAsset(id, req.body as Record<string, unknown>);
      if (!asset) { res.status(404).json({ error: "not found" }); return; }
      res.json(asset);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.post(
  "/ai/creative-marketplace/assets/:id/feature",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
      const { featured } = req.body as { featured?: boolean };
      const asset = await svc.featureAsset(id, featured !== false);
      if (!asset) { res.status(404).json({ error: "not found" }); return; }
      res.json(asset);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.post(
  "/ai/creative-marketplace/assets/:id/activate",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
      const { active } = req.body as { active?: boolean };
      const asset = await svc.activateAsset(id, active !== false);
      if (!asset) { res.status(404).json({ error: "not found" }); return; }
      res.json(asset);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// ── Admin: Creators ───────────────────────────────────────────────────────────

router.get(
  "/ai/creative-marketplace/creators",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, isVerified, limit, offset } = req.query as Record<string, string>;
      const creators = await svc.listCreators({
        search,
        isVerified: isVerified === "true" ? true : isVerified === "false" ? false : undefined,
        limit: limit ? parseInt(limit, 10) : 24,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json({ items: creators, total: creators.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.post(
  "/ai/creative-marketplace/creators",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!body.creatorCode || !body.displayName) {
        res.status(400).json({ error: "creatorCode and displayName required" });
        return;
      }
      const creator = await svc.createCreator({
        creatorCode: body.creatorCode as string,
        displayName: body.displayName as string,
        bio: body.bio as string | undefined,
        avatarUrl: body.avatarUrl as string | undefined,
        websiteUrl: body.websiteUrl as string | undefined,
        email: body.email as string | undefined,
        isVerified: body.isVerified === true,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      res.status(201).json(creator);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/ai/creative-marketplace/creators/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
      const creator = await svc.getCreator(id);
      if (!creator) { res.status(404).json({ error: "not found" }); return; }
      res.json(creator);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.patch(
  "/ai/creative-marketplace/creators/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
      const creator = await svc.updateCreator(id, req.body as Record<string, unknown>);
      if (!creator) { res.status(404).json({ error: "not found" }); return; }
      res.json(creator);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// ── Admin: Analytics & Downloads ──────────────────────────────────────────────

router.get(
  "/ai/creative-marketplace/analytics",
  adminAuth,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const analytics = await svc.getMarketplaceAnalytics();
      res.json(analytics);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/ai/creative-marketplace/downloads",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = req.query as Record<string, string>;
      const downloads = await svc.getAdminDownloads(
        limit ? parseInt(limit, 10) : 100,
        offset ? parseInt(offset, 10) : 0,
      );
      res.json({ items: downloads });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// ── Public: Assets ────────────────────────────────────────────────────────────
// Note: static segments (featured, categories, search) BEFORE :id

router.get(
  "/public/creative-marketplace/assets/featured",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit } = req.query as Record<string, string>;
      const items = await svc.listFeatured(limit ? parseInt(limit, 10) : 12);
      res.json({ items });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/public/creative-marketplace/assets/categories",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const categories = await svc.listCategories();
      res.json({ assetTypes: svc.ASSET_TYPES, categories });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/public/creative-marketplace/assets/search",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { q, assetType, limit } = req.query as Record<string, string>;
      if (!q) { res.status(400).json({ error: "q required" }); return; }
      const results = await svc.searchMarketplace(q, {
        assetType,
        limit: limit ? parseInt(limit, 10) : 20,
      });
      res.json(results);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/public/creative-marketplace/assets",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { assetType, category, priceType, search, sortBy, limit, offset } =
        req.query as Record<string, string>;
      const assets = await svc.listAssets({
        assetType,
        category,
        priceType,
        search,
        sortBy: (sortBy as svc.ListAssetsFilter["sortBy"]) ?? "newest",
        limit: limit ? parseInt(limit, 10) : 24,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json({ items: assets, total: assets.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/public/creative-marketplace/assets/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
      const asset = await svc.getAsset(id);
      if (!asset || !asset.isActive) { res.status(404).json({ error: "not found" }); return; }
      // async view bump — don't await
      svc.recordAssetView(id).catch(() => undefined);
      res.json(asset);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.post(
  "/public/creative-marketplace/assets/:id/download",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
      const { customerEmail } = req.body as { customerEmail?: string };
      const result = await svc.downloadAsset(id, customerEmail, ipOf(req));
      res.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "internal error";
      const status = msg.includes("not found") ? 404 : 500;
      res.status(status).json({ error: msg });
    }
  },
);

router.post(
  "/public/creative-marketplace/assets/:id/rate",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
      const { customerEmail, rating, review } = req.body as {
        customerEmail?: string;
        rating?: number;
        review?: string;
      };
      if (!customerEmail || !rating) {
        res.status(400).json({ error: "customerEmail and rating required" });
        return;
      }
      const result = await svc.rateItem(customerEmail, "asset", id, rating, review);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/public/creative-marketplace/assets/:id/ratings",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
      const ratings = await svc.getItemRatings("asset", id);
      res.json({ items: ratings });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// ── Public: Creators ──────────────────────────────────────────────────────────

router.get(
  "/public/creative-marketplace/creators",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, limit, offset } = req.query as Record<string, string>;
      const creators = await svc.listCreators({
        search,
        limit: limit ? parseInt(limit, 10) : 24,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json({ items: creators });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/public/creative-marketplace/creators/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
      const creator = await svc.getCreator(id);
      if (!creator) { res.status(404).json({ error: "not found" }); return; }
      res.json(creator);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// ── Workspace: Favourites ─────────────────────────────────────────────────────

router.get(
  "/public/customer/workspace/:token/creative-marketplace/favorites",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await resolveSession(req.params.token);
      if (!session) { res.status(404).json({ error: "workspace not found" }); return; }
      const favs = await svc.getFavorites(session.clientEmail);
      res.json(favs);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.post(
  "/public/customer/workspace/:token/creative-marketplace/favorites",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await resolveSession(req.params.token);
      if (!session) { res.status(404).json({ error: "workspace not found" }); return; }
      const { itemType, itemId } = req.body as { itemType?: string; itemId?: number };
      if (!itemType || !itemId) {
        res.status(400).json({ error: "itemType and itemId required" });
        return;
      }
      if (!["asset", "template"].includes(itemType)) {
        res.status(400).json({ error: "itemType must be asset or template" });
        return;
      }
      const result = await svc.addFavorite(
        session.clientEmail,
        itemType as "asset" | "template",
        itemId,
      );
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.delete(
  "/public/customer/workspace/:token/creative-marketplace/favorites/:itemType/:itemId",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await resolveSession(req.params.token);
      if (!session) { res.status(404).json({ error: "workspace not found" }); return; }
      const { itemType, itemId } = req.params;
      const id = parseInt(itemId, 10);
      if (isNaN(id)) { res.status(400).json({ error: "invalid itemId" }); return; }
      await svc.removeFavorite(session.clientEmail, itemType, id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// ── Workspace: Downloads & Assets ─────────────────────────────────────────────

router.get(
  "/public/customer/workspace/:token/creative-marketplace/downloads",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await resolveSession(req.params.token);
      if (!session) { res.status(404).json({ error: "workspace not found" }); return; }
      const { limit } = req.query as Record<string, string>;
      const downloads = await svc.getCustomerDownloads(
        session.clientEmail,
        limit ? parseInt(limit, 10) : 50,
      );
      res.json({ items: downloads });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/public/customer/workspace/:token/creative-marketplace/assets",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await resolveSession(req.params.token);
      if (!session) { res.status(404).json({ error: "workspace not found" }); return; }
      const { assetType, category, priceType, search, sortBy, limit, offset } =
        req.query as Record<string, string>;
      const assets = await svc.listAssets({
        assetType,
        category,
        priceType,
        search,
        sortBy: (sortBy as svc.ListAssetsFilter["sortBy"]) ?? "popular",
        limit: limit ? parseInt(limit, 10) : 24,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json({ items: assets });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

export default router;
