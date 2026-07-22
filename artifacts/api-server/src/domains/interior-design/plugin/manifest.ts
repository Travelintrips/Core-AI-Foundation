/**
 * Team 25 — Interior Design Domain Plugin
 * manifest.ts
 *
 * Single source of truth for the Interior Design plugin contract.
 * Consumed by the Universal Design Platform plugin loader (Team 39 adapter).
 *
 * Rules:
 *  - No AI provider, model, tenant, or service-type hard-coding.
 *  - No direct DB access.
 *  - No imports from core platform — only from sibling plugin files.
 *  - Interior-specific fields must NEVER leak to core.
 */

import { INTERIOR_ARTIFACT_TYPE_IDS, INTERIOR_ARTIFACT_TYPES }   from "./artifactTypes.js";
import { INTERIOR_BRIEF_FIELDS, INTERIOR_STYLE_PREFERENCES,
         INTERIOR_SPACE_TYPES }                                   from "./briefSchema.js";
import { INTERIOR_WORKFLOW, INTERIOR_WORKFLOW_STEP_IDS }          from "./workflow.js";
import { INTERIOR_PROPERTY_SECTION_IDS, INTERIOR_PROPERTY_SECTIONS } from "./propertyContributions.js";
import { INTERIOR_COMPONENT_CATEGORY_IDS,
         INTERIOR_MATERIAL_CATEGORIES }                           from "./components.js";
import { INTERIOR_EXPORT_PRESET_IDS, INTERIOR_EXPORT_PRESETS }    from "./exportPresets.js";

// ── Capability declaration ────────────────────────────────────────────────────

export interface PluginCapability {
  id: string;
  label: string;
  description: string;
}

export const INTERIOR_CAPABILITIES: PluginCapability[] = [
  {
    id: "brief_intake",
    label: "Brief Intake",
    description:
      "Structured 13-field brief capturing space type, dimensions, occupants, style, functional requirements, budget, location/climate, existing conditions, colour, material, lighting, accessibility, and sustainability.",
  },
  {
    id: "space_validation",
    label: "Space Geometry Validation",
    description:
      "Room dimension checks, furniture clearance validation, door/window boundary checks, and circulation pathway width verification (residential and commercial thresholds).",
  },
  {
    id: "ai_generation",
    label: "AI-Assisted Design Generation",
    description:
      "Generates moodboard, space plan, material direction, lighting direction, furniture selection, and visualization concepts via a configured AI provider (provider-agnostic).",
  },
  {
    id: "workflow_dag",
    label: "12-Step Workflow DAG",
    description:
      "Full project lifecycle from brief to export with defined dependencies, parallel execution groups, and critical-path identification.",
  },
  {
    id: "artifact_production",
    label: "9 Interior Artifact Types",
    description:
      "Produces: moodboard, space plan, material board, furniture board, lighting plan, elevation, visualization, specification, and presentation.",
  },
  {
    id: "property_contributions",
    label: "Structured Property Contributions",
    description:
      "8 typed property sections (zone metadata, dimensions, surface material, furniture reference, lighting, colour, finish, notes) applied per artifact.",
  },
  {
    id: "export_presets",
    label: "4 Export Presets",
    description:
      "Client presentation deck, client review package (with watermark), technical drawing set (A3), and standalone specification sheet (PDF + CSV).",
  },
  {
    id: "brand_intelligence_read",
    label: "Brand Intelligence Integration (Read-Only)",
    description:
      "Reads brand palette and personality from Brand Intelligence V2 as defaults; brief preferences override brand defaults. Interior Design never stores its own copy of brand data.",
  },
];

// ── Plugin manifest ───────────────────────────────────────────────────────────

export interface InteriorDesignPluginManifest {
  /** Stable plugin identifier — must be unique across all domain plugins */
  pluginId: string;
  /** Human-readable plugin name */
  name: string;
  /** Domain identifier — matches the domains/ directory name */
  domainId: string;
  /** Semantic version of this plugin contract */
  version: string;
  /**
   * Minimum Universal Design Platform version this plugin requires.
   * The platform loader rejects the plugin if the platform is older.
   */
  compatibilityVersion: string;
  /** One-line summary */
  description: string;
  /** Workflow definition (12-step DAG) */
  workflow: typeof INTERIOR_WORKFLOW;
  /** All artifact type IDs this plugin registers */
  artifactTypeIds: typeof INTERIOR_ARTIFACT_TYPE_IDS;
  /** All workflow step IDs */
  workflowStepIds: typeof INTERIOR_WORKFLOW_STEP_IDS;
  /** Brief field descriptors */
  briefFields: typeof INTERIOR_BRIEF_FIELDS;
  /** Supported space types */
  spaceTypes: typeof INTERIOR_SPACE_TYPES;
  /** Supported style preferences */
  stylePreferences: typeof INTERIOR_STYLE_PREFERENCES;
  /** Property section IDs contributed by this plugin */
  propertySectionIds: typeof INTERIOR_PROPERTY_SECTION_IDS;
  /** Component category IDs */
  componentCategoryIds: typeof INTERIOR_COMPONENT_CATEGORY_IDS;
  /** Material category IDs */
  materialCategoryIds: typeof INTERIOR_MATERIAL_CATEGORIES;
  /** Export preset IDs */
  exportPresetIds: typeof INTERIOR_EXPORT_PRESET_IDS;
  /** Declared capabilities */
  capabilities: PluginCapability[];
  /**
   * Integration notes for Team 39 (adapter wiring).
   * Describes which core contracts this plugin consumes and which it provides.
   */
  integrationNotes: string[];
}

