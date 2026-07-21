/**
 * material-library.ts — Team 21: Universal Material Library API routes
 *
 * Routes (all under /api, mounted via index.ts):
 *   GET    /ai/materials/categories          — list categories
 *   GET    /ai/materials                     — list/search materials
 *   GET    /ai/materials/:id                 — get material
 *   POST   /ai/materials                     — create material
 *   PATCH  /ai/materials/:id                 — update material
 *   DELETE /ai/materials/:id                 — delete material
 *   GET    /ai/materials/:id/assignments     — list assignments for artifact (query param)
 *   POST   /ai/materials/assignments         — create assignment
 *   POST   /ai/materials/assignments/validate — validate assignment (dry-run)
 *   GET    /ai/materials/plugins             — list registered plugins
 *
 * Authorization:
 *   - All routes require the admin API key (set globally via adminAuthWithExceptions).
 *   - RequestContext is synthesized from the session/API-key actor.
 *
 * No zod import — manual validation per api-server convention.
 */

import { Router } from "express";
import {
  createMaterial,
  getMaterial,
  updateMaterial,
  deleteMaterial,
  listMaterials,
  MaterialNotFoundError,
  MaterialAccessDeniedError,
  MaterialReadOnlyError,
  MaterialValidationError,
  type CreateMaterialInput,
  type UpdateMaterialInput,
} from "../services/material-library/materialLibraryService.js";
import {
  validateAssignment,
  createAssignment,
  listAssignmentsForArtifact,
  MaterialAssignmentValidationError,
} from "../services/material-library/materialAssignmentService.js";
import { materialCategoryRegistry } from "../services/material-library/categoryRegistry.js";
import { materialPluginRegistry } from "../services/material-library/pluginContract.js";
import {
  MATERIAL_STATUSES,
  MATERIAL_SOURCES,
  MATERIAL_SORT_OPTIONS,
  type MaterialSort,
} from "../services/material-library/types.js";
import {
  createSystemContext,
} from "../security/requestContext.js";

const router = Router();

// ── Context helper ─────────────────────────────────────────────────────────────
// Until Team 21's routes are wired into the full auth middleware, we synthesize
// a context from the request. This adapter follows the pattern in admin-customer-workspace.ts.

function getContext(req: import("express").Request) {
  // Prefer tenant from session; fall back to query/header; fall back to platform system ctx
  const tenantId =
    (req as unknown as { session?: { tenantId?: string } }).session?.tenantId ??
    (typeof req.query["tenantId"] === "string" ? req.query["tenantId"] : null);

  const isPlatformAdmin = !tenantId;

  if (isPlatformAdmin) {
    return createSystemContext({
      requestId: String((req as unknown as { id?: string | number }).id ?? "unknown"),
      source: "api",
      actorType: "system",
      tenantId: null,
      isPlatformWide: true,
      permissions: ["*"],
      metadata: {},
    });
  }

  return createSystemContext({
    requestId: String((req as unknown as { id?: string | number }).id ?? "unknown"),
    source: "api",
    actorType: "system",
    tenantId,
    isPlatformWide: false,
    permissions: ["read", "create", "edit", "delete"],
    metadata: {},
  });
}

