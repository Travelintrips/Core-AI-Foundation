import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer, bigint, boolean } from "drizzle-orm/pg-core";

/**
 * ai_brand_kit_assets — Versioned brand kit slot assets for a creative project.
 *
 * Each row represents one version of one brand kit slot (e.g. "logo", "brand_color").
 * The active flag marks the current version; previous versions are kept for history.
 */
export const aiBrandKitAssetsTable = appSchema.table("ai_brand_kit_assets", {
  id:             serial("id").primaryKey(),
  projectId:      text("project_id").notNull(),   // creative_projects.project_id
  emailHash:      text("email_hash").notNull(),    // customer owner (sha256)
  slot:           text("slot").notNull(),           // logo | secondary_logo | icon | monogram | brand_color | secondary_color | accent_color | typography_heading | typography_body | brand_voice | writing_style | photography_style | illustration_style | icon_style | do_dont | social_style | email_signature | stationery | corporate_pattern | brand_guidelines_pdf

  // File fields (null for text/JSON slots)
  fileName:       text("file_name"),
  storagePath:    text("storage_path"),
  previewUrl:     text("preview_url"),
  mimeType:       text("mime_type"),
  fileSizeBytes:  bigint("file_size_bytes", { mode: "number" }),
  checksum:       text("checksum"),               // sha256 hex of file content

  // Text/structured value (for color values, font names, brand voice text, etc.)
  value:          text("value"),
  valueJson:      jsonb("value_json"),

  // Versioning
  version:        integer("version").notNull().default(1),
  parentAssetId:  integer("parent_asset_id"),     // FK to self — previous version

  // State
  active:         boolean("active").notNull().default(true),
  archived:       boolean("archived").notNull().default(false),

  // Provenance
  uploadedBy:     text("uploaded_by"),            // email or "ai"
  tags:           jsonb("tags"),                  // string[]

  metadata:       jsonb("metadata"),

  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiBrandKitAsset = typeof aiBrandKitAssetsTable.$inferSelect;
export type InsertAiBrandKitAsset = typeof aiBrandKitAssetsTable.$inferInsert;

// Brand kit slots in canonical order
export const BRAND_KIT_SLOTS = [
  "logo", "secondary_logo", "icon", "monogram",
  "brand_color", "secondary_color", "accent_color",
  "typography_heading", "typography_body",
  "brand_voice", "writing_style", "photography_style", "illustration_style",
  "icon_style", "do_dont", "social_style", "email_signature", "stationery",
  "corporate_pattern", "brand_guidelines_pdf",
] as const;

export type BrandKitSlot = (typeof BRAND_KIT_SLOTS)[number];

// Completeness scoring weights per slot (total = 100)
export const SLOT_WEIGHTS: Record<BrandKitSlot, number> = {
  // Logo dimension (25)
  logo:               15,
  secondary_logo:      5,
  icon:                5,
  monogram:            0, // bonus, not counted in total

  // Colors dimension (20)
  brand_color:        10,
  secondary_color:     5,
  accent_color:        5,

  // Fonts dimension (15)
  typography_heading:  8,
  typography_body:     7,

  // Voice dimension (15)
  brand_voice:         6,
  writing_style:       4,
  photography_style:   3,
  illustration_style:  2,

  // Assets dimension (15)
  icon_style:          3,
  do_dont:             3,
  social_style:        3,
  email_signature:     2,
  stationery:          2,
  corporate_pattern:   2,

  // Guidelines dimension (10)
  brand_guidelines_pdf: 10,
};

// Dimension groupings
export const SLOT_DIMENSIONS: Record<string, BrandKitSlot[]> = {
  logo:       ["logo", "secondary_logo", "icon"],
  colors:     ["brand_color", "secondary_color", "accent_color"],
  fonts:      ["typography_heading", "typography_body"],
  voice:      ["brand_voice", "writing_style", "photography_style", "illustration_style"],
  assets:     ["icon_style", "do_dont", "social_style", "email_signature", "stationery", "corporate_pattern"],
  guidelines: ["brand_guidelines_pdf"],
};
