/**
 * product-design-plugin.ts — Furniture & Product Design Plugin routes (Team 28)
 *
 * Auth: productDesignPluginAuthGuard + adminAuth on ALL admin routes.
 *       Public plugin-manifest and services routes have NO auth middleware.
 *
 * Rate limiting: aiGenerationLimiter on /generate.
 *
 * Route prefix: paths do NOT include /api (applied by app.ts mount point).
 * IMPORTANT: Do NOT import zod/v4. Use plain zod only.
 * IMPORTANT: This router is NOT mounted in routes/index.ts (locked file).
 *            See integration/manifests/team-28.json → routesToMount.
 *
 * TEAM 28 OWNED — do not modify outside feature/team-28-product-design-plugin.
 */

import { Router } from "express";
import { z } from "zod";
import { adminAuth } from "../middleware/adminAuth.js";
import { aiGenerationLimiter } from "../middleware/rateLimiter.js";
import { productDesignPluginAuthGuard } from "../domains/furniture-product-design/authGuard.js";
import {
  createProject,
  listProjects,
  getProject,
  getProjectByToken,
  updateProjectStatus,
  submitBrief,
  getBriefByProject,
  generateStepOutput,
  getLatestOutput,
  listOutputs,
  approveOutput,
  exportProject,
  getPluginManifest,
} from "../domains/furniture-product-design/service.js";
import {
  PD_PRODUCT_CATEGORIES,
  PD_PROJECT_STATUSES,
  PD_WORKFLOW_STEPS,
} from "../domains/furniture-product-design/schema.js";
import {
  WORKFLOW_STEP_KEYS,
  MATERIAL_KEYS,
} from "../domains/furniture-product-design/plugin-manifest.js";
import {
  listPdComponents,
  getPdComponent,
  isValidPdComponentType,
  type ProductComponentType,
} from "../domains/furniture-product-design/components.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function handleError(res: import("express").Response, err: unknown) {
  const msg = err instanceof Error ? err.message : "Unexpected error";
  logger.error({ err }, "[product-design-plugin] Route error");
  if (
    msg.includes("Invalid") ||
    msg.includes("Cannot") ||
    msg.includes("validation failed") ||
    msg.includes("not found") ||
    msg.includes("Unknown") ||
    msg.includes("Unsupported capability") ||
    msg.includes("must be in")
  ) {
    return res.status(400).json({ error: msg });
  }
  return res.status(500).json({ error: msg });
}

function parseId(raw: string | undefined): number | null {
  const n = parseInt(raw ?? "", 10);
  return isNaN(n) ? null : n;
}

// ── Request schemas ───────────────────────────────────────────────────────────

const createProjectSchema = z.object({
  title: z.string().min(1).max(200),
  productCategory: z.enum(PD_PRODUCT_CATEGORIES),
  clientName: z.string().max(200).optional(),
  clientEmail: z.string().email().optional(),
  notes: z.string().max(2000).optional(),
});

const submitBriefSchema = z.object({
  productCategory: z.enum(PD_PRODUCT_CATEGORIES),
  targetUser: z.string().min(1).max(1000),
  environment: z.string().min(1).max(500),
  primaryFunction: z.string().min(1).max(1000),
  widthMm: z.number().positive().max(20000).optional(),
  depthMm: z.number().positive().max(20000).optional(),
  heightMm: z.number().positive().max(10000).optional(),
  weightKg: z.number().positive().max(5000).optional(),
  ergonomicsNotes: z.string().max(2000).optional(),
  loadUsageNotes: z.string().max(2000).optional(),
  primaryMaterials: z.array(z.string()).max(10).optional(),
  finishPreferences: z.record(z.string()).optional(),
  manufacturingProcess: z.string().max(500).optional(),
  productionVolume: z.string().max(500).optional(),
  budgetCurrency: z.string().max(10).optional(),
  budgetEstimate: z.number().positive().optional(),
  budgetNotes: z.string().max(1000).optional(),
  sustainabilityGoals: z.string().max(2000).optional(),
  safetyRequirements: z.string().max(2000).optional(),
  complianceStandards: z.array(z.string().max(200)).max(20).optional(),
  referenceUrls: z.array(z.string().url()).max(10).optional(),
  additionalNotes: z.string().max(2000).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(PD_PROJECT_STATUSES),
  adminNotes: z.string().max(2000).optional(),
});

