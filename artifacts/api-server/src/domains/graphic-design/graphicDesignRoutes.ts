/**
 * graphicDesignRoutes.ts — Graphic Design Domain (Team 15)
 *
 * REST routes for the Graphic Design domain.
 * Prefix: /ai/graphic-design  (registered via integration/manifests/team-15.json → routesToMount)
 *
 * Auth strategy (per Global Remediation Rules):
 *  - Public reference routes (GET services, print-spec, packages, manifest, components;
 *    POST brief/score, brief/validate, print-spec/validate): no auth required — pure
 *    static/computation data, no ownership, no DB writes.
 *  - Engine-internal mutation routes (POST manifest/build, POST qc/score): require
 *    ADMIN_API_KEY via `x-admin-api-key` header checked at route level.
 *    tenantId is NEVER trusted from request body — must come from `x-tenant-id` header
 *    set by the calling engine team.
 */

import { Router, type Request, type Response } from "express";
import { GRAPHIC_DESIGN_SERVICES, GD_PACKAGE_TIERS } from "./types.js";
import {
  scoreGraphicDesignBrief,
  assertGdBriefReady,
  extractServiceCode,
  extractPackageTier,
  GD_BRIEF_READINESS_THRESHOLD,
} from "./briefSchema.js";
import { getGdBlueprint, getGdPrintSpec } from "./blueprintMapping.js";
import { getGdComponents } from "./componentMapping.js";
import { scoreGraphicDesignOutput, validatePrintDimensions, GD_QC_PASS_THRESHOLD } from "./qcRules.js";
import { buildGdManifest, getExpectedFileNames } from "./deliverableManifest.js";
import { resolveGdPolicy, computeSlaDueDate, GD_PACKAGE_POLICIES } from "./packagePolicy.js";
import type { GraphicDesignServiceCode, GdPackageTier } from "./types.js";

const router = Router();

// ── Domain-local helpers ──────────────────────────────────────────────────────

function isValidServiceCode(code: unknown): code is GraphicDesignServiceCode {
  return typeof code === "string" && (GRAPHIC_DESIGN_SERVICES as readonly string[]).includes(code);
}

function isValidTier(tier: unknown): tier is GdPackageTier {
  return typeof tier === "string" && (GD_PACKAGE_TIERS as readonly string[]).includes(tier);
}

function badRequest(res: Response, message: string, details?: unknown) {
  return res.status(400).json({ error: message, details });
}

/**
 * Domain-local admin key guard (P1 security fix).
 * Checks `x-admin-api-key` header against ADMIN_API_KEY env var.
 * Returns true if authorised; sends 401 and returns false otherwise.
 * Does NOT import shared auth middleware (per locked-files rule).
 */
function requireAdminKey(req: Request, res: Response): boolean {
  const adminKey = process.env.ADMIN_API_KEY;
  const provided = req.headers["x-admin-api-key"];
  if (!adminKey || !provided || provided !== adminKey) {
    res.status(401).json({ error: "Unauthorized: valid x-admin-api-key required" });
    return false;
  }
  return true;
}

/**
 * Resolve tenantId from trusted `x-tenant-id` header only.
 * NEVER accept tenantId from request body (IDOR rule).
 */
function resolveTenantId(req: Request): string | null {
  const t = req.headers["x-tenant-id"];
  return typeof t === "string" && t.trim().length > 0 ? t.trim() : null;
}

// ── Service catalogue ─────────────────────────────────────────────────────────

/**
 * GET /ai/graphic-design/services
 * List all available Graphic Design services with blueprint and print spec.
 * Public reference data — no auth required.
 */
router.get("/ai/graphic-design/services", (_req: Request, res: Response) => {
  const services = GRAPHIC_DESIGN_SERVICES.map((code) => ({
    code,
    blueprint: getGdBlueprint(code),
    printSpec: getGdPrintSpec(code),
  }));
  return res.json({ services });
});

/**
 * GET /ai/graphic-design/services/:serviceCode
 * Detail for a single service including components and package policies.
 * Public reference data — no auth required.
 */
router.get("/ai/graphic-design/services/:serviceCode", (req: Request, res: Response) => {
  const { serviceCode } = req.params;
  if (!isValidServiceCode(serviceCode)) {
    return badRequest(res, `Unknown service code: '${serviceCode}'`, { valid: GRAPHIC_DESIGN_SERVICES });
  }

  const blueprint = getGdBlueprint(serviceCode);
  const printSpec = getGdPrintSpec(serviceCode);
  const components = getGdComponents(serviceCode);
  const policies = Object.fromEntries(
    GD_PACKAGE_TIERS.map((tier) => [tier, resolveGdPolicy(tier, serviceCode)]),
  );

  return res.json({ code: serviceCode, blueprint, printSpec, components, policies });
});

