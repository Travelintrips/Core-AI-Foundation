/**
 * templates.ts — V4.3 Template Marketplace routes (admin + public).
 *
 * All paths below are relative to the app-level "/api" mount in app.ts —
 * do NOT re-add an "/api" prefix here (that would double it up).
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
import {
  BUILTIN_TEMPLATES,
  listBuiltinTemplates,
  getBuiltinTemplate,
  type BuiltinTemplate,
  type BuiltinCanvasState,
  type BuiltinCanvasElement,
} from "../data/design-templates.js";

// ── Builtin Template Helpers ──────────────────────────────────────────────────

/** Convert a BuiltinTemplate to the public TemplateItem shape used by the frontend. */
function builtinToPublicTemplate(t: BuiltinTemplate, index: number) {
  const primary = t.canvasState.background;
  // Pick a contrasting accent from the first non-background colored element
  const accent =
    t.canvasState.elements.find(
      (e) =>
        e.fill &&
        e.fill !== primary &&
        e.fill !== "#FFFFFF" &&
        e.fill !== "#FAFAFA" &&
        e.fill !== "#F5F0E8" &&
        !e.fill.startsWith("rgba"),
    )?.fill ?? "#7C6EFA";

  return {
    id: -(index + 1),         // negative ID = builtin (avoids DB collision)
    templateCode: t.templateCode,
    name: t.name,
    description: t.description,
    category: t.category,
    style: t.style,
    industry: t.industry,
    colorTheme: {
      primary,
      secondary: accent,
      accent: "#7C6EFA",
      background: primary,
      text: "#FFFFFF",
    },
    previewImages: null,
    editable: true,
    isPremium: false,
    version: "1.0",
    status: "published",
    featured: index < 3,
    views: 0,
    selections: 0,
    previewsGenerated: 0,
    conversions: 0,
    supportedPackages: null,
    tags: t.tags,
    isBuiltin: true,
    canvasWidth: t.canvasWidth,
    canvasHeight: t.canvasHeight,
    canvasState: t.canvasState,
  };
}

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
 * Apply brand personalization to a builtin canvas state:
 *  - Replace brand/company name text placeholders
 *  - Swap accent/highlight color on decorative elements
 */
function personalizeCanvasState(
  template: BuiltinTemplate,
  companyName: string,
  brandColor: string,
): BuiltinCanvasState {
  const color = brandColor.startsWith("#") ? brandColor : `#${brandColor}`;
  const originalAccent =
    template.canvasState.elements.find(
      (e) =>
        e.fill &&
        e.fill !== template.canvasState.background &&
        e.fill !== "#FFFFFF" &&
        e.fill !== "#FAFAFA" &&
        !e.fill.startsWith("rgba"),
    )?.fill ?? null;

  const brandWords = companyName.trim().split(/\s+/);
  const shortName = brandWords.slice(0, 2).join(" ").toUpperCase();
  const initials = brandWords
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  const elements: BuiltinCanvasElement[] = template.canvasState.elements.map((el) => {
    const updated: BuiltinCanvasElement = { ...el };

    // ── Replace placeholder brand/company name text ──────────────────────────
    if (el.type === "text" && el.text) {
      const brandIds = ["brand-name", "brand", "brand-ribbon", "brand-top", "brand-bottom",
        "logo-text", "brand-top-right", "company-name"];
      if (brandIds.some((bid) => el.id.includes(bid))) {
        // Keep @username prefix if original had it
        if (el.text.startsWith("@")) {
          updated.text = `@${companyName.toLowerCase().replace(/\s+/g, "")}`;
        } else {
          updated.text = shortName;
        }
      }
      if (el.id === "author-init") {
        updated.text = initials || "NA";
      }
    }

    // ── Apply brand color to accent decorative elements ──────────────────────
    // Only recolor elements that carry the original accent color
    if (originalAccent && !el.locked) {
      if (el.fill === originalAccent) updated.fill = color;
      if (el.stroke === originalAccent) updated.stroke = color;
      if (el.color === originalAccent) updated.color = color;
    }

    return updated;
  });

  return { ...template.canvasState, elements };
}

const router = Router();

// ── Admin Routes ──────────────────────────────────────────────────────────────

