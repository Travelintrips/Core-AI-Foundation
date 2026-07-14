import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer, numeric, boolean } from "drizzle-orm/pg-core";

/**
 * ai_asset_intelligence — Auto-analysis results per asset.
 *
 * One row per asset (assetId + assetSource). Updated when the asset changes.
 * Sources: "brand_kit" (aiBrandKitAssetsTable) or "library" (aiAssetLibraryTable).
 *
 * Stores AI-detected subjects, auto-tags, category, search keywords,
 * suggested usage, and duplicate/version detection results.
 */
export const aiAssetIntelligenceTable = appSchema.table("ai_asset_intelligence", {
  id:               serial("id").primaryKey(),
  assetId:          integer("asset_id").notNull(),     // FK to brand kit or library table
  assetSource:      text("asset_source").notNull(),    // "brand_kit" | "library" | "creative_asset"
  clientId:         text("client_id").notNull(),        // sha256 email hash

  // ── Detected content ───────────────────────────────────────────────────────
  detectedSubjects: jsonb("detected_subjects"),        // string[] e.g. ["Office","CEO","Meeting"]
  autoTags:         jsonb("auto_tags"),                // string[]
  autoCategory:     text("auto_category"),             // logo | photo | illustration | document | icon
  searchKeywords:   jsonb("search_keywords"),          // string[]
  suggestedUsage:   jsonb("suggested_usage"),          // string[] e.g. ["Hero Image","Social Media Post"]
  colorPalette:     jsonb("color_palette"),            // string[] hex values extracted from image
  dominantColors:   jsonb("dominant_colors"),          // string[] top 3 hex values

  // ── Version / duplicate detection ─────────────────────────────────────────
  perceptualHash:   text("perceptual_hash"),           // for duplicate detection
  isDuplicate:      boolean("is_duplicate").notNull().default(false),
  duplicateOfId:    integer("duplicate_of_id"),        // FK to self
  versionType:      text("version_type"),              // "original" | "transparent" | "dark" | "light" | "icon" | "landscape" | "portrait" | "horizontal" | "vertical" | "inverted"
  versionChainId:   integer("version_chain_id"),       // groups all versions of the same asset

  // ── Quality ────────────────────────────────────────────────────────────────
  qualityScore:     integer("quality_score"),          // 0–100
  resolutionInfo:   jsonb("resolution_info"),          // { width, height, dpi, aspectRatio }
  hasTransparency:  boolean("has_transparency"),

  // ── Analysis metadata ──────────────────────────────────────────────────────
  analysisFailed:   boolean("analysis_failed").notNull().default(false),
  failureReason:    text("failure_reason"),
  confidenceScore:  numeric("confidence_score", { precision: 4, scale: 3 }),
  metadata:         jsonb("metadata"),

  analyzedAt:       timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiAssetIntelligence = typeof aiAssetIntelligenceTable.$inferSelect;
export type InsertAiAssetIntelligence = typeof aiAssetIntelligenceTable.$inferInsert;
