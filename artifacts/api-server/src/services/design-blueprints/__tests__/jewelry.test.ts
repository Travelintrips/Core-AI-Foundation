/**
 * Jewelry Design Domain Plugin Tests — Team 30
 *
 * Required test coverage (per spec):
 *   ✓ manifest          — blueprint has all required fields and correct identity
 *   ✓ brief             — requiredData covers all brief fields from the spec
 *   ✓ workflow          — all 11 workflow stages documented in domainSpecific
 *   ✓ artifact registry — all 8 artifact types declared in domainSpecific
 *   ✓ material contribution — 7 material metadata fields present
 *   ✓ component contribution — 7 component types declared
 *   ✓ technical metadata — annotation slots with mm unit exist
 *   ✓ estimation honesty — purity/dimension/weight fields use "estimated" labels
 *   ✓ no certification claims — noCertificationClaims: true
 *   ✓ no core leakage — blueprint is self-contained; domain registered in types
 *   ✓ compatibility — blueprint passes validator and service compatibility check
 */

import { describe, it, expect, beforeEach } from "vitest";
import { jewelryBlueprint } from "../blueprints/jewelry.js";
import { BLUEPRINT_DOMAINS } from "../types.js";
import { createBlueprintService } from "../index.js";
import { InMemoryBlueprintRepository } from "../repository/InMemoryBlueprintRepository.js";
import { validateBlueprint } from "../blueprintValidator.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService() {
  return createBlueprintService(new InMemoryBlueprintRepository());
}

const ds = jewelryBlueprint.constraints.domainSpecific as Record<string, unknown>;

// ── Manifest ─────────────────────────────────────────────────────────────────

