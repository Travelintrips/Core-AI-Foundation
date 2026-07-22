/**
 * Team 28 — Furniture & Product Design Plugin — Domain-local schema
 *
 * IMPORTANT: This file is intentionally NOT exported through lib/db/src/schema/index.ts.
 * Keep self-contained until Team 39 integration audit.
 *
 * Uses appSchema (ai_platform PostgreSQL schema) — same pgSchema() pattern as
 * fashion-design (Team 18) and interior-design (Team 17).
 *
 * Tables:
 *   pd_plugin_projects  — project metadata + lifecycle state
 *   pd_plugin_briefs    — structured brief (maps to all 13 brief fields)
 *   pd_plugin_outputs   — per-step generated outputs (JSONB, keyed by artifact type)
 *
 * TEAM 28 OWNED — do not modify outside feature/team-28-product-design-plugin.
 */

import {
  pgSchema,
  serial,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  numeric,
} from "drizzle-orm/pg-core";

// Mirror of lib/db/src/schema/_pg-schema.ts — same schema name, idempotent.
const appSchema = pgSchema("ai_platform");

// ── Status flow ───────────────────────────────────────────────────────────────
// draft → brief_submitted → researching → concepting → developing →
// specifying → reviewing → approved → exported | cancelled
export const PD_PROJECT_STATUSES = [
  "draft",
  "brief_submitted",
  "researching",
  "concepting",
  "developing",
  "specifying",
  "reviewing",
  "approved",
  "exported",
  "cancelled",
] as const;

export type PdProjectStatus = (typeof PD_PROJECT_STATUSES)[number];

// ── Product categories ────────────────────────────────────────────────────────
export const PD_PRODUCT_CATEGORIES = [
  "seating",
  "table",
  "storage",
  "bed",
  "shelving",
  "outdoor_furniture",
  "lighting_fixture",
  "consumer_electronics",
  "appliance",
  "tool",
  "toy",
  "medical_device",
  "industrial",
  "other",
] as const;

export type PdProductCategory = (typeof PD_PRODUCT_CATEGORIES)[number];

// ── Workflow step keys ────────────────────────────────────────────────────────
export const PD_WORKFLOW_STEPS = [
  "brief",
  "user_market_research",
  "functional_requirements",
  "concept_direction",
  "concept_sketch",
  "form_development",
  "material_component_selection",
  "orthographic_technical_view",
  "visualization",
  "prototype_specification",
  "review",
  "export",
] as const;

export type PdWorkflowStep = (typeof PD_WORKFLOW_STEPS)[number];

// ── pd_plugin_projects ────────────────────────────────────────────────────────

export const pdPluginProjectsTable = appSchema.table("pd_plugin_projects", {
  id: serial("id").primaryKey(),

  // Identity
  title: text("title").notNull(),
  productCategory: text("product_category").notNull(),  // PdProductCategory
  clientName: text("client_name"),
  clientEmail: text("client_email"),
  notes: text("notes"),

  // Lifecycle
  status: text("status").notNull().default("draft"),    // PdProjectStatus
  currentStep: text("current_step").notNull().default("brief"),  // PdWorkflowStep
  completedSteps: jsonb("completed_steps").notNull().default([]),  // string[]

  // Access control — token-based IDOR guard (same pattern as interior-design)
  accessToken: text("access_token").notNull().unique(),

  // Export tracking
  exportedAt: timestamp("exported_at", { withTimezone: true }),
  exportPackageUrl: text("export_package_url"),

  // Admin fields
  adminNotes: text("admin_notes"),
  assignedDesigner: text("assigned_designer"),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PdPluginProject = typeof pdPluginProjectsTable.$inferSelect;
export type InsertPdPluginProject = typeof pdPluginProjectsTable.$inferInsert;

// ── pd_plugin_briefs ──────────────────────────────────────────────────────────

export const pdPluginBriefsTable = appSchema.table("pd_plugin_briefs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => pdPluginProjectsTable.id, { onDelete: "cascade" }),

  // 13 core brief fields (from Team 28 spec)
  productCategory: text("product_category").notNull(),     // e.g. "seating"
  targetUser: text("target_user").notNull(),                // description of end user
  environment: text("environment").notNull(),               // e.g. "residential living room"
  primaryFunction: text("primary_function").notNull(),      // core use-case description

  // Dimensions (stored as text for flexibility — parse client-side)
  widthMm: numeric("width_mm", { precision: 10, scale: 2 }),
  depthMm: numeric("depth_mm", { precision: 10, scale: 2 }),
  heightMm: numeric("height_mm", { precision: 10, scale: 2 }),
  weightKg: numeric("weight_kg", { precision: 10, scale: 3 }),
  customDimensions: text("custom_dimensions"),              // free-text for complex shapes

  ergonomicsNotes: text("ergonomics_notes"),
  loadUsageNotes: text("load_usage_notes"),                 // e.g. "max 150kg static load"

  // Materials
  primaryMaterials: jsonb("primary_materials").notNull().default([]),   // MaterialKey[]
  finishPreferences: jsonb("finish_preferences").notNull().default({}), // { surface: string }

  // Manufacturing
  manufacturingProcess: text("manufacturing_process"),      // e.g. "CNC + hand assembly"
  productionVolume: text("production_volume"),              // e.g. "1 prototype, then 500/mo"

  // Commercial
  budgetCurrency: text("budget_currency").notNull().default("IDR"),
  budgetEstimate: numeric("budget_estimate", { precision: 15, scale: 2 }),
  budgetNotes: text("budget_notes"),

  // Responsibility fields
  sustainabilityGoals: text("sustainability_goals"),
  safetyRequirements: text("safety_requirements"),
  complianceStandards: jsonb("compliance_standards").notNull().default([]),  // string[]

  // Additional
  referenceUrls: jsonb("reference_urls").notNull().default([]),         // string[]
  additionalNotes: text("additional_notes"),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PdPluginBrief = typeof pdPluginBriefsTable.$inferSelect;
export type InsertPdPluginBrief = typeof pdPluginBriefsTable.$inferInsert;

// ── pd_plugin_outputs ─────────────────────────────────────────────────────────

export const pdPluginOutputsTable = appSchema.table("pd_plugin_outputs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => pdPluginProjectsTable.id, { onDelete: "cascade" }),

  // Which workflow step produced this output
  workflowStep: text("workflow_step").notNull(),            // PdWorkflowStep

  // Artifact type (from plugin manifest ARTIFACT_TYPES)
  artifactType: text("artifact_type").notNull(),            // ProductArtifactType

  // Generated content (rich JSON per artifact type)
  content: jsonb("content").notNull().default({}),

  // Validation results and disclaimers
  validationResults: jsonb("validation_results"),
  disclaimers: jsonb("disclaimers").notNull().default([]),  // string[]

  // AI metadata
  aiModelUsed: text("ai_model_used"),
  generationDurationMs: integer("generation_duration_ms"),
  isApproved: boolean("is_approved").notNull().default(false),
  isLatest: boolean("is_latest").notNull().default(true),

  // Review notes
  reviewNotes: text("review_notes"),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PdPluginOutput = typeof pdPluginOutputsTable.$inferSelect;
export type InsertPdPluginOutput = typeof pdPluginOutputsTable.$inferInsert;
