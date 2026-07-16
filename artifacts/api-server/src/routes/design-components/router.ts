/**
 * Universal Creative Component Library — REST Routes (Team 8)
 *
 * Route prefix: /ai/design-components  (relative to the /api mount in app.ts)
 * Auth: global adminAuthWithExceptions in app.ts — no per-route middleware needed.
 *
 * IMPORTANT: This router is NOT registered in routes/index.ts.
 * Team 24 will mount it during integration.
 *
 * Routes provided:
 *   GET    /ai/design-components/registry              — full static registry
 *   GET    /ai/design-components/registry/:type        — single type definition
 *   GET    /ai/design-components/registry/domain/:dom  — by domain
 *   GET    /ai/design-components/registry/stats        — counts per domain
 *
 *   POST   /ai/design-components/validate              — validate without saving
 *   POST   /ai/design-components/blueprint-compatibility — check composition
 *
 *   GET    /ai/design-components                       — list saved instances
 *   POST   /ai/design-components                       — create instance
 *   GET    /ai/design-components/:id                   — get instance
 *   PATCH  /ai/design-components/:id                   — update instance
 *   DELETE /ai/design-components/:id                   — soft-delete
 *   POST   /ai/design-components/:id/duplicate         — duplicate
 */

import { Router } from "express";
import { z } from "zod";
import { resolveAuthenticatedTenantContext } from "../../security/tenantResolution.js";
import { logger } from "../../lib/logger.js";
import {
  listAllComponents,
  listComponentsByDomain,
  getComponentDefinition,
  getComponentBySlug,
  isValidDomain,
  isValidComponentType,
  getStats,
  validateComponentInstance,
  validatePartialComponentInstance,
  validateBlueprintComposition,
  checkComponentCompatibility,
  listCompatibleComponents,
  createDesignComponent,
  getDesignComponent,
  listDesignComponents,
  updateDesignComponent,
  softDeleteDesignComponent,
  duplicateDesignComponent,
  ComponentValidationError,
  ComponentNotFoundError,
  ComponentTenantError,
} from "../../services/design-components/index.js";
import type { ComponentType, ComponentDomain } from "../../services/design-components/index.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function actorId(req: Parameters<typeof resolveAuthenticatedTenantContext>[0]): string {
  return req.internalUser ? String(req.internalUser.id) : "system";
}

function handleError(res: any, err: unknown) {
  if (err instanceof ComponentTenantError) {
    return res.status(403).json({ error: "Access denied" });
  }
  if (err instanceof ComponentNotFoundError) {
    return res.status(404).json({ error: err.message });
  }
  if (err instanceof ComponentValidationError) {
    return res.status(422).json({ error: "Validation failed", errors: err.errors });
  }
  const msg = err instanceof Error ? err.message : "Unexpected error";
  logger.error({ err }, "[design-components] Route error");
  return res.status(500).json({ error: msg });
}

// ── Request schemas ───────────────────────────────────────────────────────────

const createInstanceSchema = z.object({
  type: z.string(),
  name: z.string().min(1).max(200),
  domain: z.string(),
  fieldValues: z.record(z.unknown()).optional().default({}),
  blueprintId: z.string().optional(),
});

const updateInstanceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  fieldValues: z.record(z.unknown()).optional(),
  blueprintId: z.string().nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const validateSchema = z.object({
  type: z.string(),
  domain: z.string(),
  fieldValues: z.record(z.unknown()).optional().default({}),
  partial: z.boolean().optional().default(false),
});

const blueprintCompatibilitySchema = z.object({
  context: z.object({
    domain: z.string(),
    requiredComponentTypes: z.array(z.string()).optional(),
    forbiddenComponentTypes: z.array(z.string()).optional(),
    maxInstancesPerType: z.record(z.number()).optional(),
    strictDomainMatch: z.boolean().optional(),
  }),
  components: z.array(
    z.object({
      type: z.string(),
      instanceId: z.string().optional(),
    }),
  ),
});

