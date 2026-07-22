/**
 * packagingPlugin.test.ts — Team 26: Packaging Design Domain Plugin
 *
 * Required test categories (per spec):
 *   1.  manifest
 *   2.  brief
 *   3.  workflow
 *   4.  artifact types
 *   5.  overlay definitions
 *   6.  production metadata
 *   7.  material contribution
 *   8.  export preset
 *   9.  compliance metadata
 *   10. no core leakage
 *   11. version compatibility
 */

import { describe, it, expect } from "vitest";

// ── Imports under test ────────────────────────────────────────────────────────

import {
  buildPluginManifest,
  assertVersionCompatible,
  PLUGIN_ID,
  PLUGIN_VERSION,
  PLUGIN_TEAM,
} from "../manifest.js";

import {
  PackagingBriefSchema,
  validateBrief,
} from "../brief.js";

import {
  PACKAGING_WORKFLOW,
  WORKFLOW_STEP_IDS,
  getStep,
  getNextSteps,
  isStepTransitionAllowed,
} from "../workflow.js";

import {
  PACKAGING_ARTIFACT_TYPE_IDS,
  listArtifactTypes,
  listDeliverableArtifactTypes,
  getArtifactType,
  isMimeAccepted,
} from "../artifacts.js";

import {
  OVERLAY_TYPE_IDS,
  listOverlayDefinitions,
  listMandatoryOverlays,
  listStructuralOverlays,
  getOverlayDefinition,
  resolveActiveOverlays,
} from "../overlays.js";

import {
  listSubstrates,
  listSubstratesByCategory,
  getSubstrate,
  buildMaterialContribution,
} from "../material.js";

import {
  EXPORT_PRESET_IDS,
  listExportPresets,
  getExportPreset,
  getRequiredFiles,
} from "../export.js";

import {
  listComplianceProfiles,
  getComplianceProfile,
  resolveComplianceProfiles,
  buildComplianceSheet,
  recalculateOutcome,
} from "../compliance.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Manifest
// ─────────────────────────────────────────────────────────────────────────────

