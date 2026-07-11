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
  serviceId: integer("service_id").notNull().references(() => aiServicesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  industry: text("industry").notNull(), // coffee | restaurant | hotel | manufacturing | mining | trading | logistics | construction | medical | education | retail | fashion | technology | government | other
  style: text("style").notNull(), // minimalist | luxury | modern | corporate | elegant | creative | premium | industrial | classic | bold
  colorTags: jsonb("color_tags").$type<string[]>(),
  businessSize: text("business_size").default("sme"), // startup | sme | enterprise
  packageLabel: text("package_label"), // display-only label, e.g. "Professional Package"
  description: text("description"),
  coverImage: text("cover_image"),
  galleryJson: jsonb("gallery_json").$type<Array<{ type: "image" | "video" | "pdf" | "mockup" | "brand_guideline" | "presentation" | "packaging" | "company_profile"; url: string; caption?: string }>>(),
  beforeImage: text("before_image"),
  afterImage: text("after_image"),
  deliverablesJson: jsonb("deliverables_json").$type<string[]>(), // icons: png | svg | ai | psd | pdf | docx | pptx | zip | brand_guideline | editable_source | commercial_license
  toolsUsedJson: jsonb("tools_used_json").$type<string[]>(),
  workflowJson: jsonb("workflow_json").$type<Array<{ step: string; label: string }>>(), // Brief -> Brand Strategy -> Creative Direction -> Image Generation -> Copywriting -> QC -> Client Review -> Revision -> Final Delivery
  deliveryTime: text("delivery_time"),
  rating: numeric("rating", { precision: 3, scale: 2 }),
  views: integer("views").notNull().default(0),
  completedProjects: integer("completed_projects").notNull().default(0),
  featured: boolean("featured").notNull().default(false),
  status: text("status").notNull().default("published"), // published | hidden | draft
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiServicePortfolioSchema = createInsertSchema(aiServicePortfoliosTable).omit({
  id: true,
  views: true,
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
// Free, watermarked, rate-limited (max 2 per session) taste of the AI before
// buying. Concepts are persisted so "Continue With This Concept" reuses the
// exact generated result as the project seed — it never regenerates.

export const aiLivePreviewsTable = appSchema.table("ai_live_previews", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(), // client-generated UUID, persisted in localStorage — enforces the 2-preview cap
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
  selectedConcept: text("selected_concept"), // "A" | "B" | null
  status: text("status").notNull().default("generating"), // generating | ready | failed | converted
  errorMessage: text("error_message"),
  serviceRequestId: integer("service_request_id"), // set once "Continue" hands this off to ai_service_requests
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