// ── Brief ─────────────────────────────────────────────────────────────────────

/**
 * POST /ai/graphic-design/brief/score
 * Score a brief for readiness without persisting anything.
 * Pure computation — no auth, no DB, no ownership.
 * Body: { serviceCode, briefJson }
 */
router.post("/ai/graphic-design/brief/score", (req: Request, res: Response) => {
  const { serviceCode, briefJson } = req.body as {
    serviceCode?: unknown;
    briefJson?: Record<string, unknown>;
  };

  if (!isValidServiceCode(serviceCode)) {
    return badRequest(res, "Invalid or missing serviceCode", { valid: GRAPHIC_DESIGN_SERVICES });
  }
  if (!briefJson || typeof briefJson !== "object") {
    return badRequest(res, "briefJson must be an object");
  }

  const result = scoreGraphicDesignBrief(briefJson, serviceCode);
  return res.json(result);
});

/**
 * POST /ai/graphic-design/brief/validate
 * Validate whether brief is production-ready (throws-style check as JSON).
 * Pure computation — no auth, no DB, no ownership.
 * Body: { serviceCode, briefJson }
 */
router.post("/ai/graphic-design/brief/validate", (req: Request, res: Response) => {
  const { serviceCode, briefJson } = req.body as {
    serviceCode?: unknown;
    briefJson?: Record<string, unknown>;
  };

  if (!isValidServiceCode(serviceCode)) {
    return badRequest(res, "Invalid or missing serviceCode");
  }
  if (!briefJson || typeof briefJson !== "object") {
    return badRequest(res, "briefJson must be an object");
  }

  const result = scoreGraphicDesignBrief(briefJson, serviceCode);
  const ready = result.readinessStatus === "ready";

  return res.json({
    ready,
    score: result.overallScore,
    threshold: GD_BRIEF_READINESS_THRESHOLD,
    missingRequired: result.missingRequired,
    missingOptional: result.missingOptional,
    warnings: result.warnings,
  });
});

// ── Print specification ───────────────────────────────────────────────────────

/**
 * GET /ai/graphic-design/print-spec/:serviceCode
 * Return standard print specification for a service.
 * Public reference data — no auth required.
 */
router.get("/ai/graphic-design/print-spec/:serviceCode", (req: Request, res: Response) => {
  const { serviceCode } = req.params;
  if (!isValidServiceCode(serviceCode)) {
    return badRequest(res, `Unknown service code: '${serviceCode}'`);
  }
  return res.json(getGdPrintSpec(serviceCode));
});

/**
 * POST /ai/graphic-design/print-spec/:serviceCode/validate
 * Validate custom print dimension overrides against service bounds.
 * Pure computation — no auth, no DB, no ownership.
 * Body: { widthMm?, heightMm?, bleedMm? }
 */
router.post("/ai/graphic-design/print-spec/:serviceCode/validate", (req: Request, res: Response) => {
  const { serviceCode } = req.params;
  if (!isValidServiceCode(serviceCode)) {
    return badRequest(res, `Unknown service code: '${serviceCode}'`);
  }

  const { widthMm, heightMm, bleedMm } = req.body as {
    widthMm?: unknown; heightMm?: unknown; bleedMm?: unknown;
  };

  const result = validatePrintDimensions(serviceCode, {
    widthMm: typeof widthMm === "number" ? widthMm : undefined,
    heightMm: typeof heightMm === "number" ? heightMm : undefined,
    bleedMm: typeof bleedMm === "number" ? bleedMm : undefined,
  });

  if (!result.valid) {
    return res.status(422).json({ valid: false, errors: result.errors, spec: result.spec });
  }
  return res.json({ valid: true, errors: [], spec: result.spec });
});

// ── Package policy ────────────────────────────────────────────────────────────

/**
 * GET /ai/graphic-design/packages
 * List all package tiers and their global policies.
 * Public reference data — no auth required.
 */
router.get("/ai/graphic-design/packages", (_req: Request, res: Response) => {
  return res.json({ packages: GD_PACKAGE_POLICIES });
});

/**
 * GET /ai/graphic-design/packages/:tier/:serviceCode
 * Effective policy for a specific tier × service combination.
 * Public reference data — no auth required.
 */
router.get("/ai/graphic-design/packages/:tier/:serviceCode", (req: Request, res: Response) => {
  const { tier, serviceCode } = req.params;
  if (!isValidTier(tier)) {
    return badRequest(res, `Unknown package tier: '${tier}'`, { valid: GD_PACKAGE_TIERS });
  }
  if (!isValidServiceCode(serviceCode)) {
    return badRequest(res, `Unknown service code: '${serviceCode}'`);
  }

  const policy = resolveGdPolicy(tier, serviceCode);
  const slaDueDate = computeSlaDueDate(tier, serviceCode, new Date());
  return res.json({ policy, exampleSlaDueDate: slaDueDate });
});

