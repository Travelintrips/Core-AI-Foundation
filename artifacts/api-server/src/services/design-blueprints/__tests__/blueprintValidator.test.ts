/**
 * Blueprint Validator Tests (Team 7)
 *
 * Covers:
 *  - Valid blueprint passes
 *  - Malformed / missing required fields
 *  - Duplicate slot/zone IDs
 *  - Dangling slotRefs in zones
 *  - Impossible constraint ranges
 *  - Zone overlap detection
 *  - Component version range format
 *  - Output capabilities
 *  - Enum fields without allowedValues
 *  - DPI out of range
 *  - Coverage constraint violations
 */

import { describe, it, expect } from "vitest";
import { validateBlueprint } from "../blueprintValidator.js";
import { graphicDesignBlueprint } from "../blueprints/graphic-design.js";
import type { Blueprint } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMinimalBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    id: "bp-test-001",
    slug: "test-blueprint",
    schemaVersion: "1.0",
    domain: "graphic_design",
    name: "Test Blueprint",
    description: "A minimal test blueprint",
    version: "1.0.0",
    status: "active",
    dimensions: { width: 1920, height: 1080, unit: "px", dpi: 96 },
    zones: [
      { id: "z-main", name: "Main", x: 0, y: 0, width: 1920, height: 1080, required: true, slotRefs: ["s-text"] },
    ],
    slots: [
      { id: "s-text", name: "Text", type: "text", required: true, maxItems: 1, constraints: { maxChars: 200 } },
    ],
    constraints: { maxZones: 4, maxSlots: 8, allowZoneOverlap: false },
    supportedComponents: [
      { type: "rich-text-editor", versionRange: ">=1.0.0", required: true, fillsSlotTypes: ["text"] },
    ],
    requiredData: [
      { key: "brandName", label: "Brand Name", type: "string", required: true, maxLength: 100 },
    ],
    outputCapabilities: [
      { format: "pdf", maxDpi: 300, colorSpace: "rgb" },
    ],
    industryTags: ["advertising"],
    styleTags: ["minimalist"],
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

// ── Built-in blueprint ────────────────────────────────────────────────────────

describe("validateBlueprint — built-in blueprints", () => {
  it("graphic design blueprint is valid", () => {
    const result = validateBlueprint(graphicDesignBlueprint);
    expect(result.valid).toBe(true);
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });
});

// ── Valid minimal blueprint ───────────────────────────────────────────────────

describe("validateBlueprint — valid input", () => {
  it("accepts a minimal valid blueprint", () => {
    const result = validateBlueprint(makeMinimalBlueprint());
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });
});

// ── Not an object ─────────────────────────────────────────────────────────────

describe("validateBlueprint — malformed top-level", () => {
  it("rejects null", () => {
    const result = validateBlueprint(null);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("NOT_AN_OBJECT");
  });

  it("rejects a string", () => {
    const result = validateBlueprint("not-an-object");
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("NOT_AN_OBJECT");
  });

  it("rejects missing id", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ id: "" }));
    expect(result.valid).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("MISSING_ID");
  });

  it("rejects invalid slug (uppercase)", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ slug: "My-Blueprint" }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_SLUG")).toBe(true);
  });

  it("rejects unknown domain", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ domain: "unknown_domain" as any }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_DOMAIN")).toBe(true);
  });

  it("rejects unknown status", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ status: "published" as any }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_STATUS")).toBe(true);
  });

  it("rejects invalid semver version", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ version: "v1.0" }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_VERSION")).toBe(true);
  });

  it("rejects unsupported schemaVersion", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ schemaVersion: "2.0" as any }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "UNSUPPORTED_SCHEMA_VERSION")).toBe(true);
  });

  it("rejects blueprint with no zones", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ zones: [] }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "NO_ZONES")).toBe(true);
  });

  it("rejects blueprint with no slots", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ slots: [] }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "NO_SLOTS")).toBe(true);
  });
});

// ── Dimensions ────────────────────────────────────────────────────────────────

describe("validateBlueprint — dimensions", () => {
  it("rejects width <= 0", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ dimensions: { width: 0, height: 1080, unit: "px" } }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "DIMENSION_NON_POSITIVE")).toBe(true);
  });

  it("rejects height <= 0", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ dimensions: { width: 1920, height: -1, unit: "px" } }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "DIMENSION_NON_POSITIVE")).toBe(true);
  });

  it("rejects DPI below 72", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ dimensions: { width: 100, height: 100, unit: "px", dpi: 10 } }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "DPI_OUT_OF_RANGE")).toBe(true);
  });

  it("rejects DPI above 2400", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ dimensions: { width: 100, height: 100, unit: "px", dpi: 9999 } }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "DPI_OUT_OF_RANGE")).toBe(true);
  });

  it("rejects unknown dimension unit", () => {
    const result = validateBlueprint(makeMinimalBlueprint({ dimensions: { width: 100, height: 100, unit: "em" as any } }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_DIMENSION_UNIT")).toBe(true);
  });
});