describe("manifest", () => {
  it("has the correct id and slug", () => {
    expect(jewelryBlueprint.id).toBe("bp-jewelry-v1");
    expect(jewelryBlueprint.slug).toBe("jewelry-design-standard");
  });

  it("domain is 'jewelry'", () => {
    expect(jewelryBlueprint.domain).toBe("jewelry");
  });

  it("schemaVersion is '1.0'", () => {
    expect(jewelryBlueprint.schemaVersion).toBe("1.0");
  });

  it("has a non-empty name and description", () => {
    expect(jewelryBlueprint.name.length).toBeGreaterThan(0);
    expect(jewelryBlueprint.description.length).toBeGreaterThan(0);
  });

  it("status is 'active'", () => {
    expect(jewelryBlueprint.status).toBe("active");
  });

  it("version follows semver", () => {
    expect(jewelryBlueprint.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("dimensions are valid (positive width, height, 300 DPI)", () => {
    expect(jewelryBlueprint.dimensions.width).toBeGreaterThan(0);
    expect(jewelryBlueprint.dimensions.height).toBeGreaterThan(0);
    expect(jewelryBlueprint.dimensions.dpi).toBe(300);
    expect(jewelryBlueprint.dimensions.unit).toBe("px");
  });

  it("has at least one industry tag and one style tag", () => {
    expect(jewelryBlueprint.industryTags).toContain("jewelry");
    expect(jewelryBlueprint.styleTags.length).toBeGreaterThan(0);
  });

  it("createdAt and updatedAt are ISO 8601 strings", () => {
    expect(() => new Date(jewelryBlueprint.createdAt)).not.toThrow();
    expect(() => new Date(jewelryBlueprint.updatedAt)).not.toThrow();
    expect(new Date(jewelryBlueprint.createdAt).toISOString()).toBe(jewelryBlueprint.createdAt);
    expect(new Date(jewelryBlueprint.updatedAt).toISOString()).toBe(jewelryBlueprint.updatedAt);
  });
});

// ── Brief ─────────────────────────────────────────────────────────────────────

describe("brief", () => {
  it("requiredData has jewelryType field (enum)", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "jewelryType");
    expect(field).toBeDefined();
    expect(field!.type).toBe("enum");
    expect(field!.required).toBe(true);
    expect(field!.allowedValues).toContain("ring");
    expect(field!.allowedValues).toContain("necklace");
  });

  it("requiredData has targetWearer field (string, required)", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "targetWearer");
    expect(field).toBeDefined();
    expect(field!.type).toBe("string");
    expect(field!.required).toBe(true);
  });

  it("requiredData has occasion field (enum)", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "occasion");
    expect(field).toBeDefined();
    expect(field!.type).toBe("enum");
    expect(field!.allowedValues).toContain("wedding");
    expect(field!.allowedValues).toContain("everyday");
  });

  it("requiredData has style field (enum)", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "style");
    expect(field).toBeDefined();
    expect(field!.type).toBe("enum");
  });

  it("requiredData has metalPreference field (enum)", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "metalPreference");
    expect(field).toBeDefined();
    expect(field!.type).toBe("enum");
    expect(field!.allowedValues).toContain("platinum");
    expect(field!.allowedValues).toContain("silver");
  });

  it("requiredData has stonePreference field (string, optional)", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "stonePreference");
    expect(field).toBeDefined();
    expect(field!.type).toBe("string");
    expect(field!.required).toBe(false);
  });

  it("requiredData has finish field (enum)", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "finish");
    expect(field).toBeDefined();
    expect(field!.allowedValues).toContain("polished");
    expect(field!.allowedValues).toContain("matte");
  });

  it("requiredData has budgetRange field", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "budgetRange");
    expect(field).toBeDefined();
    expect(field!.required).toBe(false);
  });

  it("requiredData has productionMethod field", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "productionMethod");
    expect(field).toBeDefined();
    expect(field!.type).toBe("enum");
    expect(field!.allowedValues).toContain("handcrafted");
    expect(field!.allowedValues).toContain("cast");
  });

  it("requiredData has personalization field", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "personalization");
    expect(field).toBeDefined();
    expect(field!.type).toBe("string");
  });

  it("requiredData has sustainabilityPreference field (boolean)", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "sustainabilityPreference");
    expect(field).toBeDefined();
    expect(field!.type).toBe("boolean");
  });

  it("requiredData has safetyConstraints field", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "safetyConstraints");
    expect(field).toBeDefined();
    expect(field!.type).toBe("string");
  });

  it("estimated dimension fields (estimatedWidthMm, estimatedHeightMm) are optional and numeric", () => {
    const w = jewelryBlueprint.requiredData.find((f) => f.key === "estimatedWidthMm");
    const h = jewelryBlueprint.requiredData.find((f) => f.key === "estimatedHeightMm");
    expect(w).toBeDefined();
    expect(h).toBeDefined();
    expect(w!.type).toBe("number");
    expect(h!.type).toBe("number");
    expect(w!.required).toBe(false);
    expect(h!.required).toBe(false);
  });
});

// ── Workflow ──────────────────────────────────────────────────────────────────

describe("workflow", () => {
  const stages = ds.workflowStages as string[];

  it("declares exactly 11 workflow stages", () => {
    expect(stages).toHaveLength(11);
  });

  it("includes 'brief' as the first stage", () => {
    expect(stages[0]).toBe("brief");
  });

  it("includes all required stages", () => {
    const required = [
      "brief",
      "reference_research",
      "style_direction",
      "concept_sketch",
      "form_development",
      "material_gem_direction",
      "technical_view",
      "visualization",
      "production_specification",
      "review",
      "export",
    ];
    for (const stage of required) {
      expect(stages).toContain(stage);
    }
  });
});

// ── Artifact Registry ─────────────────────────────────────────────────────────

