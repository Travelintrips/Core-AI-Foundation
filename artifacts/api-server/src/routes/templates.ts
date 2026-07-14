/**
 * templates.ts — V4.3 Template Marketplace routes (admin + public).
 *
 * Admin routes (x-admin-api-key):
 *   GET    /api/ai/templates                          list / filter
 *   GET    /api/ai/templates/stats                    analytics stats
 *   GET    /api/ai/templates/evolution                evolution recs
 *   GET    /api/ai/templates/industry-showcase        industry showcase
 *   GET    /api/ai/templates/:id                      get one
 *   POST   /api/ai/templates                          create
 *   PATCH  /api/ai/templates/:id                      update
 *   POST   /api/ai/templates/:id/publish              publish
 *   POST   /api/ai/templates/:id/archive              archive
 *   POST   /api/ai/templates/:id/event                record event (admin)
 *
 * Public routes (no auth):
 *   GET    /api/public/templates                      public gallery
 *   GET    /api/public/templates/industry-showcase    industry showcase
 *   GET    /api/public/templates/recommended          public recs (anon)
 *   GET    /api/public/templates/:id                  get one + record view
 *   POST   /api/public/templates/:id/preview          live customization preview
 *   POST   /api/public/templates/:id/event            record event (public)
 *
 * Customer workspace routes (token auth):
 *   GET    /api/public/customer/workspace/:token/templates              list + dna match
 *   GET    /api/public/customer/workspace/:token/templates/recommended  top 5 by Brand DNA
 *   POST   /api/public/customer/workspace/:token/templates/:id/preview  live preview
 */

import { Router } from "express";
import { adminAuth as requireAdminApiKey } from "../middleware/adminAuth.js";
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  archiveTemplate,
  publishTemplate,
  recordTemplateEvent,
  generateLivePreview,
  getTemplateAnalyticsStats,
  getTemplateEvolutionRecommendations,
  getIndustryShowcase,
} from "../services/templateService.js";
import {
  getTemplateRecommendations,
  getPublicRecommendations,
} from "../services/templateMatchingService.js";
import { resolveWorkspaceSession } from "../services/customerWorkspaceService.js";

const router = Router();

// ── Admin Routes ──────────────────────────────────────────────────────────────

