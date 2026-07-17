/**
 * product-design — Manufacturer Requirement Brief Types
 *
 * A ManufacturerBrief is a CONCEPT-LEVEL communication aid for early-stage
 * supplier conversations. It is NOT a technical specification, engineering
 * drawing, regulatory submission, or procurement contract.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

export type ManufacturingProcessHint =
  | "injection_molding"
  | "blow_molding"
  | "extrusion_blow"
  | "glass_molding"
  | "die_casting"
  | "screen_printing"
  | "hot_stamping"
  | "pad_printing"
  | "digital_printing"
  | "labeling"
  | "custom";

export type RequirementCategory =
  | "dimension"
  | "material"
  | "finish"
  | "label"
  | "feature"
  | "logistics"
  | "other";

export type RequirementPriority = "must" | "prefer" | "optional";

// ── Requirement Entry ──────────────────────────────────────────────────────────

export interface RequirementEntry {
  category: RequirementCategory;
  /** Human-readable requirement statement. */
  requirement: string;
  /** Indicative target value or range (not a binding specification). */
  value?: string;
  priority: RequirementPriority;
}

// ── Manufacturer Brief ─────────────────────────────────────────────────────────

export interface ManufacturerBrief {
  id: string;
  conceptId: string;
  /** Concept name for human reference. */
  conceptName: string;
  /**
   * Suggested process hints — concept-level direction only.
   * Final process selection is the manufacturer's determination.
   */
  processHints: ManufacturingProcessHint[];
  requirements: RequirementEntry[];
  /** Packaging, MOQ, or logistics notes (indicative). */
  logisticsNotes?: string;
  /**
   * Mandatory disclaimer — must appear verbatim on every brief output.
   * Do not abbreviate or paraphrase in client-facing documents.
   */
  disclaimer: string;
  generatedAt: Date;
}

// ── Claim Validation ───────────────────────────────────────────────────────────

/**
 * Substrings that constitute unsupported manufacturing claims.
 * Any RequirementEntry or notes field containing these strings must be
 * rejected by disclaimerService.assertNoUnsupportedClaims().
 */
export const UNSUPPORTED_MANUFACTURING_CLAIMS: ReadonlyArray<string> = [
  "ce certified",
  "fda approved",
  "iso 9001",
  "iso 14001",
  "engineering drawing",
  "cad file",
  "structural analysis",
  "safety tested",
  "safety certified",
  "regulatory compliant",
  "regulatory approved",
  "ul listed",
  "rohs certified",
  "reach compliant",
  "manufacturing-ready",
  "production-ready",
];

export interface ClaimCheckResult {
  /** True when no unsupported claims were found. */
  clean: boolean;
  /** Each flagged phrase and the field it appeared in. */
  violations: Array<{ phrase: string; field: string }>;
}
