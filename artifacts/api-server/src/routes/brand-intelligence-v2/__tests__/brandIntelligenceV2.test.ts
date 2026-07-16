/**
 * Brand Intelligence 2.0 — Unit + Integration Tests (Team 5)
 *
 * Tests:
 *   1. Deterministic extraction — same input → same output
 *   2. Incomplete data — graceful degradation with low confidence
 *   3. Confidence scoring — per-dimension and overall weighted average
 *   4. Memory reuse — stored memories drive creative memory extraction
 *   5. Public redaction — exact hex, avoidWords, avoidPatterns stripped
 *   6. Route layer — HTTP responses for admin and public endpoints
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  return {
    db: mockDb,
    aiBrandDnaTable: { clientId: "client_id" },
    aiClientMemoryTable: {
      clientId: "client_id",
      memoryKey: "memory_key",
      memoryValue: "memory_value",
      category: "category",
      source: "source",
      confidence: "confidence",
      updatedAt: "updated_at",
    },
    creativeProjectsTable: {
      id: "id",
      brandName: "brand_name",
      status: "status",
      createdAt: "created_at",
      clientId: "client_id",
    },
  };
});

vi.mock("../../../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../services/customerWorkspaceService.js", () => ({
  resolveWorkspaceSession: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    session: { emailHash: "test-client-id" },
  }),
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

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
} from "../../../services/brand-intelligence-v2/extractors.js";
import {
  computeDimensionConfidence,
  generateRecommendationExplanations,
} from "../../../services/brand-intelligence-v2/confidenceEngine.js";
import { redactForPublic } from "../../../services/brand-intelligence-v2/brandIntelligenceV2Service.js";
import type { BrandDnaAdapterInput, BrandIntelligenceV2 } from "../../../services/brand-intelligence-v2/types.js";
import brandIntelligenceV2Router from "../index.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const FULL_INPUT: BrandDnaAdapterInput = {
  clientId: "test-client-001",
  brandPersonality: ["Professional", "Corporate", "Modern"],
  brandVoice: "Formal",
  writingStyle: "Corporate",
  photographyStyle: "Studio",
  illustrationStyle: "Flat",
  iconStyle: "Outline",
  layoutStyle: "Corporate",
  visualDensity: "Dense",
  spacingStyle: "Compact",
  detectedColors: {
    primary: "#003366",
    secondary: "#0066CC",
    accent: "#FF6600",
    palette: ["#003366", "#0066CC", "#FF6600", "#FFFFFF"],
  },
  colorPsychology: ["Trust", "Stability"],
  detectedTypography: {
    heading: "Inter",
    body: "Source Sans Pro",
    style: "Geometric",
  },
  targetAudience: {
    primary: "B2B Decision Makers",
    secondary: "IT Managers",
    demographics: ["35-55", "Male", "Corporate"],
    psychographics: ["Logical", "Risk-averse", "Data-driven"],
  },
  industry: "Technology Consulting",
  riskProfile: "Conservative",
  completenessScore: 80,
  consistencyScore: 75,
  confidenceScore: 0.72,
  dataSourcesSummary: {
    brandKitSlots: 16,
    assetCount: 12,
    projectCount: 3,
    memoryCount: 5,
  },
  memories: [
    {
      key: "brand_voice",
      value: "Formal and authoritative",
      category: "tone",
      source: "user_input",
      confidence: 0.9,
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      key: "color_preference",
      value: "Navy and blue tones",
      category: "visual",
      source: "user_input",
      confidence: 0.85,
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ],
  projectHistory: [
    { projectId: "p-001", brandName: "AcmeCorp", status: "completed", createdAt: "2024-06-01T00:00:00.000Z" },
    { projectId: "p-002", brandName: "AcmeCorp", status: "delivered", createdAt: "2024-09-01T00:00:00.000Z" },
  ],
};

const EMPTY_INPUT: BrandDnaAdapterInput = {
  clientId: "empty-client",
  brandPersonality: [],
  brandVoice: "",
  writingStyle: "",
  photographyStyle: "",
  illustrationStyle: "",
  iconStyle: "",
  layoutStyle: "",
  visualDensity: "",
  spacingStyle: "",
  detectedColors: { primary: null, secondary: null, accent: null, palette: [] },
  colorPsychology: [],
  detectedTypography: { heading: null, body: null, style: "" },
  targetAudience: { primary: "", secondary: "", demographics: [], psychographics: [] },
  industry: "",
  riskProfile: "",
  completenessScore: 0,
  consistencyScore: 0,
  confidenceScore: 0,
  dataSourcesSummary: { brandKitSlots: 0, assetCount: 0, projectCount: 0, memoryCount: 0 },
  memories: [],
  projectHistory: [],
};

// ── 1. Deterministic Extraction ───────────────────────────────────────────────

describe("1. Deterministic extraction — same input → same output", () => {
  it("extractVisualLanguage is deterministic", () => {
    const r1 = extractVisualLanguage(FULL_INPUT);
    const r2 = extractVisualLanguage(FULL_INPUT);
    expect(r1.profile).toEqual(r2.profile);
    expect(r1.confidence.score).toEqual(r2.confidence.score);
  });

  it("extractToneWritingStyle is deterministic", () => {
    const r1 = extractToneWritingStyle(FULL_INPUT);
    const r2 = extractToneWritingStyle(FULL_INPUT);
    expect(r1.profile).toEqual(r2.profile);
  });

  it("extractColorPsychologyDetailed is deterministic", () => {
    const r1 = extractColorPsychologyDetailed(FULL_INPUT);
    const r2 = extractColorPsychologyDetailed(FULL_INPUT);
    expect(r1.entries).toEqual(r2.entries);
  });

  it("extractTypographyProfile is deterministic", () => {
    const r1 = extractTypographyProfile(FULL_INPUT);
    const r2 = extractTypographyProfile(FULL_INPUT);
    expect(r1.profile).toEqual(r2.profile);
  });

  it("extractPhotographyDetailed is deterministic", () => {
    const r1 = extractPhotographyDetailed(FULL_INPUT);
    const r2 = extractPhotographyDetailed(FULL_INPUT);
    expect(r1.profile).toEqual(r2.profile);
  });

  it("extractIllustrationDetailed is deterministic", () => {
    const r1 = extractIllustrationDetailed(FULL_INPUT);
    const r2 = extractIllustrationDetailed(FULL_INPUT);
    expect(r1.profile).toEqual(r2.profile);
  });

  it("extractMaterialStyleInterior is deterministic", () => {
    const r1 = extractMaterialStyleInterior(FULL_INPUT);
    const r2 = extractMaterialStyleInterior(FULL_INPUT);
    expect(r1.profile).toEqual(r2.profile);
  });

  it("extractMotifStyleFashion is deterministic", () => {
    const r1 = extractMotifStyleFashion(FULL_INPUT);
    const r2 = extractMotifStyleFashion(FULL_INPUT);
    expect(r1.profile).toEqual(r2.profile);
  });

  it("extractCreativeMemory is deterministic", () => {
    const r1 = extractCreativeMemory(FULL_INPUT);
    const r2 = extractCreativeMemory(FULL_INPUT);
    expect(r1.stored).toEqual(r2.stored);
  });
});

// ── 2. Incomplete Data — Graceful Degradation ─────────────────────────────────

describe("2. Incomplete data — graceful degradation with low confidence", () => {
  it("extractVisualLanguage returns 'unknown' values when all inputs are empty", () => {
    const { profile, confidence } = extractVisualLanguage(EMPTY_INPUT);
    expect(profile.gridSystem).toBe("unknown");
    expect(profile.motionPrinciple).toBe("unknown");
    expect(profile.contrastStyle).toBe("unknown");
    expect(confidence.score).toBeLessThan(0.3);
  });

  it("extractToneWritingStyle defaults to balanced/professional when no inputs", () => {
    const { profile, confidence } = extractToneWritingStyle(EMPTY_INPUT);
    expect(profile.formalityLevel).toBe(3);
    expect(profile.formalityLabel).toBe("Balanced");
    expect(confidence.score).toBeLessThan(0.3);
  });

  it("extractColorPsychologyDetailed returns empty entries for no colors", () => {
    const { entries, confidence } = extractColorPsychologyDetailed(EMPTY_INPUT);
    expect(entries).toHaveLength(0);
    expect(confidence.score).toBeLessThanOrEqual(0.1);
    expect(confidence.gaps).toContain("detectedColors");
  });

  it("extractCreativeMemory returns empty stored when no memories or projects", () => {
    const { stored, confidence } = extractCreativeMemory(EMPTY_INPUT);
    expect(stored.keyInsights).toHaveLength(0);
    expect(stored.crossProjectLearnings).toHaveLength(0);
    expect(confidence.score).toBeLessThanOrEqual(0.1);
    expect(confidence.gaps).toContain("memories");
    expect(confidence.gaps).toContain("projectHistory");
  });

  it("all extractors handle empty strings without throwing", () => {
    expect(() => extractVisualLanguage(EMPTY_INPUT)).not.toThrow();
    expect(() => extractToneWritingStyle(EMPTY_INPUT)).not.toThrow();
    expect(() => extractColorPsychologyDetailed(EMPTY_INPUT)).not.toThrow();
    expect(() => extractTypographyProfile(EMPTY_INPUT)).not.toThrow();
    expect(() => extractPhotographyDetailed(EMPTY_INPUT)).not.toThrow();
    expect(() => extractIllustrationDetailed(EMPTY_INPUT)).not.toThrow();
    expect(() => extractMaterialStyleInterior(EMPTY_INPUT)).not.toThrow();
    expect(() => extractMotifStyleFashion(EMPTY_INPUT)).not.toThrow();
    expect(() => extractCreativeMemory(EMPTY_INPUT)).not.toThrow();
  });
});

// ── 3. Confidence Scoring ─────────────────────────────────────────────────────

describe("3. Confidence scoring — per-dimension and overall", () => {
  it("full input produces higher confidence than empty input across all dimensions", () => {
    const fullVL = extractVisualLanguage(FULL_INPUT).confidence.score;
    const emptyVL = extractVisualLanguage(EMPTY_INPUT).confidence.score;
    expect(fullVL).toBeGreaterThan(emptyVL);

    const fullTW = extractToneWritingStyle(FULL_INPUT).confidence.score;
    const emptyTW = extractToneWritingStyle(EMPTY_INPUT).confidence.score;
    expect(fullTW).toBeGreaterThan(emptyTW);

    const fullCP = extractColorPsychologyDetailed(FULL_INPUT).confidence.score;
    const emptyCP = extractColorPsychologyDetailed(EMPTY_INPUT).confidence.score;
    expect(fullCP).toBeGreaterThan(emptyCP);
  });

  it("computeDimensionConfidence overall is within [0, 1]", () => {
    const entries = {
      visualLanguage: extractVisualLanguage(FULL_INPUT).confidence,
      toneWriting: extractToneWritingStyle(FULL_INPUT).confidence,
      colorPsychology: extractColorPsychologyDetailed(FULL_INPUT).confidence,
      typography: extractTypographyProfile(FULL_INPUT).confidence,
      photography: extractPhotographyDetailed(FULL_INPUT).confidence,
      illustration: extractIllustrationDetailed(FULL_INPUT).confidence,
      interior: extractMaterialStyleInterior(FULL_INPUT).confidence,
      fashion: extractMotifStyleFashion(FULL_INPUT).confidence,
      creativeMemory: extractCreativeMemory(FULL_INPUT).confidence,
    };
    const dc = computeDimensionConfidence(entries);
    expect(dc.overall).toBeGreaterThanOrEqual(0);
    expect(dc.overall).toBeLessThanOrEqual(1);
  });

  it("dimension confidence entries carry non-empty evidence for full input", () => {
    const vl = extractVisualLanguage(FULL_INPUT).confidence;
    expect(vl.evidence.length).toBeGreaterThan(0);
    const tw = extractToneWritingStyle(FULL_INPUT).confidence;
    expect(tw.evidence.length).toBeGreaterThan(0);
  });

  it("overall confidence for empty input is very low", () => {
    const entries = {
      visualLanguage: extractVisualLanguage(EMPTY_INPUT).confidence,
      toneWriting: extractToneWritingStyle(EMPTY_INPUT).confidence,
      colorPsychology: extractColorPsychologyDetailed(EMPTY_INPUT).confidence,
      typography: extractTypographyProfile(EMPTY_INPUT).confidence,
      photography: extractPhotographyDetailed(EMPTY_INPUT).confidence,
      illustration: extractIllustrationDetailed(EMPTY_INPUT).confidence,
      interior: extractMaterialStyleInterior(EMPTY_INPUT).confidence,
      fashion: extractMotifStyleFashion(EMPTY_INPUT).confidence,
      creativeMemory: extractCreativeMemory(EMPTY_INPUT).confidence,
    };
    const dc = computeDimensionConfidence(entries);
    expect(dc.overall).toBeLessThan(0.3);
  });
});

// ── 4. Memory Reuse ───────────────────────────────────────────────────────────

describe("4. Memory reuse — stored memories incorporated into creative memory", () => {
  it("memories from input become keyInsights in stored creative memory", () => {
    const { stored } = extractCreativeMemory(FULL_INPUT);
    expect(stored.keyInsights.length).toBe(FULL_INPUT.memories.length);
    expect(stored.keyInsights[0].key).toBe("brand_voice");
    expect(stored.keyInsights[0].insight).toBe("Formal and authoritative");
    expect(stored.keyInsights[0].source).toBe("user_input");
  });

  it("completed projects generate cross-project learnings", () => {
    const { stored } = extractCreativeMemory(FULL_INPUT);
    expect(stored.crossProjectLearnings.length).toBeGreaterThan(0);
    expect(stored.crossProjectLearnings[0]).toContain("2 completed");
  });

  it("memory categories form preference patterns", () => {
    const { stored } = extractCreativeMemory(FULL_INPUT);
    expect(stored.preferencePatterns.length).toBeGreaterThan(0);
    const tonePattern = stored.preferencePatterns.find((p) => p.pattern === "tone");
    expect(tonePattern).toBeDefined();
    expect(tonePattern!.frequency).toBe(1);
  });

  it("memory confidence is preserved from input", () => {
    const { stored } = extractCreativeMemory(FULL_INPUT);
    const voiceInsight = stored.keyInsights.find((i) => i.key === "brand_voice");
    expect(voiceInsight?.confidence).toBe(0.9);
  });
});

// ── 5. Public Redaction ───────────────────────────────────────────────────────

describe("5. Public redaction — sensitive fields stripped", () => {
  const buildV2 = (partial: Partial<BrandIntelligenceV2> = {}): BrandIntelligenceV2 => ({
    clientId: "test-client",
    visualLanguage: { gridSystem: "12-column", motionPrinciple: "minimal", contrastStyle: "high-contrast", borderStyle: "sharp", shadowStyle: "flat" },
    toneWritingStyle: { formalityLevel: 4, formalityLabel: "Professional", vocabularyComplexity: "professional", sentenceStructure: "balanced", ctaStyle: "inviting", emotionalRegister: "authoritative", proofTone: "data-driven", avoidWords: ["awesome", "guys"] },
    colorPsychologyDetailed: [{ color: "#003366", colorMask: "#00****", role: "primary", emotions: ["Trust"], associations: ["Reliability"], recommendedUsage: "Primary", confidence: 0.75 }],
    typographyProfile: { scaleRatioLabel: "Major Third (1.25)", scaleRatio: 1.25, weightUsage: { primary: "700 Bold", secondary: "400 Regular", accent: "500 Medium" }, lineHeightStyle: "normal", letterSpacingStyle: "normal", fontPairingRationale: "Inter pairs well", accessibilityScore: 85 },
    photographyStyleDetailed: { shotTypes: ["product"], lightingMood: "studio", colorGrading: "natural", subjectFocus: "product", depthOfField: "medium", humanPresence: "none" },
    illustrationStyleDetailed: { complexity: "minimal", strokeWeight: "medium", colorUsage: "monochrome", culturalReferences: [], dimensionality: "flat", textureUsage: "none" },
    materialStyleInterior: { materials: ["glass"], styleFamily: "Modern Corporate", lightingApproach: "cool-focused", spacePhilosophy: "functional", texturePreference: "smooth", colorPalette: [] },
    motifStyleFashion: { patterns: ["solid"], silhouette: "structured", textiles: ["wool blend"], culturalReferences: [], colorway: "neutral", occasions: ["business formal"] },
    creativeMemory: { keyInsights: [], crossProjectLearnings: ["2 projects"], preferencePatterns: [], avoidPatterns: ["no pastel colors"] },
    dimensionConfidence: { visualLanguage: { score: 0.7, evidence: ["layoutStyle"], gaps: [] }, toneWriting: { score: 0.6, evidence: ["brandVoice"], gaps: [] }, colorPsychology: { score: 0.8, evidence: ["detectedColors"], gaps: [] }, typography: { score: 0.5, evidence: ["detectedTypography"], gaps: [] }, photography: { score: 0.6, evidence: ["photographyStyle"], gaps: [] }, illustration: { score: 0.5, evidence: ["illustrationStyle"], gaps: [] }, interior: { score: 0.4, evidence: ["brandPersonality"], gaps: [] }, fashion: { score: 0.4, evidence: ["brandPersonality"], gaps: [] }, creativeMemory: { score: 0.5, evidence: ["memories"], gaps: [] }, overall: 0.567 },
    recommendationExplanations: [],
    sourceBrandDnaVersion: "v1",
    sourceAnalyzedAt: null,
    analysisVersion: "v2",
    analyzedAt: "2025-01-01T00:00:00.000Z",
    ...partial,
  });

  it("exact hex color is stripped from public view", () => {
    const pub = redactForPublic(buildV2());
    for (const entry of pub.colorPsychologyDetailed) {
      expect(entry).not.toHaveProperty("color");
      expect(entry).toHaveProperty("colorMask");
    }
  });

  it("avoidWords is stripped from public toneWritingStyle", () => {
    const pub = redactForPublic(buildV2());
    expect(pub.toneWritingStyle).not.toHaveProperty("avoidWords");
    expect(pub.toneWritingStyle.formalityLevel).toBe(4);
  });

  it("avoidPatterns is stripped from public creativeMemory", () => {
    const pub = redactForPublic(buildV2());
    expect(pub.creativeMemory).not.toHaveProperty("avoidPatterns");
    expect(pub.creativeMemory.crossProjectLearnings).toEqual(["2 projects"]);
  });

  it("clientId is not present in public view", () => {
    const pub = redactForPublic(buildV2());
    expect(pub).not.toHaveProperty("clientId");
  });

  it("recommendation explanations are preserved in public view", () => {
    const pub = redactForPublic(buildV2());
    expect(pub).toHaveProperty("recommendationExplanations");
  });
});

// ── 6. Recommendation Explanations ───────────────────────────────────────────

describe("6. Recommendation explanations — evidence and priority", () => {
  it("generates recommendations for empty input with missing data gaps", () => {
    const entries = {
      visualLanguage: extractVisualLanguage(EMPTY_INPUT).confidence,
      toneWriting: extractToneWritingStyle(EMPTY_INPUT).confidence,
      colorPsychology: extractColorPsychologyDetailed(EMPTY_INPUT).confidence,
      typography: extractTypographyProfile(EMPTY_INPUT).confidence,
      photography: extractPhotographyDetailed(EMPTY_INPUT).confidence,
      illustration: extractIllustrationDetailed(EMPTY_INPUT).confidence,
      interior: extractMaterialStyleInterior(EMPTY_INPUT).confidence,
      fashion: extractMotifStyleFashion(EMPTY_INPUT).confidence,
      creativeMemory: extractCreativeMemory(EMPTY_INPUT).confidence,
    };
    const dc = computeDimensionConfidence(entries);
    const recs = generateRecommendationExplanations(dc);
    expect(recs.length).toBeGreaterThan(0);
  });

  it("recommendations are sorted critical → high → medium", () => {
    const entries = {
      visualLanguage: extractVisualLanguage(EMPTY_INPUT).confidence,
      toneWriting: extractToneWritingStyle(EMPTY_INPUT).confidence,
      colorPsychology: extractColorPsychologyDetailed(EMPTY_INPUT).confidence,
      typography: extractTypographyProfile(EMPTY_INPUT).confidence,
      photography: extractPhotographyDetailed(EMPTY_INPUT).confidence,
      illustration: extractIllustrationDetailed(EMPTY_INPUT).confidence,
      interior: extractMaterialStyleInterior(EMPTY_INPUT).confidence,
      fashion: extractMotifStyleFashion(EMPTY_INPUT).confidence,
      creativeMemory: extractCreativeMemory(EMPTY_INPUT).confidence,
    };
    const dc = computeDimensionConfidence(entries);
    const recs = generateRecommendationExplanations(dc);
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < recs.length; i++) {
      expect(order[recs[i]!.priority]).toBeGreaterThanOrEqual(order[recs[i - 1]!.priority]);
    }
  });

  it("each recommendation has a non-empty id, dimension, recommendation, and expectedImpact", () => {
    const entries = {
      visualLanguage: { score: 0.1, evidence: [], gaps: ["layoutStyle", "riskProfile"] },
      toneWriting: { score: 0.1, evidence: [], gaps: ["brandVoice"] },
      colorPsychology: { score: 0.05, evidence: [], gaps: ["detectedColors"] },
      typography: { score: 0.1, evidence: [], gaps: ["detectedTypography.heading"] },
      photography: { score: 0.1, evidence: [], gaps: ["photographyStyle"] },
      illustration: { score: 0.1, evidence: [], gaps: ["illustrationStyle"] },
      interior: { score: 0.1, evidence: [], gaps: ["brandPersonality"] },
      fashion: { score: 0.1, evidence: [], gaps: ["brandPersonality"] },
      creativeMemory: { score: 0.05, evidence: [], gaps: ["memories"] },
    };
    const dc = computeDimensionConfidence(entries);
    const recs = generateRecommendationExplanations(dc);
    for (const rec of recs) {
      expect(rec.id).toBeTruthy();
      expect(rec.dimension).toBeTruthy();
      expect(rec.recommendation).toBeTruthy();
      expect(rec.expectedImpact).toBeTruthy();
    }
  });

  it("full input produces fewer or no critical recommendations", () => {
    const entries = {
      visualLanguage: extractVisualLanguage(FULL_INPUT).confidence,
      toneWriting: extractToneWritingStyle(FULL_INPUT).confidence,
      colorPsychology: extractColorPsychologyDetailed(FULL_INPUT).confidence,
      typography: extractTypographyProfile(FULL_INPUT).confidence,
      photography: extractPhotographyDetailed(FULL_INPUT).confidence,
      illustration: extractIllustrationDetailed(FULL_INPUT).confidence,
      interior: extractMaterialStyleInterior(FULL_INPUT).confidence,
      fashion: extractMotifStyleFashion(FULL_INPUT).confidence,
      creativeMemory: extractCreativeMemory(FULL_INPUT).confidence,
    };
    const dc = computeDimensionConfidence(entries);
    const emptyEntries = {
      visualLanguage: extractVisualLanguage(EMPTY_INPUT).confidence,
      toneWriting: extractToneWritingStyle(EMPTY_INPUT).confidence,
      colorPsychology: extractColorPsychologyDetailed(EMPTY_INPUT).confidence,
      typography: extractTypographyProfile(EMPTY_INPUT).confidence,
      photography: extractPhotographyDetailed(EMPTY_INPUT).confidence,
      illustration: extractIllustrationDetailed(EMPTY_INPUT).confidence,
      interior: extractMaterialStyleInterior(EMPTY_INPUT).confidence,
      fashion: extractMotifStyleFashion(EMPTY_INPUT).confidence,
      creativeMemory: extractCreativeMemory(EMPTY_INPUT).confidence,
    };
    const emptyDc = computeDimensionConfidence(emptyEntries);
    const fullRecs = generateRecommendationExplanations(dc);
    const emptyRecs = generateRecommendationExplanations(emptyDc);
    const fullCritical = fullRecs.filter((r) => r.priority === "critical").length;
    const emptyCritical = emptyRecs.filter((r) => r.priority === "critical").length;
    expect(fullCritical).toBeLessThanOrEqual(emptyCritical);
  });
});

// ── 7. Route layer ────────────────────────────────────────────────────────────

describe("7. Route layer — HTTP responses", () => {
  const app = express();
  app.use(express.json());
  app.use(brandIntelligenceV2Router);

  // Mock service layer to avoid DB calls in route tests
  vi.mock("../../../services/brand-intelligence-v2/index.js", async () => {
    const actual = await vi.importActual<typeof import("../../../services/brand-intelligence-v2/index.js")>(
      "../../../services/brand-intelligence-v2/index.js",
    );
    return {
      ...actual,
      getBrandIntelligenceV2Stats: vi.fn().mockResolvedValue({
        totalProfiles: 5,
        averageConfidence: 0.65,
        highConfidenceProfiles: 2,
      }),
      getBrandIntelligenceV2: vi.fn().mockResolvedValue(null),
      analyzeAndPersistV2: vi.fn().mockResolvedValue({
        clientId: "mock-client",
        visualLanguage: { gridSystem: "12-column", motionPrinciple: "minimal", contrastStyle: "high-contrast", borderStyle: "sharp", shadowStyle: "flat" },
        toneWritingStyle: { formalityLevel: 4, formalityLabel: "Professional", vocabularyComplexity: "professional", sentenceStructure: "balanced", ctaStyle: "inviting", emotionalRegister: "authoritative", proofTone: "data-driven", avoidWords: [] },
        colorPsychologyDetailed: [],
        typographyProfile: { scaleRatioLabel: "Major Third (1.25)", scaleRatio: 1.25, weightUsage: { primary: "700 Bold", secondary: "400 Regular", accent: "500 Medium" }, lineHeightStyle: "normal", letterSpacingStyle: "normal", fontPairingRationale: "", accessibilityScore: 70 },
        photographyStyleDetailed: { shotTypes: [], lightingMood: "studio", colorGrading: "natural", subjectFocus: "product", depthOfField: "medium", humanPresence: "none" },
        illustrationStyleDetailed: { complexity: "minimal", strokeWeight: "medium", colorUsage: "monochrome", culturalReferences: [], dimensionality: "flat", textureUsage: "none" },
        materialStyleInterior: { materials: [], styleFamily: "Contemporary", lightingApproach: "warm-ambient", spacePhilosophy: "functional", texturePreference: "mixed", colorPalette: [] },
        motifStyleFashion: { patterns: [], silhouette: "relaxed", textiles: [], culturalReferences: [], colorway: "neutral", occasions: [] },
        creativeMemory: { keyInsights: [], crossProjectLearnings: [], preferencePatterns: [], avoidPatterns: [] },
        dimensionConfidence: { visualLanguage: { score: 0.7, evidence: [], gaps: [] }, toneWriting: { score: 0.6, evidence: [], gaps: [] }, colorPsychology: { score: 0.05, evidence: [], gaps: ["detectedColors"] }, typography: { score: 0.5, evidence: [], gaps: [] }, photography: { score: 0.6, evidence: [], gaps: [] }, illustration: { score: 0.5, evidence: [], gaps: [] }, interior: { score: 0.4, evidence: [], gaps: [] }, fashion: { score: 0.4, evidence: [], gaps: [] }, creativeMemory: { score: 0.1, evidence: [], gaps: [] }, overall: 0.49 },
        recommendationExplanations: [],
        sourceBrandDnaVersion: "v1",
        sourceAnalyzedAt: null,
        analysisVersion: "v2",
        analyzedAt: "2025-01-01T00:00:00.000Z",
      }),
      redactForPublic: actual.redactForPublic,
    };
  });

  it("GET /ai/brand-intelligence-v2/stats returns 200 with stats shape", async () => {
    const res = await request(app).get("/ai/brand-intelligence-v2/stats");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalProfiles");
    expect(res.body).toHaveProperty("averageConfidence");
  });

  it("POST /ai/brand-intelligence-v2/analyze with no clientId returns 400", async () => {
    const res = await request(app)
      .post("/ai/brand-intelligence-v2/analyze")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("clientId is required");
  });

  it("POST /ai/brand-intelligence-v2/analyze with clientId returns 200", async () => {
    const res = await request(app)
      .post("/ai/brand-intelligence-v2/analyze")
      .send({ clientId: "test-client-001" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("clientId");
    expect(res.body).toHaveProperty("dimensionConfidence");
  });

  it("GET /ai/brand-intelligence-v2/:clientId returns 404 when no profile", async () => {
    const res = await request(app).get("/ai/brand-intelligence-v2/nonexistent-client");
    expect(res.status).toBe(404);
  });
});
