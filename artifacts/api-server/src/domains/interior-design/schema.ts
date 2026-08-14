/**
 * Team 17 — Interior Design — DOMAIN-LOCAL schema definitions.
 *
 * These tables are defined here (not in lib/db/src/schema/) to comply with
 * the global locked-files rule.  The schema barrel registration and Drizzle
 * ORM exports are requested via integration/manifests/team-17.json
 * (schemaExportsRequested).
 *
 * DDL lives in integration/migrations/team-17.sql (additive, idempotent).
 *
 * drizzle-zod is intentionally NOT imported here — it is not installed in
 * api-server. Use plain TypeScript types derived from $inferSelect / $inferInsert.
 */
import {
  pgSchema,
  bigserial,
  text,
  numeric,
  jsonb,
  boolean,
  integer,
  timestamp,
  bigint,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Use the shared app schema — matches the rest of the platform
const appSchema = pgSchema("ai_platform");

// ── id_projects ───────────────────────────────────────────────────────────────

export const idProjectsTable = appSchema.table("id_projects", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  title:       text("title").notNull(),
  roomType:    text("room_type").notNull(),
  status:      text("status").notNull().default("draft"),
  clientName:  text("client_name"),
  clientEmail: text("client_email"),
  notes:       text("notes"),
  /** Ownership token — given to the submitter at creation, required for all public reads/writes */
  accessToken: text("access_token").notNull().default(""),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertIdProject = typeof idProjectsTable.$inferInsert;
export type IdProject       = typeof idProjectsTable.$inferSelect;

// ── id_briefs ─────────────────────────────────────────────────────────────────

export const idBriefsTable = appSchema.table("id_briefs", {
  id:                   bigserial("id", { mode: "number" }).primaryKey(),
  projectId:            bigserial("project_id", { mode: "number" }).notNull(),

  // Room geometry
  roomLengthM:          numeric("room_length_m", { precision: 8, scale: 2 }).notNull(),
  roomWidthM:           numeric("room_width_m",  { precision: 8, scale: 2 }).notNull(),
  ceilingHeightM:       numeric("ceiling_height_m", { precision: 6, scale: 2 }).notNull(),

  // Structural elements (JSONB arrays)
  doors:                jsonb("doors").notNull().default([]),
  windows:              jsonb("windows").notNull().default([]),
  columns:              jsonb("columns").notNull().default([]),
  immutableZones:       jsonb("immutable_zones").notNull().default([]),

  // Aesthetic — stored as PREFERENCE SNAPSHOT only.
  // Style/material source of truth is Brand Intelligence V2 (read via adapter).
  style:                text("style").notNull(),
  primaryColors:        text("primary_colors").array().notNull().default([]),
  secondaryColors:      text("secondary_colors").array().notNull().default([]),
  materialsPreference:  jsonb("materials_preference").notNull().default({}),
  lightingPreference:   jsonb("lighting_preference").notNull().default({}),

  // Functional
  furnitureNeeds:       text("furniture_needs").array().notNull().default([]),
  budgetNotes:          text("budget_notes"),

  // Media
  photoUrls:            text("photo_urls").array().notNull().default([]),
  floorPlanUrl:         text("floor_plan_url"),
  additionalNotes:      text("additional_notes"),

  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertIdBrief = typeof idBriefsTable.$inferInsert;
export type IdBrief       = typeof idBriefsTable.$inferSelect;

// ── id_outputs ────────────────────────────────────────────────────────────────

export const idOutputsTable = appSchema.table("id_outputs", {
  id:                      bigserial("id", { mode: "number" }).primaryKey(),
  projectId:               bigserial("project_id", { mode: "number" }).notNull(),

  // AI-generated deliverables
  moodboard:               jsonb("moodboard"),
  spacePlan:               jsonb("space_plan"),
  furniturePlacement:      jsonb("furniture_placement"),
  circulationAnalysis:     text("circulation_analysis"),
  materialRecommendations: jsonb("material_recommendations"),
  lightingRecommendations: jsonb("lighting_recommendations"),
  visualConcept:           text("visual_concept"),
  vendorCategories:        jsonb("vendor_categories"),

  // Validation & disclaimers
  validationResults:       jsonb("validation_results"),
  safetyDisclaimers:       text("safety_disclaimers").array().notNull().default([]),

  /**
   * Brand Intelligence V2 source reference (NOT a data copy).
   * Interior Design reads brand style from Brand Intelligence V2 via the adapter.
   * These fields capture WHICH brand profile version was used for traceability.
   */
  sourceBrandProfileId:      text("source_brand_profile_id"),
  sourceBrandProfileVersion: text("source_brand_profile_version"),

  /** Project-specific overrides applied on top of the brand profile snapshot */
  projectStyleOverrides:   jsonb("project_style_overrides"),

  // Meta
  aiModelUsed:             text("ai_model_used"),
  generationDurationMs:    integer("generation_duration_ms"),
  isLatest:                boolean("is_latest").notNull().default(true),

  createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:               timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertIdOutput = typeof idOutputsTable.$inferInsert;
export type IdOutput       = typeof idOutputsTable.$inferSelect;

// ── id_concept_drafts ─────────────────────────────────────────────────────────
// Editable admin drafts for AI-generated Interior Design concept outputs.
// Linked to creative_projects.project_id (UUID text), one draft per project.
// Preserves original AI output; current draft is the editable working version.

export const idConceptDraftsTable = appSchema.table("id_concept_drafts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),

  /** FK to creative_projects.project_id (UUID text) — one draft per creative project */
  projectUuid: text("project_uuid").notNull().unique(),

  // Original AI-generated outputs (set once at initialization, never overwritten)
  originalSpacePlan:     jsonb("original_space_plan"),
  originalMaterials:     jsonb("original_materials"),
  originalFurniture:     jsonb("original_furniture"),
  originalLighting:      jsonb("original_lighting"),
  originalVisualConcept: text("original_visual_concept"),

  // Editable current draft (starts as copy of AI output)
  spacePlanDraft:     jsonb("space_plan_draft"),
  materialsDraft:     jsonb("materials_draft"),
  furnitureDraft:     jsonb("furniture_draft"),
  lightingDraft:      jsonb("lighting_draft"),
  visualConceptDraft: text("visual_concept_draft"),

  // Review state
  reviewState: text("review_state").notNull().default("ai_generated"),
  hasUnsavedEdits: boolean("has_unsaved_edits").notNull().default(false),

  // ── Approved snapshot (immutable — captured on transition to approved_for_rendering) ──
  // These columns are written once per approval cycle and never overwritten by draft edits.
  // After a revision is requested, they survive as a record of what was last approved.
  approvedSpacePlan:     jsonb("approved_space_plan"),
  approvedMaterials:     jsonb("approved_materials"),
  approvedFurniture:     jsonb("approved_furniture"),
  approvedLighting:      jsonb("approved_lighting"),
  approvedVisualConcept: text("approved_visual_concept"),
  approvedAt:            timestamp("approved_at", { withTimezone: true }),
  approvedBy:            text("approved_by"),

  // ── Revision tracking (populated by requestRevision()) ────────────────────
  revisionRequestedBy:  text("revision_requested_by"),
  revisionRequestedAt:  timestamp("revision_requested_at", { withTimezone: true }),
  revisionReason:       text("revision_reason"),

  // Audit
  lastEditedBy: text("last_edited_by"),
  lastEditedAt: timestamp("last_edited_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertIdConceptDraft = typeof idConceptDraftsTable.$inferInsert;
export type IdConceptDraft       = typeof idConceptDraftsTable.$inferSelect;

// ── id_interior_asset_images ──────────────────────────────────────────────────
// Stores image metadata for items inside Interior Design concept draft JSONB.
// Keyed by (project_uuid, item_type, item_id) — one record per item.
// Manual uploads (is_manual_upload = true) are never overwritten by auto-enrichment.

export const idInteriorAssetImagesTable = appSchema.table("id_interior_asset_images", {
  id:               bigserial("id", { mode: "number" }).primaryKey(),

  projectUuid:      text("project_uuid").notNull(),
  itemType:         text("item_type").notNull(),   // material | furniture | lighting | space_plan
  itemId:           text("item_id").notNull(),

  thumbnailUrl:     text("thumbnail_url"),
  imageUrl:         text("image_url"),
  imageAlt:         text("image_alt"),
  imageSource:      text("image_source"),          // pexels | unsplash | manual | internal
  imageSourceUrl:   text("image_source_url"),
  imageLicense:     text("image_license"),
  imageAttribution: text("image_attribution"),

  isManualUpload:   boolean("is_manual_upload").notNull().default(false),
  storagePath:      text("storage_path"),
  mimeType:         text("mime_type").notNull().default("image/webp"),
  fileSizeBytes:    integer("file_size_bytes"),

  imageUpdatedAt:   timestamp("image_updated_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertIdInteriorAssetImage = typeof idInteriorAssetImagesTable.$inferInsert;
export type IdInteriorAssetImage       = typeof idInteriorAssetImagesTable.$inferSelect;

// ── export_packages (WP-11) ────────────────────────────────────────────────────
// Metadata only. Binary exports live in the canonical ai-assets object bucket.
// The source snapshot is identified by its immutable hash and, when available,
// the generic WP-10 design_spec version id.
export const exportPackagesTable = appSchema.table("export_packages", {
  id:                 bigserial("id", { mode: "number" }).primaryKey(),
  tenantId:           text("tenant_id").notNull().default("default"),
  projectUuid:        text("project_uuid").notNull(),
  sourceVersionId:    text("source_version_id"),
  sourceVersionNumber: integer("source_version_number"),
  sourceVersionHash:  text("source_version_hash").notNull(),
  format:             text("format").notNull().default("zip"),
  includedSections:   jsonb("included_sections").notNull().default(["specification", "materials", "furniture", "moodboard"]),
  status:             text("status").notNull().default("queued"),
  jobId:              bigint("job_id", { mode: "number" }),
  idempotencyKey:     text("idempotency_key").notNull(),
  manifestJson:       jsonb("manifest_json"),
  storagePath:        text("storage_path"),
  fileName:           text("file_name"),
  mimeType:           text("mime_type"),
  fileSizeBytes:      integer("file_size_bytes"),
  checksum:           text("checksum"),
  errorCode:          text("error_code"),
  errorMessage:       text("error_message"),
  retryCount:         integer("retry_count").notNull().default(0),
  expiresAt:           timestamp("expires_at", { withTimezone: true }),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantProjectIdx: index("export_packages_tenant_project_idx").on(table.tenantId, table.projectUuid),
  activeIdx: index("export_packages_active_idx").on(table.tenantId, table.projectUuid, table.status),
  idempotencyIdx: uniqueIndex("export_packages_idempotency_scope_uidx").on(
    table.tenantId,
    table.projectUuid,
    table.sourceVersionHash,
    table.idempotencyKey,
  ),
}));

export type InsertExportPackage = typeof exportPackagesTable.$inferInsert;
export type ExportPackage = typeof exportPackagesTable.$inferSelect;

export const CONCEPT_DRAFT_REVIEW_STATES = [
  "ai_generated",
  "edited_by_admin",
  "ready_for_review",
  "revision_requested",
  "approved_for_rendering",
] as const;
export type ConceptDraftReviewState = (typeof CONCEPT_DRAFT_REVIEW_STATES)[number];
