/**
 * product-design — Core Concept Types
 *
 * Represents product form direction, material direction, CMF specs,
 * feature/label placement for concept-stage product design.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 *
 * ⚠️  IMPORTANT SCOPE BOUNDARY
 * This domain supports CONCEPT DESIGN ONLY.
 * It is NOT an engineering drawing, safety certification,
 * regulatory approval, or manufacturing-ready CAD system.
 */

// ── Enumerations ───────────────────────────────────────────────────────────────

export type ConceptStatus = "draft" | "in_review" | "approved" | "archived";

export type FormCategory =
  | "bottle"
  | "tube"
  | "jar"
  | "sachet"
  | "pouch"
  | "compact"
  | "spray"
  | "dispenser"
  | "custom";

export type FinishType =
  | "matte"
  | "gloss"
  | "satin"
  | "metallic"
  | "frosted"
  | "textured"
  | "soft_touch"
  | "chrome";

export type MaterialClass =
  | "glass"
  | "pet_plastic"
  | "hdpe_plastic"
  | "pp_plastic"
  | "aluminum"
  | "stainless_steel"
  | "paperboard"
  | "bioplastic"
  | "custom";

export type PlacementAnchor =
  | "top"
  | "bottom"
  | "front"
  | "back"
  | "left"
  | "right"
  | "wrap"
  | "full";

// ── Dimensions ─────────────────────────────────────────────────────────────────

export interface DimensionsMm {
  /** Height in millimetres (concept estimate only — not engineering-grade). */
  height: number;
  /** Width or outer diameter in millimetres. */
  width: number;
  /** Depth in millimetres (0 for purely cylindrical forms). */
  depth?: number;
  /** Wall thickness estimate in millimetres. */
  wallThickness?: number;
  /** Fill volume in millilitres (indicative; not a specification). */
  fillVolumeMl?: number;
}

export interface DimensionsValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Form Direction ─────────────────────────────────────────────────────────────

export interface FormDirection {
  /** Primary form category. */
  category: FormCategory;
  /** Freeform shape notes (max 500 chars). */
  shapeNotes?: string;
  /** Concept-stage dimensions. */
  dimensions: DimensionsMm;
  /** Ergonomic or grip reference notes. */
  ergonomicNotes?: string;
}

// ── Material Direction ─────────────────────────────────────────────────────────

export interface MaterialDirection {
  /** Primary structural material. */
  primaryMaterial: MaterialClass;
  /** Secondary material for closures, applicators, etc. */
  secondaryMaterial?: MaterialClass;
  /** Sustainability aspirations (concept-only; not a certification). */
  sustainabilityNotes?: string;
  /** Compatibility constraints (e.g. "alcohol-resistant inner layer"). */
  compatibilityNotes?: string;
}

// ── CMF (Color / Material / Finish) ───────────────────────────────────────────

export interface CMFEntry {
  /** Pantone, RAL, or hex color code. */
  colorCode: string;
  /** Human-readable color name. */
  colorName: string;
  /** Material this entry applies to. */
  material: MaterialClass;
  /** Surface finish applied. */
  finish: FinishType;
  /** Application zone (e.g. "body", "cap", "label_background"). */
  zone: string;
}

export interface CMFSpec {
  entries: CMFEntry[];
  /** True when every defined form zone has a CMF entry. */
  isComplete: boolean;
  /** Ink/coating system notes (concept-level). */
  processNotes?: string;
}

// ── Feature Placement ──────────────────────────────────────────────────────────

export interface FeaturePlacement {
  /** Unique id within this concept. */
  id: string;
  /** Feature description (e.g. "pump dispenser", "flip-top cap"). */
  label: string;
  /** Cardinal position on the form. */
  anchor: PlacementAnchor;
  /**
   * Relative position as a fraction of the form's bounding box [0, 1].
   * x: left→right, y: bottom→top, z: front→back.
   */
  relativePosition: { x: number; y: number; z?: number };
  /** Estimated footprint in mm. */
  footprintMm: { width: number; height: number };
}

// ── Label Area ─────────────────────────────────────────────────────────────────

export interface LabelArea {
  /** Unique id within this concept. */
  id: string;
  /** Human name (e.g. "front panel", "neck wrap"). */
  name: string;
  /** Where on the form. */
  anchor: PlacementAnchor;
  /** Printable area dimensions in mm. */
  printAreaMm: { width: number; height: number };
  /** Safe-zone inset in mm (no critical copy should enter this margin). */
  safeMarginMm: number;
  /**
   * Wrap coverage as a fraction of the form's circumference [0, 1].
   * Only meaningful for cylindrical/round forms.
   */
  wrapFraction?: number;
}

// ── Product Concept ────────────────────────────────────────────────────────────

export interface ProductConcept {
  id: string;
  /** Human-readable concept name (e.g. "Serum Bottle v3 — Matte Forest"). */
  name: string;
  /** Project / brand context. */
  projectId: string;
  status: ConceptStatus;
  formDirection: FormDirection;
  materialDirection: MaterialDirection;
  cmf: CMFSpec;
  featurePlacements: FeaturePlacement[];
  labelAreas: LabelArea[];
  /**
   * Mandatory disclaimer — MUST appear on every output derived from this concept.
   * Never suppress or override with marketing copy.
   */
  disclaimer: string;
  createdAt: Date;
  updatedAt: Date;
  /** Incremented on every mutation. */
  version: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

export const CONCEPT_DISCLAIMER =
  "This is a conceptual design direction only. It does not constitute an " +
  "engineering drawing, structural specification, safety certification, " +
  "regulatory approval, or manufacturing-ready CAD file. All dimensions, " +
  "materials, and finishes are indicative estimates subject to revision " +
  "during industrial design and engineering review.";

export const TERMINAL_CONCEPT_STATUSES: ReadonlyArray<ConceptStatus> = [
  "archived",
];

export const ALL_MATERIAL_CLASSES: ReadonlyArray<MaterialClass> = [
  "glass",
  "pet_plastic",
  "hdpe_plastic",
  "pp_plastic",
  "aluminum",
  "stainless_steel",
  "paperboard",
  "bioplastic",
  "custom",
];

export const ALL_FINISH_TYPES: ReadonlyArray<FinishType> = [
  "matte",
  "gloss",
  "satin",
  "metallic",
  "frosted",
  "textured",
  "soft_touch",
  "chrome",
];
