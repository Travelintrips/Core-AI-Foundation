/**
 * routes/public.ts — Team 21 CM2 public routes (no auth required)
 *
 * All under /public/cm2/*
 * Security: only approved + active listings are ever returned.
 *           fileUrl is NEVER included in any response here.
 */
import { Router, type Request, type Response } from "express";
import * as svc from "../service.js";
import type { CM2ListFilter } from "../types.js";
import { CM2_ITEM_TYPES } from "../types.js";

const router = Router();

function ipOf(req: Request): string | undefined {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0]?.trim();
  return req.socket?.remoteAddress;
}

// Browse with filters + search
router.get(
  "/public/cm2/listings",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, string>;
      const tags = q["tags"] ? q["tags"].split(",").map((t) => t.trim()) : undefined;
      const filter: CM2ListFilter = {
        itemType: q["itemType"],
        category: q["category"],
        priceType: q["priceType"],
        licenseType: q["licenseType"],
        search: q["search"],
        tags,
        featured: q["featured"] === "true" ? true : undefined,
        creatorId: q["creatorId"] ? parseInt(q["creatorId"], 10) : undefined,
        sortBy: (q["sortBy"] as CM2ListFilter["sortBy"]) ?? "newest",
        limit: q["limit"] ? Math.min(parseInt(q["limit"], 10), 100) : 24,
        offset: q["offset"] ? parseInt(q["offset"], 10) : 0,
      };
      const items = await svc.browseListings(filter);
      res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// Featured listings shortcut
router.get(
  "/public/cm2/listings/featured",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const items = await svc.browseListings({ featured: true, sortBy: "popular", limit: 12 });
      res.json({ items });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// Item type taxonomy
router.get(
  "/public/cm2/item-types",
  (_req: Request, res: Response): void => {
    res.json({ itemTypes: [...CM2_ITEM_TYPES] });
  },
);

// Distinct categories (from approved listings)
router.get(
  "/public/cm2/categories",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, string>;
      const filter: CM2ListFilter = {
        itemType: q["itemType"],
        limit: 200,
      };
      const items = await svc.browseListings(filter);
      const categories = [...new Set(items.map((i) => i.category))].sort();
      res.json({ categories });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// Get single listing (records a view)
router.get(
  "/public/cm2/listings/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const listing = await svc.getListingPublic(id);
      if (!listing) { res.status(404).json({ error: "Not found or not available" }); return; }
      res.json(listing);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// Record a download (download intent — actual file delivery is via signed URL from object storage)
router.post(
  "/public/cm2/listings/:id/download",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const { customerEmail } = req.body as { customerEmail?: string };
      const result = await svc.recordDownload({
        listingId: id,
        customerEmail,
        ipAddress: ipOf(req),
      });
      if (!result.ok) { res.status(404).json({ error: result.reason }); return; }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// Submit rating (1-5 stars)
router.post(
  "/public/cm2/listings/:id/rate",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const { customerEmail, rating, review } = req.body as {
        customerEmail: string; rating: number; review?: string;
      };
      if (!customerEmail || typeof customerEmail !== "string") {
        res.status(400).json({ error: "customerEmail required" });
        return;
      }
      const result = await svc.submitRating({ customerEmail, listingId: id, rating, review });
      if (!result.ok) { res.status(400).json({ error: result.reason }); return; }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// Get ratings for a listing
router.get(
  "/public/cm2/listings/:id/ratings",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params["id"] as string, 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
      const ratings = await svc.getListingRatings(id);
      res.json({ items: ratings, total: ratings.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// Creator profiles (public)
router.get(
  "/public/cm2/creators",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const creators = await svc.listCreatorsPublic();
      res.json({ items: creators, total: creators.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

router.get(
  "/public/cm2/creators/:code",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { code } = req.params as { code: string };
      const profile = await svc.getCreatorProfile(code);
      if (!profile) { res.status(404).json({ error: "Creator not found" }); return; }
      res.json(profile);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

export default router;
