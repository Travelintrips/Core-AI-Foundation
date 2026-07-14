import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer, numeric } from "drizzle-orm/pg-core";

/**
 * ai_brand_dna — Analyzed Brand DNA per client.
 *
 * Populated by creativeBrandIntelligenceService.analyzeBrand().
 * One row per clientId (upserted on refresh). Deterministic output —
 * derived entirely from brand kit, assets, project history, and memory.
 * Never guesses — if data is missing, confidence is low.
 */
export const aiBrandDnaTable = appSchema.table("ai_brand_dna", {
  id:                   serial("id").primaryKey(),
  clientId:             text("client_id").notNull().unique(), // sha256 email hash or project clientId

  // ── Personality & Voice ────────────────────────────────────────────────────
  brandPersonality:     jsonb("brand_personality"),   // string[] e.g. ["Professional","Corporate","Minimalist"]
  brandVoice:           text("brand_voice"),           // e.g. "Formal"
  writingStyle:         text("writing_style"),         // e.g. "Corporate"

  // ── Visual Identity ────────────────────────────────────────────────────────
  photographyStyle:     text("photography_style"),     // e.g. "Studio"
  illustrationStyle:    text("illustration_style"),    // e.g. "Flat"
  iconStyle:            text("icon_style"),            // e.g. "Outline"
  layoutStyle:          text("layout_style"),          // e.g. "Corporate"
  visualDensity:        text("visual_density"),        // e.g. "Dense" | "Airy" | "Balanced"
  spacingStyle:         text("spacing_style"),         // e.g. "Compact" | "Generous"

  // ── Colors ─────────────────────────────────────────────────────────────────
  detectedColors:       jsonb("detected_colors"),      // { primary, secondary, accent, palette: string[] }
  colorPsychology:      jsonb("color_psychology"),     // string[] e.g. ["Trust","Stability"]

  // ── Typography ─────────────────────────────────────────────────────────────
  detectedTypography:   jsonb("detected_typography"),  // { heading, body, style: string }

  // ── Audience & Industry ───────────────────────────────────────────────────
  targetAudience:       jsonb("target_audience"),      // { primary, secondary, demographics, psychographics }
  industry:             text("industry"),
  riskProfile:          text("risk_profile"),          // e.g. "Conservative" | "Moderate" | "Innovative"

  // ── Scores ─────────────────────────────────────────────────────────────────
  completenessScore:    integer("completeness_score"),  // 0–100 based on brand kit
  consistencyScore:     integer("consistency_score"),   // 0–100 across all assets
  confidenceScore:      numeric("confidence_score", { precision: 4, scale: 3 }), // 0.000–1.000

  // ── Analysis metadata ──────────────────────────────────────────────────────
  dataSourcesSummary:   jsonb("data_sources_summary"), // { brandKitSlots, assetCount, projectCount, memoryCount }
  analysisVersion:      text("analysis_version").notNull().default("v1"),
  metadata:             jsonb("metadata"),

  analyzedAt:           timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiBrandDna = typeof aiBrandDnaTable.$inferSelect;
export type InsertAiBrandDna = typeof aiBrandDnaTable.$inferInsert;
