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
