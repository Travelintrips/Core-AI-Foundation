/**
 * branding-identity/manifest.ts — Team 27
 *
 * Deliverable manifest factory for the Branding & Identity plugin.
 *
 * Maps each workflow stage to the artifact types it should produce.
 * Used by the QC and export layers to verify completeness.
 */

import {
  BRANDING_ARTIFACT_TYPES,
  ARTIFACT_STAGE_MAP,
  type BrandingArtifactType,
  type BrandingStage,
} from "./schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ManifestEntry {
  artifactType: BrandingArtifactType;
  stage:        BrandingStage;
  required:     boolean;
  description:  string;
}

export interface BrandingManifest {
  pluginId:   string;
  pluginName: string;
  version:    string;
  totalCount:    number;
  requiredCount: number;
  entries:    ManifestEntry[];
  createdAt:  string;
}

// ── Artifact descriptions ─────────────────────────────────────────────────────

const ARTIFACT_DESCRIPTIONS: Record<BrandingArtifactType, string> = {
  brand_strategy:       "Core brand strategy document: mission, vision, and strategic pillars.",
  brand_positioning:    "Positioning statement and competitive differentiation rationale.",
  brand_voice:          "Verbal identity: tone of voice, messaging framework, and copywriting guidelines.",
  brand_moodboard:      "Visual direction moodboard: references, mood words, and aesthetic direction.",
  logo_concept:         "Logo concept exploration: mark options, rationale, and sketches.",
  logo_system:          "Complete logo system: primary, secondary, monochrome, and favicon variants.",
  color_system:         "Color palette with tokens, usage rules, and accessibility ratios.",
  typography_system:    "Typography system: type hierarchy, roles, and pairing guidelines.",
  identity_application: "Identity applied to real contexts: stationery, digital, packaging, etc.",
  brand_guideline:      "Complete brand guideline document for internal and agency use.",
  campaign_direction:   "Campaign direction brief: concept, messaging territories, and channel mix.",
};

// ── Required vs optional ──────────────────────────────────────────────────────

const REQUIRED_ARTIFACTS: Set<BrandingArtifactType> = new Set([
  "brand_strategy",
  "brand_positioning",
  "brand_voice",
  "logo_system",
  "color_system",
  "typography_system",
  "brand_guideline",
]);

// ── Factory ───────────────────────────────────────────────────────────────────

export function buildBrandingManifest(): BrandingManifest {
  const entries: ManifestEntry[] = BRANDING_ARTIFACT_TYPES.map((type) => ({
    artifactType: type,
    stage:        ARTIFACT_STAGE_MAP[type],
    required:     REQUIRED_ARTIFACTS.has(type),
    description:  ARTIFACT_DESCRIPTIONS[type],
  }));

  return {
    pluginId:      "branding-identity",
    pluginName:    "Branding & Identity Domain Plugin",
    version:       "1.0.0",
    totalCount:    entries.length,
    requiredCount: entries.filter((e) => e.required).length,
    entries,
    createdAt:     new Date().toISOString(),
  };
}

/**
 * Returns the artifacts expected for a given workflow stage.
 */
export function getStageArtifacts(stage: BrandingStage): ManifestEntry[] {
  const manifest = buildBrandingManifest();
  return manifest.entries.filter((e) => e.stage === stage);
}

/**
 * Validate that all required artifacts have been registered.
 * Returns list of missing required artifact types.
 */
export function getMissingRequiredArtifacts(
  registeredTypes: BrandingArtifactType[],
): BrandingArtifactType[] {
  const registered = new Set(registeredTypes);
  return [...REQUIRED_ARTIFACTS].filter((t) => !registered.has(t));
}

/**
 * Check whether a brief can be exported (all required artifacts present).
 */
export function canExport(registeredTypes: BrandingArtifactType[]): {
  canExport: boolean;
  missing:   BrandingArtifactType[];
} {
  const missing = getMissingRequiredArtifacts(registeredTypes);
  return { canExport: missing.length === 0, missing };
}
