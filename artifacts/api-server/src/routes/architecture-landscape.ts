/**
 * architecture-landscape.ts — Team 29: Architecture & Landscape Design Plugin
 *
 * Admin routes: /ai/architecture-landscape/*
 * Public routes: /public/architecture-landscape/*
 *
 * Admin routes are protected by the global adminAuthWithExceptions middleware
 * (mounted in app.ts) — no per-route duplication needed.
 *
 * NOTE: This router is NOT self-mounted.
 * Team 39 (integration) will add to artifacts/api-server/src/routes/index.ts:
 *   import architectureLandscapeRouter from "./architecture-landscape";
 *   router.use(architectureLandscapeRouter);
 *
 * No zod/v4 direct imports — validation uses domain validators only.
 * No hard-coded tenant, provider, model, or domain values.
 */

import { Router, type Request, type Response } from "express";
import {
  createProject,
  listProjects,
  getProjectById,
  getProjectByRef,
  updateProject,
  softDeleteProject,
  advanceWorkflowStep,
  addArtifact,
  listArtifacts,
  contributeComponent,
  listComponents,
  getOverlayMetadata,
  getAnalytics,
  getPluginManifest,
  isTransitionAllowed,
} from "../domains/architecture-landscape/architectureLandscapeService.js";
import {
  validateBrief,
  validateSiteConstraints,
  checkArtifactHonesty,
  ARCHITECTURE_PREVIEW_DISCLAIMER,
  PLUGIN_CAPABILITY_BOUNDARY,
} from "../domains/architecture-landscape/validators.js";
import {
  ARCHITECTURE_PROJECT_STATUSES,
  ARCHITECTURE_WORKFLOW_STEPS,
  ARCHITECTURE_ARTIFACT_TYPES,
  ARCHITECTURE_PROJECT_TYPES,
} from "../domains/architecture-landscape/schema.js";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Plugin manifest & meta
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ai/architecture-landscape/manifest", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    manifest: getPluginManifest(),
    disclaimer: ARCHITECTURE_PREVIEW_DISCLAIMER,
    capabilities: PLUGIN_CAPABILITY_BOUNDARY,
    workflowSteps: ARCHITECTURE_WORKFLOW_STEPS,
    artifactTypes: ARCHITECTURE_ARTIFACT_TYPES,
    projectTypes: ARCHITECTURE_PROJECT_TYPES,
    statuses: ARCHITECTURE_PROJECT_STATUSES,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Projects
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ai/architecture-landscape/projects", async (req: Request, res: Response) => {
  try {
    const { status, projectType, tenantId, clientEmail, limit, offset } =
      req.query as Record<string, string | undefined>;

    const result = await listProjects({
      status,
      projectType,
      tenantId,
      clientEmail,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to list projects." });
  }
});

router.post("/ai/architecture-landscape/projects", async (req: Request, res: Response) => {
  try {
    const result = await createProject(req.body);
    if (!result.ok) {
      return res.status(400).json({ ok: false, errors: result.errors, warnings: result.warnings });
    }
    return res.status(201).json({ ok: true, project: result.project, warnings: result.warnings });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Failed to create project." });
  }
});

router.get("/ai/architecture-landscape/projects/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid id." });

    const project = await getProjectById(id);
    if (!project) return res.status(404).json({ ok: false, error: "Project not found." });

    return res.json({ ok: true, project });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Failed to get project." });
  }
});

router.patch("/ai/architecture-landscape/projects/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid id." });

    // Guard terminal-state fields — don't let PATCH overwrite status directly
    const { status: _status, id: _id, projectRef: _ref, createdAt: _ca, ...patch } = req.body;

    const updated = await updateProject(id, patch);
    if (!updated) return res.status(404).json({ ok: false, error: "Project not found." });

    return res.json({ ok: true, project: updated });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Failed to update project." });
  }
});

router.delete("/ai/architecture-landscape/projects/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid id." });

    const deleted = await softDeleteProject(id);
    if (!deleted) return res.status(404).json({ ok: false, error: "Project not found." });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Failed to delete project." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Workflow step advancement
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/ai/architecture-landscape/projects/:id/advance",
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid id." });

      const result = await advanceWorkflowStep(id);
      if (!result.ok) return res.status(400).json({ ok: false, error: result.error });

      return res.json({ ok: true, project: result.project });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Failed to advance workflow step." });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Site constraints validation (dry-run)
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/ai/architecture-landscape/validate/constraints",
  (req: Request, res: Response) => {
    const result = validateSiteConstraints(req.body);
    res.status(result.valid ? 200 : 400).json({ ok: result.valid, ...result });
  },
);