describe("artifact registry", () => {
  const artifactTypes = ds.artifactTypes as string[];

  it("declares exactly 8 artifact types", () => {
    expect(artifactTypes).toHaveLength(8);
  });

  it("includes all required artifact types", () => {
    const required = [
      "jewelry_moodboard",
      "jewelry_concept_sketch",
      "jewelry_form_study",
      "jewelry_material_gem_board",
      "jewelry_technical_view",
      "jewelry_visualization",
      "jewelry_production_spec",
      "jewelry_presentation",
    ];
    for (const t of required) {
      expect(artifactTypes).toContain(t);
    }
  });

  it("all artifact types are prefixed with 'jewelry_'", () => {
    for (const t of artifactTypes) {
      expect(t).toMatch(/^jewelry_/);
    }
  });
});

// ── Material Contribution ─────────────────────────────────────────────────────

describe("material contribution", () => {
  const materialFields = ds.materialFields as string[];

  it("declares all 7 material metadata fields", () => {
    const required = [
      "metalType",
      "purityLabel",
      "finish",
      "stoneCategory",
      "settingType",
      "estimatedDimensions",
      "estimatedWeight",
    ];
    for (const f of required) {
      expect(materialFields).toContain(f);
    }
  });

  it("has a material spec slot of type 'text' in material-gem zone", () => {
    const zone = jewelryBlueprint.zones.find((z) => z.id === "z-material-gem");
    expect(zone).toBeDefined();
    expect(zone!.slotRefs).toContain("s-material-spec");
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-material-spec");
    expect(slot).toBeDefined();
    expect(slot!.type).toBe("text");
  });

  it("has a metal color swatch slot of type 'color_swatch'", () => {
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-metal-swatch");
    expect(slot).toBeDefined();
    expect(slot!.type).toBe("color_swatch");
    expect(slot!.required).toBe(true);
  });

  it("has a gem/stone image slot", () => {
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-gem-image");
    expect(slot).toBeDefined();
    expect(slot!.type).toBe("image");
  });

  it("production spec table slot exists and is data_table type", () => {
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-production-table");
    expect(slot).toBeDefined();
    expect(slot!.type).toBe("data_table");
    expect(slot!.required).toBe(true);
  });
});

// ── Component Contribution ────────────────────────────────────────────────────

describe("component contribution", () => {
  const components = ds.componentContributions as string[];

  it("declares all 7 component types", () => {
    const required = [
      "band",
      "setting",
      "clasp",
      "chain",
      "pendant",
      "stone-seat",
      "decorative-element",
    ];
    for (const c of required) {
      expect(components).toContain(c);
    }
  });

  it("component-list slot exists in technical-view zone", () => {
    const zone = jewelryBlueprint.zones.find((z) => z.id === "z-technical-view");
    expect(zone).toBeDefined();
    expect(zone!.slotRefs).toContain("s-component-list");
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-component-list");
    expect(slot).toBeDefined();
    expect(slot!.type).toBe("text");
    expect(slot!.required).toBe(true);
  });

  it("setting-detail image slot exists in production-spec zone", () => {
    const zone = jewelryBlueprint.zones.find((z) => z.id === "z-production-spec");
    expect(zone).toBeDefined();
    expect(zone!.slotRefs).toContain("s-setting-detail");
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-setting-detail");
    expect(slot).toBeDefined();
    expect(slot!.type).toBe("image");
  });
});

// ── Technical Metadata ────────────────────────────────────────────────────────

