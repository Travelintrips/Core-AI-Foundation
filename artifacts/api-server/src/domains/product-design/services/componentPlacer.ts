/**
 * product-design — Component Placement Validator
 *
 * Validates FeaturePlacement and LabelArea entries against the form's
 * bounding box. Detects out-of-bounds positions and oversized label areas.
 * Performs simplified overlap detection between features.
 *
 * PURE — no I/O, no side effects.
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import type { FeaturePlacement, LabelArea, DimensionsMm } from "../types/concept";

// ── Result types ───────────────────────────────────────────────────────────────

export interface PlacementValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface LabelAreaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AllPlacementsResult {
  valid: boolean;
  featureResults: Record<string, PlacementValidationResult>;
  labelResults: Record<string, LabelAreaValidationResult>;
  overlapWarnings: string[];
  errors: string[];
}

// ── Feature placement validation ───────────────────────────────────────────────

/**
 * Validates a single FeaturePlacement.
 * relativePosition must be in [0, 1]; footprintMm must be positive.
 */
export function validateFeaturePlacement(
  fp: FeaturePlacement,
): PlacementValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { x, y, z } = fp.relativePosition;

  if (!Number.isFinite(x) || x < 0 || x > 1) {
    errors.push(
      `Feature "${fp.id}": relativePosition.x must be in [0, 1] (got ${x}).`,
    );
  }
  if (!Number.isFinite(y) || y < 0 || y > 1) {
    errors.push(
      `Feature "${fp.id}": relativePosition.y must be in [0, 1] (got ${y}).`,
    );
  }
  if (z !== undefined && (!Number.isFinite(z) || z < 0 || z > 1)) {
    errors.push(
      `Feature "${fp.id}": relativePosition.z must be in [0, 1] (got ${z}).`,
    );
  }

  if (!Number.isFinite(fp.footprintMm.width) || fp.footprintMm.width <= 0) {
    errors.push(
      `Feature "${fp.id}": footprintMm.width must be a positive number (got ${fp.footprintMm.width}).`,
    );
  }
  if (!Number.isFinite(fp.footprintMm.height) || fp.footprintMm.height <= 0) {
    errors.push(
      `Feature "${fp.id}": footprintMm.height must be a positive number (got ${fp.footprintMm.height}).`,
    );
  }

  if (!fp.label || fp.label.trim().length === 0) {
    errors.push(`Feature "${fp.id}": label must not be empty.`);
  }

  // Warn when footprint is huge relative to common form sizes
  if (fp.footprintMm.width > 200 || fp.footprintMm.height > 200) {
    warnings.push(
      `Feature "${fp.id}": footprint (${fp.footprintMm.width} × ${fp.footprintMm.height} mm) ` +
      `is unusually large — verify it fits the form.`,
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Label area validation ──────────────────────────────────────────────────────

/**
 * Validates a LabelArea against the form dimensions.
 * printAreaMm must be positive and fit within the form's face.
 */
export function validateLabelArea(
  la: LabelArea,
  dims: DimensionsMm,
): LabelAreaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isFinite(la.printAreaMm.width) || la.printAreaMm.width <= 0) {
    errors.push(
      `Label "${la.id}": printAreaMm.width must be a positive number (got ${la.printAreaMm.width}).`,
    );
  }
  if (!Number.isFinite(la.printAreaMm.height) || la.printAreaMm.height <= 0) {
    errors.push(
      `Label "${la.id}": printAreaMm.height must be a positive number (got ${la.printAreaMm.height}).`,
    );
  }

  if (!Number.isFinite(la.safeMarginMm) || la.safeMarginMm < 0) {
    errors.push(
      `Label "${la.id}": safeMarginMm must be a non-negative number (got ${la.safeMarginMm}).`,
    );
  }

  // Label width must not exceed the form width
  if (la.printAreaMm.width > dims.width) {
    errors.push(
      `Label "${la.id}": printAreaMm.width (${la.printAreaMm.width} mm) exceeds ` +
      `form width (${dims.width} mm).`,
    );
  }

  // Label height must not exceed the form height
  if (la.printAreaMm.height > dims.height) {
    errors.push(
      `Label "${la.id}": printAreaMm.height (${la.printAreaMm.height} mm) exceeds ` +
      `form height (${dims.height} mm).`,
    );
  }

  // Safe margin must leave some usable area
  const usableWidth = la.printAreaMm.width - 2 * la.safeMarginMm;
  const usableHeight = la.printAreaMm.height - 2 * la.safeMarginMm;
  if (usableWidth <= 0 || usableHeight <= 0) {
    errors.push(
      `Label "${la.id}": safeMarginMm (${la.safeMarginMm} mm) consumes the entire print area ` +
      `(${la.printAreaMm.width} × ${la.printAreaMm.height} mm) — no usable copy area remains.`,
    );
  }

  // wrapFraction sanity
  if (la.wrapFraction !== undefined) {
    if (!Number.isFinite(la.wrapFraction) || la.wrapFraction < 0 || la.wrapFraction > 1) {
      errors.push(
        `Label "${la.id}": wrapFraction must be in [0, 1] (got ${la.wrapFraction}).`,
      );
    } else if (la.wrapFraction > 0.95) {
      warnings.push(
        `Label "${la.id}": wrapFraction ${la.wrapFraction} is almost full wrap — ` +
        `verify seam allowance with manufacturer.`,
      );
    }
  }

  if (!la.name || la.name.trim().length === 0) {
    errors.push(`Label "${la.id}": name must not be empty.`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Overlap detection (simplified 2-D bounding box) ──────────────────────────

/**
 * Checks whether two features' relative bounding boxes overlap.
 * Uses relative coordinates [0,1] for both position and footprint
 * normalised against 1 unit × 1 unit bounding box.
 */
function featuresOverlap(a: FeaturePlacement, b: FeaturePlacement): boolean {
  // We can't do precise mm overlap without knowing true form shape,
  // so this is a relative-coordinate heuristic.
  // Assume footprintMm is expressed in form-space mm; skip overlap check
  // unless both positions and footprints are defined.
  const aX1 = a.relativePosition.x;
  const aY1 = a.relativePosition.y;
  // footprint fraction approximation: footprint / 200 mm reference width
  const REF = 200;
  const aX2 = aX1 + a.footprintMm.width / REF;
  const aY2 = aY1 + a.footprintMm.height / REF;

  const bX1 = b.relativePosition.x;
  const bY1 = b.relativePosition.y;
  const bX2 = bX1 + b.footprintMm.width / REF;
  const bY2 = bY1 + b.footprintMm.height / REF;

  return aX1 < bX2 && aX2 > bX1 && aY1 < bY2 && aY2 > bY1;
}

// ── Aggregate validator ────────────────────────────────────────────────────────

/**
 * Validates all feature placements and label areas for a concept.
 */
export function validateAllPlacements(
  features: FeaturePlacement[],
  labels: LabelArea[],
  dims: DimensionsMm,
): AllPlacementsResult {
  const featureResults: Record<string, PlacementValidationResult> = {};
  const labelResults: Record<string, LabelAreaValidationResult> = {};
  const overlapWarnings: string[] = [];
  const errors: string[] = [];

  for (const fp of features) {
    const r = validateFeaturePlacement(fp);
    featureResults[fp.id] = r;
    if (!r.valid) errors.push(...r.errors);
  }

  for (const la of labels) {
    const r = validateLabelArea(la, dims);
    labelResults[la.id] = r;
    if (!r.valid) errors.push(...r.errors);
  }

  // Overlap detection between features (warn, not error)
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      if (featuresOverlap(features[i], features[j])) {
        overlapWarnings.push(
          `Features "${features[i].id}" and "${features[j].id}" may overlap ` +
          `(approximate bounding-box check — verify in 3-D view).`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    featureResults,
    labelResults,
    overlapWarnings,
    errors,
  };
}
