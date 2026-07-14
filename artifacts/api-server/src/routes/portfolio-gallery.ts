/**
 * portfolio-gallery.ts — V4.3 Portfolio Gallery & Live Preview (Team 1)
 *
 * Purely additive on top of the existing Portfolio Generator, Brand DNA,
 * Asset Library, and Customer Workspace. Adds only what those modules do
 * not already provide for the public "see samples before you buy" flow:
 *
 *   Public (no auth):
 *     GET  /api/public/portfolio-gallery/search       — free-text search + filters
 *     GET  /api/public/portfolio-gallery/industries    — industry showcase
 *     GET  /api/public/portfolio-gallery/showcase      — public showcase bundle
 *     POST /api/public/portfolio-gallery/compare        — compare 2-4 portfolios
 *
 *   Customer Workspace (token auth, reuses resolveWorkspaceSession):
 *     GET    /api/public/customer/workspace/:token/portfolio-gallery/recommended
 *     GET    /api/public/customer/workspace/:token/portfolio-gallery/favorites
 *     POST   /api/public/customer/workspace/:token/portfolio-gallery/favorites
 *     DELETE /api/public/customer/workspace/:token/portfolio-gallery/favorites/:portfolioId
 *
 *   Admin (x-admin-api-key):
 *     GET  /api/ai/portfolio-gallery/analytics
 *
 * Never touches: Queue, Dispatcher, Payment, Commercial Layer, Review
 * Engine, Asset Library, Brand Kit, Creative Runtime, Design Studio,
 * Marketplace, or the existing portfolio.ts / portfolio-public.ts /
 * templates.ts route files.
 */
import { Router } from "express";
import { requireAdminApiKey } from "../middleware/adminAuth.js";
import { resolveWorkspaceSession } from "../services/customerWorkspaceService.js";
import {
  searchPortfolios,
  getIndustryShowcase,
  getPublicShowcase,
  comparePortfolios,
  getBrandDnaRecommendations,
  listFavorites,
  addFavorite,
  removeFavorite,
  getGalleryAnalytics,
} from "../services/portfolioGalleryService.js";

const router = Router();

async function resolveToken(token: string): Promise<{ clientId: string } | null> {
  try {
    const result = await resolveWorkspaceSession(token);
    if (!result.ok) return null;
    const emailHash = result.session.emailHash;
    if (!emailHash) return null;
    return { clientId: emailHash };
  } catch {
    return null;
  }
}

// ── Public: Search ────────────────────────────────────────────────────────────

router.get("/public/portfolio-gallery/search", async (req, res) => {
  try {
    const { q, industry, style, page, pageSize } = req.query as Record<string, string>;
    const result = await searchPortfolios({
      q,
      industry,
      style,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ── Public: Industry Showcase ─────────────────────────────────────────────────

router.get("/public/portfolio-gallery/industries", async (_req, res) => {
  try {
    const result = await getIndustryShowcase();
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ── Public: Showcase bundle ────────────────────────────────────────────────────

router.get("/public/portfolio-gallery/showcase", async (_req, res) => {
  try {
    const result = await getPublicShowcase();
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ── Public: Compare ───────────────────────────────────────────────────────────

router.post("/public/portfolio-gallery/compare", async (req, res) => {
  try {
    const { ids } = req.body as { ids?: unknown };
    if (!Array.isArray(ids) || ids.length < 2) {
      res.status(400).json({ error: "ids must be an array of at least 2 portfolio ids" });
      return;
    }
    const numericIds = ids.map((id) => parseInt(String(id), 10)).filter((id) => !Number.isNaN(id));
    const result = await comparePortfolios(numericIds);
    res.json(result);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ── Customer Workspace: AI-recommendation, Favorites ──────────────────────────

router.get("/public/customer/workspace/:token/portfolio-gallery/recommended", async (req, res) => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) { res.status(404).json({ error: "workspace not found" }); return; }
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const result = await getBrandDnaRecommendations(client.clientId, limit);
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/public/customer/workspace/:token/portfolio-gallery/favorites", async (req, res) => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) { res.status(404).json({ error: "workspace not found" }); return; }
    const items = await listFavorites(client.clientId);
    res.json({ items });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/public/customer/workspace/:token/portfolio-gallery/favorites", async (req, res) => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) { res.status(404).json({ error: "workspace not found" }); return; }
    const portfolioId = parseInt(String((req.body as Record<string, unknown>)?.portfolioId), 10);
    if (Number.isNaN(portfolioId)) { res.status(400).json({ error: "portfolioId required" }); return; }
    const result = await addFavorite(client.clientId, portfolioId);
    res.json(result);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.delete("/public/customer/workspace/:token/portfolio-gallery/favorites/:portfolioId", async (req, res) => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) { res.status(404).json({ error: "workspace not found" }); return; }
    const portfolioId = parseInt(req.params.portfolioId, 10);
    if (Number.isNaN(portfolioId)) { res.status(400).json({ error: "invalid portfolioId" }); return; }
    const result = await removeFavorite(client.clientId, portfolioId);
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ── Admin: Analytics ──────────────────────────────────────────────────────────

router.get("/ai/portfolio-gallery/analytics", requireAdminApiKey, async (_req, res) => {
  try {
    const result = await getGalleryAnalytics();
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

export default router;