describe("technical metadata", () => {
  it("dimension annotation slot exists with unit 'mm'", () => {
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-dimension-annotation");
    expect(slot).toBeDefined();
    expect(slot!.type).toBe("annotation");
    expect(slot!.constraints.unit).toBe("mm");
  });

  it("dimension annotation slot is in the technical-view zone", () => {
    const zone = jewelryBlueprint.zones.find((z) => z.id === "z-technical-view");
    expect(zone!.slotRefs).toContain("s-dimension-annotation");
  });

  it("technical-drawing slot supports SVG and AI formats", () => {
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-technical-drawing");
    expect(slot).toBeDefined();
    expect(slot!.constraints.allowedFormats).toContain("svg");
    expect(slot!.constraints.allowedFormats).toContain("ai");
  });

  it("defaultUnit in domainSpecific is 'mm'", () => {
    expect(ds.defaultUnit).toBe("mm");
  });

  it("annotation-tool component is in supportedComponents", () => {
    const comp = jewelryBlueprint.supportedComponents.find((c) => c.type === "annotation-tool");
    expect(comp).toBeDefined();
    expect(comp!.fillsSlotTypes).toContain("annotation");
  });

  it("blueprint has PDF and SVG output capabilities", () => {
    const formats = jewelryBlueprint.outputCapabilities.map((o) => o.format);
    expect(formats).toContain("pdf");
    expect(formats).toContain("svg");
  });

  it("PDF output has bleed margin specified", () => {
    const pdf = jewelryBlueprint.outputCapabilities.find((o) => o.format === "pdf");
    expect(pdf).toBeDefined();
    expect(typeof pdf!.bleedMm).toBe("number");
    expect(pdf!.bleedMm).toBeGreaterThan(0);
  });
});

// ── Estimation Honesty ────────────────────────────────────────────────────────

describe("estimation honesty", () => {
  it("allDimensionsEstimated is true", () => {
    expect(ds.allDimensionsEstimated).toBe(true);
  });

  it("allWeightsEstimated is true", () => {
    expect(ds.allWeightsEstimated).toBe(true);
  });

  it("estimationDisclaimer is a non-empty string", () => {
    expect(typeof ds.estimationDisclaimer).toBe("string");
    expect((ds.estimationDisclaimer as string).length).toBeGreaterThan(50);
  });

  it("material-spec slot description contains 'ESTIMATED'", () => {
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-material-spec");
    expect(slot!.description?.toUpperCase()).toContain("ESTIMATED");
  });

  it("weight-spec slot description contains 'ESTIMATED'", () => {
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-weight-spec");
    expect(slot!.description?.toUpperCase()).toContain("ESTIMATED");
  });

  it("dimension annotation slot description contains 'ESTIMATED'", () => {
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-dimension-annotation");
    expect(slot!.description?.toUpperCase()).toContain("ESTIMATED");
  });

  it("estimatedWidthMm and estimatedHeightMm required-data labels contain 'Estimated'", () => {
    const w = jewelryBlueprint.requiredData.find((f) => f.key === "estimatedWidthMm");
    const h = jewelryBlueprint.requiredData.find((f) => f.key === "estimatedHeightMm");
    expect(w!.label).toContain("Estimated");
    expect(h!.label).toContain("Estimated");
  });

  it("estimationDisclaimer contains 'not validated by CAD'", () => {
    const disclaimer = ds.estimationDisclaimer as string;
    expect(disclaimer.toLowerCase()).toContain("not validated by cad");
  });
});

// ── No Certification Claims ───────────────────────────────────────────────────

describe("no certification claims", () => {
  it("noCertificationClaims is explicitly true", () => {
    expect(ds.noCertificationClaims).toBe(true);
  });

  it("gem-image slot description disclaims certification", () => {
    const slot = jewelryBlueprint.slots.find((s) => s.id === "s-gem-image");
    expect(slot!.description?.toLowerCase()).toContain("not constitute gemological certification");
  });

  it("stonePreference field description disclaims certification", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "stonePreference");
    expect(field!.description?.toLowerCase()).toContain("certification");
  });

  it("blueprint description does not contain 'certified' or 'certificate'", () => {
    const desc = jewelryBlueprint.description.toLowerCase();
    expect(desc).not.toContain("certified");
    expect(desc).not.toContain("certificate");
  });

  it("budgetRange description does not claim binding cost estimate", () => {
    const field = jewelryBlueprint.requiredData.find((f) => f.key === "budgetRange");
    expect(field!.description?.toLowerCase()).toContain("not a binding cost estimate");
  });
});

// ── No Core Leakage ───────────────────────────────────────────────────────────

