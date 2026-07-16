/**
 * qcRules.ts — Graphic Design Domain (Team 15)
 *
 * Post-generation Quality Control scoring for all Graphic Design services.
 *
 * Deterministic, pure-function scoring — no LLM calls, no DB access.
 * Input: the generationReport stored in the job result metadata.
 * Output: qcScore (0–100), per-dimension breakdown, pass/fail, warnings.
 *
 * Dimensions (weighted):
 *   1. briefCompleteness  (25%) — required brief fields were satisfied
 *   2. printSpecValid     (30%) — print dimensions, bleed, DPI, color mode correct
 *                                  (100 for digital-only services)
 *   3. textFitting        (25%) — all text elements fit within safe area
 *   4. bleedSafeArea      (10%) — bleed zones and safe margins verified
 *                                  (100 for digital-only services)
 *   5. deliverableCount   (10%) — expected files were produced
 *
 * QC gate: qcScore >= 65 → passed.
 */

import type {
  GraphicDesignServiceCode,
  GdPackageTier,
  GdQcResult,
  GdQcDimensions,
  PrintSpec,
} from "./types.js";
import { GD_PRINT_SPECS } from "./blueprintMapping.js";

export const GD_QC_PASS_THRESHOLD = 65;

// ── Expected deliverable counts per tier ─────────────────────────────────────

const MIN_DELIVERABLE_COUNT: Record<GdPackageTier, Record<GraphicDesignServiceCode, number>> = {
  starter: {
    "logo": 3, "business-card": 2, "letterhead": 2, "flyer": 1,
    "poster": 2, "banner": 1, "brochure": 1, "social-media": 3,
    "certificate": 2, "stationery": 2,
  },
  professional: {
    "logo": 5, "business-card": 3, "letterhead": 3, "flyer": 2,
    "poster": 3, "banner": 2, "brochure": 2, "social-media": 5,
    "certificate": 3, "stationery": 4,
  },
  business: {
    "logo": 6, "business-card": 4, "letterhead": 4, "flyer": 3,
    "poster": 4, "banner": 3, "brochure": 3, "social-media": 6,
    "certificate": 3, "stationery": 5,
  },
  enterprise: {
    "logo": 8, "business-card": 6, "letterhead": 5, "flyer": 4,
    "poster": 5, "banner": 4, "brochure": 4, "social-media": 8,
    "certificate": 4, "stationery": 7,
  },
};

// ── Text-fitting thresholds ───────────────────────────────────────────────────

