import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer, bigint, boolean } from "drizzle-orm/pg-core";

/**
 * ai_asset_library — Customer enterprise asset library.
 *
 * Stores all digital assets for a customer workspace: uploaded assets, AI-generated
 * assets promoted to the library, brand guideline files, reference materials, etc.
 * Versioned: each replace creates a new row with parentAssetId pointing to the old one.
 */
export const aiAssetLibraryTable = appSchema.table("ai_asset_library", {
  id:             serial("id").primaryKey(),
  emailHash:      text("email_hash").notNull(),   // customer owner (sha256)
  projectId:      text("project_id"),             // nullable — may belong to a project

  // Category — logo | photo | illustration | icon | document | brand_guideline | reference | generated_image | uploaded_image
  category:       text("category").notNull(),
  title:          text("title").notNull(),

  // File metadata
  fileName:       text("file_name").notNull(),
  storagePath:    text("storage_path"),
  previewUrl:     text("preview_url"),
  mimeType:       text("mime_type"),
  fileSizeBytes:  bigint("file_size_bytes", { mode: "number" }),
  checksum:       text("checksum"),               // sha256 hex

  // Versioning
  version:        integer("version").notNull().default(1),
  parentAssetId:  integer("parent_asset_id"),     // FK to self — previous version

  // State
  active:         boolean("active").notNull().default(true),
  archived:       boolean("archived").notNull().default(false),
  favorited:      boolean("favorited").notNull().default(false),

  // Provenance
  uploadedBy:     text("uploaded_by"),            // email or "ai"
  sourceAssetId:  integer("source_asset_id"),     // FK to creative_ai_assets.id if promoted

  tags:           jsonb("tags"),                  // string[]
  metadata:       jsonb("metadata"),

  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiAssetLibraryItem = typeof aiAssetLibraryTable.$inferSelect;
export type InsertAiAssetLibraryItem = typeof aiAssetLibraryTable.$inferInsert;

export const ASSET_LIBRARY_CATEGORIES = [
  "logo", "photo", "illustration", "icon", "document",
  "brand_guideline", "reference", "generated_image", "uploaded_image",
] as const;

export type AssetLibraryCategory = (typeof ASSET_LIBRARY_CATEGORIES)[number];

export const ASSET_LIBRARY_CATEGORY_LABELS: Record<AssetLibraryCategory, string> = {
  logo:           "Logo",
  photo:          "Photo",
  illustration:   "Illustration",
  icon:           "Icon",
  document:       "Document",
  brand_guideline: "Brand Guideline",
  reference:      "Reference",
  generated_image: "Generated Image",
  uploaded_image: "Uploaded Image",
};
