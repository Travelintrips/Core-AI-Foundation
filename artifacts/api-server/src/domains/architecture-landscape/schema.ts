/**
 * schema.ts — Team 29: Architecture & Landscape Design Plugin
 *
 * Defines domain-local tables, TypeScript types, and constants.
 * Kept inside the domain folder per Team 24 locked-file rules:
 *   feature teams MUST NOT add files to lib/db/src/schema/.
 *
 * pgSchema("ai_platform") mirrors lib/db/src/schema/_pg-schema.ts.
 *
 * Integration with global schema barrel is requested via:
 *   integration/manifests/team-29.json → schemaExportsRequested
 */

import {
  pgSchema,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// Mirror of lib/db/src/schema/_pg-schema.ts — same schema name.
const appSchema = pgSchema("ai_platform");

// ─────────────────────────────────────────────────────────────────────────────
// Domain constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 12 workflow steps from the spec, in order.
 * Each step maps to a project stage gate.
 */
export const ARCHITECTURE_WORKFLOW_STEPS = [
  "brief",
  "site_context",
  "constraints",
  "research",
  "concept",
  "program_zoning",
  "spatial_direction",
  "material_landscape_direction",
  "visualization",
  "documentation",
  "review",
  "export",
] as const;

export type ArchitectureWorkflowStep =
  (typeof ARCHITECTURE_WORKFLOW_STEPS)[number];

/**
 * Project lifecycle statuses.
 * Maps to workflow steps + terminal states.
 */
export const ARCHITECTURE_PROJECT_STATUSES = [
  "draft",
  "brief_submitted",
  "site_context",
  "constraints",
  "research",
  "concept",
  "program_zoning",
  "spatial_direction",
  "material_landscape_direction",
  "visualization",
  "documentation",
  "review",
  "export_ready",
  "completed",
  "cancelled",
] as const;

export type ArchitectureProjectStatus =
  (typeof ARCHITECTURE_PROJECT_STATUSES)[number];

/**
 * Artifact types supported by this plugin.
 * "preview" in the name signals it is NOT a validated technical document.
 */
export const ARCHITECTURE_ARTIFACT_TYPES = [
  "architecture_site_context",
  "architecture_concept",
  "architecture_program",
  "architecture_zoning",
  "architecture_plan_preview",
  "architecture_elevation_preview",
  "architecture_material_board",
  "architecture_visualization",
  "landscape_concept",
  "landscape_zoning",
  "landscape_planting_direction",
  "architecture_presentation",
] as const;

export type ArchitectureArtifactType =
  (typeof ARCHITECTURE_ARTIFACT_TYPES)[number];

/**
 * Labels that must NOT appear on any plugin-generated artifact
 * unless the system has real professional validation data.
 */
export const FORBIDDEN_ARTIFACT_LABELS = [
  "construction drawing",
  "structural calculation",
  "permit-ready drawing",
  "certified landscape plan",
] as const;

export type ForbiddenArtifactLabel = (typeof FORBIDDEN_ARTIFACT_LABELS)[number];

export const ARCHITECTURE_PROJECT_TYPES = [
  "residential",
  "commercial",
  "mixed_use",
  "civic",
  "hospitality",
  "industrial",
  "landscape_only",
  "urban_design",
  "interior",
  "renovation",
  "other",
] as const;

export type ArchitectureProjectType =
  (typeof ARCHITECTURE_PROJECT_TYPES)[number];

export const ARCHITECTURE_CLIMATE_TYPES = [
  "tropical",
  "subtropical",
  "temperate",
  "arid",
  "semi_arid",
  "mediterranean",
  "continental",
  "polar",
] as const;

export type ArchitectureClimateType =
  (typeof ARCHITECTURE_CLIMATE_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Brief field types (stored in brief_json)
// ─────────────────────────────────────────────────────────────────────────────

export interface ArchitectureBriefJson {
  projectType?: string;
  siteLocation?: string;
  siteAreaM2?: number;
  builtAreaM2?: number;
  climate?: string;
  userDescription?: string;
  program?: string[];
  constraints?: string[];
  regulationReferences?: string[];
  stylePreference?: string;
  materialPreferences?: string[];
  landscapeRequirements?: string;
  sustainabilityGoals?: string;
  accessibilityRequirements?: string;
  additionalNotes?: string;
}

export interface SiteContextJson {
  orientation?: string;
  topography?: string;
  surroundingContext?: string;
  existingVegetation?: string;
  solarAccess?: string;
  windDirection?: string;
  viewsToPreserve?: string;
  noiseLevel?: string;
  floodRisk?: string;
  soilType?: string;
}

export interface ConstraintsJson {
  buildingHeightLimitM?: number;
  floorAreaRatio?: number;
  setbackFrontM?: number;
  setbackSideM?: number;
  setbackRearM?: number;
  plotCoveragePercent?: number;
  heritageZone?: boolean;
  environmentalRestrictions?: string[];
  utilityEasements?: string[];
  zoningClassification?: string;
  additionalConstraints?: string;
}

export interface OverlayMetadata {
  projectId: number;
  projectRef: string;
  pluginId: "architecture-landscape-v1";
  overlayVersion: string;
  workflowStep: ArchitectureWorkflowStep | null;
  artifactTypes: ArchitectureArtifactType[];
  siteAreaM2: number | null;
  climateZone: string | null;
  projectType: string | null;
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// architecture_landscape_projects
// ─────────────────────────────────────────────────────────────────────────────

export const architectureLandscapeProjectsTable = appSchema.table(
  "architecture_landscape_projects",
  {
    id: serial("id").primaryKey(),
    projectRef: text("project_ref").notNull().unique(),

    // Ownership / context (no hard-coded tenant)
    tenantId: text("tenant_id"),
    serviceRequestId: integer("service_request_id"),

    // Core brief fields
    projectType: text("project_type").notNull(),
    clientName: text("client_name").notNull(),
    clientEmail: text("client_email").notNull(),
    projectTitle: text("project_title").notNull(),
    siteLocation: text("site_location"),
    siteAreaM2: text("site_area_m2"),
    builtAreaM2: text("built_area_m2"),
    climate: text("climate"),
    userDescription: text("user_description"),

    // Program / zoning
    programJson: jsonb("program_json").$type<string[]>().notNull().default([]),

    // Constraints & regulations
    constraintsJson: jsonb("constraints_json")
      .$type<ConstraintsJson>()
      .default({}),
    regulationReferences: jsonb("regulation_references")
      .$type<string[]>()
      .notNull()
      .default([]),

    // Style / material / landscape
    stylePreference: text("style_preference"),
    materialPreferences: jsonb("material_preferences")
      .$type<string[]>()
      .notNull()
      .default([]),
    landscapeRequirements: text("landscape_requirements"),
    sustainabilityGoals: text("sustainability_goals"),
    accessibilityRequirements: text("accessibility_requirements"),

    // Site context (step 2)
    siteContextJson: jsonb("site_context_json").$type<SiteContextJson>().default({}),

    // Full brief blob for backward compat / future fields
    briefJson: jsonb("brief_json").$type<ArchitectureBriefJson>().default({}),

    // Workflow tracking
    currentStep: text("current_step").notNull().default("brief"),
    currentStepIndex: integer("current_step_index").notNull().default(0),
    status: text("status").notNull().default("draft"),

    // Export
    exportReadyAt: timestamp("export_ready_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    // Flags
    hasLandscapeComponent: boolean("has_landscape_component")
      .notNull()
      .default(false),
    hasSustainabilityRequirements: boolean("has_sustainability_requirements")
      .notNull()
      .default(false),
    hasAccessibilityRequirements: boolean("has_accessibility_requirements")
      .notNull()
      .default(false),

    additionalNotes: text("additional_notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// architecture_landscape_artifacts
// ─────────────────────────────────────────────────────────────────────────────

export const architectureLandscapeArtifactsTable = appSchema.table(
  "architecture_landscape_artifacts",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => architectureLandscapeProjectsTable.id, {
        onDelete: "cascade",
      }),

    artifactType: text("artifact_type").notNull(),
    artifactLabel: text("artifact_label").notNull(),

    /** Must include "preview" for non-validated outputs. */
    isPreview: boolean("is_preview").notNull().default(true),

    /** Metadata blob: dimensions, scale, orientation, materials referenced, etc. */
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    /** Overlay metadata for cross-team consumption. */
    overlayMetadataJson: jsonb("overlay_metadata_json")
      .$type<OverlayMetadata>(),

    storageUrl: text("storage_url"),
    mimeType: text("mime_type"),
    fileSizeBytes: integer("file_size_bytes"),

    workflowStep: text("workflow_step"),
    generatedBy: text("generated_by").notNull().default("system"),

    status: text("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// architecture_landscape_components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Component contribution table.
 * Teams contribute reusable material/element records here.
 * Used by the plugin's material board and landscape planting direction outputs.
 */
export const architectureLandscapeComponentsTable = appSchema.table(
  "architecture_landscape_components",
  {
    id: serial("id").primaryKey(),
    componentCode: text("component_code").notNull().unique(),
    componentName: text("component_name").notNull(),
    category: text("category").notNull(), // material | plant | element | fixture
    subCategory: text("sub_category"),
    description: text("description"),
    climateZones: jsonb("climate_zones").$type<string[]>().notNull().default([]),
    sustainabilityRating: text("sustainability_rating"), // low | medium | high | certified
    locallyAvailable: boolean("locally_available").notNull().default(true),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript types
// ─────────────────────────────────────────────────────────────────────────────

export type ArchitectureLandscapeProject =
  typeof architectureLandscapeProjectsTable.$inferSelect;
export type ArchitectureLandscapeArtifact =
  typeof architectureLandscapeArtifactsTable.$inferSelect;
export type ArchitectureLandscapeComponent =
  typeof architectureLandscapeComponentsTable.$inferSelect;