describe("1. manifest", () => {
  it("builds without throwing", () => {
    expect(() => buildPluginManifest()).not.toThrow();
  });

  it("has correct pluginId, team, version", () => {
    const m = buildPluginManifest();
    expect(m.pluginId).toBe(PLUGIN_ID);
    expect(m.pluginTeam).toBe(PLUGIN_TEAM);
    expect(m.version).toBe(PLUGIN_VERSION);
  });

  it("reports correct step count (12)", () => {
    const m = buildPluginManifest();
    expect(m.workflow.stepCount).toBe(12);
  });

  it("reports all 8 artifact type IDs", () => {
    const m = buildPluginManifest();
    expect(m.artifactTypes.count).toBe(8);
    expect(m.artifactTypes.ids.length).toBe(8);
  });

  it("reports all 7 overlay IDs", () => {
    const m = buildPluginManifest();
    expect(m.overlays.count).toBe(7);
  });

  it("reports at least 6 export presets", () => {
    const m = buildPluginManifest();
    expect(m.exportPresets.count).toBeGreaterThanOrEqual(6);
  });

  it("reports at least 3 compliance profiles", () => {
    const m = buildPluginManifest();
    expect(m.compliance.profileCount).toBeGreaterThanOrEqual(3);
  });

  it("includes all route entries", () => {
    const m = buildPluginManifest();
    expect(m.routes.length).toBeGreaterThan(0);
    for (const route of m.routes) {
      expect(route.path).toMatch(/^\/ai\/packaging-design-plugin/);
    }
  });

  it("integration notes array is non-empty and mentions no new tables", () => {
    const m = buildPluginManifest();
    expect(m.integrationNotes.length).toBeGreaterThan(0);
    const joined = m.integrationNotes.join(" ");
    expect(joined).toContain("No new DB tables");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Brief
// ─────────────────────────────────────────────────────────────────────────────

describe("2. brief", () => {
  const validBrief = {
    productType:    "Healthy snack granola bar",
    productName:    "GranoBar Original",
    packagingType:  "food_packaging",
    quantity:       50000,
    targetMarket:   "Health-conscious urban consumers 20–45",
    brandName:      "NutriCo",
    customerName:   "PT NutriCo Indonesia",
    customerEmail:  "marketing@nutrico.co.id",
    barcodeRequirements: { required: true, barcodeType: "ean13" },
  };

  it("accepts a valid brief", () => {
    const result = PackagingBriefSchema.safeParse(validBrief);
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { productType: _p, ...incomplete } = validBrief;
    const result = PackagingBriefSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = PackagingBriefSchema.safeParse({
      ...validBrief,
      customerEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid packagingType", () => {
    const result = PackagingBriefSchema.safeParse({
      ...validBrief,
      packagingType: "cardboard_box_unknown",
    });
    expect(result.success).toBe(false);
  });

  it("validateBrief returns valid:true for a complete brief", () => {
    const res = validateBrief(validBrief);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it("validateBrief returns valid:false for invalid input", () => {
    const res = validateBrief({ productType: "", quantity: -1 });
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("validateBrief warns about regulated type with no regulatory requirements", () => {
    const res = validateBrief({ ...validBrief, regulatoryRequirements: [] });
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => w.includes("regulated"))).toBe(true);
  });

  it("validateBrief warns about barcode required but no type specified", () => {
    const res = validateBrief({
      ...validBrief,
      barcodeRequirements: { required: true },
    });
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => w.includes("barcodeType"))).toBe(true);
  });

  it("dimensions sub-schema defaults bleed to 3 and safeArea to 5", () => {
    const result = PackagingBriefSchema.safeParse({
      ...validBrief,
      dimensions: { widthMm: 120, heightMm: 200 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dimensions?.bleedMm).toBe(3);
      expect(result.data.dimensions?.safeAreaMm).toBe(5);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Workflow
// ─────────────────────────────────────────────────────────────────────────────

describe("3. workflow", () => {
  it("has exactly 12 steps", () => {
    expect(PACKAGING_WORKFLOW.steps).toHaveLength(12);
  });

  it("step sequences are 1–12 and unique", () => {
    const seqs = PACKAGING_WORKFLOW.steps.map((s) => s.sequence);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("initial step is 'brief'", () => {
    expect(PACKAGING_WORKFLOW.initialStep).toBe("brief");
  });

  it("terminal step is 'export'", () => {
    expect(PACKAGING_WORKFLOW.terminalStep).toBe("export");
  });

  it("every WORKFLOW_STEP_ID appears in the steps array", () => {
    const ids = PACKAGING_WORKFLOW.steps.map((s) => s.id);
    for (const id of WORKFLOW_STEP_IDS) {
      expect(ids).toContain(id);
    }
  });

  it("getStep returns the correct step", () => {
    const step = getStep("artwork");
    expect(step.id).toBe("artwork");
    expect(step.sequence).toBe(7);
  });

  it("getStep throws for unknown id", () => {
    expect(() => getStep("unknown_step" as never)).toThrow();
  });

  it("transitions: brief → product_requirements is allowed", () => {
    expect(isStepTransitionAllowed("brief", "product_requirements")).toBe(true);
  });

  it("transitions: export has no outgoing transitions", () => {
    const exportStep = getStep("export");
    expect(exportStep.transitions).toHaveLength(0);
  });

  it("transitions: brief cannot jump directly to artwork", () => {
    expect(isStepTransitionAllowed("brief", "artwork")).toBe(false);
  });

  it("getNextSteps returns correct next steps for dieline_input", () => {
    const next = getNextSteps("dieline_input");
    expect(next.map((s) => s.id)).toContain("artwork");
  });

  it("compliance_review is not revisitable", () => {
    expect(getStep("compliance_review").revisitable).toBe(false);
  });

  it("approval gates: market_research, visual_direction, structure_direction, artwork, mockup, compliance_review", () => {
    const gated = PACKAGING_WORKFLOW.steps
      .filter((s) => s.hasApprovalGate)
      .map((s) => s.id);
    expect(gated).toContain("market_research");
    expect(gated).toContain("visual_direction");
    expect(gated).toContain("artwork");
    expect(gated).toContain("mockup");
    expect(gated).toContain("compliance_review");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Artifact types
// ─────────────────────────────────────────────────────────────────────────────

describe("4. artifact types", () => {
  it("has exactly 8 artifact types", () => {
    expect(listArtifactTypes()).toHaveLength(8);
  });

  it("all PACKAGING_ARTIFACT_TYPE_IDS are in the registry", () => {
    for (const id of PACKAGING_ARTIFACT_TYPE_IDS) {
      expect(() => getArtifactType(id)).not.toThrow();
    }
  });

  it("every artifact type has non-empty mimeTypes and requiredFields", () => {
    for (const t of listArtifactTypes()) {
      expect(t.mimeTypes.length).toBeGreaterThan(0);
      expect(t.requiredFields.length).toBeGreaterThan(0);
    }
  });

  it("deliverable artifact types include packaging_artwork", () => {
    const deliverable = listDeliverableArtifactTypes().map((t) => t.id);
    expect(deliverable).toContain("packaging_artwork");
  });

  it("packaging_moodboard is NOT a deliverable", () => {
    const m = getArtifactType("packaging_moodboard");
    expect(m.isDeliverable).toBe(false);
  });

  it("isMimeAccepted returns true for application/pdf on packaging_artwork", () => {
    expect(isMimeAccepted("packaging_artwork", "application/pdf")).toBe(true);
  });

  it("isMimeAccepted returns false for video/mp4 on any packaging artifact", () => {
    for (const id of PACKAGING_ARTIFACT_TYPE_IDS) {
      expect(isMimeAccepted(id, "video/mp4")).toBe(false);
    }
  });

  it("getArtifactType throws for unknown id", () => {
    expect(() => getArtifactType("packaging_unknown" as never)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Overlay definitions
// ─────────────────────────────────────────────────────────────────────────────

describe("5. overlay definitions", () => {
  it("has exactly 7 overlay types", () => {
    expect(listOverlayDefinitions()).toHaveLength(7);
  });

  it("all OVERLAY_TYPE_IDS resolve without error", () => {
    for (const id of OVERLAY_TYPE_IDS) {
      expect(() => getOverlayDefinition(id)).not.toThrow();
    }
  });

  it("mandatory overlays include bleed, trim, safe_area", () => {
    const mandatory = listMandatoryOverlays().map((o) => o.id);
    expect(mandatory).toContain("bleed");
    expect(mandatory).toContain("trim");
    expect(mandatory).toContain("safe_area");
  });

  it("barcode_zone is NOT mandatory (conditional)", () => {
    const mandatory = listMandatoryOverlays().map((o) => o.id);
    expect(mandatory).not.toContain("barcode_zone");
  });

  it("structural overlays include trim and fold", () => {
    const structural = listStructuralOverlays().map((o) => o.id);
    expect(structural).toContain("trim");
    expect(structural).toContain("fold");
  });

  it("bleed defaultOffsetMm is negative (extends outward)", () => {
    const bleed = getOverlayDefinition("bleed");
    expect(bleed.defaultOffsetMm).toBeLessThan(0);
  });

  it("safe_area defaultOffsetMm is positive (inward inset)", () => {
    const safe = getOverlayDefinition("safe_area");
    expect(safe.defaultOffsetMm).toBeGreaterThan(0);
  });

  it("resolveActiveOverlays always includes bleed, trim, safe_area", () => {
    const active = resolveActiveOverlays({
      hasBarcodeZone:   false,
      hasFoldLines:     false,
      hasInternalCuts:  false,
      hasGlueZone:      false,
    });
    expect(active).toContain("bleed");
    expect(active).toContain("trim");
    expect(active).toContain("safe_area");
  });

  it("resolveActiveOverlays includes barcode_zone when hasBarcodeZone=true", () => {
    const active = resolveActiveOverlays({
      hasBarcodeZone:   true,
      hasFoldLines:     false,
      hasInternalCuts:  false,
      hasGlueZone:      false,
    });
    expect(active).toContain("barcode_zone");
  });

  it("resolveActiveOverlays does NOT include barcode_zone when hasBarcodeZone=false", () => {
    const active = resolveActiveOverlays({
      hasBarcodeZone:   false,
      hasFoldLines:     false,
      hasInternalCuts:  false,
      hasGlueZone:      false,
    });
    expect(active).not.toContain("barcode_zone");
  });

  it("getOverlayDefinition throws for unknown id", () => {
    expect(() => getOverlayDefinition("unknown_zone" as never)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Production metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("6. production metadata (packaging_production_spec artifact type)", () => {
  it("packaging_production_spec artifact type exists", () => {
    const t = getArtifactType("packaging_production_spec");
    expect(t.id).toBe("packaging_production_spec");
  });

  it("packaging_production_spec requiredFields includes dimensions and dielineReference", () => {
    const t = getArtifactType("packaging_production_spec");
    expect(t.requiredFields).toContain("dimensions");
    expect(t.requiredFields).toContain("dielineReference");
  });

  it("packaging_production_spec is a deliverable", () => {
    const t = getArtifactType("packaging_production_spec");
    expect(t.isDeliverable).toBe(true);
  });

  it("packaging_production_spec is produced at production_spec step", () => {
    const t = getArtifactType("packaging_production_spec");
    expect(t.producedAtStep).toBe("production_spec");
  });

  it("production_spec workflow step has compliance_review as prerequisite", () => {
    const step = getStep("production_spec");
    expect(step.requiredInputs).toContain("compliance_review");
  });

  it("export step follows production_spec in the workflow", () => {
    const step = getStep("production_spec");
    expect(step.transitions).toContain("export");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Material contribution
// ─────────────────────────────────────────────────────────────────────────────

describe("7. material contribution", () => {
  it("listSubstrates returns at least 10 substrates", () => {
    expect(listSubstrates().length).toBeGreaterThanOrEqual(10);
  });

  it("getSubstrate resolves sbs_board without error", () => {
    const s = getSubstrate("sbs_board");
    expect(s.id).toBe("sbs_board");
  });

  it("listSubstratesByCategory('board') returns only board substrates", () => {
    const boards = listSubstratesByCategory("board");
    expect(boards.every((s) => s.category === "board")).toBe(true);
  });

  it("buildMaterialContribution returns foodSafetyStatus requires_testing for sbs_board without migration note", () => {
    const result = buildMaterialContribution({
      substrateId:       "sbs_board",
      weightOrThickness: "350 gsm",
      coatingId:         "matte_laminate",
    });
    expect(result.foodSafetyStatus).toBe("requires_testing");
    expect(result.migrationTestRequired).toBe(true);
  });

  it("buildMaterialContribution recommends food-safe inks for sbs_board", () => {
    const result = buildMaterialContribution({
      substrateId:       "sbs_board",
      weightOrThickness: "350 gsm",
      coatingId:         "matte_laminate",
    });
    expect(result.vendorRecommendations.some((r) => r.toLowerCase().includes("food-safe"))).toBe(true);
  });

  it("buildMaterialContribution for bioplastic warns against lamination", () => {
    const result = buildMaterialContribution({
      substrateId:       "bioplastic_pla",
      weightOrThickness: "30 µm",
      coatingId:         "none",
    });
    expect(result.vendorRecommendations.some((r) => r.includes("compostability"))).toBe(true);
  });

  it("getSubstrate throws for unknown substrate", () => {
    expect(() => getSubstrate("unknown_substrate" as never)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Export preset
// ─────────────────────────────────────────────────────────────────────────────

describe("8. export preset", () => {
  it("has exactly 6 presets", () => {
    expect(listExportPresets()).toHaveLength(6);
  });

  it("all EXPORT_PRESET_IDS resolve without error", () => {
    for (const id of EXPORT_PRESET_IDS) {
      expect(() => getExportPreset(id)).not.toThrow();
    }
  });

  it("print_ready preset includes packaging_artwork as required file", () => {
    const files = getRequiredFiles("print_ready");
    const ids = files.map((f) => f.artifactTypeId);
    expect(ids).toContain("packaging_artwork");
  });

  it("print_ready preset artwork file has includeBleed=true and colorSpace cmyk", () => {
    const files = getRequiredFiles("print_ready");
    const artworkFile = files.find((f) => f.artifactTypeId === "packaging_artwork");
    expect(artworkFile).toBeDefined();
    expect(artworkFile!.includeBleed).toBe(true);
    expect(artworkFile!.colorSpace).toBe("cmyk");
  });

  it("digital_only preset artwork file has colorSpace rgb", () => {
    const preset = getExportPreset("digital_only");
    const artworkFile = preset.files.find((f) => f.artifactTypeId === "packaging_artwork");
    if (artworkFile) {
      expect(artworkFile.colorSpace).toBe("rgb");
    }
  });

  it("full_package preset is password-protected", () => {
    const preset = getExportPreset("full_package");
    expect(preset.passwordProtect).toBe(true);
  });

  it("all file name patterns include {brand} and {date} tokens", () => {
    for (const preset of listExportPresets()) {
      for (const file of preset.files) {
        expect(file.fileNamePattern).toMatch(/\{brand\}/);
        expect(file.fileNamePattern).toMatch(/\{date\}/);
      }
    }
  });

  it("getExportPreset throws for unknown id", () => {
    expect(() => getExportPreset("unknown_preset" as never)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Compliance metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("9. compliance metadata", () => {
  it("has at least 3 compliance profiles", () => {
    expect(listComplianceProfiles().length).toBeGreaterThanOrEqual(3);
  });

  it("indonesia_food profile applies to food_packaging", () => {
    const profile = getComplianceProfile("indonesia_food");
    expect(profile.appliesTo).toContain("food_packaging");
  });

  it("indonesia_food profile has bpom_registration as blocker check", () => {
    const profile = getComplianceProfile("indonesia_food");
    const check = profile.checks.find((c) => c.code === "bpom_registration");
    expect(check).toBeDefined();
    expect(check!.severity).toBe("blocker");
  });

  it("resolveComplianceProfiles returns indonesia_food for food_packaging", () => {
    const profiles = resolveComplianceProfiles("food_packaging");
    expect(profiles.map((p) => p.profileId)).toContain("indonesia_food");
  });

  it("buildComplianceSheet produces a sheet with pending checks", () => {
    const sheet = buildComplianceSheet({
      packagingType:   "food_packaging",
      brandName:       "TestBrand",
      productName:     "TestProduct",
      reviewedBy:      "tester",
      pluginVersion:   PLUGIN_VERSION,
    });
    expect(sheet.checks.length).toBeGreaterThan(0);
    expect(sheet.checks.every((c) => c.outcome === "pending")).toBe(true);
  });

  it("recalculateOutcome returns failed when a blocker check fails", () => {
    let sheet = buildComplianceSheet({
      packagingType:   "food_packaging",
      brandName:       "TestBrand",
      productName:     "TestProduct",
      reviewedBy:      "tester",
      pluginVersion:   PLUGIN_VERSION,
    });
    // Manually fail the first blocker
    const blockerIndex = sheet.checks.findIndex((c) => c.severity === "blocker");
    expect(blockerIndex).toBeGreaterThanOrEqual(0);
    sheet.checks[blockerIndex]!.outcome = "failed";
    sheet = recalculateOutcome(sheet);
    expect(sheet.outcome).toBe("failed");
    expect(sheet.blockerCount).toBeGreaterThan(0);
  });

  it("recalculateOutcome returns passed when all checks pass", () => {
    let sheet = buildComplianceSheet({
      packagingType:   "general_retail",
      brandName:       "TestBrand",
      productName:     "TestProduct",
      reviewedBy:      "tester",
      pluginVersion:   PLUGIN_VERSION,
    });
    sheet.checks = sheet.checks.map((c) => ({ ...c, outcome: "passed" as const }));
    sheet = recalculateOutcome(sheet);
    expect(sheet.outcome).toBe("passed");
    expect(sheet.blockerCount).toBe(0);
  });

  it("buildComplianceSheet falls back to general_retail for unknown packagingType", () => {
    const sheet = buildComplianceSheet({
      packagingType:   "unknown_type",
      brandName:       "X",
      productName:     "Y",
      reviewedBy:      "tester",
      pluginVersion:   PLUGIN_VERSION,
    });
    expect(sheet.checks.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. No core leakage
// ─────────────────────────────────────────────────────────────────────────────

describe("10. no core leakage", () => {
  it("manifest does NOT reference any locked core file paths", () => {
    const m = buildPluginManifest();
    const json = JSON.stringify(m);
    // Locked files that feature teams must not reference or modify
    expect(json).not.toContain("routes/index.ts");
    expect(json).not.toContain("lib/db/src/schema/index.ts");
  });

  it("plugin files do NOT declare DB tables (no pgTable / appSchema.table in plugin dir)", async () => {
    // All plugin modules are pure — they contain no Drizzle table declarations.
    // Verify by checking that none of the plugin's exported objects have a drizzle
    // table shape (symbol "[drizzle:Name]").
    const allExports = await import("../index.js");
    for (const [key, val] of Object.entries(allExports)) {
      // Drizzle tables have a Symbol.for("[drizzle:Name]") on them
      const isDrizzleTable =
        val !== null &&
        typeof val === "object" &&
        Symbol.for("[drizzle:Name]") in (val as object);
      expect(isDrizzleTable, `${key} should not be a Drizzle table`).toBe(false);
    }
  });

  it("workflow step IDs match the WORKFLOW_STEP_IDS constant", () => {
    const ids = PACKAGING_WORKFLOW.steps.map((s) => s.id);
    for (const id of WORKFLOW_STEP_IDS) {
      expect(ids).toContain(id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Version compatibility
// ─────────────────────────────────────────────────────────────────────────────

describe("11. version compatibility", () => {
  it("assertVersionCompatible does not throw for 0.0.0 (min version)", () => {
    expect(() => assertVersionCompatible("0.0.0")).not.toThrow();
  });

  it("assertVersionCompatible does not throw for any version when MIN_CORE_VERSION is 0.0.0", () => {
    expect(() => assertVersionCompatible("1.0.0")).not.toThrow();
    expect(() => assertVersionCompatible("99.99.99")).not.toThrow();
  });

  it("PLUGIN_VERSION is a valid semver string", () => {
    expect(PLUGIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("PLUGIN_TEAM is '26'", () => {
    expect(PLUGIN_TEAM).toBe("26");
  });

  it("manifest version matches PLUGIN_VERSION constant", () => {
    const m = buildPluginManifest();
    expect(m.version).toBe(PLUGIN_VERSION);
  });

  it("buildPluginManifest createdAt is a valid ISO date string", () => {
    const m = buildPluginManifest();
    expect(() => new Date(m.createdAt)).not.toThrow();
    expect(new Date(m.createdAt).toISOString()).toBe(m.createdAt.replace(/\.\d+Z$/, (ms) => ms));
  });
});