/** Overflow percentage above which text-fitting fails (0.0–1.0). */
const TEXT_OVERFLOW_FAIL_THRESHOLD = 0.05;  // 5% overflow → fail
const TEXT_OVERFLOW_WARN_THRESHOLD = 0.02;  // 2% → warning

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(present: number, total: number): number {
  if (total === 0) return 100;
  return Math.round(Math.min(100, (present / total) * 100));
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ── Generation report types ───────────────────────────────────────────────────

export interface GdGenerationReport {
  /** Actual dimensions of the primary output file in mm (null for digital). */
  actualWidthMm?: number | null;
  actualHeightMm?: number | null;
  /** Actual bleed applied in mm. */
  actualBleedMm?: number | null;
  /** Actual safe area in mm. */
  actualSafeAreaMm?: number | null;
  /** Actual output DPI. */
  actualDpi?: number | null;
  /** Color mode of output file. */
  actualColorMode?: "cmyk" | "rgb" | null;
  /** Text overflow ratio (0.0 = no overflow, 1.0 = all text overflowed). */
  textOverflowRatio?: number | null;
  /** Text elements that overflowed the safe area. */
  overflowingTextElements?: string[];
  /** List of file names actually produced. */
  producedFiles?: string[];
  /** Brief field keys that were satisfied. */
  satisfiedBriefFields?: string[];
  /** Total required brief fields for this service. */
  totalRequiredBriefFields?: number;
}

// ── Dimension scorers ─────────────────────────────────────────────────────────

function scoreBriefCompleteness(report: GdGenerationReport): number {
  const satisfied = report.satisfiedBriefFields?.length ?? 0;
  const total = report.totalRequiredBriefFields ?? 0;
  return pct(satisfied, total);
}

function scorePrintSpec(
  report: GdGenerationReport,
  spec: PrintSpec,
  warnings: string[],
): number {
  if (spec.digitalOnly) return 100;

  let score = 100;
  const tolerance = 0.5; // mm tolerance for dimension checks

  if (report.actualWidthMm != null) {
    const widthOk = Math.abs(report.actualWidthMm - (spec.widthMm + 2 * spec.bleedMm)) <= tolerance;
    if (!widthOk) {
      warnings.push(
        `Output width (${report.actualWidthMm.toFixed(2)} mm) does not match expected ` +
        `${(spec.widthMm + 2 * spec.bleedMm).toFixed(2)} mm (with bleed).`,
      );
      score -= 30;
    }
  } else {
    warnings.push("Output width not reported — cannot verify print dimensions.");
    score -= 15;
  }

  if (report.actualHeightMm != null) {
    const heightOk = Math.abs(report.actualHeightMm - (spec.heightMm + 2 * spec.bleedMm)) <= tolerance;
    if (!heightOk) {
      warnings.push(
        `Output height (${report.actualHeightMm.toFixed(2)} mm) does not match expected ` +
        `${(spec.heightMm + 2 * spec.bleedMm).toFixed(2)} mm (with bleed).`,
      );
      score -= 30;
    }
  } else {
    warnings.push("Output height not reported — cannot verify print dimensions.");
    score -= 15;
  }

  if (report.actualDpi != null && report.actualDpi < spec.resolutionDpi) {
    warnings.push(`Output DPI (${report.actualDpi}) is below required ${spec.resolutionDpi} DPI.`);
    score -= 20;
  }

  if (report.actualColorMode != null && report.actualColorMode !== spec.colorMode) {
    warnings.push(
      `Output color mode '${report.actualColorMode}' does not match required '${spec.colorMode}'.`,
    );
    score -= 20;
  }

  return clamp(score);
}

function scoreTextFitting(report: GdGenerationReport, warnings: string[]): number {
  const overflow = report.textOverflowRatio ?? 0;

  if (overflow > TEXT_OVERFLOW_FAIL_THRESHOLD) {
    const elems = report.overflowingTextElements?.join(", ") ?? "unknown";
    warnings.push(`Text overflow (${(overflow * 100).toFixed(1)}%) exceeds safe area: ${elems}.`);
    return clamp(Math.round((1 - overflow) * 100));
  }
  if (overflow > TEXT_OVERFLOW_WARN_THRESHOLD) {
    warnings.push(
      `Minor text overflow detected (${(overflow * 100).toFixed(1)}%) — review before print.`,
    );
    return clamp(Math.round(100 - overflow * 500));
  }
  return 100;
}

function scoreBleedSafeArea(
  report: GdGenerationReport,
  spec: PrintSpec,
  warnings: string[],
): number {
  if (spec.digitalOnly) return 100;

  let score = 100;

  if (report.actualBleedMm != null && report.actualBleedMm < spec.bleedMm) {
    warnings.push(
      `Applied bleed (${report.actualBleedMm} mm) is less than required ${spec.bleedMm} mm.`,
    );
    score -= 50;
  }

  if (report.actualSafeAreaMm != null && report.actualSafeAreaMm < spec.safeAreaMm) {
    warnings.push(
      `Safe area margin (${report.actualSafeAreaMm} mm) is less than required ${spec.safeAreaMm} mm.`,
    );
    score -= 50;
  }

  return clamp(score);
}

function scoreDeliverableCount(
  report: GdGenerationReport,
  serviceCode: GraphicDesignServiceCode,
  packageTier: GdPackageTier,
  warnings: string[],
): number {
  const produced = report.producedFiles?.length ?? 0;
  const required = MIN_DELIVERABLE_COUNT[packageTier][serviceCode] ?? 1;

  if (produced < required) {
    warnings.push(
      `Only ${produced} file(s) produced; expected at least ${required} for '${packageTier}' tier.`,
    );
    return pct(produced, required);
  }
  return 100;
}

// ── Main QC scorer ────────────────────────────────────────────────────────────

/**
 * Score a completed Graphic Design job for QC.
 *
 * @param report    The generationReport from the job result metadata.
 * @param serviceCode  Which service was run.
 * @param packageTier  Package tier (affects deliverable count expectations).
 */
export function scoreGraphicDesignOutput(
  report: GdGenerationReport,
  serviceCode: GraphicDesignServiceCode,
  packageTier: GdPackageTier,
): GdQcResult {
  const spec = GD_PRINT_SPECS[serviceCode];
  const warnings: string[] = [];

  const briefCompleteness  = scoreBriefCompleteness(report);
  const printSpecValid     = scorePrintSpec(report, spec, warnings);
  const textFitting        = scoreTextFitting(report, warnings);
  const bleedSafeArea      = scoreBleedSafeArea(report, spec, warnings);
  const deliverableCount   = scoreDeliverableCount(report, serviceCode, packageTier, warnings);

  const dimensions: GdQcDimensions = {
    briefCompleteness,
    printSpecValid,
    textFitting,
    bleedSafeArea,
    deliverableCount,
  };

  // Weighted score
  const qcScore = clamp(
    Math.round(
      briefCompleteness * 0.25 +
      printSpecValid    * 0.30 +
      textFitting       * 0.25 +
      bleedSafeArea     * 0.10 +
      deliverableCount  * 0.10,
    ),
  );

  const passed = qcScore >= GD_QC_PASS_THRESHOLD;

  return { qcScore, passed, dimensions, warnings, serviceCode, packageTier };
}

// ── Print dimension validator (standalone, for route-level checks) ────────────

export interface PrintDimensionValidation {
  valid: boolean;
  errors: string[];
  spec: PrintSpec;
}

/**
 * Validate that a user-supplied print spec (from brief overrides) is within
 * acceptable bounds for the service. Safe to call in route handlers.
 */
export function validatePrintDimensions(
  serviceCode: GraphicDesignServiceCode,
  overrides: { widthMm?: number; heightMm?: number; bleedMm?: number },
): PrintDimensionValidation {
  const spec = GD_PRINT_SPECS[serviceCode];
  const errors: string[] = [];

  if (spec.digitalOnly) {
    return { valid: true, errors: [], spec };
  }

  if (overrides.widthMm !== undefined) {
    if (overrides.widthMm < 10 || overrides.widthMm > 10000) {
      errors.push(`widthMm (${overrides.widthMm}) must be between 10 and 10000 mm.`);
    }
  }
  if (overrides.heightMm !== undefined) {
    if (overrides.heightMm < 10 || overrides.heightMm > 10000) {
      errors.push(`heightMm (${overrides.heightMm}) must be between 10 and 10000 mm.`);
    }
  }
  if (overrides.bleedMm !== undefined) {
    if (overrides.bleedMm < 0 || overrides.bleedMm > 50) {
      errors.push(`bleedMm (${overrides.bleedMm}) must be between 0 and 50 mm.`);
    }
  }

  // Banner: width and height required if custom
  if (serviceCode === "banner" && overrides.widthMm !== undefined && overrides.heightMm === undefined) {
    errors.push("Banner custom width requires custom height.");
  }

  return {
    valid: errors.length === 0,
    errors,
    spec: {
      ...spec,
      widthMm:  overrides.widthMm  ?? spec.widthMm,
      heightMm: overrides.heightMm ?? spec.heightMm,
      bleedMm:  overrides.bleedMm  ?? spec.bleedMm,
    },
  };
}
