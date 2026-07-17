/**
 * routes/workspace.ts — Team 21 CM2 workspace routes (token auth)
 *
 * All under /public/customer/workspace/:token/cm2/*
 * Session resolved via resolveWorkspaceSession (existing core service).
 * IDOR: every query scoped to session.clientEmail.
 * fileUrl is NEVER returned.
 */
import { Router, type Request, type Response } from "express";
import { resolveWorkspaceSession } from "../../../services/customerWorkspaceService.js";
import * as svc from "../service.js";

const router = Router();

async function resolveSession(token: string) {
  const result = await resolveWorkspaceSession(token);
  if (!result.ok || !result.session) return null;
  return result.session;
}

// GET favorites
router.get(
  "/public/customer/workspace/:token/cm2/favorites",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await resolveSession(req.params["token"] as string);
      if (!session) { res.status(401).json({ error: "Invalid or expired workspace token" }); return; }
      const items = await svc.getFavorites(session.clientEmail);
      res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// POST add favorite
router.post(
  "/public/customer/workspace/:token/cm2/favorites/:listingId",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await resolveSession(req.params["token"] as string);
      if (!session) { res.status(401).json({ error: "Invalid or expired workspace token" }); return; }
      const listingId = parseInt(req.params["listingId"] as string, 10);
      if (isNaN(listingId)) { res.status(400).json({ error: "Invalid listingId" }); return; }
      const result = await svc.addFavorite(session.clientEmail, listingId);
      if (!result.ok) { res.status(404).json({ error: result.reason }); return; }
      res.status(201).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// DELETE remove favorite
router.delete(
  "/public/customer/workspace/:token/cm2/favorites/:listingId",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await resolveSession(req.params["token"] as string);
      if (!session) { res.status(401).json({ error: "Invalid or expired workspace token" }); return; }
      const listingId = parseInt(req.params["listingId"] as string, 10);
      if (isNaN(listingId)) { res.status(400).json({ error: "Invalid listingId" }); return; }
      const result = await svc.removeFavorite(session.clientEmail, listingId);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// GET customer download history
router.get(
  "/public/customer/workspace/:token/cm2/downloads",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await resolveSession(req.params["token"] as string);
      if (!session) { res.status(401).json({ error: "Invalid or expired workspace token" }); return; }
      const items = await svc.getCustomerDownloads(session.clientEmail);
      res.json({ items, total: items.length });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

// POST submit rating from workspace (token-authenticated)
router.post(
  "/public/customer/workspace/:token/cm2/listings/:id/rate",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await resolveSession(req.params["token"] as string);
      if (!session) { res.status(401).json({ error: "Invalid or expired workspace token" }); return; }
      const listingId = parseInt(req.params["id"] as string, 10);
      if (isNaN(listingId)) { res.status(400).json({ error: "Invalid id" }); return; }
      const { rating, review } = req.body as { rating: number; review?: string };
      const result = await svc.submitRating({
        customerEmail: session.clientEmail,
        listingId,
        rating,
        review,
      });
      if (!result.ok) { res.status(400).json({ error: result.reason }); return; }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
    }
  },
);

export default router;