function handleError(res: import("express").Response, err: unknown): void {
  if (err instanceof MaterialNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof MaterialAccessDeniedError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof MaterialReadOnlyError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof MaterialValidationError || err instanceof MaterialAssignmentValidationError) {
    res.status(400).json({ error: err.message, details: (err as MaterialValidationError).errors });
    return;
  }
  console.error("[material-library] Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
}

// ── GET /ai/materials/categories ──────────────────────────────────────────────
router.get("/ai/materials/categories", (req, res): void => {
  const domain = typeof req.query["domain"] === "string" ? req.query["domain"] : undefined;
  const categories = materialCategoryRegistry.list({ domain });
  res.json({ categories, total: categories.length });
});

// ── GET /ai/materials/plugins ─────────────────────────────────────────────────
router.get("/ai/materials/plugins", (_req, res): void => {
  const plugins = materialPluginRegistry.list().map((p) => ({
    pluginId: p.descriptor.pluginId,
    name: p.descriptor.name,
    version: p.descriptor.version,
    description: p.descriptor.description,
    domains: p.descriptor.domains ?? [],
    capabilities: (p.descriptor.capabilities ?? []).map((c) => c.capabilityId),
    registeredAt: p.registeredAt,
  }));
  res.json({ plugins, total: plugins.length });
});

// ── GET /ai/materials ─────────────────────────────────────────────────────────
router.get("/ai/materials", (req, res): void => {
  try {
    const ctx = getContext(req);
    const q = req.query as Record<string, string | undefined>;

    const sort = (MATERIAL_SORT_OPTIONS as readonly string[]).includes(q["sort"] ?? "")
      ? (q["sort"] as MaterialSort)
      : "name_asc";

    const page = parseInt(q["page"] ?? "1", 10) || 1;
    const pageSize = Math.min(parseInt(q["pageSize"] ?? "20", 10) || 20, 100);

    const result = listMaterials(
      {
        q: q["q"],
        categoryIds: q["categoryIds"] ? q["categoryIds"].split(",") : undefined,
        tags: q["tags"] ? q["tags"].split(",") : undefined,
        source: (MATERIAL_SOURCES as readonly string[]).includes(q["source"] ?? "")
          ? (q["source"] as (typeof MATERIAL_SOURCES)[number])
          : undefined,
        domain: q["domain"],
        status: (MATERIAL_STATUSES as readonly string[]).includes(q["status"] ?? "")
          ? (q["status"] as (typeof MATERIAL_STATUSES)[number])
          : undefined,
        includeInactive: q["includeInactive"] === "true",
        platformOnly: q["platformOnly"] === "true",
      },
      sort,
      page,
      pageSize,
      ctx,
    );

    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /ai/materials/:id ─────────────────────────────────────────────────────
router.get("/ai/materials/:id", (req, res): void => {
  try {
    const ctx = getContext(req);
    const material = getMaterial(req.params["id"]!, ctx);
    res.json({ material });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /ai/materials ────────────────────────────────────────────────────────
router.post("/ai/materials", (req, res): void => {
  try {
    const ctx = getContext(req);
    const body = req.body as Partial<CreateMaterialInput> & { platformLevel?: boolean };

    if (!body.name || typeof body.name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!body.categoryId || typeof body.categoryId !== "string") {
      res.status(400).json({ error: "categoryId is required" });
      return;
    }
    if (!body.preview || typeof body.preview !== "object") {
      res.status(400).json({ error: "preview is required" });
      return;
    }

    const input: CreateMaterialInput = {
      name: body.name,
      categoryId: body.categoryId,
      description: body.description ?? "",
      status: body.status ?? "active",
      source: body.source ?? "tenant",
      preview: body.preview,
      properties: body.properties ?? {},
      tags: body.tags ?? [],
      compatibility: body.compatibility ?? { compatibleDomains: [] },
      extensions: body.extensions ?? {},
      readOnly: body.readOnly ?? false,
      sustainability: body.sustainability,
      technical: body.technical,
      availability: body.availability,
      pluginId: body.pluginId,
    };

    const material = createMaterial(input, ctx, { platformLevel: body.platformLevel ?? false });
    res.status(201).json({ material });
  } catch (err) {
    handleError(res, err);
  }
});

// ── PATCH /ai/materials/:id ───────────────────────────────────────────────────
router.patch("/ai/materials/:id", (req, res): void => {
  try {
    const ctx = getContext(req);
    const updates = req.body as UpdateMaterialInput;
    const material = updateMaterial(req.params["id"]!, updates, ctx);
    res.json({ material });
  } catch (err) {
    handleError(res, err);
  }
});

// ── DELETE /ai/materials/:id ──────────────────────────────────────────────────
router.delete("/ai/materials/:id", (req, res): void => {
  try {
    const ctx = getContext(req);
    deleteMaterial(req.params["id"]!, ctx);
    res.status(204).send();
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /ai/materials/for-artifact/:artifactId/assignments ────────────────────
router.get("/ai/materials/for-artifact/:artifactId/assignments", (req, res): void => {
  const assignments = listAssignmentsForArtifact(req.params["artifactId"]!);
  res.json({ assignments, total: assignments.length });
});

// ── POST /ai/materials/assignments/validate ───────────────────────────────────
router.post("/ai/materials/assignments/validate", (req, res): void => {
  try {
    const ctx = getContext(req);
    const body = req.body as {
      materialId?: string;
      targetArtifactId?: string;
      targetElementId?: string;
      targetRegionId?: string;
      overrideProperties?: Record<string, unknown>;
      domain?: string;
      capability?: string;
    };

    if (!body.materialId || !body.targetArtifactId) {
      res.status(400).json({ error: "materialId and targetArtifactId are required" });
      return;
    }

    const result = validateAssignment(
      {
        materialId: body.materialId,
        targetArtifactId: body.targetArtifactId,
        targetElementId: body.targetElementId,
        targetRegionId: body.targetRegionId,
        overrideProperties: body.overrideProperties,
        domain: body.domain,
        capability: body.capability,
      },
      ctx,
    );
    res.json({ validation: result });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /ai/materials/assignments ────────────────────────────────────────────
router.post("/ai/materials/assignments", (req, res): void => {
  try {
    const ctx = getContext(req);
    const body = req.body as {
      materialId?: string;
      targetArtifactId?: string;
      targetElementId?: string;
      targetRegionId?: string;
      overrideProperties?: Record<string, unknown>;
      assignmentSource?: string;
      domain?: string;
      capability?: string;
    };

    if (!body.materialId || !body.targetArtifactId) {
      res.status(400).json({ error: "materialId and targetArtifactId are required" });
      return;
    }

    const assignment = createAssignment(
      {
        materialId: body.materialId,
        targetArtifactId: body.targetArtifactId,
        targetElementId: body.targetElementId,
        targetRegionId: body.targetRegionId,
        overrideProperties: body.overrideProperties,
        assignmentSource: body.assignmentSource ?? "user",
        domain: body.domain,
        capability: body.capability,
      },
      ctx,
    );
    res.status(201).json({ assignment });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
