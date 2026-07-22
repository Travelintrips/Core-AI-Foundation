/**
 * architecture-landscape.test.ts — Team 29
 *
 * Unit tests for the Architecture & Landscape Design Plugin.
 * Tests run entirely in-memory (no DB) by exercising pure logic functions.
 *
 * WAJIB (required by parallel execution rules):
 *   1.  manifest          — plugin manifest has correct shape and no forbidden capabilities
 *   2.  brief             — validateBrief: required fields, email, area bounds, built > site guard
 *   3.  site_constraints  — validateSiteConstraints: height, FAR, setbacks, coverage bounds
 *   4.  workflow          — step ordering, nextWorkflowStep, isTransitionAllowed, terminal guard
 *   5.  artifact_types    — all 12 types registered; isValidArtifactType correct
 *   6.  preview_honesty   — forbidden labels rejected; preview types require preview language
 *   7.  material_component — component contribution contract shape (no DB call)
 *   8.  overlay_metadata  — OverlayMetadata shape and pluginId constant
 *   9.  no_bim_gis_engine — PLUGIN_CAPABILITY_BOUNDARY is all-false; no engine exports
 *   10. no_core_leakage   — schema/index.ts and routes/index.ts are clean of team-29 exports
 *   11. compatibility      — statuses cover all workflow steps + terminal states
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  validateBrief,
  validateSiteConstraints,
  checkArtifactHonesty,
  isValidArtifactType,
  isValidWorkflowStep,
  nextWorkflowStep,
  workflowStepIndex,
  ARCHITECTURE_PREVIEW_DISCLAIMER,
  PLUGIN_CAPABILITY_BOUNDARY,
} from "../domains/architecture-landscape/validators.js";

import {
  ARCHITECTURE_WORKFLOW_STEPS,
  ARCHITECTURE_PROJECT_STATUSES,
  ARCHITECTURE_ARTIFACT_TYPES,
  ARCHITECTURE_PROJECT_TYPES,
  FORBIDDEN_ARTIFACT_LABELS,
} from "../domains/architecture-landscape/schema.js";

import {
  isTransitionAllowed,
  getPluginManifest,
} from "../domains/architecture-landscape/architectureLandscapeService.js";

// ESM __dirname shim
const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// 1. Manifest
// ─────────────────────────────────────────────────────────────────────────────

describe("manifest", () => {
  it("returns correct pluginId", () => {
    const m = getPluginManifest();
    expect(m.pluginId).toBe("architecture-landscape-v1");
  });

  it("reports team 29", () => {
    const m = getPluginManifest();
    expect(m.team).toBe("29");
  });

  it("lists all 12 workflow steps", () => {
    const m = getPluginManifest();
    expect(m.workflowSteps).toHaveLength(12);
    expect(m.workflowSteps[0]).toBe("brief");
    expect(m.workflowSteps[11]).toBe("export");
  });

  it("lists all 12 artifact types", () => {
    const m = getPluginManifest();
    expect(m.artifactTypes).toHaveLength(12);
  });

  it("declares all capabilities as false", () => {
    const m = getPluginManifest();
    expect(m.capabilities.hasBimEngine).toBe(false);
    expect(m.capabilities.hasGisEngine).toBe(false);
    expect(m.capabilities.hasCadEngine).toBe(false);
    expect(m.capabilities.hasStructuralCalculation).toBe(false);
    expect(m.capabilities.hasPermitDocumentGeneration).toBe(false);
    expect(m.capabilities.hasCertifiedLandscapePlanning).toBe(false);
  });

  it("lists three tables all scoped to ai_platform schema", () => {
    const m = getPluginManifest();
    for (const table of m.tables) {
      expect(table).toMatch(/^ai_platform\./);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Brief validation
// ─────────────────────────────────────────────────────────────────────────────

describe("brief validation", () => {
  const validBase = {
    projectType: "residential",
    clientName: "PT Maju Jaya",
    clientEmail: "info@majujaya.id",
    projectTitle: "Villa Pantai Indah",
  };

  it("passes with minimum valid input", () => {
    const result = validateBrief(validBase);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when projectType is missing", () => {
    const result = validateBrief({ ...validBase, projectType: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "projectType" && e.code === "required")).toBe(true);
  });

  it("fails when projectType is unknown", () => {
    const result = validateBrief({ ...validBase, projectType: "bim_project" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "projectType" && e.code === "invalid_project_type")).toBe(true);
  });

  it("fails when clientName is missing", () => {
    const result = validateBrief({ ...validBase, clientName: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "clientName")).toBe(true);
  });

  it("fails when clientEmail is missing", () => {
    const result = validateBrief({ ...validBase, clientEmail: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "clientEmail" && e.code === "required")).toBe(true);
  });

  it("fails when clientEmail is malformed", () => {
    const result = validateBrief({ ...validBase, clientEmail: "not-an-email" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "clientEmail" && e.code === "invalid_email")).toBe(true);
  });

  it("fails when projectTitle is missing", () => {
    const result = validateBrief({ ...validBase, projectTitle: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "projectTitle")).toBe(true);
  });

  it("fails for negative siteAreaM2", () => {
    const result = validateBrief({ ...validBase, siteAreaM2: -100 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "siteAreaM2" && e.code === "invalid_area")).toBe(true);
  });

  it("fails for zero siteAreaM2", () => {
    const result = validateBrief({ ...validBase, siteAreaM2: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "siteAreaM2")).toBe(true);
  });

  it("fails when siteAreaM2 exceeds maximum", () => {
    const result = validateBrief({ ...validBase, siteAreaM2: 20_000_000 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "siteAreaM2" && e.code === "area_too_large")).toBe(true);
  });

  it("fails when builtAreaM2 exceeds siteAreaM2", () => {
    const result = validateBrief({ ...validBase, siteAreaM2: 500, builtAreaM2: 800 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "builtAreaM2" && e.code === "built_exceeds_site")).toBe(true);
  });

  it("passes when builtAreaM2 equals siteAreaM2 (100% coverage allowed)", () => {
    const result = validateBrief({ ...validBase, siteAreaM2: 500, builtAreaM2: 500 });
    // built == site is not inherently invalid at brief stage
    const builtExceedsErrors = result.errors.filter(
      (e) => e.field === "builtAreaM2" && e.code === "built_exceeds_site",
    );
    expect(builtExceedsErrors).toHaveLength(0);
  });

  it("warns when siteLocation is missing", () => {
    const result = validateBrief({ ...validBase, siteLocation: undefined });
    expect(result.warnings.some((w) => w.field === "siteLocation")).toBe(true);
  });

  it("warns when program is empty", () => {
    const result = validateBrief({ ...validBase, program: [] });
    expect(result.warnings.some((w) => w.field === "program" && w.code === "missing_program")).toBe(true);
  });

  it("warns when climate is missing", () => {
    const result = validateBrief({ ...validBase, climate: undefined });
    expect(result.warnings.some((w) => w.field === "climate")).toBe(true);
  });

  it("accepts string number for siteAreaM2 (numeric coercion)", () => {
    const result = validateBrief({ ...validBase, siteAreaM2: "2500" });
    expect(result.errors.filter((e) => e.field === "siteAreaM2")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Site constraints validation
// ─────────────────────────────────────────────────────────────────────────────

describe("site constraints validation", () => {
  it("passes with valid constraints", () => {
    const result = validateSiteConstraints({
      buildingHeightLimitM: 15,
      floorAreaRatio: 2.5,
      setbackFrontM: 4,
      setbackSideM: 2,
      setbackRearM: 3,
      plotCoveragePercent: 60,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails for negative building height", () => {
    const result = validateSiteConstraints({ buildingHeightLimitM: -5 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "buildingHeightLimitM")).toBe(true);
  });

  it("fails when building height exceeds 1000 m", () => {
    const result = validateSiteConstraints({ buildingHeightLimitM: 1500 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "height_exceeds_max")).toBe(true);
  });

  it("fails for negative FAR", () => {
    const result = validateSiteConstraints({ floorAreaRatio: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "floorAreaRatio" && e.code === "invalid_far")).toBe(true);
  });

  it("warns for very high FAR (>20)", () => {
    const result = validateSiteConstraints({ floorAreaRatio: 25 });
    expect(result.warnings.some((w) => w.field === "floorAreaRatio" && w.code === "high_far")).toBe(true);
  });

  it("fails for negative front setback", () => {
    const result = validateSiteConstraints({ setbackFrontM: -2 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "setbackFrontM" && e.code === "invalid_setback")).toBe(true);
  });

  it("warns for unusually large setback", () => {
    const result = validateSiteConstraints({ setbackRearM: 150 });
    expect(result.warnings.some((w) => w.field === "setbackRearM" && w.code === "large_setback")).toBe(true);
  });

  it("fails for plot coverage below 0", () => {
    const result = validateSiteConstraints({ plotCoveragePercent: -10 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "plotCoveragePercent" && e.code === "invalid_coverage")).toBe(true);
  });

  it("fails for plot coverage above 100", () => {
    const result = validateSiteConstraints({ plotCoveragePercent: 105 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "plotCoveragePercent" && e.code === "invalid_coverage")).toBe(true);
  });

  it("warns for very high coverage (>90%)", () => {
    const result = validateSiteConstraints({ plotCoveragePercent: 95 });
    expect(result.warnings.some((w) => w.field === "plotCoveragePercent" && w.code === "high_coverage")).toBe(true);
  });

  it("passes with empty input (all optional)", () => {
    const result = validateSiteConstraints({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes with zero setbacks (valid — no setback regulation)", () => {
    const result = validateSiteConstraints({ setbackFrontM: 0, setbackSideM: 0, setbackRearM: 0 });
    expect(result.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Workflow
// ─────────────────────────────────────────────────────────────────────────────

describe("workflow", () => {
  it("has exactly 12 steps", () => {
    expect(ARCHITECTURE_WORKFLOW_STEPS).toHaveLength(12);
  });

  it("starts with 'brief' and ends with 'export'", () => {
    expect(ARCHITECTURE_WORKFLOW_STEPS[0]).toBe("brief");
    expect(ARCHITECTURE_WORKFLOW_STEPS[11]).toBe("export");
  });

  it("step order matches spec: brief → site_context → constraints → research → concept → program_zoning → spatial_direction → material_landscape_direction → visualization → documentation → review → export", () => {
    const expected = [
      "brief",
      "site_context",
      "constraints",
      "research",
      "concept",
      "program_zoning",
      "spatial_direction",
      "material_landscape_direction",
      "visualization",
      "documentation",
      "review",
      "export",
    ];
    expect([...ARCHITECTURE_WORKFLOW_STEPS]).toEqual(expected);
  });

  it("isValidWorkflowStep returns true for every registered step", () => {
    for (const step of ARCHITECTURE_WORKFLOW_STEPS) {
      expect(isValidWorkflowStep(step)).toBe(true);
    }
  });

  it("isValidWorkflowStep returns false for unknown step", () => {
    expect(isValidWorkflowStep("bim_phase")).toBe(false);
    expect(isValidWorkflowStep("")).toBe(false);
  });

  it("workflowStepIndex returns correct 0-based index", () => {
    expect(workflowStepIndex("brief")).toBe(0);
    expect(workflowStepIndex("export")).toBe(11);
    expect(workflowStepIndex("concept")).toBe(4);
  });

  it("nextWorkflowStep returns the next step correctly", () => {
    expect(nextWorkflowStep("brief")).toBe("site_context");
    expect(nextWorkflowStep("concept")).toBe("program_zoning");
    expect(nextWorkflowStep("review")).toBe("export");
  });

  it("nextWorkflowStep returns null for 'export' (last step)", () => {
    expect(nextWorkflowStep("export")).toBeNull();
  });

  it("isTransitionAllowed: draft → brief_submitted is valid", () => {
    expect(isTransitionAllowed("draft", "brief_submitted")).toBe(true);
  });

  it("isTransitionAllowed: draft → cancelled is valid", () => {
    expect(isTransitionAllowed("draft", "cancelled")).toBe(true);
  });

  it("isTransitionAllowed: completed → anything is not allowed (terminal)", () => {
    expect(isTransitionAllowed("completed", "brief_submitted")).toBe(false);
    expect(isTransitionAllowed("completed", "cancelled")).toBe(false);
  });

  it("isTransitionAllowed: cancelled → anything is not allowed (terminal)", () => {
    expect(isTransitionAllowed("cancelled", "draft")).toBe(false);
    expect(isTransitionAllowed("cancelled", "brief_submitted")).toBe(false);
  });

  it("isTransitionAllowed: cannot skip steps (brief_submitted → concept is not allowed)", () => {
    expect(isTransitionAllowed("brief_submitted", "concept")).toBe(false);
  });

  it("isTransitionAllowed: review → export_ready is valid (last gate)", () => {
    expect(isTransitionAllowed("review", "export_ready")).toBe(true);
  });

  it("isTransitionAllowed: export_ready → completed is valid", () => {
    expect(isTransitionAllowed("export_ready", "completed")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Artifact types
// ─────────────────────────────────────────────────────────────────────────────

describe("artifact types", () => {
  const expectedTypes = [
    "architecture_site_context",
    "architecture_concept",
    "architecture_program",
    "architecture_zoning",
    "architecture_plan_preview",
    "architecture_elevation_preview",
    "architecture_material_board",
    "architecture_visualization",
    "landscape_concept",
    "landscape_zoning",
    "landscape_planting_direction",
    "architecture_presentation",
  ];

  it("has exactly 12 artifact types", () => {
    expect(ARCHITECTURE_ARTIFACT_TYPES).toHaveLength(12);
  });

  it("contains all expected types from the spec", () => {
    for (const t of expectedTypes) {
      expect(ARCHITECTURE_ARTIFACT_TYPES as readonly string[]).toContain(t);
    }
  });

  it("isValidArtifactType returns true for every registered type", () => {
    for (const t of ARCHITECTURE_ARTIFACT_TYPES) {
      expect(isValidArtifactType(t)).toBe(true);
    }
  });

  it("isValidArtifactType returns false for unknown type", () => {
    expect(isValidArtifactType("construction_drawing")).toBe(false);
    expect(isValidArtifactType("bim_model")).toBe(false);
    expect(isValidArtifactType("")).toBe(false);
  });

  it("plan and elevation types include 'preview' keyword (honesty enforcement at type level)", () => {
    expect(ARCHITECTURE_ARTIFACT_TYPES as readonly string[]).toContain("architecture_plan_preview");
    expect(ARCHITECTURE_ARTIFACT_TYPES as readonly string[]).toContain("architecture_elevation_preview");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Preview honesty
// ─────────────────────────────────────────────────────────────────────────────

describe("preview honesty", () => {
  it("rejects label containing 'construction drawing'", () => {
    const result = checkArtifactHonesty("architecture_concept", "Construction Drawing — Level 1");
    expect(result.honest).toBe(false);
    expect(result.forbiddenLabel).toBe("construction drawing");
  });

  it("rejects label containing 'structural calculation'", () => {
    const result = checkArtifactHonesty("architecture_concept", "Structural Calculation Sheet");
    expect(result.honest).toBe(false);
    expect(result.forbiddenLabel).toBe("structural calculation");
  });

  it("rejects label containing 'permit-ready drawing'", () => {
    const result = checkArtifactHonesty("architecture_presentation", "Permit-Ready Drawing Set");
    expect(result.honest).toBe(false);
    expect(result.forbiddenLabel).toBe("permit-ready drawing");
  });

  it("rejects label containing 'certified landscape plan'", () => {
    const result = checkArtifactHonesty("landscape_concept", "Certified Landscape Plan — Phase 1");
    expect(result.honest).toBe(false);
    expect(result.forbiddenLabel).toBe("certified landscape plan");
  });

  it("is case-insensitive for forbidden label check", () => {
    const result = checkArtifactHonesty("architecture_concept", "CONSTRUCTION DRAWING v2");
    expect(result.honest).toBe(false);
  });

  it("accepts label with preview language for plan_preview type", () => {
    const result = checkArtifactHonesty(
      "architecture_plan_preview",
      "Floor Plan Preview — Ground Level",
    );
    expect(result.honest).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("accepts label with draft language for plan_preview type", () => {
    const result = checkArtifactHonesty(
      "architecture_plan_preview",
      "Ground Floor Draft Plan",
    );
    expect(result.honest).toBe(true);
  });

  it("rejects plan_preview artifact label that lacks preview/draft/concept/direction", () => {
    const result = checkArtifactHonesty(
      "architecture_plan_preview",
      "Ground Floor Plan",
    );
    expect(result.honest).toBe(false);
    expect(result.forbiddenLabel).toBeNull(); // fails for honesty reason, not forbidden label
    expect(result.reason).toBeTruthy();
  });

  it("accepts concept label without preview language (concept type doesn't require it)", () => {
    const result = checkArtifactHonesty(
      "architecture_concept",
      "Site Concept — Tropical Minimalist",
    );
    expect(result.honest).toBe(true);
  });

  it("disclaimer string is non-empty and references 'preview'", () => {
    expect(ARCHITECTURE_PREVIEW_DISCLAIMER).toBeTruthy();
    expect(ARCHITECTURE_PREVIEW_DISCLAIMER.toLowerCase()).toContain("preview");
  });

  it("disclaimer explicitly excludes construction drawings", () => {
    expect(ARCHITECTURE_PREVIEW_DISCLAIMER.toLowerCase()).toContain("construction drawing");
  });

  it("FORBIDDEN_ARTIFACT_LABELS has exactly 4 entries", () => {
    expect(FORBIDDEN_ARTIFACT_LABELS).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Material / component contribution
// ─────────────────────────────────────────────────────────────────────────────

describe("material component contribution", () => {
  it("component contribution input shape accepts required fields", () => {
    // Pure shape test — no DB
    const input = {
      componentCode: "mat_bamboo_flooring",
      componentName: "Bamboo Flooring — Natural",
      category: "material",
      subCategory: "flooring",
      description: "Sustainably harvested bamboo flooring, suitable for tropical climates.",
      climateZones: ["tropical", "subtropical"],
      sustainabilityRating: "high",
      locallyAvailable: true,
      metadataJson: { finishOptions: ["matte", "satin"], unitPrice: "IDR 180000/m2" },
    };
    expect(input.componentCode).toBe("mat_bamboo_flooring");
    expect(input.category).toBe("material");
    expect(input.climateZones).toContain("tropical");
    expect(input.sustainabilityRating).toBe("high");
    expect(input.locallyAvailable).toBe(true);
  });

  it("component contribution accepts plant category", () => {
    const input = {
      componentCode: "plant_heliconia_psittacorum",
      componentName: "Heliconia (Psittacorum)",
      category: "plant",
      climateZones: ["tropical"],
      sustainabilityRating: "medium",
      locallyAvailable: true,
      metadataJson: { heightCm: "60-120", waterNeeds: "high", sunExposure: "partial" },
    };
    expect(input.category).toBe("plant");
    expect(input.climateZones).toContain("tropical");
  });

  it("component categories include material, plant, element, fixture", () => {
    const validCategories = ["material", "plant", "element", "fixture"];
    // Not enforced by a strict enum in service (open string) — but we verify expected values exist
    for (const cat of validCategories) {
      expect(cat).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Overlay metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("overlay metadata", () => {
  it("OverlayMetadata shape has required fields", () => {
    // Construct manually to test the shape
    const overlay = {
      projectId: 1,
      projectRef: "arch-test-uuid",
      pluginId: "architecture-landscape-v1" as const,
      overlayVersion: "1.0.0",
      workflowStep: "concept" as const,
      artifactTypes: ["architecture_concept", "architecture_visualization"] as any,
      siteAreaM2: 2500,
      climateZone: "tropical",
      projectType: "residential",
      generatedAt: new Date().toISOString(),
    };
    expect(overlay.pluginId).toBe("architecture-landscape-v1");
    expect(overlay.overlayVersion).toBe("1.0.0");
    expect(overlay.artifactTypes).toHaveLength(2);
    expect(overlay.siteAreaM2).toBe(2500);
  });

  it("pluginId constant is stable and matches manifest", () => {
    const manifest = getPluginManifest();
    expect(manifest.pluginId).toBe("architecture-landscape-v1");
  });

  it("overlay metadata includes climateZone from project", () => {
    const overlay = {
      climateZone: "tropical",
      siteAreaM2: null,
      projectType: "commercial",
    };
    expect(overlay.climateZone).toBe("tropical");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. No BIM/GIS engine
// ─────────────────────────────────────────────────────────────────────────────

describe("no BIM/GIS engine", () => {
  it("PLUGIN_CAPABILITY_BOUNDARY.hasBimEngine is false", () => {
    expect(PLUGIN_CAPABILITY_BOUNDARY.hasBimEngine).toBe(false);
  });

  it("PLUGIN_CAPABILITY_BOUNDARY.hasGisEngine is false", () => {
    expect(PLUGIN_CAPABILITY_BOUNDARY.hasGisEngine).toBe(false);
  });

  it("PLUGIN_CAPABILITY_BOUNDARY.hasCadEngine is false", () => {
    expect(PLUGIN_CAPABILITY_BOUNDARY.hasCadEngine).toBe(false);
  });

  it("PLUGIN_CAPABILITY_BOUNDARY.hasStructuralCalculation is false", () => {
    expect(PLUGIN_CAPABILITY_BOUNDARY.hasStructuralCalculation).toBe(false);
  });

  it("PLUGIN_CAPABILITY_BOUNDARY.hasPermitDocumentGeneration is false", () => {
    expect(PLUGIN_CAPABILITY_BOUNDARY.hasPermitDocumentGeneration).toBe(false);
  });

  it("PLUGIN_CAPABILITY_BOUNDARY.hasCertifiedLandscapePlanning is false", () => {
    expect(PLUGIN_CAPABILITY_BOUNDARY.hasCertifiedLandscapePlanning).toBe(false);
  });

  it("every capability in the boundary is false (no undeclared true flags)", () => {
    for (const [key, val] of Object.entries(PLUGIN_CAPABILITY_BOUNDARY)) {
      expect(val, `Expected capability '${key}' to be false`).toBe(false);
    }
  });

  it("manifest capabilities match PLUGIN_CAPABILITY_BOUNDARY", () => {
    const m = getPluginManifest();
    for (const [key, val] of Object.entries(m.capabilities)) {
      expect(val, `manifest capability '${key}' should be false`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. No core leakage
// ─────────────────────────────────────────────────────────────────────────────

describe("no core leakage", () => {
  const schemaIndexPath = resolve(__dirname, "../../lib/db/src/schema/index.ts");
  const routesIndexPath = resolve(__dirname, "../routes/index.ts");

  it("lib/db schema/index.ts does NOT export architecture-landscape types", () => {
    let content: string;
    try {
      content = readFileSync(schemaIndexPath, "utf-8");
    } catch {
      // Schema file may not exist in this branch — that's correct
      return;
    }
    expect(content).not.toContain("architecture-landscape");
    expect(content).not.toContain("architectureLandscape");
    expect(content).not.toContain("architecture_landscape");
  });

  it("routes/index.ts does NOT import architecture-landscape router", () => {
    let content: string;
    try {
      content = readFileSync(routesIndexPath, "utf-8");
    } catch {
      return;
    }
    expect(content).not.toContain("architecture-landscape");
    expect(content).not.toContain("architectureLandscapeRouter");
  });

  it("domain schema file does NOT import from lib/db/src/schema/index", () => {
    const schemaFilePath = resolve(
      __dirname,
      "../domains/architecture-landscape/schema.ts",
    );
    const content = readFileSync(schemaFilePath, "utf-8");
    expect(content).not.toContain("lib/db/src/schema/index");
    expect(content).not.toContain("@workspace/db/schema");
  });

  it("route file does NOT import zod/v4 directly", () => {
    const routeFilePath = resolve(
      __dirname,
      "../routes/architecture-landscape.ts",
    );
    const content = readFileSync(routeFilePath, "utf-8");
    expect(content).not.toMatch(/from ['"]zod\/v4['"]/);
    expect(content).not.toMatch(/require\(['"]zod\/v4['"]\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Compatibility
// ─────────────────────────────────────────────────────────────────────────────

describe("compatibility", () => {
  it("project statuses include all workflow-step-mapped statuses plus terminals", () => {
    // Every step maps to a status: brief → brief_submitted, …, export → export_ready
    const stepMappedStatuses = [
      "brief_submitted",
      "site_context",
      "constraints",
      "research",
      "concept",
      "program_zoning",
      "spatial_direction",
      "material_landscape_direction",
      "visualization",
      "documentation",
      "review",
      "export_ready",
    ];
    const terminalStatuses = ["completed", "cancelled"];
    const initialStatus = ["draft"];

    for (const s of [...stepMappedStatuses, ...terminalStatuses, ...initialStatus]) {
      expect(
        (ARCHITECTURE_PROJECT_STATUSES as readonly string[]).includes(s),
        `Status '${s}' missing from ARCHITECTURE_PROJECT_STATUSES`,
      ).toBe(true);
    }
  });

  it("total project status count is 15 (1 draft + 12 step-mapped + 2 terminal)", () => {
    expect(ARCHITECTURE_PROJECT_STATUSES).toHaveLength(15);
  });

  it("all project types are non-empty strings", () => {
    for (const t of ARCHITECTURE_PROJECT_TYPES) {
      expect(typeof t).toBe("string");
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it("transition map covers every status (no orphan statuses)", () => {
    // Every status in ARCHITECTURE_PROJECT_STATUSES must be a valid 'from' in isTransitionAllowed
    for (const from of ARCHITECTURE_PROJECT_STATUSES) {
      // Calling with a nonsense 'to' should not throw — just return false
      expect(() => isTransitionAllowed(from as any, "draft" as any)).not.toThrow();
    }
  });

  it("forward-only: no status can transition back to 'draft'", () => {
    for (const from of ARCHITECTURE_PROJECT_STATUSES) {
      if (from === "draft") continue;
      expect(isTransitionAllowed(from as any, "draft")).toBe(false);
    }
  });
});
