/**
 * Brand Intelligence 2.0 — Main Service (Team 5)
 *
 * Orchestrates the adapter → extractors → confidence engine pipeline.
 * Persists results in ai_brand_intelligence_v2 (local drizzle table definition).
 * Never modifies ai_brand_dna — adapter-only read contract.
 */
import { eq } from "drizzle-orm";
import { pgSchema, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import { logAudit } from "../aiAuditService.js";
import { adaptBrandDnaForV2 } from "./brandDnaAdapter.js";
import {
  extractVisualLanguage,
  extractToneWritingStyle,
  extractColorPsychologyDetailed,
  extractTypographyProfile,
  extractPhotographyDetailed,
  extractIllustrationDetailed,
  extractMaterialStyleInterior,
  extractMotifStyleFashion,
  extractCreativeMemory,
} from "./extractors.js";
import { computeDimensionConfidence, generateRecommendationExplanations } from "./confidenceEngine.js";
import type {
  BrandIntelligenceV2,
  BrandIntelligenceV2Public,
} from "./types.js";

// ── Local table definition (Team 5 owns this table) ──────────────────────────
// The actual DDL is in integration/migrations/team-05.sql.
// We define it locally so we don't touch the locked @workspace/db barrel.

const aiPlatformSchema = pgSchema("ai_platform");

const aiBrandIntelligenceV2Table = aiPlatformSchema.table(
  "ai_brand_intelligence_v2",
  {
    id: serial("id").primaryKey(),
    clientId: text("client_id").notNull(),
    visualLanguage: jsonb("visual_language"),
    toneWritingStyle: jsonb("tone_writing_style"),
    colorPsychologyDetailed: jsonb("color_psychology_detailed"),
    typographyProfile: jsonb("typography_profile"),
    photographyStyleDetailed: jsonb("photography_style_detailed"),
    illustrationStyleDetailed: jsonb("illustration_style_detailed"),
    materialStyleInterior: jsonb("material_style_interior"),
    motifStyleFashion: jsonb("motif_style_fashion"),
    creativeMemoryStored: jsonb("creative_memory_stored"),
    dimensionConfidence: jsonb("dimension_confidence"),
    recommendationExplanations: jsonb("recommendation_explanations"),
    sourceBrandDnaVersion: text("source_brand_dna_version").notNull().default("v1"),
    sourceAnalyzedAt: timestamp("source_analyzed_at", { withTimezone: true }),
    analysisVersion: text("analysis_version").notNull().default("v2"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ── Core: analyze and persist ─────────────────────────────────────────────────

export async function analyzeAndPersistV2(
  clientId: string,
): Promise<BrandIntelligenceV2> {
  const { input, sourceDna } = await adaptBrandDnaForV2(clientId);

  // Run all extractors (independent — deterministic, pure)
  const [
    { profile: visualLanguage, confidence: vlConf },
    { profile: toneWritingStyle, confidence: twConf },
    { entries: colorPsychologyDetailed, confidence: cpConf },
    { profile: typographyProfile, confidence: tyConf },
    { profile: photographyStyleDetailed, confidence: phConf },
    { profile: illustrationStyleDetailed, confidence: ilConf },
    { profile: materialStyleInterior, confidence: miConf },
    { profile: motifStyleFashion, confidence: mfConf },
    { stored: creativeMemory, confidence: cmConf },
  ] = [
    extractVisualLanguage(input),
    extractToneWritingStyle(input),
    extractColorPsychologyDetailed(input),
    extractTypographyProfile(input),
    extractPhotographyDetailed(input),
    extractIllustrationDetailed(input),
    extractMaterialStyleInterior(input),
    extractMotifStyleFashion(input),
    extractCreativeMemory(input),
  ];

  const dimensionConfidence = computeDimensionConfidence({
    visualLanguage: vlConf,
    toneWriting: twConf,
    colorPsychology: cpConf,
    typography: tyConf,
    photography: phConf,
    illustration: ilConf,
    interior: miConf,
    fashion: mfConf,
    creativeMemory: cmConf,
  });

  const recommendationExplanations = generateRecommendationExplanations(dimensionConfidence);

  const now = new Date().toISOString();

  const result: BrandIntelligenceV2 = {
    clientId,
    visualLanguage,
    toneWritingStyle,
    colorPsychologyDetailed,
    typographyProfile,
    photographyStyleDetailed,
    illustrationStyleDetailed,
    materialStyleInterior,
    motifStyleFashion,
    creativeMemory,
    dimensionConfidence,
    recommendationExplanations,
    sourceBrandDnaVersion: sourceDna?.analysisVersion ?? "v1",
    sourceAnalyzedAt: sourceDna?.analyzedAt?.toISOString() ?? null,
    analysisVersion: "v2",
    analyzedAt: now,
  };

  // Upsert into ai_brand_intelligence_v2
  const existing = await db
    .select({ id: aiBrandIntelligenceV2Table.id })
    .from(aiBrandIntelligenceV2Table)
    .where(eq(aiBrandIntelligenceV2Table.clientId, clientId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(aiBrandIntelligenceV2Table)
      .set({
        visualLanguage,
        toneWritingStyle,
        colorPsychologyDetailed,
        typographyProfile,
        photographyStyleDetailed,
        illustrationStyleDetailed,
        materialStyleInterior,
        motifStyleFashion,
        creativeMemoryStored: creativeMemory,
        dimensionConfidence,
        recommendationExplanations,
        sourceBrandDnaVersion: result.sourceBrandDnaVersion,
        sourceAnalyzedAt: sourceDna?.analyzedAt ?? null,
        analysisVersion: "v2",
        analyzedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(aiBrandIntelligenceV2Table.clientId, clientId));
  } else {
    await db.insert(aiBrandIntelligenceV2Table).values({
      clientId,
      visualLanguage,
      toneWritingStyle,
      colorPsychologyDetailed,
      typographyProfile,
      photographyStyleDetailed,
      illustrationStyleDetailed,
      materialStyleInterior,
      motifStyleFashion,
      creativeMemoryStored: creativeMemory,
      dimensionConfidence,
      recommendationExplanations,
      sourceBrandDnaVersion: result.sourceBrandDnaVersion,
      sourceAnalyzedAt: sourceDna?.analyzedAt ?? null,
      analysisVersion: "v2",
      analyzedAt: new Date(),
    });
  }

  await logAudit({
    action: "brand_intelligence_v2_analyzed",
    entityType: "brand_intelligence_v2",
    entityId: clientId,
    details: {
      overallConfidence: dimensionConfidence.overall,
      recommendationCount: recommendationExplanations.length,
    },
  });

  return result;
}

// ── Get persisted V2 profile ──────────────────────────────────────────────────

export async function getBrandIntelligenceV2(
  clientId: string,
): Promise<BrandIntelligenceV2 | null> {
  const [row] = await db
    .select()
    .from(aiBrandIntelligenceV2Table)
    .where(eq(aiBrandIntelligenceV2Table.clientId, clientId))
    .limit(1);

  if (!row) return null;

  return {
    clientId: row.clientId,
    visualLanguage: (row.visualLanguage as BrandIntelligenceV2["visualLanguage"]) ?? {
      gridSystem: "unknown",
      motionPrinciple: "unknown",
      contrastStyle: "unknown",
      borderStyle: "unknown",
      shadowStyle: "unknown",
    },
    toneWritingStyle: (row.toneWritingStyle as BrandIntelligenceV2["toneWritingStyle"]) ?? {
      formalityLevel: 3,
      formalityLabel: "Balanced",
      vocabularyComplexity: "professional",
      sentenceStructure: "balanced",
      ctaStyle: "inviting",
      emotionalRegister: "neutral",
      proofTone: "narrative",
      avoidWords: [],
    },
    colorPsychologyDetailed: (row.colorPsychologyDetailed as BrandIntelligenceV2["colorPsychologyDetailed"]) ?? [],
    typographyProfile: (row.typographyProfile as BrandIntelligenceV2["typographyProfile"]) ?? {
      scaleRatioLabel: "Major Third (1.25)",
      scaleRatio: 1.25,
      weightUsage: { primary: "700 Bold", secondary: "400 Regular", accent: "500 Medium" },
      lineHeightStyle: "normal",
      letterSpacingStyle: "normal",
      fontPairingRationale: "",
      accessibilityScore: 60,
    },
    photographyStyleDetailed: (row.photographyStyleDetailed as BrandIntelligenceV2["photographyStyleDetailed"]) ?? {
      shotTypes: [],
      lightingMood: "natural",
      colorGrading: "natural",
      subjectFocus: "mixed",
      depthOfField: "medium",
      humanPresence: "minimal",
    },
    illustrationStyleDetailed: (row.illustrationStyleDetailed as BrandIntelligenceV2["illustrationStyleDetailed"]) ?? {
      complexity: "minimal",
      strokeWeight: "medium",
      colorUsage: "limited-palette",
      culturalReferences: [],
      dimensionality: "flat",
      textureUsage: "none",
    },
    materialStyleInterior: (row.materialStyleInterior as BrandIntelligenceV2["materialStyleInterior"]) ?? {
      materials: [],
      styleFamily: "Contemporary",
      lightingApproach: "warm-ambient",
      spacePhilosophy: "functional",
      texturePreference: "mixed",
      colorPalette: [],
    },
    motifStyleFashion: (row.motifStyleFashion as BrandIntelligenceV2["motifStyleFashion"]) ?? {
      patterns: [],
      silhouette: "relaxed",
      textiles: [],
      culturalReferences: [],
      colorway: "neutral",
      occasions: [],
    },
    creativeMemory: (row.creativeMemoryStored as BrandIntelligenceV2["creativeMemory"]) ?? {
      keyInsights: [],
      crossProjectLearnings: [],
      preferencePatterns: [],
      avoidPatterns: [],
    },
    dimensionConfidence: (row.dimensionConfidence as BrandIntelligenceV2["dimensionConfidence"]) ?? {
      visualLanguage: { score: 0, evidence: [], gaps: [] },
      toneWriting: { score: 0, evidence: [], gaps: [] },
      colorPsychology: { score: 0, evidence: [], gaps: [] },
      typography: { score: 0, evidence: [], gaps: [] },
      photography: { score: 0, evidence: [], gaps: [] },
      illustration: { score: 0, evidence: [], gaps: [] },
      interior: { score: 0, evidence: [], gaps: [] },
      fashion: { score: 0, evidence: [], gaps: [] },
      creativeMemory: { score: 0, evidence: [], gaps: [] },
      overall: 0,
    },
    recommendationExplanations: (row.recommendationExplanations as BrandIntelligenceV2["recommendationExplanations"]) ?? [],
    sourceBrandDnaVersion: row.sourceBrandDnaVersion,
    sourceAnalyzedAt: row.sourceAnalyzedAt?.toISOString() ?? null,
    analysisVersion: "v2",
    analyzedAt: row.analyzedAt.toISOString(),
  };
}

// ── Public-safe redaction ─────────────────────────────────────────────────────

export function redactForPublic(v2: BrandIntelligenceV2): BrandIntelligenceV2Public {
  const { avoidWords: _aw, ...tonePublic } = v2.toneWritingStyle;
  const { avoidPatterns: _ap, ...memoryPublic } = v2.creativeMemory;

  return {
    visualLanguage: v2.visualLanguage,
    toneWritingStyle: tonePublic,
    colorPsychologyDetailed: v2.colorPsychologyDetailed.map(({ color: _c, ...rest }) => rest),
    typographyProfile: v2.typographyProfile,
    photographyStyleDetailed: v2.photographyStyleDetailed,
    illustrationStyleDetailed: v2.illustrationStyleDetailed,
    materialStyleInterior: v2.materialStyleInterior,
    motifStyleFashion: v2.motifStyleFashion,
    dimensionConfidence: v2.dimensionConfidence,
    recommendationExplanations: v2.recommendationExplanations,
    creativeMemory: memoryPublic,
    sourceBrandDnaVersion: v2.sourceBrandDnaVersion,
    sourceAnalyzedAt: v2.sourceAnalyzedAt,
    analysisVersion: v2.analysisVersion,
    analyzedAt: v2.analyzedAt,
  };
}

// ── Admin stats ───────────────────────────────────────────────────────────────

export async function getBrandIntelligenceV2Stats(): Promise<{
  totalProfiles: number;
  averageConfidence: number;
  highConfidenceProfiles: number;
}> {
  const rows = await db
    .select({ dimensionConfidence: aiBrandIntelligenceV2Table.dimensionConfidence })
    .from(aiBrandIntelligenceV2Table);

  const scores = rows
    .map((r: { dimensionConfidence: unknown }) => {
      const dc = r.dimensionConfidence as { overall?: number } | null;
      return dc?.overall ?? 0;
    })
    .filter((s: number) => s > 0);

  const avg = scores.length > 0 ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;
  const high = scores.filter((s: number) => s >= 0.7).length;

  return {
    totalProfiles: rows.length,
    averageConfidence: parseFloat(avg.toFixed(3)),
    highConfidenceProfiles: high,
  };
}

export type { BrandIntelligenceV2, BrandIntelligenceV2Public };
