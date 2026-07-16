/**
 * Team 13 — Dynamic Design Composition Engine
 * Route handlers
 *
 * Base path (after /api prefix from app.ts):
 *   POST   /ai/composer/compose          — compose a DesignCompositionSpec
 *   POST   /ai/composer/validate         — validate inputs without composing
 *   POST   /ai/composer/compatibility    — check compatibility of design elements
 *   GET    /ai/composer/health           — route-level health probe
 *
 * All routes are protected by the global adminAuth middleware applied in app.ts.
 * No zod/v4 direct imports — schemas live in the service layer only.
 */

import { Router } from "express";
import { ZodError } from "zod";
import {
  compose,
  checkCompatibility,
  compositionRequestSchema,
  validateRequestSchema,
  compatibilityCheckSchema,
} from "../../services/dynamic-design-composer/index.js";
import { applyFallbacks } from "../../services/dynamic-design-composer/fallbackHandler.js";
import { logger } from "../../lib/logger.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
}

// ── POST /api/ai/composer/compose ─────────────────────────────────────────────

/**
 * Compose a full DesignCompositionSpec from the provided design elements.
 *
 * Body: CompositionRequest (see schemas.ts)
 * Response: DesignCompositionSpec
 */
router.post("/ai/composer/compose", async (req, res) => {
  try {
    const parseResult = compositionRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Invalid composition request",
        details: formatZodError(parseResult.error),
      });
      return;
    }

    const spec = compose(parseResult.data);

    logger.info(
      {
        compositionId: spec.compositionId,
        styleScore: spec.styleConsistencyScore,
        brandScore: spec.brandConsistencyScore,
        fallbackCount: spec.fallbacksApplied.length,
        componentCount: spec.components.length,
      },
      "[composer] Composition complete",
    );

    res.status(200).json(spec);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    logger.error({ err }, "[composer] Composition failed");
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/ai/composer/validate ────────────────────────────────────────────

/**
 * Validate a CompositionRequest without running the full composition.
 * Returns validation errors and a preview of what fallbacks would be applied.
 *
 * Body: CompositionRequest
 * Response: { valid: boolean; errors?: string; fallbackPreview: FallbackRecord[] }
 */
router.post("/ai/composer/validate", async (req, res) => {
  try {
    const parseResult = validateRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(200).json({
        valid: false,
        errors: formatZodError(parseResult.error),
        fallbackPreview: [],
      });
      return;
    }

    const data = parseResult.data;

    // Run fallback analysis to show what the engine would fill in
    const fallbackResult = applyFallbacks(
      data.blueprint,
      data.layoutPlan,
      data.components,
      data.pattern,
      data.palette,
      data.typography,
      data.decoration,
      data.material,
      data.motif,
      data.brandDna,
    );

    res.status(200).json({
      valid: true,
      errors: null,
      fallbackPreview: fallbackResult.fallbacks,
      summary: {
        blueprintProvided: !!data.blueprint,
        layoutProvided: !!data.layoutPlan,
        paletteProvided: !!data.palette,
        typographyProvided: !!data.typography,
        componentCount: data.components.length,
        brandDnaProvided: !!data.brandDna,
        hasBrandColors: !!data.brandDna?.detectedColors?.primary,
        fallbackCount: fallbackResult.fallbacks.length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/ai/composer/compatibility ───────────────────────────────────────

/**
 * Check cross-element compatibility without a full composition.
 * Useful for real-time UI feedback while building a composition request.
 *
 * Body: { material, pattern, palette, decoration }
 * Response: CompatibilityReport
 */
router.post("/ai/composer/compatibility", async (req, res) => {
  try {
    const parseResult = compatibilityCheckSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Invalid compatibility check request",
        details: formatZodError(parseResult.error),
      });
      return;
    }

    const { material, pattern, palette, decoration } = parseResult.data;

    // For standalone compatibility check, use minimal layout + components
    const report = checkCompatibility({
      material,
      pattern,
      palette,
      decoration,
      layout: {
        name: "check",
        strategy: "hero-content",
        flow: "vertical",
        heroWeight: 0.4,
        sectionCount: 3,
        hasSidebar: false,
        emphasis: "balanced",
      },
      components: [],
      typography: {
        name: "check",
        headingFont: "Inter",
        bodyFont: "Inter",
        headingWeight: "600",
        bodyWeight: "400",
        baseSize: 16,
        scaleRatio: 1.25,
        lineHeight: 1.6,
        letterSpacing: "normal",
        style: "sans-serif",
      },
    });

    res.status(200).json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/ai/composer/health ───────────────────────────────────────────────

router.get("/ai/composer/health", (_req, res) => {
  res.status(200).json({
    service: "dynamic-design-composer",
    team: "team-13",
    version: "1.0.0",
    status: "ok",
  });
});

export default router;
