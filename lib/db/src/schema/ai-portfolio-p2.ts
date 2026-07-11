/**
 * ai-portfolio-p2.ts — Sprint P2 tables:
 *   ai_portfolio_assets         — structured asset registry per portfolio
 *   ai_portfolio_generation_batches — admin-triggered AI demo generation
 *   ai_portfolio_permissions    — project-to-portfolio customer consent
 */
import { appSchema } from "./_pg-schema";
import {
  serial,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiServicePortfoliosTable } from "./ai-service-portfolios";

// ── Portfolio Assets ───────────────────────────────────────────────────────────
// Structured asset registry — supplements galleryJson with typed, role-aware
// asset entries. storage_path is NEVER exposed in public API responses.

export const aiPortfolioAssetsTable = appSchema.table("ai_portfolio_assets", {
  id: serial("id").primaryKey(),
  portfolioId: integer("portfolio_id")
    .notNull()
    .references(() => aiServicePortfoliosTable.id, { onDelete: "cascade" }),
  creativeAssetId: integer("creative_asset_id"), // links to creative_ai_assets if generated
  // asset_type: image | video | pdf | mockup | presentation | company_profile | brand_guideline | before | after
  assetType: text("asset_type").notNull(),
  // asset_role: cover | gallery | thumbnail | preview | hero | before | after | deliverable
  assetRole: text("asset_role").notNull(),
  title: text("title"),
  altText: text("alt_text"),
  fileName: text("file_name"),
  thumbnailUrl: text("thumbnail_url"),
  previewUrl: text("preview_url"), // optimized public URL (no original source)
  storagePath: text("storage_path"), // PRIVATE — never returned in public DTOs
  mimeType: text("mime_type"),
  width: integer("width"),
  height: integer("height"),
  displayOrder: integer("display_order").notNull().default(0),
  downloadable: boolean("downloadable").notNull().default(false),
  watermarkRequired: boolean("watermark_required").notNull().default(false),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiPortfolioAssetSchema = createInsertSchema(aiPortfolioAssetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiPortfolioAsset = z.infer<typeof insertAiPortfolioAssetSchema>;
export type AiPortfolioAsset = typeof aiPortfolioAssetsTable.$inferSelect;

// ── Generation Batches ─────────────────────────────────────────────────────────
// Admin-triggered batches that produce demo portfolio entries via the AI OS.
// Subject to max_cost budget guardrail — batch stops if budget exceeded.

export const aiPortfolioGenerationBatchesTable = appSchema.table("ai_portfolio_generation_batches", {
  id: serial("id").primaryKey(),
  batchCode: text("batch_code").notNull().unique(),
  serviceId: integer("service_id"), // optional — attach to a specific service
  industry: text("industry").notNull(),
  style: text("style").notNull(),
  packageLevel: text("package_level").notNull().default("standard"),
  requestedCount: integer("requested_count").notNull().default(3),
  generatedCount: integer("generated_count").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  // status: draft | queued | running | review | completed | partially_failed | failed | cancelled | blocked_by_budget
  status: text("status").notNull().default("draft"),
  maxCost: numeric("max_cost", { precision: 10, scale: 2 }),
  actualCost: numeric("actual_cost", { precision: 10, scale: 2 }).notNull().default("0"),
  autoPublish: boolean("auto_publish").notNull().default(false),
  qcThreshold: integer("qc_threshold").notNull().default(70), // min QC score for auto-publish
  createdBy: text("created_by"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiPortfolioGenerationBatchSchema = createInsertSchema(aiPortfolioGenerationBatchesTable).omit({
  id: true,
  generatedCount: true,
  approvedCount: true,
  rejectedCount: true,
  failedCount: true,
  actualCost: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiPortfolioGenerationBatch = z.infer<typeof insertAiPortfolioGenerationBatchSchema>;
export type AiPortfolioGenerationBatch = typeof aiPortfolioGenerationBatchesTable.$inferSelect;

// ── Portfolio Permissions (Project-to-Portfolio consent) ────────────────────────
// A completed client project MUST have an approved permission record before
// its assets can be published in the public portfolio.

export const aiPortfolioPermissionsTable = appSchema.table("ai_portfolio_permissions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(), // references creative_projects
  customerId: integer("customer_id"),         // references customer_profiles
  // status: not_requested | pending | approved | rejected | revoked
  permissionStatus: text("permission_status").notNull().default("not_requested"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  scopeJson: jsonb("scope_json").$type<{
    assets?: string[];
    redactFields?: string[];
    portfolioId?: number;
  }>(),
  approvedBy: text("approved_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiPortfolioPermissionSchema = createInsertSchema(aiPortfolioPermissionsTable).omit({
  id: true,
  requestedAt: true,
  approvedAt: true,
  rejectedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiPortfolioPermission = z.infer<typeof insertAiPortfolioPermissionSchema>;
export type AiPortfolioPermission = typeof aiPortfolioPermissionsTable.$inferSelect;
