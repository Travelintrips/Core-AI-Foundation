/**
 * packaging-design-plugin.ts — Team 26: Packaging Design Domain Plugin Routes
 *
 * Read-only introspection endpoints that expose plugin metadata to the admin
 * dashboard and to downstream systems (Team 39 Integration).
 *
 * All GET routes require admin auth (global adminAuthWithExceptions middleware).
 * The POST /brief/validate and POST /compliance/build-sheet routes are
 * intentionally open (no auth) — they perform no writes and handle no secrets.
 *
 * Route prefix: paths do NOT include /api (applied by app.ts mount point).
 * IMPORTANT: Do NOT import zod/v4. Use plain zod only.
 * IMPORTANT: This router is NOT mounted in routes/index.ts (locked file).
 *            See integration/manifests/team-26.json → routesToMount.
 */

import { Router, type Request, type Response } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import {
  buildPluginManifest,
  assertVersionCompatible,
  PLUGIN_VERSION,
} from "../domains/packaging-design/plugin/manifest.js";
import {
  PACKAGING_WORKFLOW,
  getStep,
  isStepTransitionAllowed,
  type WorkflowStepId,
} from "../domains/packaging-design/plugin/workflow.js";
import {
  listArtifactTypes,
  listDeliverableArtifactTypes,
  getArtifactType,
  isMimeAccepted,
  type PackagingArtifactTypeId,
} from "../domains/packaging-design/plugin/artifacts.js";
import {
  listOverlayDefinitions,
  listMandatoryOverlays,
  resolveActiveOverlays,
} from "../domains/packaging-design/plugin/overlays.js";
import {
  listSubstrates,
  listSubstratesByCategory,
  buildMaterialContribution,
  type SubstrateId,
  type CoatingId,
} from "../domains/packaging-design/plugin/material.js";
import {
  listExportPresets,
  getExportPreset,
  getRequiredFiles,
  type ExportPresetId,
} from "../domains/packaging-design/plugin/export.js";
import {
  listComplianceProfiles,
  resolveComplianceProfiles,
  buildComplianceSheet,
  recalculateOutcome,
} from "../domains/packaging-design/plugin/compliance.js";
import { validateBrief } from "../domains/packaging-design/plugin/brief.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function handleError(res: Response, err: unknown, context: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: `${context}: ${msg}` });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /ai/packaging-design-plugin/manifest
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design-plugin/manifest",
  adminAuth,
  (_req: Request, res: Response): void => {
    try {
      const manifest = buildPluginManifest();
      res.json(manifest);
    } catch (err) {
      handleError(res, err, "Failed to build manifest");
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /ai/packaging-design-plugin/version
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design-plugin/version",
  adminAuth,
  (_req: Request, res: Response): void => {
    res.json({ pluginId: "packaging-design", version: PLUGIN_VERSION, team: "26" });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /ai/packaging-design-plugin/version/check?coreVersion=x.y.z
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design-plugin/version/check",
  adminAuth,
  (req: Request, res: Response): void => {
    const coreVersion = req.query["coreVersion"];
    if (typeof coreVersion !== "string" || !coreVersion) {
      res.status(400).json({ error: "coreVersion query param is required" });
      return;
    }
    try {
      assertVersionCompatible(coreVersion);
      res.json({ compatible: true, pluginVersion: PLUGIN_VERSION, coreVersion });
    } catch (err) {
      res.status(409).json({
        compatible: false,
        pluginVersion: PLUGIN_VERSION,
        coreVersion,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /ai/packaging-design-plugin/workflow
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design-plugin/workflow",
  adminAuth,
  (_req: Request, res: Response): void => {
    res.json(PACKAGING_WORKFLOW);
  },
);

// GET /ai/packaging-design-plugin/workflow/steps/:stepId
router.get(
  "/ai/packaging-design-plugin/workflow/steps/:stepId",
  adminAuth,
  (req: Request, res: Response): void => {
    const stepId = req.params["stepId"] as WorkflowStepId;
    try {
      const step = getStep(stepId);
      res.json(step);
    } catch {
      res.status(404).json({ error: `Unknown workflow step: ${stepId}` });
    }
  },
);

// GET /ai/packaging-design-plugin/workflow/transitions?from=:stepId&to=:stepId
router.get(
  "/ai/packaging-design-plugin/workflow/transitions",
  adminAuth,
  (req: Request, res: Response): void => {
    const { from, to } = req.query as Record<string, string>;
    if (!from || !to) {
      res.status(400).json({ error: "from and to query params are required" });
      return;
    }
    const allowed = isStepTransitionAllowed(from as WorkflowStepId, to as WorkflowStepId);
    res.json({ from, to, allowed });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /ai/packaging-design-plugin/artifact-types
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design-plugin/artifact-types",
  adminAuth,
  (req: Request, res: Response): void => {
    const { deliverableOnly } = req.query as Record<string, string>;
    const types =
      deliverableOnly === "true"
        ? listDeliverableArtifactTypes()
        : listArtifactTypes();
    res.json({ artifactTypes: types, count: types.length });
  },
);

// GET /ai/packaging-design-plugin/artifact-types/:typeId
router.get(
  "/ai/packaging-design-plugin/artifact-types/:typeId",
  adminAuth,
  (req: Request, res: Response): void => {
    const typeId = req.params["typeId"] as PackagingArtifactTypeId;
    try {
      const t = getArtifactType(typeId);
      res.json(t);
    } catch {
      res.status(404).json({ error: `Unknown artifact type: ${typeId}` });
    }
  },
);

// GET /ai/packaging-design-plugin/artifact-types/:typeId/mime-check?mime=application/pdf
router.get(
  "/ai/packaging-design-plugin/artifact-types/:typeId/mime-check",
  adminAuth,
  (req: Request, res: Response): void => {
    const typeId  = req.params["typeId"] as PackagingArtifactTypeId;
    const mime    = req.query["mime"] as string | undefined;
    if (!mime) {
      res.status(400).json({ error: "mime query param is required" });
      return;
    }
    try {
      const accepted = isMimeAccepted(typeId, mime);
      res.json({ typeId, mime, accepted });
    } catch {
      res.status(404).json({ error: `Unknown artifact type: ${typeId}` });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /ai/packaging-design-plugin/overlays
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design-plugin/overlays",
  adminAuth,
  (req: Request, res: Response): void => {
    const { mandatory } = req.query as Record<string, string>;
    const overlays =
      mandatory === "true" ? listMandatoryOverlays() : listOverlayDefinitions();
    res.json({ overlays, count: overlays.length });
  },
);

// POST /ai/packaging-design-plugin/overlays/resolve
// Body: { hasBarcodeZone, hasFoldLines, hasInternalCuts, hasGlueZone }
router.post(
  "/ai/packaging-design-plugin/overlays/resolve",
  adminAuth,
  (req: Request, res: Response): void => {
    const {
      hasBarcodeZone   = false,
      hasFoldLines     = false,
      hasInternalCuts  = false,
      hasGlueZone      = false,
    } = req.body as {
      hasBarcodeZone?:   boolean;
      hasFoldLines?:     boolean;
      hasInternalCuts?:  boolean;
      hasGlueZone?:      boolean;
    };
    const activeIds = resolveActiveOverlays({
      hasBarcodeZone:   Boolean(hasBarcodeZone),
      hasFoldLines:     Boolean(hasFoldLines),
      hasInternalCuts:  Boolean(hasInternalCuts),
      hasGlueZone:      Boolean(hasGlueZone),
    });
    res.json({ activeOverlays: activeIds, count: activeIds.length });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /ai/packaging-design-plugin/material-spec
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design-plugin/material-spec",
  adminAuth,
  (req: Request, res: Response): void => {
    const { category } = req.query as Record<string, string>;
    const substrates = category
      ? listSubstratesByCategory(
          category as Parameters<typeof listSubstratesByCategory>[0],
        )
      : listSubstrates();
    res.json({ substrates, count: substrates.length });
  },
);

// POST /ai/packaging-design-plugin/material-spec/build
// Body: { spec: MaterialSpec, sustainabilityCerts?: string[] }
router.post(
  "/ai/packaging-design-plugin/material-spec/build",
  adminAuth,
  (req: Request, res: Response): void => {
    const { spec, sustainabilityCerts } = req.body as {
      spec?: { substrateId: SubstrateId; weightOrThickness: string; coatingId: CoatingId };
      sustainabilityCerts?: string[];
    };
    if (!spec?.substrateId || !spec?.coatingId) {
      res.status(400).json({
        error: "spec.substrateId and spec.coatingId are required",
      });
      return;
    }
    try {
      const contribution = buildMaterialContribution(spec, sustainabilityCerts ?? []);
      res.json(contribution);
    } catch (err) {
      handleError(res, err, "Failed to build material contribution");
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /ai/packaging-design-plugin/export-presets
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design-plugin/export-presets",
  adminAuth,
  (_req: Request, res: Response): void => {
    const presets = listExportPresets();
    res.json({ presets, count: presets.length });
  },
);

// GET /ai/packaging-design-plugin/export-presets/:presetId
router.get(
  "/ai/packaging-design-plugin/export-presets/:presetId",
  adminAuth,
  (req: Request, res: Response): void => {
    const presetId = req.params["presetId"] as ExportPresetId;
    try {
      const preset = getExportPreset(presetId);
      res.json(preset);
    } catch {
      res.status(404).json({ error: `Unknown export preset: ${presetId}` });
    }
  },
);

// GET /ai/packaging-design-plugin/export-presets/:presetId/required-files
router.get(
  "/ai/packaging-design-plugin/export-presets/:presetId/required-files",
  adminAuth,
  (req: Request, res: Response): void => {
    const presetId = req.params["presetId"] as ExportPresetId;
    try {
      const files = getRequiredFiles(presetId);
      res.json({ presetId, requiredFiles: files, count: files.length });
    } catch {
      res.status(404).json({ error: `Unknown export preset: ${presetId}` });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /ai/packaging-design-plugin/compliance-profiles
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/packaging-design-plugin/compliance-profiles",
  adminAuth,
  (req: Request, res: Response): void => {
    const { packagingType } = req.query as Record<string, string>;
    const profiles = packagingType
      ? resolveComplianceProfiles(packagingType)
      : listComplianceProfiles();
    res.json({ profiles, count: profiles.length });
  },
);

// POST /ai/packaging-design-plugin/compliance/build-sheet
// Body: { packagingType, brandName, productName, reviewedBy?, notes? }
router.post(
  "/ai/packaging-design-plugin/compliance/build-sheet",
  adminAuth,
  (req: Request, res: Response): void => {
    const {
      packagingType,
      brandName,
      productName,
      reviewedBy = "system",
      notes,
    } = req.body as {
      packagingType?: string;
      brandName?:     string;
      productName?:   string;
      reviewedBy?:    string;
      notes?:         string;
    };
    if (!packagingType || !brandName || !productName) {
      res.status(400).json({
        error: "packagingType, brandName, and productName are required",
      });
      return;
    }
    try {
      const sheet = buildComplianceSheet({
        packagingType,
        brandName,
        productName,
        reviewedBy,
        pluginVersion: PLUGIN_VERSION,
        notes,
      });
      res.status(201).json(sheet);
    } catch (err) {
      handleError(res, err, "Failed to build compliance sheet");
    }
  },
);

// POST /ai/packaging-design-plugin/compliance/recalculate
// Body: ComplianceSheetMetadata (with updated check outcomes)
router.post(
  "/ai/packaging-design-plugin/compliance/recalculate",
  adminAuth,
  (req: Request, res: Response): void => {
    const sheet = req.body;
    if (!sheet?.checks || !Array.isArray(sheet.checks)) {
      res.status(400).json({ error: "Request body must be a ComplianceSheetMetadata object with a checks array" });
      return;
    }
    try {
      const updated = recalculateOutcome(sheet);
      res.json(updated);
    } catch (err) {
      handleError(res, err, "Failed to recalculate compliance outcome");
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /ai/packaging-design-plugin/brief/validate   (PUBLIC — no auth)
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/ai/packaging-design-plugin/brief/validate",
  (req: Request, res: Response): void => {
    const result = validateBrief(req.body);
    if (result.valid) {
      res.json({
        valid:    true,
        warnings: result.warnings,
        message:  result.warnings.length > 0
          ? "Brief is valid with warnings."
          : "Brief is valid.",
      });
    } else {
      res.status(422).json({
        valid:   false,
        errors:  result.errors,
        message: "Brief validation failed.",
      });
    }
  },
);

export default router;
