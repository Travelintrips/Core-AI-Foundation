/**
 * Compatibility Checker Tests (Team 7)
 *
 * Covers:
 *  - Schema version match / major mismatch / minor mismatch
 *  - Unsupported component types
 *  - Missing required components
 *  - Slot type fill compatibility
 *  - Required slot unfilled warning
 *  - Deprecated / draft blueprint warnings
 *  - satisfiesRange helper across all range formats
 */

import { describe, it, expect } from "vitest";
import { checkCompatibility, satisfiesRange } from "../compatibilityChecker.js";
import { graphicDesignBlueprint } from "../blueprints/graphic-design.js";
import type { Blueprint, CompatibilityRequest } from "../types.js";

// ── satisfiesRange ────────────────────────────────────────────────────────────

describe("satisfiesRange", () => {
  it("* matches any version", () => {
    expect(satisfiesRange("1.0.0", "*")).toBe(true);
    expect(satisfiesRange("99.0.0", "*")).toBe(true);
  });

  it("exact match", () => {
    expect(satisfiesRange("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.4", "1.2.3")).toBe(false);
  });

  it(">=X.Y.Z", () => {
    expect(satisfiesRange("1.0.0", ">=1.0.0")).toBe(true);
    expect(satisfiesRange("1.5.0", ">=1.0.0")).toBe(true);
    expect(satisfiesRange("0.9.9", ">=1.0.0")).toBe(false);
  });

  it(">X.Y.Z (strict)", () => {
    expect(satisfiesRange("1.0.1", ">1.0.0")).toBe(true);
    expect(satisfiesRange("1.0.0", ">1.0.0")).toBe(false);
  });

  it("<=X.Y.Z", () => {
    expect(satisfiesRange("1.0.0", "<=1.0.0")).toBe(true);
    expect(satisfiesRange("0.9.9", "<=1.0.0")).toBe(true);
    expect(satisfiesRange("1.0.1", "<=1.0.0")).toBe(false);
  });

  it(">=X.Y.Z <A.B.C dual range", () => {
    expect(satisfiesRange("1.5.0", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
    expect(satisfiesRange("0.9.9", ">=1.0.0 <2.0.0")).toBe(false);
  });

  it("^X.Y.Z (caret — compatible major)", () => {
    expect(satisfiesRange("1.2.3", "^1.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfiesRange("1.0.0", "^1.0.0")).toBe(true);
  });

  it("~X.Y.Z (tilde — compatible minor)", () => {
    expect(satisfiesRange("1.2.5", "~1.2.3")).toBe(true);
    expect(satisfiesRange("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.2", "~1.2.3")).toBe(false);
  });

  it("returns false for unparseable version", () => {
    expect(satisfiesRange("not-a-version", ">=1.0.0")).toBe(false);
  });
});

// ── checkCompatibility ────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<CompatibilityRequest> = {}): CompatibilityRequest {
  return {
    blueprintId: graphicDesignBlueprint.id,
    schemaVersion: "1.0",
    componentTypes: ["rich-text-editor", "image-picker"],
    slotTypesFilled: { text: 1, image: 1 },
    ...overrides,
  };
}

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return { ...graphicDesignBlueprint, ...overrides };
}

describe("checkCompatibility — schema version", () => {
  it("compatible when schema versions match", () => {
    const result = checkCompatibility(makeRequest(), graphicDesignBlueprint);
    expect(result.compatible).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("error on major version mismatch", () => {
    const result = checkCompatibility(makeRequest({ schemaVersion: "2.0.0" }), graphicDesignBlueprint);
    expect(result.compatible).toBe(false);
    expect(result.issues.some((i) => i.code === "SCHEMA_MAJOR_MISMATCH")).toBe(true);
  });

  it("warning on unparseable schema version", () => {
    const result = checkCompatibility(makeRequest({ schemaVersion: "beta" }), graphicDesignBlueprint);
    expect(result.compatible).toBe(false);
    expect(result.issues.some((i) => i.code === "UNPARSEABLE_SCHEMA_VERSION")).toBe(true);
  });
});

describe("checkCompatibility — component types", () => {
  it("error when unsupported component requested", () => {
    const result = checkCompatibility(
      makeRequest({ componentTypes: ["unknown-widget"] }),
      graphicDesignBlueprint
    );
    expect(result.compatible).toBe(false);
    expect(result.issues.some((i) => i.code === "UNSUPPORTED_COMPONENT")).toBe(true);
  });

  it("error when required component is missing from request", () => {
    const result = checkCompatibility(
      makeRequest({ componentTypes: ["image-picker"] }),  // missing rich-text-editor which is required
      graphicDesignBlueprint
    );
    expect(result.compatible).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_REQUIRED_COMPONENT")).toBe(true);
  });

  it("warns that component version is unchecked (no version provided)", () => {
    const result = checkCompatibility(
      makeRequest({ componentTypes: ["rich-text-editor", "image-picker"] }),
      graphicDesignBlueprint
    );
    expect(result.warnings.some((w) => w.code === "COMPONENT_VERSION_UNCHECKED")).toBe(true);
  });

  it("skips component checks when componentTypes is empty", () => {
    const result = checkCompatibility(
      makeRequest({ componentTypes: [] }),
      graphicDesignBlueprint
    );
    // No UNSUPPORTED_COMPONENT errors, but MISSING_REQUIRED_COMPONENT should still fire
    expect(result.issues.some((i) => i.code === "MISSING_REQUIRED_COMPONENT")).toBe(true);
  });
});

describe("checkCompatibility — slot type fills", () => {
  it("error when slot type not supported by blueprint", () => {
    const result = checkCompatibility(
      makeRequest({ slotTypesFilled: { video: 1 } }),
      makeBlueprint({
        slots: [{ id: "s-text", name: "T", type: "text", required: true, maxItems: 1, constraints: {} }],
      })
    );
    expect(result.compatible).toBe(false);
    expect(result.issues.some((i) => i.code === "UNSUPPORTED_SLOT_TYPE")).toBe(true);
  });

  it("error when slot fill count is 0 or negative", () => {
    const result = checkCompatibility(
      makeRequest({ slotTypesFilled: { text: 0 } }),
      graphicDesignBlueprint
    );
    expect(result.compatible).toBe(false);
    expect(result.issues.some((i) => i.code === "INVALID_SLOT_COUNT")).toBe(true);
  });

  it("warns when required slot type is unfilled", () => {
    const result = checkCompatibility(
      makeRequest({ slotTypesFilled: { image: 1 } }),  // text is required but not filled
      graphicDesignBlueprint
    );
    expect(result.warnings.some((w) => w.code === "REQUIRED_SLOT_UNFILLED")).toBe(true);
  });

  it("compatible when all required slot types are filled", () => {
    const result = checkCompatibility(
      makeRequest({ componentTypes: ["rich-text-editor", "image-picker"], slotTypesFilled: { text: 1, image: 1 } }),
      graphicDesignBlueprint
    );
    expect(result.compatible).toBe(true);
  });
});

describe("checkCompatibility — blueprint status", () => {
  it("warns when blueprint is deprecated", () => {
    const bp = makeBlueprint({ status: "deprecated" });
    const result = checkCompatibility(makeRequest(), bp);
    expect(result.warnings.some((w) => w.code === "BLUEPRINT_DEPRECATED")).toBe(true);
  });

  it("warns when blueprint is draft", () => {
    const bp = makeBlueprint({ status: "draft" });
    const result = checkCompatibility(makeRequest(), bp);
    expect(result.warnings.some((w) => w.code === "BLUEPRINT_DRAFT")).toBe(true);
  });
});
