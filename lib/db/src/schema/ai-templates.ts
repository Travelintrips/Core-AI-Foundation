import { appSchema } from "./_pg-schema";
import { serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * V4.3 — Template Marketplace + Portfolio Generator
 *
 * ai_templates  — master template library (seeded, admin-managed)
 * ai_template_analytics — event tracking for evolution/analytics
 */

export const aiTemplatesTable = appSchema.table("ai_templates", {
  id: serial("id").primaryKey(),

  // ── Identity ──────────────────────────────────────────────────────────────
  templateCode: text("template_code").notNull().unique(), // e.g. COMP-PROF-MODERN-001
  name: text("name").notNull(),
  description: text("description"),

  // ── Classification ────────────────────────────────────────────────────────
  category: text("category").notNull(),        // Company Profile, Pitch Deck, etc.
  style: text("style").notNull(),             // Modern, Classic, Minimalist, Bold, Elegant, etc.
  industry: text("industry"),                 // null = cross-industry
  colorTheme: jsonb("color_theme").$type<{
    primary: string; secondary: string; accent: string; background: string; text: string;
  }>(),
  typography: jsonb("typography").$type<{
    heading: string; body: string; style: string;
  }>(),
  layout: text("layout"),                     // single-column, two-column, grid, magazine, etc.

  // ── Compatibility ─────────────────────────────────────────────────────────
  supportedPackages: jsonb("supported_packages").$type<string[]>(), // starter|standard|professional|enterprise
  brandDnaTags: jsonb("brand_dna_tags").$type<{
    personalities: string[];
    voices: string[];
    audiences: string[];
    industries: string[];
  }>(),

  // ── Media ─────────────────────────────────────────────────────────────────
  previewImages: jsonb("preview_images").$type<{
    thumbnail: string; hero: string; gallery: string[];
  }>(),
  pdfPreviewUrl: text("pdf_preview_url"),
  pptPreviewUrl: text("ppt_preview_url"),
  coverImage: text("cover_image"),

  // ── Marketplace ───────────────────────────────────────────────────────────
  editable: boolean("editable").notNull().default(true),
  isPremium: boolean("is_premium").notNull().default(false),
  version: text("version").notNull().default("1.0"),
  status: text("status").notNull().default("published"), // draft | published | archived
  featured: boolean("featured").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  pricePoints: jsonb("price_points").$type<Record<string, number>>(), // package → price multiplier

  // ── Analytics (denormalized counters) ────────────────────────────────────
  views: integer("views").notNull().default(0),
  selections: integer("selections").notNull().default(0),
  previewsGenerated: integer("previews_generated").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiTemplate = typeof aiTemplatesTable.$inferSelect;
export type InsertAiTemplate = typeof aiTemplatesTable.$inferInsert;

// ── Template Analytics ────────────────────────────────────────────────────────

export const aiTemplateAnalyticsTable = appSchema.table("ai_template_analytics", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => aiTemplatesTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // view | selected | preview_generated | portfolio_viewed | conversion | favorited
  clientId: text("client_id"),             // null = anonymous
  sessionId: text("session_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiTemplateAnalytic = typeof aiTemplateAnalyticsTable.$inferSelect;
