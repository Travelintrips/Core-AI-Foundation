/**
 * branding-identity/schema.test.ts — Team 27
 *
 * Tests:
 *   - Brief validation (valid + invalid)
 *   - Stage/artifact type enums
 *   - Brand property schema
 *   - Artifact registration schema
 *   - No branding fields leaked to core
 */

import { describe, it, expect } from "vitest";
import {
  BrandingBriefSchema,
  BrandingStageEnum,
  BrandingArtifactTypeEnum,
  BrandPropertySchema,
  ArtifactRegistrationSchema,
  StageAdvanceSchema,
  BRANDING_STAGES,
  BRANDING_ARTIFACT_TYPES,
  BRAND_PROPERTY_KINDS,
  BRANDING_STAGE_LABELS,
  ARTIFACT_STAGE_MAP,
} from "../schema.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validBrief = {
  companyName:     "Acme Corp",
  industry:        "Technology",
  targetAudience:  "Young professionals aged 25-35",
  positioning:     "The most reliable platform for modern teams",
  brandPersonality: ["innovative", "trustworthy"],
  brandValues:     ["quality", "transparency"],
  tone:            ["professional", "approachable"],
  preferredStyle:  "modern" as const,
  usageChannels:   ["digital", "web"] as ("digital" | "web")[],
};

// ── BrandingBriefSchema ───────────────────────────────────────────────────────

