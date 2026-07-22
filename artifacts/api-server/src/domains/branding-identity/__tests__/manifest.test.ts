/**
 * branding-identity/manifest.test.ts — Team 27
 *
 * Tests:
 *   - buildBrandingManifest structure
 *   - getStageArtifacts
 *   - getMissingRequiredArtifacts
 *   - canExport
 *   - strategy/visual separation
 */

import { describe, it, expect } from "vitest";
import {
  buildBrandingManifest,
  getStageArtifacts,
  getMissingRequiredArtifacts,
  canExport,
} from "../manifest.js";
import { BRANDING_ARTIFACT_TYPES, BRANDING_STAGES, type BrandingArtifactType } from "../schema.js";

// ── buildBrandingManifest ─────────────────────────────────────────────────────

describe("buildBrandingManifest", () => {
  it("returns all 11 artifact entries", () => {
    const manifest = buildBrandingManifest();
    expect(manifest.entries).toHaveLength(11);
  });

  it("has pluginId 'branding-identity'", () => {
    const manifest = buildBrandingManifest();
    expect(manifest.pluginId).toBe("branding-identity");
  });

  it("totalCount matches entries length", () => {
    const manifest = buildBrandingManifest();
    expect(manifest.totalCount).toBe(manifest.entries.length);
  });

  it("requiredCount is less than totalCount (some optional)", () => {
    const manifest = buildBrandingManifest();
    expect(manifest.requiredCount).toBeLessThan(manifest.totalCount);
    expect(manifest.requiredCount).toBeGreaterThan(0);
  });

  it("every entry has a description", () => {
    const manifest = buildBrandingManifest();
    for (const entry of manifest.entries) {
      expect(entry.description).toBeTruthy();
    }
  });

  it("every artifact type appears exactly once", () => {
    const manifest = buildBrandingManifest();
    const seen = new Set<string>();
    for (const entry of manifest.entries) {
      expect(seen.has(entry.artifactType)).toBe(false);
      seen.add(entry.artifactType);
    }
    expect(seen.size).toBe(BRANDING_ARTIFACT_TYPES.length);
  });

  it("all entries map to valid stages", () => {
    const manifest = buildBrandingManifest();
    for (const entry of manifest.entries) {
      expect(BRANDING_STAGES).toContain(entry.stage);
    }
  });

  it("includes version field", () => {
    const manifest = buildBrandingManifest();
    expect(manifest.version).toBeTruthy();
  });
});

// ── getStageArtifacts ─────────────────────────────────────────────────────────

describe("getStageArtifacts", () => {
  it("returns brand_strategy artifact for brand_strategy stage", () => {
    const entries = getStageArtifacts("brand_strategy");
    expect(entries.some((e) => e.artifactType === "brand_strategy")).toBe(true);
  });

  it("returns logo_concept and logo_system for logo_concepts stage", () => {
    const entries = getStageArtifacts("logo_concepts");
    const types   = entries.map((e) => e.artifactType);
    expect(types).toContain("logo_concept");
    expect(types).toContain("logo_system");
  });

  it("returns brand_guideline for brand_guideline stage", () => {
    const entries = getStageArtifacts("brand_guideline");
    expect(entries.some((e) => e.artifactType === "brand_guideline")).toBe(true);
  });

  it("returns empty array for stages with no artifacts (research)", () => {
    const entries = getStageArtifacts("research");
    expect(entries).toHaveLength(0);
  });

  it("all entries match the requested stage", () => {
    for (const stage of [
      "brand_strategy",
      "positioning",
      "verbal_direction",
      "visual_direction",
      "logo_concepts",
      "color_system",
      "typography",
      "identity_applications",
      "brand_guideline",
      "export",
    ] as const) {
      const entries = getStageArtifacts(stage);
      for (const entry of entries) {
        expect(entry.stage).toBe(stage);
      }
    }
  });
});

// ── strategy/visual separation ────────────────────────────────────────────────

describe("strategy/visual separation", () => {
  it("strategy artifacts are associated with early stages", () => {
    const stageMap: Record<string, "brand_strategy" | "positioning" | "verbal_direction"> = {
      brand_strategy:   "brand_strategy",
      brand_positioning: "positioning",
      brand_voice:       "verbal_direction",
    };
    const strategyArtifacts: BrandingArtifactType[] = [
      "brand_strategy",
      "brand_positioning",
      "brand_voice",
    ];
    for (const type of strategyArtifacts) {
      const stage   = stageMap[type]!;
      const entries = getStageArtifacts(stage);
      expect(entries.some((e) => e.artifactType === type)).toBe(true);
    }
  });

  it("visual artifacts are associated with mid-to-late stages", () => {
    const visualArtifacts: BrandingArtifactType[] = [
      "brand_moodboard",
      "logo_concept",
      "logo_system",
      "color_system",
      "typography_system",
    ];
    const manifest = buildBrandingManifest();
    for (const type of visualArtifacts) {
      const entry = manifest.entries.find((e) => e.artifactType === type);
      expect(entry).toBeDefined();
      // Visual artifacts appear in stage index >= 5 (visual_direction onwards)
      const stageIdx = BRANDING_STAGES.indexOf(entry!.stage);
      expect(stageIdx).toBeGreaterThanOrEqual(5);
    }
  });
});

// ── getMissingRequiredArtifacts ───────────────────────────────────────────────

describe("getMissingRequiredArtifacts", () => {
  it("returns all required types when nothing registered", () => {
    const missing = getMissingRequiredArtifacts([]);
    expect(missing.length).toBeGreaterThan(0);
  });

  it("returns empty when all required types are registered", () => {
    const required: BrandingArtifactType[] = [
      "brand_strategy",
      "brand_positioning",
      "brand_voice",
      "logo_system",
      "color_system",
      "typography_system",
      "brand_guideline",
    ];
    const missing = getMissingRequiredArtifacts(required);
    expect(missing).toHaveLength(0);
  });

  it("only reports required types, not optional ones", () => {
    // Register all optional-only types
    const optionalOnly: BrandingArtifactType[] = [
      "brand_moodboard",
      "logo_concept",
      "identity_application",
      "campaign_direction",
    ];
    const missing = getMissingRequiredArtifacts(optionalOnly);
    // Should still be missing the required ones
    expect(missing).toContain("brand_strategy");
    expect(missing).toContain("brand_guideline");
  });
});

// ── canExport ─────────────────────────────────────────────────────────────────

describe("canExport", () => {
  it("returns canExport:false when nothing registered", () => {
    const result = canExport([]);
    expect(result.canExport).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("returns canExport:true when all required types registered", () => {
    const required: BrandingArtifactType[] = [
      "brand_strategy",
      "brand_positioning",
      "brand_voice",
      "logo_system",
      "color_system",
      "typography_system",
      "brand_guideline",
    ];
    const result = canExport(required);
    expect(result.canExport).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("missing list is a subset of required artifact types", () => {
    const manifest  = buildBrandingManifest();
    const requiredTypes = manifest.entries
      .filter((e) => e.required)
      .map((e) => e.artifactType);
    const result = canExport([]);
    for (const m of result.missing) {
      expect(requiredTypes).toContain(m);
    }
  });
});