router.get("/ai/templates/stats", async (req, res) => {
  try {
    const stats = await getTemplateAnalyticsStats();
    res.json(stats);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/templates/evolution", async (req, res) => {
  try {
    const recs = await getTemplateEvolutionRecommendations();
    res.json(recs);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/templates/industry-showcase", async (req, res) => {
  try {
    const showcase = await getIndustryShowcase();
    res.json({ items: showcase });
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
    const showcase = await getIndustryShowcase();
    res.json({ items: showcase });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/public/templates/recommended", async (req, res) => {
  try {
    const { industry, category, limit } = req.query as Record<string, string>;
    const maxItems = limit ? parseInt(limit, 10) : 6;
    let items = await getPublicRecommendations({ industry, category, limit: maxItems });

    // Pad with builtin templates if DB has fewer than requested
    if (items.length < maxItems) {
      const builtinFiltered = listBuiltinTemplates({ category, industry });
      const builtinMapped = builtinFiltered.map(builtinToPublicTemplate);
      items = [...items, ...builtinMapped].slice(0, maxItems);
    }

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

    const pageLimit = limit ? parseInt(limit, 10) : 24;
    const pageOffset = offset ? parseInt(offset, 10) : 0;

    // ── Builtin templates (always included, prepended) ────────────────────────
    let builtins = listBuiltinTemplates({ category, industry, style });

    // Apply search filter
    if (search) {
      const q = search.toLowerCase();
      builtins = builtins.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.includes(q)) ||
          t.category.toLowerCase().includes(q),
      );
    }
    // isPremium filter: builtins are never premium
    if (isPremium === "true") builtins = [];

    const builtinItems = builtins.map(builtinToPublicTemplate);

    // ── DB templates ──────────────────────────────────────────────────────────
    const dbResult = await listTemplates({
      category, industry, style,
      status: "published",
      isPremium: isPremium === "true" ? true : isPremium === "false" ? false : undefined,
      featured: featured === "true" ? true : undefined,
      sortBy: (sortBy as "popular" | "newest" | "conversions" | "selections") ?? "popular",
      search,
      limit: pageLimit,
      offset: pageOffset,
    });

    // ── Merge: builtins first (only on first page, to avoid duplicates) ───────
    const allItems = pageOffset === 0
      ? [...builtinItems, ...dbResult.items]
      : dbResult.items;

    res.json({
      items: allItems,
      total: dbResult.total + builtinItems.length,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/public/templates/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

    // Negative ID = builtin template
    if (id < 0) {
      const idx = -(id) - 1;
      const t = BUILTIN_TEMPLATES[idx];
      if (!t) { res.status(404).json({ error: "not found" }); return; }
      res.json(builtinToPublicTemplate(t, idx));
      return;
    }

    const t = await getTemplate(id);
    if (!t || t.status !== "published") { res.status(404).json({ error: "not found" }); return; }
    // async fire-and-forget view count
    recordTemplateEvent(id, "view", { sessionId: req.headers["x-session-id"] as string | undefined }).catch(() => {});
    res.json(t);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/public/templates/:id/preview", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const { companyName, brandColor, logoUrl, industry } = req.body as Record<string, string>;
    if (!companyName || !brandColor) { res.status(400).json({ error: "companyName, brandColor required" }); return; }

    // Builtin template: personalize the canvas state directly
    if (id < 0) {
      const idx = -(id) - 1;
      const t = BUILTIN_TEMPLATES[idx];
      if (!t) { res.status(404).json({ error: "not found" }); return; }
      const personalizedCanvasState = personalizeCanvasState(t, companyName, brandColor);
      const color = brandColor.startsWith("#") ? brandColor : `#${brandColor}`;
      const textColor = isHexDark(color) ? "#FFFFFF" : "#1A1A1A";
      res.json({
        templateId: id,
        templateName: t.name,
        companyName,
        brandColor: color,
        logoUrl: logoUrl ?? null,
        isBuiltin: true,
        personalizedCanvasState,
        canvasWidth: t.canvasWidth,
        canvasHeight: t.canvasHeight,
        previewConcept: {
          headerBg: color,
          headerText: textColor,
          accentColor: color,
          fontPairing: t.style === "Elegant" ? "Georgia / Inter" : t.style === "Bold" ? "Inter Black / Inter" : t.style === "Minimalist" ? "Georgia / Inter" : "Inter / Inter",
          layoutType: t.category.toLowerCase().replace(/\s+/g, "-"),
          mockSections: [
            { type: "brand", content: companyName, color },
            { type: "category", content: t.category, color: "#64748B" },
            { type: "style", content: t.style, color: "#64748B" },
            { type: "canvas", content: `${t.canvasWidth} × ${t.canvasHeight}px`, color: "#64748B" },
          ],
        },
        generatedAt: new Date().toISOString(),
      });
      return;
    }

    const preview = await generateLivePreview({ templateId: id, companyName, brandColor, logoUrl, industry });
    res.json(preview);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/public/templates/:id/event", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    // Builtin templates don't have analytics; silently succeed
    if (id < 0) { res.json({ ok: true }); return; }
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
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const { companyName, brandColor, logoUrl, industry } = req.body as Record<string, string>;
    if (!companyName || !brandColor) { res.status(400).json({ error: "companyName, brandColor required" }); return; }
    const preview = await generateLivePreview({ templateId: id, companyName, brandColor, logoUrl, industry });
    res.json(preview);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

export default router;