const listQuerySchema = z.object({
  domain: z.string().optional(),
  type: z.string().optional(),
  blueprintId: z.string().optional(),
  status: z.enum(["active", "archived"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

// ── Registry routes (read-only, static, no DB) ────────────────────────────────

router.get("/registry/stats", (_req, res) => {
  res.json(getStats());
});

router.get("/registry/domain/:domain", (req, res) => {
  const { domain } = req.params;
  if (!isValidDomain(domain)) {
    return res.status(400).json({
      error: `Invalid domain "${domain}". Valid: graphic, interior, fashion, packaging`,
    });
  }
  const components = listComponentsByDomain(domain as ComponentDomain);
  return res.json({ domain, components, total: components.length });
});

router.get("/registry/:type", (req, res) => {
  const { type } = req.params;
  // Try by type first, then by slug
  const def = getComponentDefinition(type as ComponentType) ?? getComponentBySlug(type);
  if (!def) {
    return res.status(404).json({ error: `Component type or slug "${type}" not found.` });
  }
  return res.json(def);
});

router.get("/registry", (_req, res) => {
  const all = listAllComponents();
  const byDomain: Record<string, unknown[]> = {};
  for (const comp of all) {
    if (!byDomain[comp.domain]) byDomain[comp.domain] = [];
    byDomain[comp.domain].push(comp);
  }
  res.json({ total: all.length, byDomain, components: all });
});

// ── Validation route (stateless) ──────────────────────────────────────────────

router.post("/validate", (req, res) => {
  const parsed = validateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
  }

  const { type, domain, fieldValues, partial } = parsed.data;

  if (!isValidComponentType(type)) {
    return res.status(400).json({ error: `Unknown component type: "${type}"` });
  }
  if (!isValidDomain(domain)) {
    return res.status(400).json({
      error: `Invalid domain "${domain}". Valid: graphic, interior, fashion, packaging`,
    });
  }

  const result = partial
    ? validatePartialComponentInstance(type as ComponentType, domain as ComponentDomain, fieldValues)
    : validateComponentInstance({ type: type as ComponentType, domain: domain as ComponentDomain, fieldValues });

  return res.json(result);
});

// ── Blueprint compatibility route (stateless) ─────────────────────────────────

router.post("/blueprint-compatibility", (req, res) => {
  const parsed = blueprintCompatibilitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
  }

  const { context, components } = parsed.data;

  if (!isValidDomain(context.domain)) {
    return res.status(400).json({ error: `Invalid domain: "${context.domain}"` });
  }

  // Validate component types
  const invalidTypes = components.filter((c) => !isValidComponentType(c.type));
  if (invalidTypes.length > 0) {
    return res.status(400).json({
      error: "Unknown component types",
      types: invalidTypes.map((c) => c.type),
    });
  }

  const result = validateBlueprintComposition({
    context: context as Parameters<typeof validateBlueprintComposition>[0]["context"],
    components: components as Parameters<typeof validateBlueprintComposition>[0]["components"],
  });

  return res.json(result);
});

router.get("/blueprint-compatibility/compatible", (req, res) => {
  const { domain, strict } = req.query;
  if (!domain || !isValidDomain(String(domain))) {
    return res.status(400).json({ error: "Valid ?domain= is required" });
  }
  const compatible = listCompatibleComponents({
    domain: String(domain) as ComponentDomain,
    strictDomainMatch: strict === "true",
  });
  return res.json({ domain, compatible, total: compatible.length });
});

// ── Saved instance CRUD ───────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const ctx = await resolveAuthenticatedTenantContext(req);
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({ error: "Invalid query", issues: query.error.issues });
    }

    const result = await listDesignComponents(ctx.tenantId, {
      domain: query.data.domain as ComponentDomain | undefined,
      type: query.data.type as ComponentType | undefined,
      blueprintId: query.data.blueprintId,
      status: query.data.status,
      page: query.data.page,
      pageSize: query.data.pageSize,
    });

    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

router.post("/", async (req, res) => {
  try {
    const ctx = await resolveAuthenticatedTenantContext(req);
    const parsed = createInstanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    }

    const { type, name, domain, fieldValues, blueprintId } = parsed.data;

    if (!isValidComponentType(type)) {
      return res.status(400).json({ error: `Unknown component type: "${type}"` });
    }
    if (!isValidDomain(domain)) {
      return res.status(400).json({ error: `Invalid domain: "${domain}"` });
    }

    const instance = await createDesignComponent({
      type: type as ComponentType,
      tenantId: ctx.tenantId,
      name,
      domain: domain as ComponentDomain,
      fieldValues,
      blueprintId,
      createdBy: actorId(req),
    });

    return res.status(201).json(instance);
  } catch (err) {
    return handleError(res, err);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const ctx = await resolveAuthenticatedTenantContext(req);
    const id = parseInt(req.params.id!, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const instance = await getDesignComponent(id, ctx.tenantId);
    if (!instance) return res.status(404).json({ error: `Component #${id} not found` });

    return res.json(instance);
  } catch (err) {
    return handleError(res, err);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const ctx = await resolveAuthenticatedTenantContext(req);
    const id = parseInt(req.params.id!, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const parsed = updateInstanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    }

    const updated = await updateDesignComponent(id, ctx.tenantId, parsed.data);
    return res.json(updated);
  } catch (err) {
    return handleError(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const ctx = await resolveAuthenticatedTenantContext(req);
    const id = parseInt(req.params.id!, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    await softDeleteDesignComponent(id, ctx.tenantId);
    return res.status(204).send();
  } catch (err) {
    return handleError(res, err);
  }
});

router.post("/:id/duplicate", async (req, res) => {
  try {
    const ctx = await resolveAuthenticatedTenantContext(req);
    const id = parseInt(req.params.id!, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const { name } = z.object({ name: z.string().min(1).max(200).optional() })
      .parse(req.body ?? {});

    const copy = await duplicateDesignComponent(id, ctx.tenantId, name);
    return res.status(201).json(copy);
  } catch (err) {
    return handleError(res, err);
  }
});

export default router;
