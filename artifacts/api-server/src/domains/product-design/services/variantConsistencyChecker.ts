/**
 * product-design — Variant Consistency Checker
 *
 * Validates that a ConceptVariant's deltas are internally consistent
 * and do not fundamentally contradict the base concept's product identity.
 *
 * Rules:
 * - A variant MUST have at least one delta.
 * - CMF / label / feature axis changes are always consistent.
 * - Form axis changes that alter the FormCategory are flagged.
 * - Simultaneous change of multiple "structural" axes (form + material)
 *   raises a multipleStructuralAxes warning.
 * - Patch keys must not be empty.
 *
 * PURE — no I/O, no side effects.
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import type { ConceptVariant, VariantDelta, VariantAxis } from "../types/variant";
import type { VariantConsistencyResult } from "../types/variant";

const STRUCTURAL_AXES: ReadonlySet<VariantAxis> = new Set(["form", "material"]);

// ── Internal helpers ───────────────────────────────────────────────────────────

function validateDelta(delta: VariantDelta, index: number): string[] {
  const errors: string[] = [];
  const tag = `delta[${index}] (axis "${delta.axis}")`;

  if (!delta.description || delta.description.trim().length === 0) {
    errors.push(`${tag}: description must not be empty.`);
  }

  if (!delta.patch || Object.keys(delta.patch).length === 0) {
    errors.push(`${tag}: patch must contain at least one field change.`);
  } else {
    for (const key of Object.keys(delta.patch)) {
      if (!key || key.trim().length === 0) {
        errors.push(`${tag}: patch contains an empty key — all patch keys must be non-empty field paths.`);
      }
    }
  }

  return errors;
}

// ── Primary export ─────────────────────────────────────────────────────────────

/**
 * Checks a variant's deltas for consistency with its declared axes and
 * against general product-identity rules.
 *
 * @param variant  The ConceptVariant to check.
 * @returns        VariantConsistencyResult — issues are blocking, notes are advisory.
 */
export function checkVariantConsistency(
  variant: ConceptVariant,
): VariantConsistencyResult {
  const issues: string[] = [];
  const notes: string[] = [];
  const axesChanged: VariantAxis[] = [];

  // ── Must have at least one delta ────────────────────────────────────────

  if (!Array.isArray(variant.deltas) || variant.deltas.length === 0) {
    issues.push(
      "A variant must declare at least one delta. " +
      "A variant with no changes is identical to the base concept.",
    );
    return {
      consistent: false,
      issues,
      notes,
      axesChanged,
      multipleStructuralAxes: false,
    };
  }

  // ── Validate each delta ─────────────────────────────────────────────────

  for (let i = 0; i < variant.deltas.length; i++) {
    const delta = variant.deltas[i];
    const deltaErrors = validateDelta(delta, i);
    issues.push(...deltaErrors);

    if (!axesChanged.includes(delta.axis)) {
      axesChanged.push(delta.axis);
    }
  }

  // ── Structural axis analysis ────────────────────────────────────────────

  const structuralAxesChanged = axesChanged.filter((a) => STRUCTURAL_AXES.has(a));
  const multipleStructuralAxes = structuralAxesChanged.length > 1;

  if (multipleStructuralAxes) {
    notes.push(
      `Multiple structural axes changed simultaneously (${structuralAxesChanged.join(", ")}). ` +
      "Consider splitting into separate variants for clearer stakeholder review.",
    );
  }

  // ── Form category change warning ────────────────────────────────────────

  const formDelta = variant.deltas.find((d) => d.axis === "form");
  if (formDelta) {
    const patchKeys = Object.keys(formDelta.patch);
    const changesCategory = patchKeys.some(
      (k) => k === "category" || k === "formDirection.category",
    );
    if (changesCategory) {
      issues.push(
        "Changing the form category (e.g. bottle → jar) creates a fundamentally " +
        "different product, not a variant. Create a new ProductConcept instead.",
      );
    } else {
      notes.push(
        "Form axis change detected. Verify that shape modifications are " +
        "compatible with the base concept's structural requirements.",
      );
    }
  }

  // ── Duplicate axes ──────────────────────────────────────────────────────

  const axisCount = new Map<VariantAxis, number>();
  for (const delta of variant.deltas) {
    axisCount.set(delta.axis, (axisCount.get(delta.axis) ?? 0) + 1);
  }
  for (const [axis, count] of axisCount.entries()) {
    if (count > 1) {
      notes.push(
        `Axis "${axis}" has ${count} delta entries. ` +
        "Consider consolidating into a single delta for clarity.",
      );
    }
  }

  return {
    consistent: issues.length === 0,
    issues,
    notes,
    axesChanged,
    multipleStructuralAxes,
  };
}
