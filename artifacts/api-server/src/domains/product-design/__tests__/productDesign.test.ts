/**
 * product-design — Domain Test Suite
 *
 * Covers all 10 required test dimensions:
 *   1.  Dimensions metadata validation
 *   2.  Component placement bounds
 *   3.  Variant consistency
 *   4.  Unsupported manufacturing claim rejection
 *   5.  Customer-safe disclaimers always present
 *   6.  CMF validation
 *   7.  Manufacturer brief building
 *   8.  Mockup composition (layer z-order via null ports)
 *   9.  Label area bounds
 *  10.  Form + material co-validation (process hint inference)
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import { describe, it, expect, beforeEach } from "vitest";

// Types
import type { ProductConcept } from "../types/concept";
import { CONCEPT_DISCLAIMER } from "../types/concept";

// Services
import { validateDimensions, assertValidDimensions } from "../services/dimensionsValidator";
import {
  validateFeaturePlacement,
  validateLabelArea,
  validateAllPlacements,
} from "../services/componentPlacer";
import { validateCMFSpec, validateCMFEntry } from "../services/cmfValidator";
import {
  assertNoUnsupportedClaims,
  guardAgainstUnsupportedClaims,
  getConceptDisclaimer,
  injectDisclaimer,
  assertDisclaimerPresent,
  listUnsupportedClaimViolations,
} from "../services/disclaimerService";
import { checkVariantConsistency } from "../services/variantConsistencyChecker";
import { buildManufacturerBrief } from "../services/manufacturerBriefBuilder";
import { composeMockup } from "../services/mockupComposer";
import { NullBlueprintPort }   from "../services/ports/nullBlueprintPort";
import { NullCompositionPort } from "../services/ports/nullCompositionPort";
import { LAYER_ZINDEX } from "../types/mockup";

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeBaseConcept(overrides: Partial<ProductConcept> = {}): ProductConcept {
  return {
    id:        "concept-001",
    name:      "Serum Bottle v3",
    projectId: "project-abc",
    status:    "draft",
    formDirection: {
      category:   "bottle",
      dimensions: { height: 150, width: 40 },
      shapeNotes: "Slim cylindrical form with tapered shoulder",
    },
    materialDirection: {
      primaryMaterial:   "glass",
      secondaryMaterial: "pp_plastic",
    },
    cmf: {
      entries: [
        { colorCode: "#1A1A2E", colorName: "Midnight Navy", material: "glass",      finish: "matte", zone: "body" },
        { colorCode: "#C0C0C0", colorName: "Silver Mist",   material: "pp_plastic", finish: "chrome", zone: "cap" },
      ],
      isComplete: true,
    },
    featurePlacements: [
      {
        id:               "fp-pump",
        label:            "Pump dispenser",
        anchor:           "top",
        relativePosition: { x: 0.5, y: 0.95, z: 0.5 },
        footprintMm:      { width: 20, height: 30 },
      },
    ],
    labelAreas: [
      {
        id:           "la-front",
        name:         "Front panel",
        anchor:       "front",
        printAreaMm:  { width: 35, height: 80 },
        safeMarginMm: 3,
        wrapFraction: 0.4,
      },
    ],
    disclaimer: CONCEPT_DISCLAIMER,
    createdAt:  new Date("2026-01-01"),
    updatedAt:  new Date("2026-01-01"),
    version:    1,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DIMENSIONS METADATA VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("1. Dimensions metadata validation", () => {
  it("accepts valid bottle dimensions", () => {
    const result = validateDimensions({ height: 150, width: 40 }, "bottle");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects negative height", () => {
    const result = validateDimensions({ height: -10, width: 40 }, "bottle");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("height"))).toBe(true);
  });

  it("rejects zero width", () => {
    const result = validateDimensions({ height: 150, width: 0 }, "bottle");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("width"))).toBe(true);
  });

  it("rejects unrealistically thick wall", () => {
    const result = validateDimensions(
      { height: 100, width: 40, wallThickness: 25 },
      "jar",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("wallThickness"))).toBe(true);
  });

  it("warns when height/width ratio is unusual for the form category", () => {
    // A compact should have a low ratio; 150/10 = 15 (too high)
    const result = validateDimensions({ height: 150, width: 10 }, "compact");
    expect(result.warnings.some((w) => w.includes("ratio"))).toBe(true);
  });

  it("assertValidDimensions throws on invalid, returns result on valid", () => {
    expect(() =>
      assertValidDimensions({ height: -5, width: 30 }, "jar"),
    ).toThrow();
    expect(() =>
      assertValidDimensions({ height: 80, width: 60 }, "jar"),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. COMPONENT PLACEMENT BOUNDS
// ─────────────────────────────────────────────────────────────────────────────

describe("2. Component placement bounds", () => {
  it("accepts a valid feature placement within [0,1]", () => {
    const result = validateFeaturePlacement({
      id:               "fp-1",
      label:            "Pump",
      anchor:           "top",
      relativePosition: { x: 0.5, y: 0.9 },
      footprintMm:      { width: 15, height: 20 },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects relativePosition.x > 1", () => {
    const result = validateFeaturePlacement({
      id:               "fp-2",
      label:            "Cap",
      anchor:           "top",
      relativePosition: { x: 1.5, y: 0.9 },
      footprintMm:      { width: 10, height: 10 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("relativePosition.x"))).toBe(true);
  });

  it("rejects relativePosition.y < 0", () => {
    const result = validateFeaturePlacement({
      id:               "fp-3",
      label:            "Base ring",
      anchor:           "bottom",
      relativePosition: { x: 0.5, y: -0.1 },
      footprintMm:      { width: 10, height: 5 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("relativePosition.y"))).toBe(true);
  });

  it("rejects zero-width footprint", () => {
    const result = validateFeaturePlacement({
      id:               "fp-4",
      label:            "Logo emboss",
      anchor:           "front",
      relativePosition: { x: 0.5, y: 0.5 },
      footprintMm:      { width: 0, height: 20 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("footprintMm.width"))).toBe(true);
  });

  it("validateAllPlacements reports errors from all features and labels", () => {
    const dims = { height: 150, width: 40 };
    const result = validateAllPlacements(
      [
        {
          id:               "fp-bad",
          label:            "Bad",
          anchor:           "top",
          relativePosition: { x: 2.0, y: 0.5 }, // invalid
          footprintMm:      { width: 10, height: 10 },
        },
      ],
      [
        {
          id:           "la-bad",
          name:         "Giant Label",
          anchor:       "front",
          printAreaMm:  { width: 200, height: 300 }, // exceeds form
          safeMarginMm: 0,
        },
      ],
      dims,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. VARIANT CONSISTENCY
// ─────────────────────────────────────────────────────────────────────────────

describe("3. Variant consistency", () => {
  it("single CMF delta is consistent", () => {
    const result = checkVariantConsistency({
      id:            "v-001",
      baseConceptId: "concept-001",
      name:          "Variant A — Rose Gold",
      deltas: [
        {
          axis:        "cmf",
          description: "Change cap color to rose gold",
          patch:       { "cmf.entries[1].colorCode": "#B76E79" },
        },
      ],
      disclaimer: CONCEPT_DISCLAIMER,
      createdAt:  new Date(),
    });
    expect(result.consistent).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.axesChanged).toContain("cmf");
  });

  it("empty deltas array is inconsistent", () => {
    const result = checkVariantConsistency({
      id:            "v-002",
      baseConceptId: "concept-001",
      name:          "Empty variant",
      deltas:        [],
      disclaimer:    CONCEPT_DISCLAIMER,
      createdAt:     new Date(),
    });
    expect(result.consistent).toBe(false);
    expect(result.issues.some((i) => i.includes("at least one delta"))).toBe(true);
  });

  it("form category change is an inconsistency", () => {
    const result = checkVariantConsistency({
      id:            "v-003",
      baseConceptId: "concept-001",
      name:          "Changed to jar",
      deltas: [
        {
          axis:        "form",
          description: "Switch from bottle to jar",
          patch:       { "formDirection.category": "jar" },
        },
      ],
      disclaimer: CONCEPT_DISCLAIMER,
      createdAt:  new Date(),
    });
    expect(result.consistent).toBe(false);
    expect(result.issues.some((i) => i.includes("form category"))).toBe(true);
  });

  it("multiple structural axes produces multipleStructuralAxes flag", () => {
    const result = checkVariantConsistency({
      id:            "v-004",
      baseConceptId: "concept-001",
      name:          "Material + Form change",
      deltas: [
        {
          axis:        "form",
          description: "Wider shoulder",
          patch:       { "formDirection.dimensions.width": 50 },
        },
        {
          axis:        "material",
          description: "Switch to aluminum",
          patch:       { "materialDirection.primaryMaterial": "aluminum" },
        },
      ],
      disclaimer: CONCEPT_DISCLAIMER,
      createdAt:  new Date(),
    });
    expect(result.multipleStructuralAxes).toBe(true);
    expect(result.notes.some((n) => n.includes("structural axes"))).toBe(true);
  });

  it("label and feature deltas together are consistent", () => {
    const result = checkVariantConsistency({
      id:            "v-005",
      baseConceptId: "concept-001",
      name:          "Variant B — New label + cap feature",
      deltas: [
        {
          axis:        "label",
          description: "Wider front panel",
          patch:       { "labelAreas[0].printAreaMm.width": 38 },
        },
        {
          axis:        "feature",
          description: "Add secondary airless valve",
          patch:       { "featurePlacements[1]": { id: "fp-valve" } },
        },
      ],
      disclaimer: CONCEPT_DISCLAIMER,
      createdAt:  new Date(),
    });
    expect(result.consistent).toBe(true);
    expect(result.axesChanged).toContain("label");
    expect(result.axesChanged).toContain("feature");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. UNSUPPORTED MANUFACTURING CLAIM REJECTION
// ─────────────────────────────────────────────────────────────────────────────

describe("4. Unsupported manufacturing claim rejection", () => {
  it("clean fields return { clean: true }", () => {
    const result = assertNoUnsupportedClaims({
      shapeNotes: "Slim cylindrical form with tapered shoulder",
    });
    expect(result.clean).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("detects 'CE certified' in a notes field", () => {
    const result = assertNoUnsupportedClaims({
      sustainabilityNotes: "Material is CE certified for food contact",
    });
    expect(result.clean).toBe(false);
    expect(result.violations.some((v) => v.phrase === "ce certified")).toBe(true);
    expect(result.violations[0].field).toBe("sustainabilityNotes");
  });

  it("detects 'FDA approved' in logisticsNotes", () => {
    const result = assertNoUnsupportedClaims({
      logisticsNotes: "Product must be FDA approved before export",
    });
    expect(result.clean).toBe(false);
  });

  it("detects 'engineering drawing' claim", () => {
    const result = assertNoUnsupportedClaims({
      shapeNotes: "See attached engineering drawing for tolerances",
    });
    expect(result.clean).toBe(false);
  });

  it("guardAgainstUnsupportedClaims throws on violation", () => {
    expect(() =>
      guardAgainstUnsupportedClaims(
        { processNotes: "CAD file to be supplied by vendor" },
        "test",
      ),
    ).toThrow("Unsupported manufacturing claims");
  });

  it("buildManufacturerBrief throws when concept notes contain unsupported claim", () => {
    const concept = makeBaseConcept({
      materialDirection: {
        primaryMaterial:    "glass",
        sustainabilityNotes: "Material is ISO 9001 certified",
      },
    });
    expect(() => buildManufacturerBrief(concept)).toThrow();
  });

  it("listUnsupportedClaimViolations returns human-readable list", () => {
    const violations = listUnsupportedClaimViolations({
      notes: "Must be regulatory compliant and safety tested",
    });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("Field");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. CUSTOMER-SAFE DISCLAIMERS ALWAYS PRESENT
// ─────────────────────────────────────────────────────────────────────────────

describe("5. Customer-safe disclaimers always present", () => {
  it("getConceptDisclaimer returns the canonical non-empty string", () => {
    const d = getConceptDisclaimer();
    expect(typeof d).toBe("string");
    expect(d.length).toBeGreaterThan(50);
    expect(d).toContain("conceptual design");
  });

  it("CONCEPT_DISCLAIMER mentions engineering drawing exclusion", () => {
    expect(CONCEPT_DISCLAIMER).toContain("engineering drawing");
  });

  it("CONCEPT_DISCLAIMER mentions safety certification exclusion", () => {
    expect(CONCEPT_DISCLAIMER).toContain("safety certification");
  });

  it("injectDisclaimer always overwrites with canonical text", () => {
    const obj = { disclaimer: "some old text", id: "x" };
    const result = injectDisclaimer(obj);
    expect(result.disclaimer).toBe(CONCEPT_DISCLAIMER);
    expect(result.id).toBe("x");
  });

  it("assertDisclaimerPresent throws when disclaimer is missing", () => {
    expect(() =>
      assertDisclaimerPresent({ disclaimer: "" }, "test"),
    ).toThrow();
  });

  it("assertDisclaimerPresent does not throw when disclaimer is present", () => {
    expect(() =>
      assertDisclaimerPresent({ disclaimer: CONCEPT_DISCLAIMER }, "test"),
    ).not.toThrow();
  });

  it("buildManufacturerBrief output always carries the disclaimer", async () => {
    const concept = makeBaseConcept();
    const brief = buildManufacturerBrief(concept);
    expect(brief.disclaimer).toBe(CONCEPT_DISCLAIMER);
  });

  it("composeMockup output always carries the disclaimer", async () => {
    const concept = makeBaseConcept();
    const blueprint   = new NullBlueprintPort();
    const composition = new NullCompositionPort();
    const mockup = await composeMockup(
      concept,
      { viewAngle: "front", widthPx: 800, heightPx: 1200, format: "png" },
      blueprint,
      composition,
    );
    expect(mockup.disclaimer).toBe(CONCEPT_DISCLAIMER);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. CMF VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("6. CMF validation", () => {
  it("accepts a valid CMF spec with two zones", () => {
    const result = validateCMFSpec({
      entries: [
        { colorCode: "#1A1A2E", colorName: "Navy",   material: "glass",      finish: "matte",  zone: "body" },
        { colorCode: "#C0C0C0", colorName: "Silver", material: "pp_plastic", finish: "chrome", zone: "cap"  },
      ],
      isComplete: true,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects duplicate zone", () => {
    const result = validateCMFSpec({
      entries: [
        { colorCode: "#FF0000", colorName: "Red",  material: "glass", finish: "gloss", zone: "body" },
        { colorCode: "#0000FF", colorName: "Blue", material: "glass", finish: "matte", zone: "body" },
      ],
      isComplete: false,
    });
    expect(result.valid).toBe(false);
    expect(result.duplicateZones).toContain("body");
  });

  it("rejects invalid hex color code", () => {
    const entryResult = validateCMFEntry(
      { colorCode: "ZZZZZZ", colorName: "Bad", material: "glass", finish: "matte", zone: "body" },
      0,
    );
    expect(entryResult.valid).toBe(false);
    expect(entryResult.errors.some((e) => e.includes("colorCode"))).toBe(true);
  });

  it("accepts Pantone color code format", () => {
    const entryResult = validateCMFEntry(
      { colorCode: "Pantone 185 C", colorName: "Red", material: "glass", finish: "gloss", zone: "neck" },
      0,
    );
    expect(entryResult.valid).toBe(true);
  });

  it("accepts RAL color code format", () => {
    const entryResult = validateCMFEntry(
      { colorCode: "RAL 9010", colorName: "Pure White", material: "aluminum", finish: "satin", zone: "shoulder" },
      0,
    );
    expect(entryResult.valid).toBe(true);
  });

  it("rejects invalid material class", () => {
    const entryResult = validateCMFEntry(
      { colorCode: "#FF0000", colorName: "Red", material: "uranium" as never, finish: "matte", zone: "body" },
      0,
    );
    expect(entryResult.valid).toBe(false);
    expect(entryResult.errors.some((e) => e.includes("material"))).toBe(true);
  });

  it("rejects empty entries array", () => {
    const result = validateCMFSpec({ entries: [], isComplete: false });
    expect(result.valid).toBe(false);
  });

  it("warns when only one zone is defined", () => {
    const result = validateCMFSpec({
      entries: [
        { colorCode: "#FFFFFF", colorName: "White", material: "glass", finish: "matte", zone: "body" },
      ],
      isComplete: false,
    });
    expect(result.warnings.some((w) => w.includes("one zone"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MANUFACTURER BRIEF BUILDING
// ─────────────────────────────────────────────────────────────────────────────

describe("7. Manufacturer brief building", () => {
  it("produces a brief with all required fields", () => {
    const concept = makeBaseConcept();
    const brief = buildManufacturerBrief(concept);

    expect(brief.id).toBeDefined();
    expect(brief.conceptId).toBe(concept.id);
    expect(brief.conceptName).toBe(concept.name);
    expect(brief.requirements.length).toBeGreaterThan(0);
    expect(brief.processHints.length).toBeGreaterThan(0);
    expect(brief.disclaimer).toBe(CONCEPT_DISCLAIMER);
    expect(brief.generatedAt).toBeInstanceOf(Date);
  });

  it("infers glass_molding process hint for glass primary material", () => {
    const concept = makeBaseConcept();
    const brief = buildManufacturerBrief(concept);
    expect(brief.processHints).toContain("glass_molding");
  });

  it("includes dimension requirements from formDirection", () => {
    const concept = makeBaseConcept();
    const brief = buildManufacturerBrief(concept);
    const dimensionReqs = brief.requirements.filter((r) => r.category === "dimension");
    expect(dimensionReqs.length).toBeGreaterThan(0);
    const heightReq = dimensionReqs.find((r) => r.requirement.includes("height"));
    expect(heightReq).toBeDefined();
    expect(heightReq?.value).toContain("150");
  });

  it("includes label area requirements", () => {
    const concept = makeBaseConcept();
    const brief = buildManufacturerBrief(concept);
    const labelReqs = brief.requirements.filter((r) => r.category === "label");
    expect(labelReqs.length).toBe(1);
    expect(labelReqs[0].requirement).toContain("Front panel");
  });

  it("includes feature requirements for pump dispenser", () => {
    const concept = makeBaseConcept();
    const brief = buildManufacturerBrief(concept);
    const featureReqs = brief.requirements.filter((r) => r.category === "feature");
    expect(featureReqs.some((r) => r.requirement.includes("Pump dispenser"))).toBe(true);
  });

  it("adds optional logisticsNotes when provided", () => {
    const concept = makeBaseConcept();
    const brief = buildManufacturerBrief(concept, { logisticsNotes: "MOQ 5000 units" });
    expect(brief.logisticsNotes).toBe("MOQ 5000 units");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. MOCKUP COMPOSITION (layer z-order)
// ─────────────────────────────────────────────────────────────────────────────

describe("8. Mockup composition via null ports", () => {
  let blueprint: NullBlueprintPort;
  let composition: NullCompositionPort;

  beforeEach(() => {
    blueprint   = new NullBlueprintPort();
    composition = new NullCompositionPort();
  });

  it("composeMockup returns a ProductMockup with layers in ascending z-order", async () => {
    const concept = makeBaseConcept();
    const mockup  = await composeMockup(
      concept,
      { viewAngle: "front", widthPx: 800, heightPx: 1200, format: "png" },
      blueprint,
      composition,
    );

    expect(mockup.conceptId).toBe(concept.id);
    expect(mockup.layers.length).toBeGreaterThan(0);
    expect(mockup.rendered).toBe(false);
    expect(mockup.renderedAssetKey).toBeUndefined();

    // Verify strictly ascending z-order
    for (let i = 1; i < mockup.layers.length; i++) {
      expect(mockup.layers[i].zIndex).toBeGreaterThanOrEqual(mockup.layers[i - 1].zIndex);
    }
  });

  it("background layer has lowest z-index", async () => {
    const concept = makeBaseConcept();
    const mockup  = await composeMockup(
      concept,
      { viewAngle: "front", widthPx: 800, heightPx: 1200, format: "png" },
      blueprint,
      composition,
    );
    const bg = mockup.layers.find((l) => l.type === "background");
    expect(bg).toBeDefined();
    expect(bg!.zIndex).toBe(LAYER_ZINDEX.background);
    // Background should be at or near the bottom of all layers
    expect(bg!.zIndex).toBeLessThan(LAYER_ZINDEX.form_silhouette);
  });

  it("annotation layer has highest canonical z-index", () => {
    expect(LAYER_ZINDEX.annotation).toBeGreaterThan(LAYER_ZINDEX.feature);
    expect(LAYER_ZINDEX.feature).toBeGreaterThan(LAYER_ZINDEX.label);
    expect(LAYER_ZINDEX.label).toBeGreaterThan(LAYER_ZINDEX.cmf_overlay);
    expect(LAYER_ZINDEX.cmf_overlay).toBeGreaterThan(LAYER_ZINDEX.form_silhouette);
  });

  it("when render=true, composition port is called and assetKey is set", async () => {
    const concept = makeBaseConcept();
    const mockup  = await composeMockup(
      concept,
      { viewAngle: "isometric_left", widthPx: 600, heightPx: 900, format: "png", render: true },
      blueprint,
      composition,
    );
    expect(mockup.rendered).toBe(true);
    expect(mockup.renderedAssetKey).toBeDefined();
    expect(composition.calls).toHaveLength(1);
    expect(composition.calls[0].format).toBe("png");
  });

  it("blueprint port records the call with correct concept id", async () => {
    const concept = makeBaseConcept();
    await composeMockup(
      concept,
      { viewAngle: "back", widthPx: 400, heightPx: 600, format: "svg" },
      blueprint,
      composition,
    );
    expect(blueprint.calls).toHaveLength(1);
    expect(blueprint.calls[0].concept.id).toBe(concept.id);
    expect(blueprint.calls[0].viewAngle).toBe("back");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. LABEL AREA BOUNDS
// ─────────────────────────────────────────────────────────────────────────────

describe("9. Label area bounds", () => {
  const dims = { height: 150, width: 40 };

  it("accepts label that fits within form dimensions", () => {
    const result = validateLabelArea(
      {
        id:           "la-ok",
        name:         "Front panel",
        anchor:       "front",
        printAreaMm:  { width: 35, height: 80 },
        safeMarginMm: 3,
      },
      dims,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects label width exceeding form width", () => {
    const result = validateLabelArea(
      {
        id:           "la-wide",
        name:         "Oversized label",
        anchor:       "front",
        printAreaMm:  { width: 60, height: 100 }, // 60 > 40
        safeMarginMm: 0,
      },
      dims,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("printAreaMm.width"))).toBe(true);
  });

  it("rejects label height exceeding form height", () => {
    const result = validateLabelArea(
      {
        id:           "la-tall",
        name:         "Tall label",
        anchor:       "front",
        printAreaMm:  { width: 30, height: 200 }, // 200 > 150
        safeMarginMm: 0,
      },
      dims,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("printAreaMm.height"))).toBe(true);
  });

  it("rejects safe margin that leaves no usable area", () => {
    const result = validateLabelArea(
      {
        id:           "la-margin",
        name:         "Zero usable area",
        anchor:       "front",
        printAreaMm:  { width: 20, height: 20 },
        safeMarginMm: 15, // 2×15 = 30 > 20
      },
      dims,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("safeMarginMm"))).toBe(true);
  });

  it("warns for near-full-circumference wrap fraction", () => {
    const result = validateLabelArea(
      {
        id:           "la-wrap",
        name:         "Full wrap",
        anchor:       "wrap",
        printAreaMm:  { width: 38, height: 60 },
        safeMarginMm: 2,
        wrapFraction: 0.97,
      },
      dims,
    );
    // May be valid but should warn
    expect(result.warnings.some((w) => w.includes("wrap"))).toBe(true);
  });

  it("rejects wrapFraction > 1", () => {
    const result = validateLabelArea(
      {
        id:           "la-overwrap",
        name:         "Impossible wrap",
        anchor:       "wrap",
        printAreaMm:  { width: 38, height: 60 },
        safeMarginMm: 2,
        wrapFraction: 1.5,
      },
      dims,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("wrapFraction"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. FORM + MATERIAL CO-VALIDATION (process hint inference)
// ─────────────────────────────────────────────────────────────────────────────

describe("10. Form + material co-validation (process hint inference)", () => {
  it("glass bottle infers glass_molding and blow_molding hints", () => {
    const concept = makeBaseConcept({
      formDirection:     { category: "bottle", dimensions: { height: 120, width: 35 } },
      materialDirection: { primaryMaterial: "glass" },
    });
    const brief = buildManufacturerBrief(concept);
    expect(brief.processHints).toContain("glass_molding");
    expect(brief.processHints).toContain("blow_molding");
  });

  it("aluminum dispenser infers die_casting and injection_molding", () => {
    const concept = makeBaseConcept({
      formDirection:     { category: "dispenser", dimensions: { height: 180, width: 55 } },
      materialDirection: { primaryMaterial: "aluminum" },
    });
    const brief = buildManufacturerBrief(concept);
    expect(brief.processHints).toContain("die_casting");
    expect(brief.processHints).toContain("injection_molding");
  });

  it("bioplastic tube infers blow_molding and extrusion_blow", () => {
    const concept = makeBaseConcept({
      formDirection:     { category: "tube", dimensions: { height: 200, width: 35 } },
      materialDirection: { primaryMaterial: "bioplastic" },
    });
    const brief = buildManufacturerBrief(concept);
    // tube infers extrusion_blow; bioplastic infers blow_molding
    expect(brief.processHints).toContain("extrusion_blow");
    expect(brief.processHints).toContain("blow_molding");
  });

  it("concept with label areas always gets labeling hint", () => {
    const concept = makeBaseConcept(); // has one label area
    const brief = buildManufacturerBrief(concept);
    expect(brief.processHints).toContain("labeling");
  });

  it("dimension validation warns about ratio mismatch between form and dims", () => {
    // A jar with height >> width is unusual (jars are typically squat)
    const result = validateDimensions({ height: 300, width: 30 }, "jar");
    // Jar max ratio is 2.5; 300/30 = 10 → warning
    expect(result.warnings.some((w) => w.includes("jar"))).toBe(true);
  });

  it("paperboard sachet infers labeling process hint", () => {
    const concept = makeBaseConcept({
      formDirection:     { category: "sachet", dimensions: { height: 80, width: 60 } },
      materialDirection: { primaryMaterial: "paperboard" },
    });
    const brief = buildManufacturerBrief(concept);
    expect(brief.processHints).toContain("labeling");
  });
});
