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
import { aiServicesTable } from "./ai-service-catalog";

/**
 * Service Showcase — Portfolio / Creative Showcase / Live AI Preview
 *
 * Purely additive to the existing service-catalog + commercial flow. Lets a
 * customer see real results (Portfolio, Gallery, Reviews, FAQ) and try the
 * AI for free (watermarked, capped, non-commercial) *before* buying, then
 * "Continue With This Concept" hands the exact generated concept into the
 * existing Brief → Checkout → Payment → Project pipeline as a seed — it
 * never triggers a second/duplicate generation.
 */

// ── Portfolio ─────────────────────────────────────────────────────────────────

export const aiServicePortfoliosTable = appSchema.table("ai_service_portfolios", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id"), // null = shared across all tenants

  // ── Core foreign keys ──
  serviceId: integer("service_id").notNull().references(() => aiServicesTable.id, { onDelete: "cascade" }),
  sourceProjectId: integer("source_project_id"), // set when portfolio is derived from a completed project

  // ── Identity & slug ──
  portfolioCode: text("portfolio_code"), // unique business key, e.g. DEMO-COFFEE-ABC123
  slug: text("slug"), // URL slug, e.g. kopi-senja-minimalist-coffee

  // ── Classification ──
  title: text("title").notNull(),
  shortDescription: text("short_description"), // 50-word teaser for gallery cards
  description: text("description"), // existing field kept as "full description"
  industry: text("industry").notNull(),
  businessType: text("business_type"), // e.g. "specialty coffee roastery"
  style: text("style").notNull(),
  colorTags: jsonb("color_tags").$type<string[]>(),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  businessSize: text("business_size").default("sme"),
  packageLabel: text("package_label"),
  packageLevel: text("package_level"), // starter | standard | professional | enterprise

  // ── Timing ──
  deliveryTime: text("delivery_time"), // display label e.g. "3 hari"
  deliveryDays: integer("delivery_days"), // numeric for sorting/filtering

  // ── Media ──
  coverImage: text("cover_image"),
  galleryJson: jsonb("gallery_json").$type<Array<{ type: "image" | "video" | "pdf" | "mockup" | "brand_guideline" | "presentation" | "packaging" | "company_profile"; url: string; caption?: string }>>(),
  beforeImage: text("before_image"),
  afterImage: text("after_image"),
  deliverablesJson: jsonb("deliverables_json").$type<string[]>(),
  toolsUsedJson: jsonb("tools_used_json").$type<string[]>(),
  workflowJson: jsonb("workflow_json").$type<Array<{ step: string; label: string }>>(),

  // ── Metrics ──
  rating: numeric("rating", { precision: 3, scale: 2 }),
  views: integer("views").notNull().default(0),
  totalClicks: integer("total_clicks").notNull().default(0),
  totalCheckouts: integer("total_checkouts").notNull().default(0),
  totalReviews: integer("total_reviews").notNull().default(0),
  completedProjects: integer("completed_projects").notNull().default(0),

  // ── Visibility & status ──
  featured: boolean("featured").notNull().default(false),
  status: text("status").notNull().default("published"), // published | hidden | draft (legacy — kept for backward compat)
  publishStatus: text("publish_status").notNull().default("published"), // draft | review | published | hidden | archived
  displayOrder: integer("display_order").notNull().default(0),

  // ── Demo / AI-generated flags ──
  isDemo: boolean("is_demo").notNull().default(false),
  trademarkRisk: text("trademark_risk").notNull().default("low"), // low | medium | high
  qcScore: numeric("qc_score", { precision: 5, scale: 2 }),

  // ── Sprint P3 — Generation pipeline tracking ─────────────────────────────
  // Tracks the full pipeline stage for the Portfolio Center UI.
  // metadata_only | generating | generated | archiving | archived |
  // optimizing | qc_review | ready_to_publish | published |
  // archive_failed | incomplete | needs_repair
  generationStatus: text("generation_status").notNull().default("metadata_only"),
  coverAssetId: integer("cover_asset_id"), // FK to ai_portfolio_assets.id (set after first archive)

  // ── Metadata ──
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiServicePortfolioSchema = createInsertSchema(aiServicePortfoliosTable).omit({
  id: true,
  views: true,
  totalClicks: true,
  totalCheckouts: true,
  totalReviews: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiServicePortfolio = z.infer<typeof insertAiServicePortfolioSchema>;
export type AiServicePortfolio = typeof aiServicePortfoliosTable.$inferSelect;

// ── Portfolio Reviews ─────────────────────────────────────────────────────────

export const portfolioReviewsTable = appSchema.table("portfolio_reviews", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id").notNull().references(() => aiServicesTable.id, { onDelete: "cascade" }),
  portfolioId: integer("portfolio_id").references(() => aiServicePortfoliosTable.id, { onDelete: "set null" }),
  rating: integer("rating").notNull(), // 1-5
  review: text("review").notNull(),
  company: text("company").notNull(),
  industry: text("industry"),
  clientName: text("client_name"),
  verified: boolean("verified").notNull().default(false), // true = from real project customer
  featured: boolean("featured").notNull().default(false),
  status: text("status").notNull().default("published"), // published | hidden
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPortfolioReviewSchema = createInsertSchema(portfolioReviewsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPortfolioReview = z.infer<typeof insertPortfolioReviewSchema>;
export type PortfolioReview = typeof portfolioReviewsTable.$inferSelect;

// ── Service FAQ ───────────────────────────────────────────────────────────────

export const aiServiceFaqsTable = appSchema.table("ai_service_faqs", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id").notNull().references(() => aiServicesTable.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  status: text("status").notNull().default("published"), // published | hidden
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiServiceFaqSchema = createInsertSchema(aiServiceFaqsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiServiceFaq = z.infer<typeof insertAiServiceFaqSchema>;
export type AiServiceFaq = typeof aiServiceFaqsTable.$inferSelect;

// ── Live AI Preview ───────────────────────────────────────────────────────────

export const aiLivePreviewsTable = appSchema.table("ai_live_previews", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  serviceId: integer("service_id").notNull().references(() => aiServicesTable.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  industry: text("industry").notNull(),
  style: text("style").notNull(),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  shortDescription: text("short_description"),
  referenceImageUrl: text("reference_image_url"),
  conceptA: jsonb("concept_a").$type<Record<string, unknown>>(),
  conceptB: jsonb("concept_b").$type<Record<string, unknown>>(),
  selectedConcept: text("selected_concept"),
  status: text("status").notNull().default("generating"),
  errorMessage: text("error_message"),
  serviceRequestId: integer("service_request_id"),
  watermarked: boolean("watermarked").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiLivePreviewSchema = createInsertSchema(aiLivePreviewsTable).omit({
  id: true,
  conceptA: true,
  conceptB: true,
  selectedConcept: true,
  status: true,
  errorMessage: true,
  serviceRequestId: true,
  watermarked: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiLivePreview = z.infer<typeof insertAiLivePreviewSchema>;
export type AiLivePreview = typeof aiLivePreviewsTable.$inferSelect;
