/**
 * product-design — Types barrel export
 *
 * STATUS: BLOCKED_PENDING_FOUNDATION
 *
 * Public surface: domain-specific types AND the 5 minimal contracts
 * (ProductDesignRequirements, ProductDesignBrief, ProductDesignCompositionMapping,
 * ProductDesignQcProfile, ProductDesignDeliverableManifest) + ExistingEngineAdapter.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

// ── Raw domain types (kept for validator and brief-builder use) ───────────────
export type {
  ConceptStatus,
  FormCategory,
  FinishType,
  MaterialClass,
  PlacementAnchor,
  DimensionsMm,
  DimensionsValidationResult,
  FormDirection,
  MaterialDirection,
  CMFEntry,
  CMFSpec,
  FeaturePlacement,
  LabelArea,
  ProductConcept,
} from "./concept.js";

export {
  CONCEPT_DISCLAIMER,
  TERMINAL_CONCEPT_STATUSES,
  ALL_MATERIAL_CLASSES,
  ALL_FINISH_TYPES,
} from "./concept.js";

export type {
  ManufacturingProcessHint,
  RequirementCategory,
  RequirementPriority,
  RequirementEntry,
  ManufacturerBrief,
  ClaimCheckResult,
} from "./manufacturer.js";

export { UNSUPPORTED_MANUFACTURING_CLAIMS } from "./manufacturer.js";

export type {
  LayerType,
  MockupFormat,
  ViewAngle,
  MockupLayer,
  CompositionSpec,
  ProductMockup,
} from "./mockup.js";

export { LAYER_ZINDEX } from "./mockup.js";

export type {
  VariantAxis,
  VariantDelta,
  ConceptVariant,
  VariantConsistencyResult,
} from "./variant.js";

// ── Minimal domain contracts (primary integration surface for Teams 7–14) ─────
export type {
  ProductDesignRequirements,
  ProductDesignBrief,
  ProductDesignCompositionMapping,
  ProductDesignQcProfile,
  ProductDesignDeliverableManifest,
  ExistingEngineAdapter,
} from "./contracts.js";
