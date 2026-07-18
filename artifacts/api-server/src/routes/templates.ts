/**
 * templates.ts — Template Marketplace routes (admin + public).
 *
 * All templates are stored in Supabase (ai_platform.ai_templates).
 * No hardcoded builtin templates — all data comes from the DB.
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
import type { AiTemplate } from "@workspace/db";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Detect if a hex color is perceptually dark (for contrast text). */
function isHexDark(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length < 6) return true;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

/**
 * Apply brand personalization to a DB template's canvas state:
 *  - Replace brand/company name text placeholders
 *  - Swap accent/highlight color on unlocked decorative elements
 */
function personalizeCanvasState(
  template: AiTemplate,
  companyName: string,
  brandColor: string,
) {
  const canvasState = template.canvasState as {
    width: number; height: number; background: string;
    elements: Array<Record<string, unknown>>;
  } | null;
  if (!canvasState) return null;

  const color = brandColor.startsWith("#") ? brandColor : `#${brandColor}`;
  const bgColor = canvasState.background;

  const originalAccent =
    canvasState.elements.find((e) => {
      const fill = e.fill as string | undefined;
      return fill && fill !== bgColor && fill !== "#FFFFFF" && fill !== "#FAFAFA" && !fill.startsWith("rgba");
    })?.fill as string | null ?? null;

  const brandWords = companyName.trim().split(/\s+/);
  const shortName = brandWords.slice(0, 2).join(" ").toUpperCase();
  const initials = brandWords.slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();

  const BRAND_IDS = ["brand-name", "brand", "brand-ribbon", "brand-top", "brand-bottom",
    "logo-text", "brand-top-right", "company-name"];

  const elements = canvasState.elements.map((el) => {
    const updated = { ...el };

    if (el.type === "text" && el.text) {
      if (BRAND_IDS.some((bid) => (el.id as string).includes(bid))) {
        updated.text = (el.text as string).startsWith("@")
          ? `@${companyName.toLowerCase().replace(/\s+/g, "")}`
          : shortName;
      }
      if (el.id === "author-init") updated.text = initials || "NA";
    }

    if (originalAccent && !el.locked) {
      if (el.fill === originalAccent) updated.fill = color;
      if (el.stroke === originalAccent) updated.stroke = color;
      if (el.color === originalAccent) updated.color = color;
    }

    return updated;
  });

  return { ...canvasState, elements };
}

// ── Admin Routes ──────────────────────────────────────────────────────────────