describe("no core leakage", () => {
  it("'jewelry' is registered in BLUEPRINT_DOMAINS type constant", () => {
    expect(BLUEPRINT_DOMAINS).toContain("jewelry");
  });

  it("blueprint domain field matches the registered domain", () => {
    expect(jewelryBlueprint.domain).toBe("jewelry");
    // BLUEPRINT_DOMAINS is a readonly tuple; the type accepts 'jewelry'
    const domain: (typeof BLUEPRINT_DOMAINS)[number] = "jewelry";
    expect(domain).toBe(jewelryBlueprint.domain);
  });

  it("plugin team marker is present in domainSpecific", () => {
    expect(ds.pluginTeam).toBe("team-30");
  });

  it("all slot IDs are unique within the blueprint", () => {
    const ids = jewelryBlueprint.slots.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all zone IDs are unique within the blueprint", () => {
    const ids = jewelryBlueprint.zones.map((z) => z.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all zone slotRefs point to existing slot IDs", () => {
    const slotIds = new Set(jewelryBlueprint.slots.map((s) => s.id));
    for (const zone of jewelryBlueprint.zones) {
      for (const ref of zone.slotRefs) {
        expect(slotIds.has(ref)).toBe(true);
      }
    }
  });

  it("requiredZoneIds all point to existing zone IDs", () => {
    const zoneIds = new Set(jewelryBlueprint.zones.map((z) => z.id));
    const required = jewelryBlueprint.constraints.requiredZoneIds ?? [];
    for (const id of required) {
      expect(zoneIds.has(id)).toBe(true);
    }
  });
});

// ── Compatibility ─────────────────────────────────────────────────────────────

describe("compatibility", () => {
  it("blueprint passes the validator with no errors", () => {
    const result = validateBlueprint(jewelryBlueprint);
    expect(result.valid).toBe(true);
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("is retrievable by id via the service (registered in BUILTIN_BLUEPRINTS)", async () => {
    const service = makeService();
    const bp = await service.getBlueprintById("bp-jewelry-v1");
    expect(bp).not.toBeNull();
    expect(bp!.domain).toBe("jewelry");
  });

  it("is retrievable by slug via the service", async () => {
    const service = makeService();
    const bp = await service.getBlueprintBySlug("jewelry-design-standard");
    expect(bp).not.toBeNull();
    expect(bp!.id).toBe("bp-jewelry-v1");
  });

  it("is retrievable by domain via the service", async () => {
    const service = makeService();
    const blueprints = await service.getBlueprintsByDomain("jewelry");
    expect(blueprints.length).toBeGreaterThanOrEqual(1);
    expect(blueprints.some((b) => b.id === "bp-jewelry-v1")).toBe(true);
  });

  it("passes compatibility check with all declared supportedComponents", async () => {
    const service = makeService();
    const result = await service.checkBlueprintCompatibility({
      blueprintId: "bp-jewelry-v1",
      schemaVersion: "1.0",
      componentTypes: [
        "image-picker",
        "color-picker",
        "annotation-tool",
        "rich-text-editor",
        "data-table-editor",
      ],
    });
    expect(result.blueprintNotFound).toBeFalsy();
    expect(result.compatible).toBe(true);
  });

  it("includes jewelry in getBlueprintStats byDomain", async () => {
    const service = makeService();
    const stats = await service.getBlueprintStats();
    expect(stats.byDomain["jewelry"]).toBeGreaterThanOrEqual(1);
  });

  it("filters by domain='jewelry' returns only jewelry blueprints", async () => {
    const service = makeService();
    const results = await service.listBlueprints({ domain: "jewelry" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((b) => b.domain === "jewelry")).toBe(true);
  });

  it("normalizeBlueprintPayload is idempotent for jewelry blueprint", () => {
    const service = makeService();
    const r1 = service.normalizeBlueprintPayload(jewelryBlueprint);
    expect(r1.valid).toBe(true);
    const r2 = service.normalizeBlueprintPayload(r1.blueprint);
    expect(r2.changes).toHaveLength(0);
  });
});