router.get("/api/ai/templates/stats", requireAdminApiKey, async (req, res) => {
  try {
    const stats = await getTemplateAnalyticsStats();
    res.json(stats);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/api/ai/templates/evolution", requireAdminApiKey, async (req, res) => {
  try {
    const recs = await getTemplateEvolutionRecommendations();
    res.json(recs);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/api/ai/templates/industry-showcase", requireAdminApiKey, async (req, res) => {
  try {
    const showcase = await getIndustryShowcase();
    res.json({ items: showcase });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/api/ai/templates", requireAdminApiKey, async (req, res) => {
  try {
    const {
      category, industry, style, status, isPremium, featured,
      sortBy, search, limit, offset,
    } = req.query as Record<string, string>;

    const result = await listTemplates({
      category, industry, style,
      status: status ?? "published",
      isPremium: isPremium === "true" ? true : isPremium === "false" ? false : undefined,
      featured: featured === "true" ? true : undefined,
      sortBy: (sortBy as "popular" | "newest" | "conversions" | "selections") ?? "popular",
      search,
      limit: limit ? parseInt(limit, 10) : 24,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/api/ai/templates/:id", requireAdminApiKey, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
    const t = await getTemplate(id);
    if (!t) return res.status(404).json({ error: "not found" });
    res.json(t);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/api/ai/templates", requireAdminApiKey, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body.templateCode || !body.name || !body.category || !body.style) {
      return res.status(400).json({ error: "templateCode, name, category, style required" });
    }
    const t = await createTemplate(body as Parameters<typeof createTemplate>[0]);
    res.status(201).json(t);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.patch("/api/ai/templates/:id", requireAdminApiKey, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
    const t = await updateTemplate(id, req.body as Record<string, unknown>);
    if (!t) return res.status(404).json({ error: "not found" });
    res.json(t);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/api/ai/templates/:id/publish", requireAdminApiKey, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
    await publishTemplate(id);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/api/ai/templates/:id/archive", requireAdminApiKey, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
    await archiveTemplate(id);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/api/ai/templates/:id/event", requireAdminApiKey, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
    const { eventType, clientId, sessionId, metadata } = req.body as Record<string, unknown>;
    if (!eventType) return res.status(400).json({ error: "eventType required" });
    await recordTemplateEvent(id, eventType as "view", {
      clientId: clientId as string | undefined,
      sessionId: sessionId as string | undefined,
      metadata: metadata as Record<string, unknown> | undefined,
    });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ── Public Routes ─────────────────────────────────────────────────────────────

router.get("/api/public/templates/industry-showcase", async (req, res) => {
  try {
    const showcase = await getIndustryShowcase();
    res.json({ items: showcase });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/api/public/templates/recommended", async (req, res) => {
  try {
    const { industry, category, limit } = req.query as Record<string, string>;
    const items = await getPublicRecommendations({
      industry,
      category,
      limit: limit ? parseInt(limit, 10) : 6,
    });
    res.json({ items });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/api/public/templates", async (req, res) => {
  try {
    const {
      category, industry, style, isPremium, featured,
      sortBy, search, limit, offset,
    } = req.query as Record<string, string>;

    const result = await listTemplates({
      category, industry, style,
      status: "published",
      isPremium: isPremium === "true" ? true : isPremium === "false" ? false : undefined,
      featured: featured === "true" ? true : undefined,
      sortBy: (sortBy as "popular" | "newest" | "conversions" | "selections") ?? "popular",
      search,
      limit: limit ? parseInt(limit, 10) : 24,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/api/public/templates/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
    const t = await getTemplate(id);
    if (!t || t.status !== "published") return res.status(404).json({ error: "not found" });
    // async fire-and-forget view count
    recordTemplateEvent(id, "view", { sessionId: req.headers["x-session-id"] as string | undefined }).catch(() => {});
    res.json(t);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/api/public/templates/:id/preview", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
    const { companyName, brandColor, logoUrl, industry } = req.body as Record<string, string>;
    if (!companyName || !brandColor) return res.status(400).json({ error: "companyName, brandColor required" });
    const preview = await generateLivePreview({ templateId: id, companyName, brandColor, logoUrl, industry });
    res.json(preview);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/api/public/templates/:id/event", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
    const { eventType, clientId, sessionId, metadata } = req.body as Record<string, unknown>;
    if (!eventType) return res.status(400).json({ error: "eventType required" });
    await recordTemplateEvent(id, eventType as "view", {
      clientId: clientId as string | undefined,
      sessionId: sessionId as string | undefined,
      metadata: metadata as Record<string, unknown> | undefined,
    });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ── Customer Workspace Template Routes ────────────────────────────────────────

async function resolveToken(token: string): Promise<{ clientId: string; emailHash: string } | null> {
  try {
    const result = await resolveWorkspaceSession(token);
    if (result.type === "not_found") return null;
    const emailHash = result.session?.emailHash ?? "";
    return { clientId: emailHash, emailHash };
  } catch {
    return null;
  }
}

router.get("/api/public/customer/workspace/:token/templates", async (req, res) => {
  try {
    const { category, industry, style, sortBy, limit, offset } = req.query as Record<string, string>;
    const client = await resolveToken(req.params.token);
    if (!client) return res.status(404).json({ error: "workspace not found" });

    const [gallery, recommended] = await Promise.all([
      listTemplates({
        category, industry, style,
        status: "published",
        sortBy: (sortBy as "popular" | "newest") ?? "popular",
        limit: limit ? parseInt(limit, 10) : 12,
        offset: offset ? parseInt(offset, 10) : 0,
      }),
      getTemplateRecommendations({ clientId: client.clientId, limit: 5 }),
    ]);

    res.json({ gallery, recommended });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/api/public/customer/workspace/:token/templates/recommended", async (req, res) => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) return res.status(404).json({ error: "workspace not found" });
    const { category, packageLevel, limit } = req.query as Record<string, string>;
    const recs = await getTemplateRecommendations({
      clientId: client.clientId,
      category,
      packageLevel,
      limit: limit ? parseInt(limit, 10) : 5,
    });
    res.json({ items: recs });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/api/public/customer/workspace/:token/templates/:id/preview", async (req, res) => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) return res.status(404).json({ error: "workspace not found" });
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
    const { companyName, brandColor, logoUrl, industry } = req.body as Record<string, string>;
    if (!companyName || !brandColor) return res.status(400).json({ error: "companyName, brandColor required" });
    const preview = await generateLivePreview({ templateId: id, companyName, brandColor, logoUrl, industry });
    res.json(preview);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

export default router;