router.get("/ai/templates/stats", async (req, res) => {
  try {
    res.json(await getTemplateAnalyticsStats());
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/templates/evolution", async (req, res) => {
  try {
    res.json(await getTemplateEvolutionRecommendations());
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/templates/industry-showcase", async (req, res) => {
  try {
    res.json({ items: await getIndustryShowcase() });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/templates", async (req, res) => {
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

router.get("/ai/templates/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const t = await getTemplate(id);
    if (!t) { res.status(404).json({ error: "not found" }); return; }
    res.json(t);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/templates", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body.templateCode || !body.name || !body.category || !body.style) {
      res.status(400).json({ error: "templateCode, name, category, style required" });
      return;
    }
    const t = await createTemplate(body as Parameters<typeof createTemplate>[0]);
    res.status(201).json(t);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.patch("/ai/templates/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const t = await updateTemplate(id, req.body as Record<string, unknown>);
    if (!t) { res.status(404).json({ error: "not found" }); return; }
    res.json(t);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/templates/:id/publish", async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    await publishTemplate(id);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/templates/:id/archive", async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    await archiveTemplate(id);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/templates/:id/event", async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const { eventType, clientId, sessionId, metadata } = req.body as Record<string, unknown>;
    if (!eventType) { res.status(400).json({ error: "eventType required" }); return; }
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

router.get("/public/templates/industry-showcase", async (req, res) => {
  try {
    res.json({ items: await getIndustryShowcase() });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/public/templates/recommended", async (req, res) => {
  try {
    const { industry, category, limit } = req.query as Record<string, string>;
    const items = await getPublicRecommendations({
      industry, category, limit: limit ? parseInt(limit, 10) : 6,
    });
    res.json({ items });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/public/templates", async (req, res) => {
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

router.get("/public/templates/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) { res.status(400).json({ error: "invalid id" }); return; }
    const t = await getTemplate(id);
    if (!t || t.status !== "published") { res.status(404).json({ error: "not found" }); return; }
    recordTemplateEvent(id, "view", { sessionId: req.headers["x-session-id"] as string | undefined }).catch(() => {});
    res.json(t);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/public/templates/:id/preview", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) { res.status(400).json({ error: "invalid id" }); return; }
    const { companyName, brandColor, logoUrl, industry } = req.body as Record<string, string>;
    if (!companyName || !brandColor) { res.status(400).json({ error: "companyName, brandColor required" }); return; }

    const t = await getTemplate(id);
    if (!t || t.status !== "published") { res.status(404).json({ error: "not found" }); return; }

    // If template has a canvas state (design-editor style), personalize it directly
    if (t.canvasState) {
      const color = brandColor.startsWith("#") ? brandColor : `#${brandColor}`;
      const textColor = isHexDark(color) ? "#FFFFFF" : "#1A1A1A";
      const personalizedCanvasState = personalizeCanvasState(t, companyName, brandColor);
      res.json({
        templateId: id,
        templateName: t.name,
        companyName,
        brandColor: color,
        logoUrl: logoUrl ?? null,
        isBuiltin: false,
        personalizedCanvasState,
        canvasWidth: t.canvasWidth,
        canvasHeight: t.canvasHeight,
        previewConcept: {
          headerBg: color,
          headerText: textColor,
          accentColor: color,
          fontPairing: t.style === "Elegant" ? "Georgia / Inter"
            : t.style === "Bold" ? "Inter Black / Inter"
            : t.style === "Minimalist" ? "Georgia / Inter"
            : "Inter / Inter",
          layoutType: t.category.toLowerCase().replace(/\s+/g, "-"),
          mockSections: [
            { type: "brand", content: companyName, color },
            { type: "category", content: t.category, color: "#64748B" },
            { type: "style", content: t.style, color: "#64748B" },
            { type: "canvas", content: `${t.canvasWidth ?? 1080} × ${t.canvasHeight ?? 1080}px`, color: "#64748B" },
          ],
        },
        generatedAt: new Date().toISOString(),
      });
      return;
    }

    // Standard document-template live preview
    const preview = await generateLivePreview({ templateId: id, companyName, brandColor, logoUrl, industry });
    res.json(preview);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/public/templates/:id/event", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) { res.status(400).json({ error: "invalid id" }); return; }
    const { eventType, clientId, sessionId, metadata } = req.body as Record<string, unknown>;
    if (!eventType) { res.status(400).json({ error: "eventType required" }); return; }
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
    if (!result.ok) return null;
    const emailHash = result.session.emailHash;
    return { clientId: emailHash, emailHash };
  } catch {
    return null;
  }
}

router.get("/public/customer/workspace/:token/templates", async (req, res): Promise<void> => {
  try {
    const { category, industry, style, sortBy, limit, offset } = req.query as Record<string, string>;
    const client = await resolveToken(req.params.token);
    if (!client) { res.status(404).json({ error: "workspace not found" }); return; }

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

router.get("/public/customer/workspace/:token/templates/recommended", async (req, res): Promise<void> => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) { res.status(404).json({ error: "workspace not found" }); return; }
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

router.post("/public/customer/workspace/:token/templates/:id/preview", async (req, res): Promise<void> => {
  try {
    const client = await resolveToken(req.params.token);
    if (!client) { res.status(404).json({ error: "workspace not found" }); return; }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) { res.status(400).json({ error: "invalid id" }); return; }
    const { companyName, brandColor, logoUrl, industry } = req.body as Record<string, string>;
    if (!companyName || !brandColor) { res.status(400).json({ error: "companyName, brandColor required" }); return; }
    const preview = await generateLivePreview({ templateId: id, companyName, brandColor, logoUrl, industry });
    res.json(preview);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

export default router;
