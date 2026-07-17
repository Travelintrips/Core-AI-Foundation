/**
 * galleryV2Router.ts — Team 4 / creative-portfolio-v2
 *
 * New endpoints for the enhanced Portfolio Showcase domain.
 * Mounts under a prefix supplied by Team 24 integration; internally
 * all paths are relative (no leading /api).
 *
 * Public (no auth):
 *   GET  /public/portfolio-v2/gallery            — enhanced search + sort
 *   GET  /public/portfolio-v2/industries         — industry summary list
 *   GET  /public/portfolio-v2/industries/:name   — industry deep-dive
 *   GET  /public/portfolio-v2/:id/similar        — similar portfolios
 *   GET  /public/portfolio-v2/:id                — portfolio detail (public DTO)
 *   POST /public/portfolio-v2/compare            — compare 2-4 portfolios
 *   POST /public/portfolio-v2/:id/cta            — CTA click tracking → serviceId
 *   GET  /public/portfolio-v2/inspiration/feed   — full mood feed
 *   GET  /public/portfolio-v2/inspiration/:mood  — single mood feed
 *   GET  /public/portfolio-v2/before-after       — before/after collection
 *
 * Customer workspace (token auth):
 *   GET    /public/customer/workspace/:token/portfolio-v2/recommended
 *   GET    /public/customer/workspace/:token/portfolio-v2/favorites
 *   POST   /public/customer/workspace/:token/portfolio-v2/favorites
 *   DELETE /public/customer/workspace/:token/portfolio-v2/favorites/:portfolioId
 *   GET    /public/customer/workspace/:token/portfolio-v2/favorite-ids
 *
 * Admin (x-admin-api-key):
 *   GET  /ai/portfolio-v2/analytics
 */
import { Router } from "express";
import { requireAdminApiKey } from "../../middleware/adminAuth.js";
import { resolveWorkspaceSession } from "../../services/customerWorkspaceService.js";
import {
  searchGalleryV2,
  comparePortfoliosPublic,
  getSimilarPortfolios,
  getPortfolioDetailPublic,
  trackCtaClick,
  getBrandDnaRecsPublic,
  listFavoritesPublic,
  addFavoritePublic,
  removeFavoritePublic,
  getFavoriteIds,
  getGalleryV2Analytics,
  getAllIndustrySummary,
  getIndustryDeepDive,
  type SortOption,
} from "../../services/creative-portfolio-v2/index.js";
import {
  getInspirationFeed,
  getFeedByMood,
  getBeforeAfterFeed,
  MOODS,
  type Mood,
} from "../../services/creative-portfolio-v2/inspirationFeedService.js";

const router = Router();

// ── Workspace session resolver ────────────────────────────────────────────────

async function resolveToken(token: string): Promise<{ clientId: string } | null> {
  try {
    const result = await resolveWorkspaceSession(token);
    if (!result.ok) return null;
    const emailHash = (result as Record<string, unknown>)?.["session"]
      ? ((result as Record<string, unknown>)["session"] as Record<string, unknown>)["emailHash"] as string | null
      : null;
    if (!emailHash) return null;
    return { clientId: emailHash };
  } catch {
    return null;
  }
}

function err(res: import("express").Response, status: number, msg: string) {
  res.status(status).json({ error: msg });
}

// ── Public: Gallery Search ────────────────────────────────────────────────────

