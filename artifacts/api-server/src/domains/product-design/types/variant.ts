/**
 * product-design — Concept Variant Types
 *
 * A ConceptVariant is a derivative of a base ProductConcept that changes
 * one or more design axes (CMF, form, material, feature, label) while
 * preserving the product's core identity.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

export type VariantAxis = "cmf" | "form" | "material" | "feature" | "label";

// ── Variant Delta ──────────────────────────────────────────────────────────────

export interface VariantDelta {
  /** Which design axis this change targets. */
  axis: VariantAxis;
  /** Human-readable description of the change. */
  description: string;
  /**
   * Structured patch on top of the base concept.
   * Keys are dot-notation field paths (e.g. "cmf.entries[0].colorCode").
   * Values are replacement values.
   * This is a declarative delta — not an imperative mutation.
   */
  patch: Record<string, unknown>;
}

// ── Concept Variant ────────────────────────────────────────────────────────────

export interface ConceptVariant {
  id: string;
  /** The base ProductConcept this variant derives from. */
  baseConceptId: string;
  /** Short label (e.g. "Variant A — Matte Black"). */
  name: string;
  /** Non-empty list of axes that differ from the base. */
  deltas: VariantDelta[];
  /** Populated by the consistency checker after creation. */
  consistencyCheck?: VariantConsistencyResult;
  /**
   * Mandatory disclaimer — same requirement as the base concept.
   * Must accompany every variant in client-facing outputs.
   */
  disclaimer: string;
  createdAt: Date;
}

// ── Consistency Check ──────────────────────────────────────────────────────────

export interface VariantConsistencyResult {
  /**
   * True when the variant does not fundamentally contradict the base concept's
   * form identity (e.g. changing a bottle to a jar is an inconsistency).
   * CMF / label / feature changes are always consistent by definition.
   */
  consistent: boolean;
  /** Violations found (empty when consistent). */
  issues: string[];
  /** Informational observations (non-blocking). */
  notes: string[];
  /** Axes changed in this variant. */
  axesChanged: VariantAxis[];
  /**
   * True when more than one "structural" axis (form or material) is changed
   * simultaneously — a warning condition, not a blocker.
   */
  multipleStructuralAxes: boolean;
}
