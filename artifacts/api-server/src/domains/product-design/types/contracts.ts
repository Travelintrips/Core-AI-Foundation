/**
 * product-design — Minimal Domain Contracts (Team 20)
 *
 * STATUS: BLOCKED_PENDING_FOUNDATION
 *
 * These are the ONLY public types exported by this domain until the
 * following foundation teams pass audit and are integrated:
 *   - Team 07: AI model routing
 *   - Team 08: Universal Component Library
 *   - Team 11: Blueprint Engine
 *   - Team 12: Composition / Rendering Engine
 *   - Team 13: QC Pipeline
 *   - Team 14: Deliverable Manifest Service
 *
 * DO NOT implement engine logic, routes, or DB persistence here.
 * DO NOT depend on foundation team outputs until they are integrated.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import type { ProductConcept, CMFSpec, FormDirection, MaterialDirection, DimensionsMm } from "./concept.js";
import type { ManufacturerBrief, RequirementEntry } from "./manufacturer.js";
import type { CompositionSpec, MockupLayer, ViewAngle, MockupFormat } from "./mockup.js";
import type { ConceptVariant, VariantConsistencyResult } from "./variant.js";

// ── 1. ProductDesignRequirements ───────────────────────────────────────────────

/**
 * The full set of design requirements that a product concept captures.
 * This is the SOURCE of truth for all downstream engines.
 *
 * Maps to: ProductConcept (the domain entity)
 * Consumed by: Teams 11 (blueprint), 12 (composition), 13 (QC)
 */
export interface ProductDesignRequirements {
  /** Reference to the saved ProductConcept entity. */
  conceptId: string;
  /** Human-readable concept label. */
  conceptName: string;
  formDirection: FormDirection;
  materialDirection: MaterialDirection;
  cmf: CMFSpec;
  estimatedDimensions: DimensionsMm;
  /**
   * Mandatory disclaimer that MUST accompany every output derived from these
   * requirements. Do not suppress or paraphrase.
   */
  disclaimer: string;
  /** Monotonically incrementing version — bump on every mutation. */
  version: number;
}

// ── 2. ProductDesignBrief ──────────────────────────────────────────────────────

/**
 * Concept-level communication package sent to a manufacturer or supplier
 * for early-stage feasibility conversations.
 *
 * Maps to: ManufacturerBrief (the domain entity)
 * Consumed by: External manufacturer communication flow (Team 24 wiring)
 *
 * ⚠️  NOT a technical specification, engineering drawing, or procurement
 *     contract. Every field is a conceptual estimate.
 */
export interface ProductDesignBrief {
  briefId: string;
  conceptId: string;
  conceptName: string;
  /** Suggested manufacturing process directions (concept-level only). */
  processHints: string[];
  requirements: RequirementEntry[];
  logisticsNotes?: string;
  /** Mandatory disclaimer — must appear verbatim on every brief output. */
  disclaimer: string;
  generatedAt: Date;
}

// ── 3. ProductDesignCompositionMapping ────────────────────────────────────────

/**
 * Maps a product concept to a layered composition spec consumable by the
 * rendering engine (Team 12).
 *
 * This is a DECLARATIVE MAPPING — it describes what to render, not how.
 * The actual rendering is delegated to Team 12's composition engine via
 * ExistingEngineAdapter.compositionEngine.
 *
 * Maps to: CompositionSpec (the domain entity)
 * Consumed by: Team 12 (rendering/composition engine)
 */
export interface ProductDesignCompositionMapping {
  /** The concept this mapping is derived from. */
  conceptId: string;
  /** Requested view angle for the composition. */
  viewAngle: ViewAngle;
  /** Requested output format. */
  format: MockupFormat;
  /** Canvas dimensions in pixels. */
  widthPx: number;
  heightPx: number;
  /**
   * Ordered layer stack (bottom to top).
   * Populated by Team 11's blueprint engine via ExistingEngineAdapter.blueprintEngine.
   * Empty until Team 11 is integrated — do not render an empty layer stack.
   */
  layers: MockupLayer[];
  backgroundColor: string;
  /**
   * True when all layers are populated and the spec is ready for rendering.
   * Must be false until Team 11 provides the layer stack.
   */
  finalised: boolean;
  /** Mandatory disclaimer on every composition output. */
  disclaimer: string;
}

// ── 4. ProductDesignQcProfile ─────────────────────────────────────────────────

/**
 * Quality criteria that must be verified before a concept is approved.
 * Enforced by Team 13's QC pipeline.
 *
 * Consumed by: Team 13 (QC pipeline)
 */
