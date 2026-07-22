/**
 * Domain Plugin Framework — Express Router (Team 07)
 *
 * Mounts at /design-plugins (the routes/index.ts prefix strips /api).
 *
 * Endpoints:
 *   GET  /design-plugins                 — list all plugins (safe projection)
 *   GET  /design-plugins/:id             — get single plugin (safe projection)
 *   GET  /design-plugins/:id/health      — raw diagnostics (admin only)
 *   GET  /design-plugins/alias/:slug     — resolve legacy service slug → plugin
 *   POST /design-plugins/:id/enable      — enable a plugin (admin)
 *   POST /design-plugins/:id/disable     — disable a plugin (admin)
 *
 * All routes are already behind the global adminAuthWithExceptions middleware
 * applied in app.ts — no per-route auth duplication needed.
 */

import { Router, type Request, type Response } from "express";
import {
  listPlugins,
  resolvePlugin,
  enablePlugin,
  disablePlugin,
  refreshPluginHealth,
} from "./registry.js";
import { toSafeManifest, toSafeManifestList } from "./clientProjection.js";
import { resolveAlias, getSlugsForPluginId } from "./legacyAdapter.js";
import { evaluateTenantPolicy, type TenantContext } from "./tenantPolicy.js";

const router = Router();

// ── GET /design-plugins ───────────────────────────────────────────────────────
router.get("/design-plugins", (_req: Request, res: Response) => {
  const entries = listPlugins();
  res.json({ plugins: toSafeManifestList(entries), total: entries.length });
});

// ── GET /design-plugins/alias/:slug ──────────────────────────────────────────
// Must be declared BEFORE /:id to avoid "alias" being captured as an id.
router.get("/design-plugins/alias/:slug", (req: Request, res: Response) => {
  const { slug } = req.params as { slug: string };
  const pluginId = resolveAlias(slug);
  if (!pluginId) {
    res.status(404).json({ error: `No plugin alias found for slug '${slug}'` });
    return;
  }
  const entry = resolvePlugin(pluginId);
  res.json({
    slug,
    pluginId,
    ...(entry ? { plugin: toSafeManifest(entry) } : { plugin: null }),
    legacySlugs: getSlugsForPluginId(pluginId),
  });
});

// ── GET /design-plugins/:id ───────────────────────────────────────────────────
router.get("/design-plugins/:id", (req: Request, res: Response) => {
  const entry = resolvePlugin(req.params.id as string);
  if (!entry) {
    res.status(404).json({ error: `Plugin '${req.params.id}' not found` });
    return;
  }
  res.json({ plugin: toSafeManifest(entry) });
});

// ── GET /design-plugins/:id/health ───────────────────────────────────────────
router.get("/design-plugins/:id/health", async (req: Request, res: Response) => {
  const entry = await refreshPluginHealth(req.params.id as string);
  if (!entry) {
    res.status(404).json({ error: `Plugin '${req.params.id}' not found` });
    return;
  }
  // Health endpoint returns full diagnostics — admin eyes only.
  res.json({
    pluginId: entry.manifest.id,
    version: entry.manifest.version,
    status: entry.status,
    diagnostics: {
      healthy: entry.diagnostics.healthy,
      notes: entry.diagnostics.notes,
      lastCheckedAt: entry.diagnostics.lastCheckedAt.toISOString(),
    },
  });
});

// ── POST /design-plugins/:id/enable ──────────────────────────────────────────
router.post("/design-plugins/:id/enable", (req: Request, res: Response) => {
  const ok = enablePlugin(req.params.id as string);
  if (!ok) {
    res.status(404).json({
      error: `Plugin '${req.params.id}' not found or cannot be enabled (incompatible)`,
    });
    return;
  }
  res.json({ pluginId: req.params.id, status: "enabled" });
});

// ── POST /design-plugins/:id/disable ─────────────────────────────────────────
router.post("/design-plugins/:id/disable", (req: Request, res: Response) => {
  const ok = disablePlugin(req.params.id as string);
  if (!ok) {
    res.status(404).json({
      error: `Plugin '${req.params.id}' not found or cannot be disabled (incompatible)`,
    });
    return;
  }
  res.json({ pluginId: req.params.id, status: "disabled" });
});

// ── GET /design-plugins/:id/tenant-check ─────────────────────────────────────
// Allows callers to verify tenant availability without a full request context.
router.get(
  "/design-plugins/:id/tenant-check",
  (req: Request, res: Response) => {
    const entry = resolvePlugin(req.params.id as string);
    if (!entry) {
      res.status(404).json({ error: `Plugin '${req.params.id}' not found` });
      return;
    }

    const tenantId = (req.query["tenantId"] as string) || "";
    const serviceCode = (req.query["serviceCode"] as string) || undefined;

    if (!tenantId) {
      res.status(400).json({ error: "tenantId query param is required" });
      return;
    }

    // Note: in production flows, tenantId MUST come from the authenticated
    // session — not from client query params.  This endpoint is for admin
    // tooling only and is already behind the global admin-auth middleware.
    const ctx: TenantContext = {
      tenantId,
      serviceCode,
      isPlatformScope: true, // admin callers always have platform scope
    };

    const result = evaluateTenantPolicy(entry.manifest.tenantPolicy, ctx);
    res.json({
      pluginId: req.params.id,
      tenantId,
      allowed: result.allowed,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  },
);

export default router;
