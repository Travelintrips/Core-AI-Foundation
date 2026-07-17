/**
 * routes/admin.ts — Team 21 CM2 admin routes
 *
 * All under /ai/cm2/* — protected by adminAuth middleware (x-admin-api-key).
 * Never mounts at /api prefix — app.ts does that via the central router.
 */
import { Router, type Request, type Response } from "express";
import { adminAuth } from "../../../middleware/adminAuth.js";
import * as svc from "../service.js";
import type { CM2ListFilter, CM2ModerationState } from "../types.js";

const router = Router();

// ── Listings ──────────────────────────────────────────────────────────────────

router.get(
  "/ai/cm2/listings",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, string>;
      const filter: CM2ListFilter = {
        itemType: q["itemType"],
        category: q["category"],
        priceType: q["priceType"],
        licenseType: q["licenseType"],
        search: q["search"],
        moderationState: q["moderationState"] as CM2ModerationState | undefined,
        creatorId: q["creatorId"] ? parseInt(q["creatorId"], 10) : undefined,
        featured: q["featured"] === "true" ? true : q["featured"] === "false" ? false : undefined,
        sortBy: (q["sortBy"] as CM2ListFilter["sortBy"]) ?? "newest",
        limit: q["limit"] ? parseInt(q["limit"], 10) : 50,
        offset: q["offset"] ? parseInt(q["offset"], 10) : 0,
      };
      const items = await svc.adminListListings(filter);
      res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.post(
  "/ai/cm2/listings",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const b = req.body as Record<string, unknown>;
      const required = ["listingCode", "itemType", "title", "category"];
      const missing = required.filter((k) => !b[k]);
      if (missing.length > 0) {
        res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
        return;
      }
      const listing = await svc.adminCreateListing({
        listingCode: b["listingCode"] as string,
        itemType: b["itemType"] as string,
        title: b["title"] as string,
        category: b["category"] as string,
        description: b["description"] as string | undefined,
        tags: (b["tags"] as string[]) ?? [],
        creatorId: b["creatorId"] ? parseInt(b["creatorId"] as string, 10) : undefined,
        priceType: (b["priceType"] as string) ?? "free",
        priceAmount: (b["priceAmount"] as string) ?? "0",
        currency: (b["currency"] as string) ?? "IDR",
        licenseType: (b["licenseType"] as string) ?? "standard",
        licenseMetadata: (b["licenseMetadata"] as Record<string, unknown>) ?? {},
        fileUrl: b["fileUrl"] as string | undefined,
        previewUrls: (b["previewUrls"] as string[]) ?? [],
        thumbnailUrl: b["thumbnailUrl"] as string | undefined,
        fileFormat: b["fileFormat"] as string | undefined,
        fileSizeBytes: b["fileSizeBytes"] ? Number(b["fileSizeBytes"]) : undefined,
        metadata: (b["metadata"] as Record<string, unknown>) ?? {},
      });
      res.status(201).json(listing);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "internal error";
      if (msg.includes("Duplicate")) { res.status(409).json({ error: msg }); return; }
      res.status(500).json({ error: msg });
    }
  },
);

router.get(
  "/ai/cm2/listings/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const listing = await svc.adminGetListing(id);
      if (!listing) { res.status(404).json({ error: "Not found" }); return; }
      res.json(listing);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.patch(
  "/ai/cm2/listings/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const b = req.body as Record<string, unknown>;
      const listing = await svc.adminUpdateListing(id, {
        title: b["title"] as string | undefined,
        description: b["description"] as string | undefined,
        category: b["category"] as string | undefined,
        tags: b["tags"] as string[] | undefined,
        priceType: b["priceType"] as string | undefined,
        priceAmount: b["priceAmount"] as string | undefined,
        licenseType: b["licenseType"] as string | undefined,
        licenseMetadata: b["licenseMetadata"] as Record<string, unknown> | undefined,
        fileUrl: b["fileUrl"] as string | undefined,
        previewUrls: b["previewUrls"] as string[] | undefined,
        thumbnailUrl: b["thumbnailUrl"] as string | undefined,
        isFeatured: b["isFeatured"] as boolean | undefined,
        isActive: b["isActive"] as boolean | undefined,
      });
      if (!listing) { res.status(404).json({ error: "Not found" }); return; }
      res.json(listing);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// Moderation endpoint
router.post(
  "/ai/cm2/listings/:id/moderate",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const { state, reason, adminNote } = req.body as {
        state: CM2ModerationState; reason?: string; adminNote?: string;
      };
      const validStates: CM2ModerationState[] = ["pending", "approved", "rejected", "suspended"];
      if (!validStates.includes(state)) {
        res.status(400).json({ error: `state must be one of: ${validStates.join(", ")}` });
        return;
      }
      const performedBy = (req.headers["x-admin-api-key"] as string)?.slice(-8) ?? "admin";
      const listing = await svc.adminModerateListing(id, state, performedBy, reason, adminNote);
      if (!listing) { res.status(404).json({ error: "Not found" }); return; }
      res.json(listing);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "internal error";
      if (msg.includes("already in state")) { res.status(409).json({ error: msg }); return; }
      res.status(500).json({ error: msg });
    }
  },
);