export interface ProductDesignQcProfile {
  conceptId: string;
  /** All required validators and their expected outcome. */
  checks: Array<{
    /** Human-readable check name (e.g. "dimensions_valid", "cmf_complete"). */
    checkId: string;
    description: string;
    /** Whether this check is a hard blocker (blocks approval) or advisory. */
    severity: "blocker" | "warning";
    /**
     * The validator function name in this domain that performs the check.
     * Team 13 calls these via ExistingEngineAdapter.domainValidators.
     */
    validatorRef:
      | "validateDimensions"
      | "validateCmf"
      | "validatePlacements"
      | "assertDisclaimerPresent"
      | "assertNoUnsupportedClaims";
  }>;
  /**
   * Minimum score (0–100) required for concept approval.
   * Team 13 computes this; 0 = not yet scored.
   */
  minimumQcScore: number;
}

// ── 5. ProductDesignDeliverableManifest ───────────────────────────────────────

/**
 * Declares what the product-design domain will produce when a concept is
 * approved and all foundation engines are integrated.
 *
 * Consumed by: Team 14 (deliverable manifest / asset management service)
 */
export interface ProductDesignDeliverableManifest {
  conceptId: string;
  conceptName: string;
  /** Ordered list of deliverable artifacts this domain will generate. */
  deliverables: Array<{
    deliverableId: string;
    /** Human-readable name (e.g. "Front-angle mockup PNG"). */
    name: string;
    /** MIME type of the output asset. */
    mimeType: string;
    /**
     * Which foundation engine produces this deliverable.
     * Team 14 uses this to route generation requests.
     */
    producedBy: "team-11-blueprint" | "team-12-composition" | "team-20-brief-builder";
    /**
     * Object-storage key where the asset will be deposited.
     * Null until the asset is generated.
     */
    assetKey?: string;
    status: "pending" | "generating" | "ready" | "failed";
  }>;
  /** Mandatory disclaimer carried on all deliverables. */
  disclaimer: string;
}

// ── 6. ExistingEngineAdapter ──────────────────────────────────────────────────

/**
 * Adapter interface that Team 20 will use to integrate with existing/foundation
 * engines once they pass audit (Teams 7–14).
 *
 * Team 20 does NOT implement these engines.
 * Team 24 injects concrete implementations at mount time.
 *
 * Until all dependencies are integrated, every method returns a
 * structured "not available" response — never throws, never silently no-ops.
 */
export interface ExistingEngineAdapter {
  /**
   * Team 11 — Blueprint Engine
   * Generates an ordered layer stack from a ProductConcept.
   * Returns null when Team 11 is not yet integrated.
   */
  blueprintEngine: {
    isAvailable(): boolean;
    generateLayers(conceptId: string, viewAngle: ViewAngle): Promise<MockupLayer[] | null>;
  };

  /**
   * Team 12 — Composition / Rendering Engine
   * Renders a finalised CompositionSpec to an object-storage asset.
   * Returns null when Team 12 is not yet integrated.
   */
  compositionEngine: {
    isAvailable(): boolean;
    render(spec: CompositionSpec, format: MockupFormat): Promise<{ assetKey: string } | null>;
  };

  /**
   * Team 13 — QC Pipeline
   * Runs domain validators against a concept and returns a numeric score.
   * Returns null when Team 13 is not yet integrated.
   */
  qcPipeline: {
    isAvailable(): boolean;
    score(conceptId: string, profile: ProductDesignQcProfile): Promise<number | null>;
  };

  /**
   * Team 14 — Deliverable Manifest Service
   * Registers and tracks generated deliverable assets.
   * Returns false when Team 14 is not yet integrated.
   */
  deliverableManifest: {
    isAvailable(): boolean;
    register(manifest: ProductDesignDeliverableManifest): Promise<boolean>;
  };

  /**
   * Domain validators exposed for Team 13's QC pipeline.
   * These are the pure functions from this domain's service layer.
   */
  domainValidators: {
    validateDimensions: (requirements: ProductDesignRequirements) => boolean;
    validateCmf: (cmf: CMFSpec) => boolean;
    assertDisclaimerPresent: (obj: { disclaimer?: string }) => boolean;
    assertNoUnsupportedClaims: (text: string) => boolean;
  };
}

// ── Convenience re-exports for consumers ─────────────────────────────────────

export type {
  ProductConcept,
  ManufacturerBrief,
  ConceptVariant,
  VariantConsistencyResult,
  CompositionSpec,
};