export const INTERIOR_DESIGN_PLUGIN_MANIFEST: InteriorDesignPluginManifest = {
  pluginId:             "interior-design-plugin",
  name:                 "Interior Design Domain Plugin",
  domainId:             "interior-design",
  version:             "1.0.0",
  compatibilityVersion: "1.0.0",
  description:
    "Full-lifecycle interior design workflow plugin for the Universal Design Platform. Covers brief intake through final export across residential, commercial, and hospitality space types.",

  workflow:           INTERIOR_WORKFLOW,
  artifactTypeIds:    INTERIOR_ARTIFACT_TYPE_IDS,
  workflowStepIds:    INTERIOR_WORKFLOW_STEP_IDS,
  briefFields:        INTERIOR_BRIEF_FIELDS,
  spaceTypes:         INTERIOR_SPACE_TYPES,
  stylePreferences:   INTERIOR_STYLE_PREFERENCES,
  propertySectionIds: INTERIOR_PROPERTY_SECTION_IDS,
  componentCategoryIds: INTERIOR_COMPONENT_CATEGORY_IDS,
  materialCategoryIds:  INTERIOR_MATERIAL_CATEGORIES,
  exportPresetIds:    INTERIOR_EXPORT_PRESET_IDS,
  capabilities:       INTERIOR_CAPABILITIES,

  integrationNotes: [
    "Team 39 adapter: wire INTERIOR_DESIGN_PLUGIN_MANIFEST.workflow into the core WorkflowDefinition runner via the plugin loader.",
    "Team 39 adapter: map INTERIOR_ARTIFACT_TYPE_IDS to the core artifact registry — prefix interior_ ensures no collision.",
    "Brand Intelligence V2 (Team 5): this plugin reads brand snapshots via ./brandIntelligenceAdapter.ts (existing Team 17 file). Do NOT duplicate brand data into interior tables.",
    "API server: domain routes are already mounted at /ai/interior-design/* and /public/interior-design/* by Team 17 (router.ts). The plugin layer adds no new HTTP routes.",
    "OpenAPI spec: Team 25 adds no new OpenAPI paths — all public schema additions must go through the api-spec package to avoid orval collision.",
    "Drizzle: no new DB tables are added by this plugin. Schema is owned by Team 17 (schema.ts). Property contributions are stored as JSONB in existing id_outputs.vendor_categories.",
    "Adapter status: Team 17 brandIntelligenceAdapter.ts is the only external dependency. If Brand Intelligence V2 is unavailable, the adapter returns null and the plugin falls back gracefully.",
  ],
};

// ── Validation helper (used by tests and the loader) ─────────────────────────

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateManifest(
  manifest: InteriorDesignPluginManifest,
): ManifestValidationResult {
  const errors: string[] = [];

  if (!manifest.pluginId)         errors.push("pluginId is required");
  if (!manifest.domainId)         errors.push("domainId is required");
  if (!manifest.version)          errors.push("version is required");
  if (!manifest.compatibilityVersion) errors.push("compatibilityVersion is required");

  // Workflow
  if (!manifest.workflow?.id)     errors.push("workflow.id is required");
  if ((manifest.workflowStepIds?.length ?? 0) < 12)
    errors.push("workflowStepIds must contain at least 12 steps");

  // Artifact types
  if ((manifest.artifactTypeIds?.length ?? 0) < 9)
    errors.push("artifactTypeIds must contain at least 9 types");

  // Brief fields
  const requiredBriefFieldKeys = ["spaceType", "dimensions", "occupantCount", "stylePreference", "lightingNeeds"];
  for (const key of requiredBriefFieldKeys) {
    const found = manifest.briefFields?.some((f) => f.field === key);
    if (!found) errors.push(`briefFields must include field '${key}'`);
  }

  // Property sections
  if ((manifest.propertySectionIds?.length ?? 0) < 8)
    errors.push("propertySectionIds must contain at least 8 sections");

  // Component categories
  if ((manifest.componentCategoryIds?.length ?? 0) < 7)
    errors.push("componentCategoryIds must contain at least 7 categories");

  // Material categories
  if ((manifest.materialCategoryIds?.length ?? 0) < 7)
    errors.push("materialCategoryIds must contain at least 7 material categories");

  // Export presets
  if ((manifest.exportPresetIds?.length ?? 0) < 4)
    errors.push("exportPresetIds must contain at least 4 presets");

  // Capabilities
  if ((manifest.capabilities?.length ?? 0) === 0)
    errors.push("capabilities must not be empty");

  return { valid: errors.length === 0, errors };
}

// ── Capability lookup ─────────────────────────────────────────────────────────

export function getCapability(id: string): PluginCapability | undefined {
  return INTERIOR_CAPABILITIES.find((c) => c.id === id);
}

// ── No-leak guard (for CI / lint) ────────────────────────────────────────────
// This comment serves as a reminder for Team 39: the types exported from this
// file must only be imported inside domains/interior-design/. Any import from
// outside that directory indicates a leak that violates the isolation contract.