// ── Slots ─────────────────────────────────────────────────────────────────────

describe("validateBlueprint — slots", () => {
  it("rejects duplicate slot IDs", () => {
    const bp = makeMinimalBlueprint({
      slots: [
        { id: "s-dup", name: "A", type: "text", required: true, maxItems: 1, constraints: {} },
        { id: "s-dup", name: "B", type: "image", required: false, maxItems: 1, constraints: {} },
      ],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "DUPLICATE_SLOT_ID")).toBe(true);
  });

  it("rejects unknown slot type", () => {
    const bp = makeMinimalBlueprint({
      slots: [{ id: "s-1", name: "X", type: "3d_model" as any, required: false, maxItems: 1, constraints: {} }],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_SLOT_TYPE")).toBe(true);
  });

  it("rejects impossible width range (min > max)", () => {
    const bp = makeMinimalBlueprint({
      slots: [{ id: "s-1", name: "X", type: "image", required: false, maxItems: 1, constraints: { minWidth: 500, maxWidth: 100 } }],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "IMPOSSIBLE_WIDTH_RANGE")).toBe(true);
  });

  it("rejects impossible font size range (min > max)", () => {
    const bp = makeMinimalBlueprint({
      slots: [{ id: "s-1", name: "X", type: "text", required: false, maxItems: 1, constraints: { minFontSize: 100, maxFontSize: 10 } }],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "IMPOSSIBLE_FONT_SIZE_RANGE")).toBe(true);
  });

  it("rejects impossible char range (min > max)", () => {
    const bp = makeMinimalBlueprint({
      slots: [{ id: "s-1", name: "X", type: "text", required: false, maxItems: 1, constraints: { minChars: 500, maxChars: 10 } }],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "IMPOSSIBLE_CHAR_RANGE")).toBe(true);
  });

  it("warns about allowedFormats on a text slot", () => {
    const bp = makeMinimalBlueprint({
      slots: [{ id: "s-1", name: "X", type: "text", required: false, maxItems: 1, constraints: { allowedFormats: ["png"] } }],
    });
    const result = validateBlueprint(bp);
    expect(result.issues.some((i) => i.code === "IRRELEVANT_CONSTRAINT" && i.severity === "warning")).toBe(true);
  });
});

// ── Zones ─────────────────────────────────────────────────────────────────────

describe("validateBlueprint — zones", () => {
  it("rejects duplicate zone IDs", () => {
    const bp = makeMinimalBlueprint({
      slots: [{ id: "s-text", name: "T", type: "text", required: true, maxItems: 1, constraints: {} }],
      zones: [
        { id: "z-dup", name: "A", x: 0, y: 0, width: 100, height: 100, required: true, slotRefs: ["s-text"] },
        { id: "z-dup", name: "B", x: 200, y: 0, width: 100, height: 100, required: false, slotRefs: [] },
      ],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "DUPLICATE_ZONE_ID")).toBe(true);
  });

  it("rejects dangling slotRef (refs non-existent slot)", () => {
    const bp = makeMinimalBlueprint({
      zones: [
        { id: "z-main", name: "Main", x: 0, y: 0, width: 1920, height: 1080, required: true, slotRefs: ["s-text", "s-does-not-exist"] },
      ],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "DANGLING_SLOT_REF")).toBe(true);
  });

  it("warns when zone exceeds canvas bounds (px only)", () => {
    const bp = makeMinimalBlueprint({
      zones: [
        { id: "z-main", name: "Main", x: 0, y: 0, width: 3000, height: 1080, required: true, slotRefs: ["s-text"] },
      ],
    });
    const result = validateBlueprint(bp);
    expect(result.issues.some((i) => i.code === "ZONE_EXCEEDS_CANVAS" && i.severity === "warning")).toBe(true);
  });

  it("detects zone overlap when allowZoneOverlap is false", () => {
    const bp = makeMinimalBlueprint({
      slots: [
        { id: "s-a", name: "A", type: "text", required: true, maxItems: 1, constraints: {} },
        { id: "s-b", name: "B", type: "text", required: false, maxItems: 1, constraints: {} },
      ],
      zones: [
        { id: "z-a", name: "A", x: 0, y: 0, width: 500, height: 500, required: true, slotRefs: ["s-a"] },
        { id: "z-b", name: "B", x: 250, y: 250, width: 500, height: 500, required: false, slotRefs: ["s-b"] },
      ],
      constraints: { allowZoneOverlap: false },
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "ZONE_OVERLAP")).toBe(true);
  });

  it("allows zone overlap when allowZoneOverlap is true", () => {
    const bp = makeMinimalBlueprint({
      slots: [
        { id: "s-a", name: "A", type: "text", required: true, maxItems: 1, constraints: {} },
        { id: "s-b", name: "B", type: "text", required: false, maxItems: 1, constraints: {} },
      ],
      zones: [
        { id: "z-a", name: "A", x: 0, y: 0, width: 500, height: 500, required: true, slotRefs: ["s-a"] },
        { id: "z-b", name: "B", x: 250, y: 250, width: 500, height: 500, required: false, slotRefs: ["s-b"] },
      ],
      constraints: { allowZoneOverlap: true },
    });
    const result = validateBlueprint(bp);
    expect(result.issues.some((i) => i.code === "ZONE_OVERLAP")).toBe(false);
  });
});

// ── Blueprint constraints ─────────────────────────────────────────────────────

describe("validateBlueprint — blueprint constraints", () => {
  it("rejects maxZones exceeded", () => {
    const bp = makeMinimalBlueprint({ constraints: { maxZones: 0, maxSlots: 8 } });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MAX_ZONES_EXCEEDED")).toBe(true);
  });

  it("rejects maxSlots exceeded", () => {
    const bp = makeMinimalBlueprint({ constraints: { maxZones: 4, maxSlots: 0 } });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MAX_SLOTS_EXCEEDED")).toBe(true);
  });

  it("rejects missing required zone in requiredZoneIds", () => {
    const bp = makeMinimalBlueprint({ constraints: { requiredZoneIds: ["z-main", "z-nonexistent"] } });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_REQUIRED_ZONE")).toBe(true);
  });

  it("rejects impossible coverage range", () => {
    const bp = makeMinimalBlueprint({ constraints: { minContentCoverage: 0.8, maxContentCoverage: 0.2 } });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "IMPOSSIBLE_COVERAGE_RANGE")).toBe(true);
  });

  it("rejects coverage values outside 0–1", () => {
    const bp = makeMinimalBlueprint({ constraints: { minContentCoverage: 1.5 } });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_COVERAGE")).toBe(true);
  });
});

