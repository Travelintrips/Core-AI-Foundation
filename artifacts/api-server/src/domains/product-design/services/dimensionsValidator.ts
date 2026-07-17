/**
 * product-design — Dimensions Validator
 *
 * Validates DimensionsMm metadata for a concept's form direction.
 * All results are concept-stage estimates; this is NOT an engineering check.
 * Returns structured errors + warnings rather than throwing.
 *
 * PURE — no I/O, no side effects.
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import type {
  DimensionsMm,
  DimensionsValidationResult,
  FormCategory,
} from "../types/concept";

// ── Heuristic limits per form category ────────────────────────────────────────

interface HeightWidthRatioRange {
  minRatio: number;
  maxRatio: number;
}

const FORM_RATIO_HINTS: Partial<Record<FormCategory, HeightWidthRatioRange>> = {
  bottle:     { minRatio: 1.5, maxRatio: 8.0 },
  tube:       { minRatio: 3.0, maxRatio: 15.0 },
  jar:        { minRatio: 0.3, maxRatio: 2.5 },
  sachet:     { minRatio: 0.5, maxRatio: 4.0 },
  pouch:      { minRatio: 0.8, maxRatio: 3.0 },
  compact:    { minRatio: 0.1, maxRatio: 1.2 },
  spray:      { minRatio: 2.0, maxRatio: 9.0 },
  dispenser:  { minRatio: 1.0, maxRatio: 6.0 },
};

// ── Absolute sanity bounds (concept-stage) ────────────────────────────────────

const MIN_DIMENSION_MM = 0.1;
const MAX_DIMENSION_MM = 2000;
const MAX_WALL_THICKNESS_FRACTION = 0.45; // can't be > 45% of width
const MAX_FILL_VOLUME_ML = 10_000;

// ── Validator ──────────────────────────────────────────────────────────────────

/**
 * Validates the DimensionsMm object for a given form category.
 *
 * @param dims     The dimensions to validate.
 * @param category The form category for ratio-hint warnings.
 * @returns        A DimensionsValidationResult (errors block, warnings advise).
 */
export function validateDimensions(
  dims: DimensionsMm,
  category: FormCategory,
): DimensionsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Required fields ──────────────────────────────────────────────────────

  if (!Number.isFinite(dims.height) || dims.height <= 0) {
    errors.push(`height must be a positive number (got ${dims.height}).`);
  } else if (dims.height < MIN_DIMENSION_MM) {
    errors.push(`height ${dims.height} mm is below minimum ${MIN_DIMENSION_MM} mm.`);
  } else if (dims.height > MAX_DIMENSION_MM) {
    errors.push(`height ${dims.height} mm exceeds maximum ${MAX_DIMENSION_MM} mm.`);
  }

  if (!Number.isFinite(dims.width) || dims.width <= 0) {
    errors.push(`width must be a positive number (got ${dims.width}).`);
  } else if (dims.width < MIN_DIMENSION_MM) {
    errors.push(`width ${dims.width} mm is below minimum ${MIN_DIMENSION_MM} mm.`);
  } else if (dims.width > MAX_DIMENSION_MM) {
    errors.push(`width ${dims.width} mm exceeds maximum ${MAX_DIMENSION_MM} mm.`);
  }

  // ── Optional: depth ──────────────────────────────────────────────────────

  if (dims.depth !== undefined) {
    if (!Number.isFinite(dims.depth) || dims.depth < 0) {
      errors.push(`depth must be a non-negative number (got ${dims.depth}).`);
    } else if (dims.depth > MAX_DIMENSION_MM) {
      errors.push(`depth ${dims.depth} mm exceeds maximum ${MAX_DIMENSION_MM} mm.`);
    }
  }

  // ── Optional: wallThickness ───────────────────────────────────────────────

  if (dims.wallThickness !== undefined) {
    if (!Number.isFinite(dims.wallThickness) || dims.wallThickness <= 0) {
      errors.push(`wallThickness must be a positive number (got ${dims.wallThickness}).`);
    } else if (
      Number.isFinite(dims.width) &&
      dims.width > 0 &&
      dims.wallThickness > dims.width * MAX_WALL_THICKNESS_FRACTION
    ) {
      errors.push(
        `wallThickness ${dims.wallThickness} mm is unrealistically large ` +
        `relative to width ${dims.width} mm (exceeds ${MAX_WALL_THICKNESS_FRACTION * 100}% of width).`,
      );
    } else if (dims.wallThickness < 0.1) {
      warnings.push(
        `wallThickness ${dims.wallThickness} mm is very thin — verify this is intentional.`,
      );
    }
  }

  // ── Optional: fillVolumeMl ────────────────────────────────────────────────

  if (dims.fillVolumeMl !== undefined) {
    if (!Number.isFinite(dims.fillVolumeMl) || dims.fillVolumeMl <= 0) {
      errors.push(`fillVolumeMl must be a positive number (got ${dims.fillVolumeMl}).`);
    } else if (dims.fillVolumeMl > MAX_FILL_VOLUME_ML) {
      errors.push(
        `fillVolumeMl ${dims.fillVolumeMl} mL exceeds maximum ${MAX_FILL_VOLUME_ML} mL.`,
      );
    }
  }

  // ── Height/width ratio heuristic ──────────────────────────────────────────

  if (errors.length === 0 && dims.height > 0 && dims.width > 0) {
    const ratio = dims.height / dims.width;
    const hint = FORM_RATIO_HINTS[category];
    if (hint) {
      if (ratio < hint.minRatio) {
        warnings.push(
          `Height/width ratio ${ratio.toFixed(2)} is unusually low for a "${category}" ` +
          `(expected ≥ ${hint.minRatio}). Verify form direction.`,
        );
      } else if (ratio > hint.maxRatio) {
        warnings.push(
          `Height/width ratio ${ratio.toFixed(2)} is unusually high for a "${category}" ` +
          `(expected ≤ ${hint.maxRatio}). Verify form direction.`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Throws if dims are invalid; otherwise returns the validation result (with
 * any warnings) for the caller to inspect.
 */
export function assertValidDimensions(
  dims: DimensionsMm,
  category: FormCategory,
): DimensionsValidationResult {
  const result = validateDimensions(dims, category);
  if (!result.valid) {
    throw new Error(
      `Invalid dimensions for concept form "${category}": ${result.errors.join("; ")}`,
    );
  }
  return result;
}
