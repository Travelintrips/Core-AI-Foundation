/**
 * template-engine.ts — V4.6 Template Ecosystem routes
 *
 * All paths relative to /api mount (no /api prefix here).
 *
 * Theme Engine:     /ai/engine/themes/*
 * Layout Engine:    /ai/engine/layouts/*
 * Template Registry:/ai/engine/registry/*
 *   - Versioning:  /ai/engine/registry/:id/versions/*
 *   - Mappings:    /ai/engine/registry/:id/brand|industry|package
 * Public endpoints: /public/engine/*
 * Seed:             /ai/engine/seed
 */

import { Router } from "express";
import {
  listThemes, getTheme, createTheme, updateTheme, deleteTheme,
  applyThemeTokens, seedDefaultThemes,
} from "../services/themeEngineService.js";
import {
  listLayouts, getLayout, createLayout, updateLayout, deleteLayout,
  getRecommendedLayouts, seedDefaultLayouts,
} from "../services/layoutEngineService.js";
import {
  listRegistryTemplates, getRegistryTemplate, createRegistryTemplate,
  updateRegistryTemplate, publishRegistryTemplate, archiveRegistryTemplate,
  listVersions, getVersion, createVersion, publishVersion, rollbackToVersion,
  compareVersions, getBrandMappings, setBrandMappings, getIndustryMappings,
  setIndustryMappings, getPackageMappings, setPackageMappings,
  getTemplateDetail, recommendTemplates, getCategoryStats,
  seedRegistryTemplates,
} from "../services/templateRegistryService.js";
import { TEMPLATE_CATEGORIES } from "../services/themeEngineService.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════════
// META
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/ai/engine/meta", async (_req, res) => {
  res.json({
    categories: TEMPLATE_CATEGORIES,
    version: "4.6",
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// THEME ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/ai/engine/themes", async (req, res) => {
  try {
    const { category, search, limit, offset } = req.query as Record<string, string>;
    const result = await listThemes({
      category, search,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/engine/themes/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const theme = await getTheme(id);
    if (!theme) { res.status(404).json({ error: "not found" }); return; }
    res.json(theme);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/engine/themes/:id/apply", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const theme = await getTheme(id);
    if (!theme) { res.status(404).json({ error: "not found" }); return; }
    res.json(applyThemeTokens(theme));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/engine/themes", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body.themeKey || !body.name || !body.tokensJson) {
      res.status(400).json({ error: "themeKey, name, tokensJson required" }); return;
    }
    const theme = await createTheme(body as Parameters<typeof createTheme>[0]);
    res.status(201).json(theme);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.patch("/ai/engine/themes/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const theme = await updateTheme(id, req.body as Record<string, unknown>);
    if (!theme) { res.status(404).json({ error: "not found" }); return; }
    res.json(theme);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.delete("/ai/engine/themes/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    await deleteTheme(id);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LAYOUT ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/ai/engine/layouts", async (req, res) => {
  try {
    const { category, layoutType, search, limit, offset } = req.query as Record<string, string>;
    const result = await listLayouts({
      category, layoutType, search,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/engine/layouts/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const layout = await getLayout(id);
    if (!layout) { res.status(404).json({ error: "not found" }); return; }
    res.json(layout);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/engine/layouts/recommended/:category", async (req, res) => {
  try {
    const layouts = getRecommendedLayouts(req.params.category);
    res.json({ category: req.params.category, recommendedTypes: layouts });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/engine/layouts", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body.layoutKey || !body.name || !body.category || !body.layoutType || !body.structureJson) {
      res.status(400).json({ error: "layoutKey, name, category, layoutType, structureJson required" }); return;
    }
    const layout = await createLayout(body as Parameters<typeof createLayout>[0]);
    res.status(201).json(layout);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.patch("/ai/engine/layouts/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const layout = await updateLayout(id, req.body as Record<string, unknown>);
    if (!layout) { res.status(404).json({ error: "not found" }); return; }
    res.json(layout);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.delete("/ai/engine/layouts/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    await deleteLayout(id);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/ai/engine/registry", async (req, res) => {
  try {
    const { category, status, limit, offset } = req.query as Record<string, string>;
    const result = await listRegistryTemplates({
      category, status,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/engine/registry/stats", async (_req, res) => {
  try {
    const stats = await getCategoryStats();
    res.json({ categories: stats });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/engine/registry/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const detail = await getTemplateDetail(id);
    if (!detail) { res.status(404).json({ error: "not found" }); return; }
    res.json(detail);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/engine/registry", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body.templateKey || !body.name || !body.category) {
      res.status(400).json({ error: "templateKey, name, category required" }); return;
    }
    const template = await createRegistryTemplate(body as Parameters<typeof createRegistryTemplate>[0]);
    res.status(201).json(template);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.patch("/ai/engine/registry/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const template = await updateRegistryTemplate(id, req.body as Record<string, unknown>);
    if (!template) { res.status(404).json({ error: "not found" }); return; }
    res.json(template);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/engine/registry/:id/publish", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const template = await publishRegistryTemplate(id);
    if (!template) { res.status(404).json({ error: "not found" }); return; }
    res.json(template);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/engine/registry/:id/archive", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const template = await archiveRegistryTemplate(id);
    if (!template) { res.status(404).json({ error: "not found" }); return; }
    res.json(template);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ── Versions ──────────────────────────────────────────────────────────────────

router.get("/ai/engine/registry/:id/versions", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const versions = await listVersions(id);
    res.json({ items: versions, total: versions.length });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/engine/registry/:id/versions", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const { themeId, layoutId, layoutSpecJson, themeOverridesJson, changelog } = req.body as Record<string, unknown>;
    const version = await createVersion({
      templateId: id,
      themeId: themeId ? Number(themeId) : undefined,
      layoutId: layoutId ? Number(layoutId) : undefined,
      layoutSpecJson: layoutSpecJson as Record<string, unknown> | undefined,
      themeOverridesJson: themeOverridesJson as Record<string, unknown> | undefined,
      changelog: changelog as string | undefined,
    });
    res.status(201).json(version);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/engine/registry/:id/versions/:versionId/publish", async (req, res): Promise<void> => {
  try {
    const versionId = parseInt(req.params.versionId, 10);
    if (isNaN(versionId)) { res.status(400).json({ error: "invalid versionId" }); return; }
    await publishVersion(versionId);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/ai/engine/registry/:id/versions/:versionId/rollback", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const versionId = parseInt(req.params.versionId, 10);
    if (isNaN(id) || isNaN(versionId)) { res.status(400).json({ error: "invalid id" }); return; }
    await rollbackToVersion(id, versionId);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/ai/engine/registry/:id/versions/compare", async (req, res): Promise<void> => {
  try {
    const { a, b } = req.query as { a: string; b: string };
    if (!a || !b) { res.status(400).json({ error: "query params a and b (version IDs) required" }); return; }
    const result = await compareVersions(parseInt(a, 10), parseInt(b, 10));
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ── Brand Mappings ────────────────────────────────────────────────────────────

router.get("/ai/engine/registry/:id/brand", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    res.json(await getBrandMappings(id));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.put("/ai/engine/registry/:id/brand", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const { mappings } = req.body as { mappings: Parameters<typeof setBrandMappings>[1] };
    await setBrandMappings(id, mappings ?? []);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ── Industry Mappings ─────────────────────────────────────────────────────────

router.get("/ai/engine/registry/:id/industry", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    res.json(await getIndustryMappings(id));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.put("/ai/engine/registry/:id/industry", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const { mappings } = req.body as { mappings: Parameters<typeof setIndustryMappings>[1] };
    await setIndustryMappings(id, mappings ?? []);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ── Package Mappings ──────────────────────────────────────────────────────────

router.get("/ai/engine/registry/:id/package", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    res.json(await getPackageMappings(id));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.put("/ai/engine/registry/:id/package", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const { mappings } = req.body as { mappings: Parameters<typeof setPackageMappings>[1] };
    await setPackageMappings(id, mappings ?? []);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/public/engine/categories", (_req, res) => {
  res.json({ categories: TEMPLATE_CATEGORIES });
});

router.get("/public/engine/themes", async (req, res) => {
  try {
    const { category, limit } = req.query as Record<string, string>;
    const result = await listThemes({ category, limit: limit ? parseInt(limit, 10) : 20 });
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.get("/public/engine/layouts", async (req, res) => {
  try {
    const { category, limit } = req.query as Record<string, string>;
    const result = await listLayouts({ category, limit: limit ? parseInt(limit, 10) : 20 });
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

router.post("/public/engine/recommend", async (req, res) => {
  try {
    const { industry, brandAttributes, packageCode, category, limit } = req.body as {
      industry?: string;
      brandAttributes?: Array<{ attribute: string; value: string }>;
      packageCode?: string;
      category?: string;
      limit?: number;
    };
    const results = await recommendTemplates({ industry, brandAttributes, packageCode, category, limit });
    res.json({ items: results, total: results.length });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEED
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/ai/engine/seed", async (_req, res) => {
  try {
    await seedDefaultThemes();
    await seedDefaultLayouts();
    await seedRegistryTemplates();
    res.json({ ok: true, message: "V4.6 Template Engine seeded: themes, layouts, registry templates" });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "internal error" });
  }
});

export default router;