// ── Components ────────────────────────────────────────────────────────────────

describe("validateBlueprint — supportedComponents", () => {
  it("rejects invalid semver range", () => {
    const bp = makeMinimalBlueprint({
      supportedComponents: [
        { type: "rich-text-editor", versionRange: "latest", required: true, fillsSlotTypes: ["text"] },
      ],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_VERSION_RANGE")).toBe(true);
  });

  it("warns about duplicate component types", () => {
    const bp = makeMinimalBlueprint({
      supportedComponents: [
        { type: "rich-text-editor", versionRange: ">=1.0.0", required: true, fillsSlotTypes: ["text"] },
        { type: "rich-text-editor", versionRange: ">=2.0.0", required: false, fillsSlotTypes: ["text"] },
      ],
    });
    const result = validateBlueprint(bp);
    expect(result.issues.some((i) => i.code === "DUPLICATE_COMPONENT_TYPE" && i.severity === "warning")).toBe(true);
  });

  it("rejects unknown slot type in fillsSlotTypes", () => {
    const bp = makeMinimalBlueprint({
      supportedComponents: [
        { type: "rich-text-editor", versionRange: ">=1.0.0", required: true, fillsSlotTypes: ["magic_slot" as any] },
      ],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_SLOT_TYPE_REF")).toBe(true);
  });
});

// ── Required data ─────────────────────────────────────────────────────────────

describe("validateBlueprint — requiredData", () => {
  it("rejects duplicate data keys", () => {
    const bp = makeMinimalBlueprint({
      requiredData: [
        { key: "brandName", label: "Brand A", type: "string", required: true },
        { key: "brandName", label: "Brand B", type: "string", required: false },
      ],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "DUPLICATE_DATA_KEY")).toBe(true);
  });

  it("rejects enum type without allowedValues", () => {
    const bp = makeMinimalBlueprint({
      requiredData: [
        { key: "category", label: "Category", type: "enum", required: true },
      ],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "ENUM_NO_VALUES")).toBe(true);
  });

  it("rejects invalid key (starts with number)", () => {
    const bp = makeMinimalBlueprint({
      requiredData: [
        { key: "1invalid", label: "Bad", type: "string", required: false },
      ],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_DATA_KEY")).toBe(true);
  });

  it("rejects min > max on numeric field", () => {
    const bp = makeMinimalBlueprint({
      requiredData: [
        { key: "count", label: "Count", type: "number", required: false, min: 100, max: 10 },
      ],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "IMPOSSIBLE_RANGE")).toBe(true);
  });
});

// ── Output capabilities ───────────────────────────────────────────────────────

describe("validateBlueprint — outputCapabilities", () => {
  it("rejects blueprint with no output capabilities", () => {
    const bp = makeMinimalBlueprint({ outputCapabilities: [] });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "NO_OUTPUT_FORMATS")).toBe(true);
  });

  it("rejects unknown output format", () => {
    const bp = makeMinimalBlueprint({
      outputCapabilities: [{ format: "docx" as any, colorSpace: "rgb" }],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_OUTPUT_FORMAT")).toBe(true);
  });

  it("rejects negative bleed", () => {
    const bp = makeMinimalBlueprint({
      outputCapabilities: [{ format: "pdf", bleedMm: -3, colorSpace: "cmyk" }],
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "NEGATIVE_BLEED")).toBe(true);
  });
});