const generateStepSchema = z.object({
  step: z.enum(PD_WORKFLOW_STEPS),
});

const approveOutputSchema = z.object({
  reviewNotes: z.string().max(2000).optional(),
});

// ── Public routes ─────────────────────────────────────────────────────────────

/**
 * GET /ai/product-design-plugin/manifest
 * Returns plugin manifest — workflow, artifact types, components, capabilities.
 * Public — no auth. See integration/manifests/team-28.json for PUBLIC_ROUTE_RULES entry.
 */
router.get("/ai/product-design-plugin/manifest", (_req, res) => {
  try {
    res.json(getPluginManifest());
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /ai/product-design-plugin/components
 * Lists all product design component definitions.
 * Public — component metadata, no project data.
 */
router.get("/ai/product-design-plugin/components", (_req, res) => {
  try {
    res.json({ components: listPdComponents() });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /ai/product-design-plugin/components/:type
 * Get a single component definition by type.
 */
router.get("/ai/product-design-plugin/components/:type", (req, res) => {
  try {
    const type = req.params["type"] as string;
    if (!isValidPdComponentType(type)) {
      res.status(404).json({ error: `Component type "${type}" not found.` });
      return;
    }
    const component = getPdComponent(type as ProductComponentType);
    if (!component) {
      res.status(404).json({ error: `Component "${type}" not found.` });
      return;
    }
    res.json(component);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /ai/product-design-plugin/projects
 * Create a new product design project.
 * Public — customers initiate projects without admin key.
 */
router.post("/ai/product-design-plugin/projects", async (req, res) => {
  try {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }
    const project = await createProject(parsed.data);
    res.status(201).json(project);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /ai/product-design-plugin/projects/:token/brief
 * Submit or update a project brief. Token-authenticated (IDOR guard).
 * Public — customers submit their own brief.
 */
router.post("/ai/product-design-plugin/projects/:token/brief", async (req, res) => {
  try {
    const token = req.params["token"] as string;
    const project = await getProjectByToken(token);
    if (!project) { res.status(404).json({ error: "Project not found or invalid token." }); return; }

    const parsed = submitBriefSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const result = await submitBrief({ ...parsed.data, projectId: project.id });
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /ai/product-design-plugin/projects/:token
 * Get project by access token. Public — customer view.
 */
router.get("/ai/product-design-plugin/projects/:token", async (req, res) => {
  try {
    const token = req.params["token"] as string;
    const project = await getProjectByToken(token);
    if (!project) { res.status(404).json({ error: "Project not found or invalid token." }); return; }

    const brief = await getBriefByProject(project.id);
    res.json({ project, brief: brief ?? null });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /ai/product-design-plugin/projects/:token/outputs
 * Get all outputs for a project by access token. Public — customer view.
 */
router.get("/ai/product-design-plugin/projects/:token/outputs", async (req, res) => {
  try {
    const token = req.params["token"] as string;
    const project = await getProjectByToken(token);
    if (!project) { res.status(404).json({ error: "Project not found or invalid token." }); return; }

    const outputs = await listOutputs(project.id);
    res.json({ outputs: outputs.filter((o) => o.isLatest) });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin routes ──────────────────────────────────────────────────────────────

/**
 * GET /ai/product-design-plugin/admin/projects
 * List all projects (paginated). Admin only.
 */
router.get(
  "/ai/product-design-plugin/admin/projects",
  productDesignPluginAuthGuard,
  adminAuth,
  async (req, res) => {
    try {
      const page     = parseInt(String(req.query["page"] ?? "1"), 10);
      const pageSize = Math.min(parseInt(String(req.query["pageSize"] ?? "20"), 10), 100);
      const status   = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
      const category = typeof req.query["productCategory"] === "string" ? req.query["productCategory"] : undefined;

      const result = await listProjects({ page, pageSize, status: status as typeof PD_PROJECT_STATUSES[number] | undefined, productCategory: category });
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  }
);

/**
 * GET /ai/product-design-plugin/admin/projects/:id
 * Get project by numeric ID. Admin only.
 */
router.get(
  "/ai/product-design-plugin/admin/projects/:id",
  productDesignPluginAuthGuard,
  adminAuth,
  async (req, res) => {
    try {
      const id = parseId(req.params["id"] as string);
      if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

      const [project, brief, outputs] = await Promise.all([
        getProject(id),
        getBriefByProject(id),
        listOutputs(id),
      ]);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      res.json({ project, brief: brief ?? null, outputs });
    } catch (err) {
      handleError(res, err);
    }
  }
);

/**
 * PATCH /ai/product-design-plugin/admin/projects/:id/status
 * Update project status. Admin only.
 */
router.patch(
  "/ai/product-design-plugin/admin/projects/:id/status",
  productDesignPluginAuthGuard,
  adminAuth,
  async (req, res) => {
    try {
      const id = parseId(req.params["id"] as string);
      if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

      const parsed = updateStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Validation error", details: parsed.error.issues });
        return;
      }

      const updated = await updateProjectStatus(id, parsed.data.status);
      if (!updated) { res.status(404).json({ error: "Project not found" }); return; }
      res.json(updated);
    } catch (err) {
      handleError(res, err);
    }
  }
);

/**
 * POST /ai/product-design-plugin/admin/projects/:id/generate
 * Generate AI output for a workflow step. Admin + rate-limited.
 */
router.post(
  "/ai/product-design-plugin/admin/projects/:id/generate",
  productDesignPluginAuthGuard,
  adminAuth,
  aiGenerationLimiter,
  async (req, res) => {
    try {
      const id = parseId(req.params["id"] as string);
      if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

      const parsed = generateStepSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Validation error", details: parsed.error.issues });
        return;
      }

      const result = await generateStepOutput({ projectId: id, step: parsed.data.step });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      if (msg.includes("rate") || msg.includes("Rate")) {
        res.status(429).json({ error: msg, code: "RATE_LIMIT_EXCEEDED" });
        return;
      }
      handleError(res, err);
    }
  }
);

/**
 * GET /ai/product-design-plugin/admin/projects/:id/outputs/:step
 * Get latest output for a specific step. Admin only.
 */
router.get(
  "/ai/product-design-plugin/admin/projects/:id/outputs/:step",
  productDesignPluginAuthGuard,
  adminAuth,
  async (req, res) => {
    try {
      const id = parseId(req.params["id"] as string);
      if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

      const step = req.params["step"] as string;
      if (!(WORKFLOW_STEP_KEYS as readonly string[]).includes(step)) {
        res.status(400).json({ error: `Unknown workflow step "${step}".` });
        return;
      }

      const output = await getLatestOutput(id, step as typeof WORKFLOW_STEP_KEYS[number]);
      res.json({ output: output ?? null });
    } catch (err) {
      handleError(res, err);
    }
  }
);

/**
 * PATCH /ai/product-design-plugin/admin/outputs/:outputId/approve
 * Approve a specific output. Admin only.
 */
router.patch(
  "/ai/product-design-plugin/admin/outputs/:outputId/approve",
  productDesignPluginAuthGuard,
  adminAuth,
  async (req, res) => {
    try {
      const id = parseId(req.params["outputId"] as string);
      if (id === null) { res.status(400).json({ error: "Invalid outputId" }); return; }

      const parsed = approveOutputSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Validation error", details: parsed.error.issues });
        return;
      }

      const updated = await approveOutput(id, parsed.data.reviewNotes);
      if (!updated) { res.status(404).json({ error: "Output not found" }); return; }
      res.json(updated);
    } catch (err) {
      handleError(res, err);
    }
  }
);

/**
 * POST /ai/product-design-plugin/admin/projects/:id/export
 * Export all approved outputs. Admin only.
 */
router.post(
  "/ai/product-design-plugin/admin/projects/:id/export",
  productDesignPluginAuthGuard,
  adminAuth,
  async (req, res) => {
    try {
      const id = parseId(req.params["id"] as string);
      if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

      const exportManifest = await exportProject(id);
      res.json(exportManifest);
    } catch (err) {
      handleError(res, err);
    }
  }
);

export default router;
export { router as productDesignPluginRouter };