router.post(
  "/ai/architecture-landscape/validate/brief",
  (req: Request, res: Response) => {
    const result = validateBrief(req.body);
    res.status(result.valid ? 200 : 400).json({ ok: result.valid, ...result });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Artifacts
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/architecture-landscape/projects/:id/artifacts",
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid id." });

      const artifacts = await listArtifacts(id);
      return res.json({ ok: true, artifacts });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Failed to list artifacts." });
    }
  },
);

router.post(
  "/ai/architecture-landscape/projects/:id/artifacts",
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid id." });

      const result = await addArtifact(id, req.body);
      if (!result.ok) return res.status(400).json({ ok: false, error: result.error });

      return res.status(201).json({ ok: true, artifact: result.artifact });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Failed to add artifact." });
    }
  },
);

// Honesty pre-check (dry-run, no DB write)
router.post(
  "/ai/architecture-landscape/validate/artifact-label",
  (req: Request, res: Response) => {
    const { artifactType, artifactLabel } = req.body as {
      artifactType?: string;
      artifactLabel?: string;
    };
    if (!artifactType || !artifactLabel) {
      return res
        .status(400)
        .json({ ok: false, error: "artifactType and artifactLabel are required." });
    }
    const result = checkArtifactHonesty(artifactType, artifactLabel);
    return res.json({ ok: true, honestyCheck: result });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Overlay metadata
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/architecture-landscape/projects/:id/overlay",
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid id." });

      const overlay = await getOverlayMetadata(id);
      if (!overlay) return res.status(404).json({ ok: false, error: "Project not found." });

      return res.json({ ok: true, overlay });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Failed to get overlay metadata." });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Components / material contribution
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ai/architecture-landscape/components", async (req: Request, res: Response) => {
  try {
    const { category, climateZone, locallyAvailable, limit } =
      req.query as Record<string, string | undefined>;

    const components = await listComponents({
      category,
      climateZone,
      locallyAvailable:
        locallyAvailable !== undefined ? locallyAvailable === "true" : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json({ ok: true, components });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to list components." });
  }
});

router.post("/ai/architecture-landscape/components", async (req: Request, res: Response) => {
  try {
    const component = await contributeComponent(req.body);
    res.status(201).json({ ok: true, component });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to contribute component." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Analytics
// ─────────────────────────────────────────────────────────────────────────────

router.get("/ai/architecture-landscape/analytics", async (_req: Request, res: Response) => {
  try {
    const analytics = await getAnalytics();
    res.json({ ok: true, analytics });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to get analytics." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Public: Project lookup by ref (for client-facing status tracking)
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/public/architecture-landscape/projects/:projectRef",
  async (req: Request, res: Response) => {
    try {
      const project = await getProjectByRef(String(req.params["projectRef"] ?? ""));
      if (!project) return res.status(404).json({ ok: false, error: "Project not found." });

      // Return safe subset only — no internal fields
      return res.json({
        ok: true,
        project: {
          projectRef: project.projectRef,
          projectTitle: project.projectTitle,
          projectType: project.projectType,
          status: project.status,
          currentStep: project.currentStep,
          currentStepIndex: project.currentStepIndex,
          hasLandscapeComponent: project.hasLandscapeComponent,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
        disclaimer: ARCHITECTURE_PREVIEW_DISCLAIMER,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Failed to get project." });
    }
  },
);

// Public: Submit a new project (client-facing brief submission)
router.post(
  "/public/architecture-landscape/submit",
  async (req: Request, res: Response) => {
    try {
      const result = await createProject(req.body);
      if (!result.ok) {
        return res.status(400).json({ ok: false, errors: result.errors, warnings: result.warnings });
      }
      // Return only the ref and status — not full internal record
      return res.status(201).json({
        ok: true,
        projectRef: result.project!.projectRef,
        status: result.project!.status,
        currentStep: result.project!.currentStep,
        disclaimer: ARCHITECTURE_PREVIEW_DISCLAIMER,
        warnings: result.warnings,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Failed to submit project." });
    }
  },
);

export default router;
export { router as architectureLandscapeRouter };
