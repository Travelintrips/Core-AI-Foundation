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

  // ── Canvas (design editor state) ─────────────────────────────────────────
  canvasState: jsonb("canvas_state").$type<{
    width: number; height: number; background: string;
    elements: Array<Record<string, unknown>>;
  }>(),
  canvasWidth: integer("canvas_width"),
  canvasHeight: integer("canvas_height"),
  tags: jsonb("tags").$type<string[]>(),

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

// ═══════════════════════════════════════════════════════════════════════════════
// V4.6 — Template Ecosystem (Theme Engine + Layout Engine + Registry + Mappings)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Theme Engine ──────────────────────────────────────────────────────────────

export const aiTemplateThemesTable = appSchema.table("ai_template_themes", {
  id: serial("id").primaryKey(),
  themeKey: text("theme_key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),                  // category affinity (null = universal)
  tokensJson: jsonb("tokens_json").notNull().$type<{
    colors: { primary: string; secondary: string; accent: string; background: string; text: string; surface?: string };
    typography: { heading: string; body: string; accent?: string; headingWeight?: string };
    spacing?: string;          // compact | normal | relaxed
    borderRadius?: string;     // none | small | medium | large | full
    shadows?: string;          // none | soft | medium | strong
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiTemplateTheme = typeof aiTemplateThemesTable.$inferSelect;
export type InsertAiTemplateTheme = typeof aiTemplateThemesTable.$inferInsert;

// ── Layout Engine ─────────────────────────────────────────────────────────────

export const aiTemplateLayoutsTable = appSchema.table("ai_template_layouts", {
  id: serial("id").primaryKey(),
  layoutKey: text("layout_key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),        // category affinity
  layoutType: text("layout_type").notNull(),   // single-column | two-column | grid | magazine | cover-focus
  structureJson: jsonb("structure_json").notNull().$type<{
    sections: Array<{ id: string; label: string; order: number; width?: string; span?: number }>;
    columns?: number;
    gutter?: string;
  }>(),
  minSlots: integer("min_slots").notNull().default(1),
  maxSlots: integer("max_slots"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiTemplateLayout = typeof aiTemplateLayoutsTable.$inferSelect;
export type InsertAiTemplateLayout = typeof aiTemplateLayoutsTable.$inferInsert;

// ── Template Registry ─────────────────────────────────────────────────────────

export const aiTemplateRegistryTable = appSchema.table("ai_template_registry", {
  id: serial("id").primaryKey(),
  templateKey: text("template_key").notNull().unique(),  // e.g. COMP-PROF-001
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),        // Company Profile | Proposal | Pitch Deck | …
  status: text("status").notNull().default("draft"),  // draft | published | archived
  currentVersionId: integer("current_version_id"),    // FK resolved below via relations
  thumbnailUrl: text("thumbnail_url"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiTemplateRegistry = typeof aiTemplateRegistryTable.$inferSelect;
export type InsertAiTemplateRegistry = typeof aiTemplateRegistryTable.$inferInsert;

// ── Template Versions ─────────────────────────────────────────────────────────

export const aiTemplateVersionsTable = appSchema.table("ai_template_versions", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => aiTemplateRegistryTable.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  status: text("status").notNull().default("draft"),  // draft | published | archived
  themeId: integer("theme_id").references(() => aiTemplateThemesTable.id),
  layoutId: integer("layout_id").references(() => aiTemplateLayoutsTable.id),
  layoutSpecJson: jsonb("layout_spec_json").notNull().default({}).$type<Record<string, unknown>>(),
  themeOverridesJson: jsonb("theme_overrides_json").notNull().default({}).$type<Record<string, unknown>>(),
  changelog: text("changelog"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export type AiTemplateVersion = typeof aiTemplateVersionsTable.$inferSelect;
export type InsertAiTemplateVersion = typeof aiTemplateVersionsTable.$inferInsert;

// ── Brand Mappings ────────────────────────────────────────────────────────────

export const aiTemplateBrandMappingsTable = appSchema.table("ai_template_brand_mappings", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => aiTemplateRegistryTable.id, { onDelete: "cascade" }),
  brandAttribute: text("brand_attribute").notNull(),   // personality | voice | audience | color_family
  attributeValue: text("attribute_value").notNull(),
  weight: integer("weight").notNull().default(10),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiTemplateBrandMapping = typeof aiTemplateBrandMappingsTable.$inferSelect;

// ── Industry Mappings ─────────────────────────────────────────────────────────

export const aiTemplateIndustryMappingsTable = appSchema.table("ai_template_industry_mappings", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => aiTemplateRegistryTable.id, { onDelete: "cascade" }),
  industry: text("industry").notNull(),
  weight: integer("weight").notNull().default(10),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiTemplateIndustryMapping = typeof aiTemplateIndustryMappingsTable.$inferSelect;

// ── Package Mappings ──────────────────────────────────────────────────────────

export const aiTemplatePackageMappingsTable = appSchema.table("ai_template_package_mappings", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => aiTemplateRegistryTable.id, { onDelete: "cascade" }),
  serviceCode: text("service_code").notNull(),   // e.g. CP-STARTER | PITCH-PRO
  weight: integer("weight").notNull().default(10),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiTemplatePackageMapping = typeof aiTemplatePackageMappingsTable.$inferSelect;