// ── Deliverable manifest ──────────────────────────────────────────────────────

/**
 * GET /ai/graphic-design/manifest/:serviceCode/:tier
 * Return expected file names for a service at a given tier.
 * Public reference data — no auth required.
 */
router.get("/ai/graphic-design/manifest/:serviceCode/:tier", (req: Request, res: Response) => {
  const { serviceCode, tier } = req.params;
  if (!isValidServiceCode(serviceCode)) {
    return badRequest(res, `Unknown service code: '${serviceCode}'`);
  }
  if (!isValidTier(tier)) {
    return badRequest(res, `Unknown tier: '${tier}'`);
  }

  const expectedFiles = getExpectedFileNames(serviceCode, tier);
  return res.json({ serviceCode, tier, expectedFiles, count: expectedFiles.length });
});

/**
 * POST /ai/graphic-design/manifest/build
 * Build a deliverable manifest from a completed job's produced files.
 * Body: { gdRequestId, serviceCode, packageTier, producedFiles, qcSummary }
 *
 * SECURITY (P1 fix):
 *  - Requires `x-admin-api-key` header — engine team internal route only.
 *  - tenantId is resolved from `x-tenant-id` header ONLY — never from body (IDOR rule).
 */
router.post("/ai/graphic-design/manifest/build", (req: Request, res: Response) => {
  if (!requireAdminKey(req, res)) return res.end();

  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: "Missing x-tenant-id header" });
  }

  const { gdRequestId, serviceCode, packageTier, producedFiles, qcSummary } =
    req.body as {
      gdRequestId?: unknown;
      serviceCode?: unknown;
      packageTier?: unknown;
      producedFiles?: unknown;
      qcSummary?: unknown;
    };

  if (typeof gdRequestId !== "number") return badRequest(res, "gdRequestId must be a number");
  if (!isValidServiceCode(serviceCode)) return badRequest(res, "Invalid serviceCode");
  if (!isValidTier(packageTier)) return badRequest(res, "Invalid packageTier");
  if (!Array.isArray(producedFiles)) return badRequest(res, "producedFiles must be an array");
  if (typeof qcSummary !== "object" || !qcSummary) return badRequest(res, "qcSummary must be an object");

  const manifest = buildGdManifest({
    gdRequestId,
    serviceCode,
    packageTier,
    tenantId,                             // ← sourced from header, not body
    producedFiles: producedFiles as Array<{ fileName: string; storagePath?: string }>,
    qcSummary: qcSummary as { score: number; passed: boolean; warnings: string[] },
  });

  return res.json(manifest);
});

// ── QC ────────────────────────────────────────────────────────────────────────

/**
 * POST /ai/graphic-design/qc/score
 * Score a generation report for QC. Pure function — no DB writes.
 * Body: { generationReport, serviceCode, packageTier }
 *
 * SECURITY (P1 fix):
 *  - Requires `x-admin-api-key` — invoked by Team 13 (QC orchestration) only.
 *    Not a customer-facing endpoint.
 */
router.post("/ai/graphic-design/qc/score", (req: Request, res: Response) => {
  if (!requireAdminKey(req, res)) return res.end();

  const { generationReport, serviceCode, packageTier } = req.body as {
    generationReport?: unknown;
    serviceCode?: unknown;
    packageTier?: unknown;
  };

  if (!isValidServiceCode(serviceCode)) return badRequest(res, "Invalid serviceCode");
  if (!isValidTier(packageTier)) return badRequest(res, "Invalid packageTier");
  if (typeof generationReport !== "object" || !generationReport) {
    return badRequest(res, "generationReport must be an object");
  }

  const result = scoreGraphicDesignOutput(
    generationReport as Record<string, unknown> as Parameters<typeof scoreGraphicDesignOutput>[0],
    serviceCode,
    packageTier,
  );

  return res.json({ ...result, threshold: GD_QC_PASS_THRESHOLD });
});

// ── Components ────────────────────────────────────────────────────────────────

/**
 * GET /ai/graphic-design/components/:serviceCode
 * Return component checklist for a service.
 * Public reference data — no auth required.
 */
router.get("/ai/graphic-design/components/:serviceCode", (req: Request, res: Response) => {
  const { serviceCode } = req.params;
  if (!isValidServiceCode(serviceCode)) {
    return badRequest(res, `Unknown service code: '${serviceCode}'`);
  }
  return res.json({ serviceCode, components: getGdComponents(serviceCode) });
});

export { router as graphicDesignRouter };
export default router;