router.get("/public/portfolio-v2/gallery", async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    const SORT_OPTIONS: SortOption[] = ["featured", "popular", "latest", "rating", "fastest"];
    const sort = SORT_OPTIONS.includes(q.sort as SortOption) ? (q.sort as SortOption) : "featured";

    const result = await searchGalleryV2({
      q: q.q,
      industry: q.industry,
      style: q.style,
      sort,
      colorTag: q.colorTag,
      packageLevel: q.packageLevel,
      hasBeforeAfter: q.hasBeforeAfter === "true",
      page: q.page ? parseInt(q.page, 10) : undefined,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
    });
    res.json(result);
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

// ── Public: Industry Summary ──────────────────────────────────────────────────

router.get("/public/portfolio-v2/industries", async (_req, res) => {
  try {
    const result = await getAllIndustrySummary();
    res.json({ items: result });
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

router.get("/public/portfolio-v2/industries/:name", async (req, res) => {
  try {
    const industry = req.params.name.toLowerCase();
    const result = await getIndustryDeepDive(industry);
    res.json(result);
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

// ── Public: Inspiration Feed ──────────────────────────────────────────────────

router.get("/public/portfolio-v2/inspiration/feed", async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    const validMoods = Object.keys(MOODS) as Mood[];
    const moods = q.moods
      ? (q.moods.split(",").filter((m) => validMoods.includes(m as Mood)) as Mood[])
      : undefined;
    const perMood = q.perMood ? Math.min(12, Math.max(2, parseInt(q.perMood, 10))) : 6;
    const result = await getInspirationFeed(moods, perMood);
    res.json({ moods: result, availableMoods: validMoods.map((m) => ({ mood: m, ...MOODS[m] })) });
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

router.get("/public/portfolio-v2/inspiration/:mood", async (req, res) => {
  try {
    const mood = req.params.mood as Mood;
    if (!Object.keys(MOODS).includes(mood)) {
      err(res, 400, `Invalid mood. Valid options: ${Object.keys(MOODS).join(", ")}`);
      return;
    }
    const limit = req.query.limit ? Math.min(24, parseInt(String(req.query.limit), 10)) : 8;
    const result = await getFeedByMood(mood, limit);
    res.json(result);
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

// ── Public: Before/After Feed ─────────────────────────────────────────────────

router.get("/public/portfolio-v2/before-after", async (req, res) => {
  try {
    const limit = req.query.limit ? Math.min(24, parseInt(String(req.query.limit), 10)) : 12;
    const items = await getBeforeAfterFeed(limit);
    res.json({ items });
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

// ── Public: Compare ───────────────────────────────────────────────────────────

router.post("/public/portfolio-v2/compare", async (req, res) => {
  try {
    const { ids } = req.body as { ids?: unknown };
    if (!Array.isArray(ids) || ids.length < 2) {
      err(res, 400, "ids must be an array of at least 2 portfolio ids");
      return;
    }
    const numericIds = ids.map((id) => parseInt(String(id), 10)).filter((id) => !Number.isNaN(id));
    if (numericIds.length < 2) { err(res, 400, "ids must be numeric"); return; }
    const result = await comparePortfoliosPublic(numericIds);
    res.json(result);
  } catch (e: unknown) {
    err(res, 400, e instanceof Error ? e.message : "internal error");
  }
});

// ── Public: Portfolio Detail ──────────────────────────────────────────────────

router.get("/public/portfolio-v2/:idOrSlug/similar", async (req, res) => {
  try {
    const portfolioId = parseInt(req.params.idOrSlug, 10);
    if (Number.isNaN(portfolioId)) { err(res, 400, "invalid portfolio id"); return; }
    const limit = req.query.limit ? Math.min(12, parseInt(String(req.query.limit), 10)) : 6;
    const items = await getSimilarPortfolios(portfolioId, limit);
    res.json({ items });
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

router.get("/public/portfolio-v2/:idOrSlug", async (req, res) => {
  try {
    const portfolio = await getPortfolioDetailPublic(req.params.idOrSlug);
    if (!portfolio) { err(res, 404, "Portfolio not found"); return; }
    res.json(portfolio);
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

// ── Public: CTA Click Tracking ────────────────────────────────────────────────

router.post("/public/portfolio-v2/:id/cta", async (req, res) => {
  try {
    const portfolioId = parseInt(req.params.id, 10);
    if (Number.isNaN(portfolioId)) { err(res, 400, "invalid portfolio id"); return; }
    const source = String((req.body as Record<string, unknown>)?.source ?? "gallery");
    const result = await trackCtaClick(portfolioId, source);
    res.json(result);
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

// ── Customer Workspace: Recommendations ──────────────────────────────────────

router.get("/public/customer/workspace/:token/portfolio-v2/recommended", async (req, res) => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) { err(res, 404, "workspace not found"); return; }
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 6;
    const result = await getBrandDnaRecsPublic(client.clientId, limit);
    res.json(result);
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

// ── Customer Workspace: Favorites ─────────────────────────────────────────────

router.get("/public/customer/workspace/:token/portfolio-v2/favorite-ids", async (req, res) => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) { err(res, 404, "workspace not found"); return; }
    const ids = await getFavoriteIds(client.clientId);
    res.json({ ids });
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

router.get("/public/customer/workspace/:token/portfolio-v2/favorites", async (req, res) => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) { err(res, 404, "workspace not found"); return; }
    const result = await listFavoritesPublic(client.clientId);
    res.json(result);
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

router.post("/public/customer/workspace/:token/portfolio-v2/favorites", async (req, res) => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) { err(res, 404, "workspace not found"); return; }
    const portfolioId = parseInt(String((req.body as Record<string, unknown>)?.portfolioId), 10);
    if (Number.isNaN(portfolioId)) { err(res, 400, "portfolioId required"); return; }
    const result = await addFavoritePublic(client.clientId, portfolioId);
    res.json(result);
  } catch (e: unknown) {
    err(res, 400, e instanceof Error ? e.message : "internal error");
  }
});

router.delete("/public/customer/workspace/:token/portfolio-v2/favorites/:portfolioId", async (req, res) => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) { err(res, 404, "workspace not found"); return; }
    const portfolioId = parseInt(req.params.portfolioId, 10);
    if (Number.isNaN(portfolioId)) { err(res, 400, "invalid portfolioId"); return; }
    const result = await removeFavoritePublic(client.clientId, portfolioId);
    res.json(result);
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

// ── Admin: Analytics ──────────────────────────────────────────────────────────

router.get("/ai/portfolio-v2/analytics", requireAdminApiKey, async (_req, res) => {
  try {
    const result = await getGalleryV2Analytics();
    res.json(result);
  } catch (e: unknown) {
    err(res, 500, e instanceof Error ? e.message : "internal error");
  }
});

export default router;