router.post(
  "/ai/cm2/listings/:id/feature",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const listing = await svc.adminToggleFeatured(id);
      if (!listing) { res.status(404).json({ error: "Not found" }); return; }
      res.json(listing);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// Moderation log
router.get(
  "/ai/cm2/listings/:id/moderation-log",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const log = await svc.adminGetModerationLog(id);
      res.json({ items: log });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// Moderation queue (all pending)
router.get(
  "/ai/cm2/moderation-queue",
  adminAuth,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const items = await svc.adminGetModerationQueue();
      res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// ── Creators ──────────────────────────────────────────────────────────────────

router.get(
  "/ai/cm2/creators",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, string>;
      const items = await svc.adminListCreators({
        verified: q["verified"] === "true" ? true : q["verified"] === "false" ? false : undefined,
        limit: q["limit"] ? parseInt(q["limit"], 10) : 50,
        offset: q["offset"] ? parseInt(q["offset"], 10) : 0,
      });
      res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.post(
  "/ai/cm2/creators",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const b = req.body as Record<string, unknown>;
      if (!b["creatorCode"] || !b["displayName"]) {
        res.status(400).json({ error: "creatorCode and displayName required" });
        return;
      }
      const creator = await svc.adminCreateCreator({
        creatorCode: b["creatorCode"] as string,
        displayName: b["displayName"] as string,
        bio: b["bio"] as string | undefined,
        avatarUrl: b["avatarUrl"] as string | undefined,
        websiteUrl: b["websiteUrl"] as string | undefined,
        socialLinks: b["socialLinks"] as Record<string, string> | undefined,
        email: b["email"] as string | undefined,
      });
      res.status(201).json(creator);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "internal error";
      if (msg.includes("Duplicate")) { res.status(409).json({ error: msg }); return; }
      res.status(500).json({ error: msg });
    }
  },
);

router.get(
  "/ai/cm2/creators/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const creator = await svc.adminGetCreator(id);
      if (!creator) { res.status(404).json({ error: "Not found" }); return; }
      res.json(creator);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.patch(
  "/ai/cm2/creators/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const b = req.body as Record<string, unknown>;
      const creator = await svc.adminUpdateCreator(id, {
        displayName: b["displayName"] as string | undefined,
        bio: b["bio"] as string | undefined,
        avatarUrl: b["avatarUrl"] as string | undefined,
        websiteUrl: b["websiteUrl"] as string | undefined,
        socialLinks: b["socialLinks"] as Record<string, string> | undefined,
        email: b["email"] as string | undefined,
        isActive: b["isActive"] as boolean | undefined,
      });
      if (!creator) { res.status(404).json({ error: "Not found" }); return; }
      res.json(creator);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.post(
  "/ai/cm2/creators/:id/verify",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const creator = await svc.adminToggleCreatorVerified(id);
      if (!creator) { res.status(404).json({ error: "Not found" }); return; }
      res.json(creator);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get(
  "/ai/cm2/analytics",
  adminAuth,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const analytics = await svc.adminGetPlatformAnalytics();
      res.json(analytics);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/ai/cm2/analytics/listings/:id",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const data = await svc.adminGetListingAnalytics(id);
      if (!data.listing) { res.status(404).json({ error: "Not found" }); return; }
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/ai/cm2/downloads",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, string>;
      const log = await svc.adminGetDownloadLog({
        listingId: q["listingId"] ? parseInt(q["listingId"], 10) : undefined,
        limit: q["limit"] ? parseInt(q["limit"], 10) : 100,
      });
      res.json({ items: log, total: log.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

export default router;