describe("BrandingBriefSchema", () => {
  it("accepts a valid brief", () => {
    const result = BrandingBriefSchema.safeParse(validBrief);
    expect(result.success).toBe(true);
  });

  it("rejects missing companyName", () => {
    const { companyName: _, ...rest } = validBrief;
    const result = BrandingBriefSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects empty brandPersonality array", () => {
    const result = BrandingBriefSchema.safeParse({ ...validBrief, brandPersonality: [] });
    expect(result.success).toBe(false);
  });

  it("rejects empty brandValues array", () => {
    const result = BrandingBriefSchema.safeParse({ ...validBrief, brandValues: [] });
    expect(result.success).toBe(false);
  });

  it("rejects empty tone array", () => {
    const result = BrandingBriefSchema.safeParse({ ...validBrief, tone: [] });
    expect(result.success).toBe(false);
  });

  it("rejects empty usageChannels", () => {
    const result = BrandingBriefSchema.safeParse({ ...validBrief, usageChannels: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid hex color constraint", () => {
    const result = BrandingBriefSchema.safeParse({
      ...validBrief,
      colorConstraints: ["notacolor"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid hex color constraints", () => {
    const result = BrandingBriefSchema.safeParse({
      ...validBrief,
      colorConstraints: ["#FF5733", "#333333"],
    });
    expect(result.success).toBe(true);
  });

  it("defaults language to 'id'", () => {
    const result = BrandingBriefSchema.safeParse(validBrief);
    expect(result.success && result.data.language).toBe("id");
  });

  it("defaults namingStatus to 'confirmed'", () => {
    const result = BrandingBriefSchema.safeParse(validBrief);
    expect(result.success && result.data.namingStatus).toBe("confirmed");
  });

  it("rejects invalid preferredStyle", () => {
    const result = BrandingBriefSchema.safeParse({
      ...validBrief,
      preferredStyle: "nonexistent_style",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid usageChannel value", () => {
    const result = BrandingBriefSchema.safeParse({
      ...validBrief,
      usageChannels: ["invalid_channel"],
    });
    expect(result.success).toBe(false);
  });
});

// ── Stage enum ────────────────────────────────────────────────────────────────

describe("BrandingStageEnum", () => {
  it("has 13 stages", () => {
    expect(BRANDING_STAGES).toHaveLength(13);
  });

  it("starts with brand_brief", () => {
    expect(BRANDING_STAGES[0]).toBe("brand_brief");
  });

  it("ends with export", () => {
    expect(BRANDING_STAGES[BRANDING_STAGES.length - 1]).toBe("export");
  });

  it("parses all valid stages", () => {
    for (const stage of BRANDING_STAGES) {
      expect(BrandingStageEnum.safeParse(stage).success).toBe(true);
    }
  });

  it("rejects unknown stage", () => {
    expect(BrandingStageEnum.safeParse("unknown_stage").success).toBe(false);
  });

  it("every stage has a label", () => {
    for (const stage of BRANDING_STAGES) {
      expect(BRANDING_STAGE_LABELS[stage]).toBeTruthy();
    }
  });
});

// ── Artifact type enum ────────────────────────────────────────────────────────

describe("BrandingArtifactTypeEnum", () => {
  it("has 11 artifact types", () => {
    expect(BRANDING_ARTIFACT_TYPES).toHaveLength(11);
  });

  it("parses all valid artifact types", () => {
    for (const type of BRANDING_ARTIFACT_TYPES) {
      expect(BrandingArtifactTypeEnum.safeParse(type).success).toBe(true);
    }
  });

  it("rejects unknown artifact type", () => {
    expect(BrandingArtifactTypeEnum.safeParse("unknown_type").success).toBe(false);
  });

  it("every artifact type maps to a valid stage", () => {
    for (const type of BRANDING_ARTIFACT_TYPES) {
      const stage = ARTIFACT_STAGE_MAP[type];
      expect(BRANDING_STAGES).toContain(stage);
    }
  });
});

// ── BrandPropertySchema ───────────────────────────────────────────────────────

describe("BrandPropertySchema", () => {
  it("accepts a valid color_token property", () => {
    const result = BrandPropertySchema.safeParse({
      kind:  "color_token",
      name:  "Primary Brand Color",
      value: "#1A73E8",
    });
    expect(result.success).toBe(true);
  });

  it("accepts all property kinds", () => {
    for (const kind of BRAND_PROPERTY_KINDS) {
      const result = BrandPropertySchema.safeParse({
        kind,
        name:  `Test ${kind}`,
        value: "test value",
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects missing name", () => {
    const result = BrandPropertySchema.safeParse({
      kind:  "color_token",
      value: "#FF0000",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown property kind", () => {
    const result = BrandPropertySchema.safeParse({
      kind:  "nonexistent_kind",
      name:  "Test",
      value: "test",
    });
    expect(result.success).toBe(false);
  });
});

// ── ArtifactRegistrationSchema ────────────────────────────────────────────────

describe("ArtifactRegistrationSchema", () => {
  it("accepts a valid artifact registration", () => {
    const result = ArtifactRegistrationSchema.safeParse({
      artifactType: "brand_strategy",
      title:        "Core Brand Strategy",
      stage:        "brand_strategy",
    });
    expect(result.success).toBe(true);
  });

  it("defaults properties to []", () => {
    const result = ArtifactRegistrationSchema.safeParse({
      artifactType: "color_system",
      title:        "Color Palette",
      stage:        "color_system",
    });
    expect(result.success && result.data.properties).toEqual([]);
  });

  it("defaults version to 1", () => {
    const result = ArtifactRegistrationSchema.safeParse({
      artifactType: "logo_concept",
      title:        "Logo Sketches",
      stage:        "logo_concepts",
    });
    expect(result.success && result.data.version).toBe(1);
  });

  it("rejects invalid artifact type", () => {
    const result = ArtifactRegistrationSchema.safeParse({
      artifactType: "unknown_type",
      title:        "Test",
      stage:        "brand_brief",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid storageUrl", () => {
    const result = ArtifactRegistrationSchema.safeParse({
      artifactType: "brand_guideline",
      title:        "Guideline",
      stage:        "brand_guideline",
      storageUrl:   "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});

// ── StageAdvanceSchema ────────────────────────────────────────────────────────

describe("StageAdvanceSchema", () => {
  it("accepts a valid stage advance", () => {
    const result = StageAdvanceSchema.safeParse({ targetStage: "research" });
    expect(result.success).toBe(true);
  });

  it("accepts advance with note", () => {
    const result = StageAdvanceSchema.safeParse({
      targetStage: "review",
      note:        "Requesting client review of strategy",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown stage", () => {
    const result = StageAdvanceSchema.safeParse({ targetStage: "unknown" });
    expect(result.success).toBe(false);
  });
});

// ── No branding fields leaked to core ────────────────────────────────────────

describe("isolation: branding fields must not appear in core schemas", () => {
  it("schema module exports no global design tokens", async () => {
    const mod = await import("../schema.js");
    // Should not export anything named 'token' at the top level (only via BrandProperty)
    expect(Object.keys(mod)).not.toContain("DesignToken");
    expect(Object.keys(mod)).not.toContain("GlobalToken");
  });

  it("schema module exports only branding-scoped identifiers", async () => {
    const mod = await import("../schema.js");
    const exports = Object.keys(mod);
    // Every exported key should reference branding or brand domain
    const nonBrandingExports = exports.filter(
      (k) =>
        !k.startsWith("Brand") &&
        !k.startsWith("Branding") &&
        !k.startsWith("BRANDING") &&
        !k.startsWith("ARTIFACT") &&
        !k.startsWith("Artifact") &&
        !k.startsWith("BRAND") &&
        !k.startsWith("Stage") &&
        !k.startsWith("HexColor") &&
        k !== "BrandPropertySchema" &&
        k !== "BrandPropertyKindEnum" &&
        k !== "StageAdvanceSchema" &&
        k !== "BrandingStatusUpdateSchema"
    );
    expect(nonBrandingExports).toEqual([]);
  });
});
