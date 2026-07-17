/**
 * Team 8 — Blueprint Compatibility Service Tests
 */

import { describe, it, expect } from "vitest";
import {
  checkComponentCompatibility,
  checkBlueprintCoverage,
  listCompatibleComponents,
  validateBlueprintComposition,
  isTypeCompatibleWithDomain,
} from "../blueprintCompatibilityService.js";
import type { BlueprintContext } from "../blueprintCompatibilityService.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const graphicCtx: BlueprintContext = { domain: "graphic" };
const interiorCtx: BlueprintContext = { domain: "interior" };
const fashionCtx: BlueprintContext = { domain: "fashion" };
const packagingCtx: BlueprintContext = { domain: "packaging" };

// ── checkComponentCompatibility ───────────────────────────────────────────────

describe("checkComponentCompatibility", () => {
  it("graphic text is compatible with graphic domain", () => {
    const result = checkComponentCompatibility("text", graphicCtx);
    expect(result.compatible).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("interior sofa is compatible with interior domain", () => {
    const result = checkComponentCompatibility("sofa", interiorCtx);
    expect(result.compatible).toBe(true);
  });

  it("fashion body_panel is compatible with fashion domain", () => {
    const result = checkComponentCompatibility("body_panel", fashionCtx);
    expect(result.compatible).toBe(true);
  });

  it("packaging barcode is compatible with packaging domain", () => {
    const result = checkComponentCompatibility("barcode", packagingCtx);
    expect(result.compatible).toBe(true);
  });

  it("rejects chart in interior domain (chart only supports graphic)", () => {
    const result = checkComponentCompatibility("chart", interiorCtx);
    expect(result.compatible).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("rejects sofa in packaging domain", () => {
    const result = checkComponentCompatibility("sofa", packagingCtx);
    expect(result.compatible).toBe(false);
  });

  it("accepts logo in fashion domain (cross-domain)", () => {
    const result = checkComponentCompatibility("logo", fashionCtx);
    expect(result.compatible).toBe(true);
  });

  it("accepts logo in packaging domain (cross-domain)", () => {
    const result = checkComponentCompatibility("logo", packagingCtx);
    expect(result.compatible).toBe(true);
  });

  it("returns incompatible for unknown type", () => {
    const result = checkComponentCompatibility("unknown_type" as any, graphicCtx);
    expect(result.compatible).toBe(false);
    expect(result.reasons[0]).toContain("Unknown component type");
  });

  it("strict domain match rejects logo in interior (primary domain is graphic)", () => {
    const result = checkComponentCompatibility("logo", {
      domain: "interior",
      strictDomainMatch: true,
    });
    expect(result.compatible).toBe(false);
    expect(result.reasons.some((r) => r.includes("Strict domain match"))).toBe(true);
  });

  it("strict domain match accepts sofa in interior (primary domain matches)", () => {
    const result = checkComponentCompatibility("sofa", {
      domain: "interior",
      strictDomainMatch: true,
    });
    expect(result.compatible).toBe(true);
  });

  it("forbidden type is rejected", () => {
    const result = checkComponentCompatibility("text", {
      domain: "graphic",
      forbiddenComponentTypes: ["text"],
    });
    expect(result.compatible).toBe(false);
    expect(result.reasons.some((r) => r.includes("explicitly forbidden"))).toBe(true);
  });
});

// ── checkBlueprintCoverage ────────────────────────────────────────────────────

describe("checkBlueprintCoverage", () => {
  it("passes when all required types are present", () => {
    const result = checkBlueprintCoverage(
      { domain: "packaging", requiredComponentTypes: ["front", "back", "barcode", "legal_block"] },
      ["front", "back", "barcode", "legal_block", "label"],
    );
    expect(result.compatible).toBe(true);
    expect(result.missingFields).toHaveLength(0);
  });

  it("fails when a required type is absent", () => {
    const result = checkBlueprintCoverage(
      { domain: "packaging", requiredComponentTypes: ["front", "barcode"] },
      ["front"],
    );
    expect(result.compatible).toBe(false);
    expect(result.missingFields).toContain("barcode");
  });

  it("passes when no required types are specified", () => {
    const result = checkBlueprintCoverage({ domain: "graphic" }, []);
    expect(result.compatible).toBe(true);
  });

  it("reports all missing types", () => {
    const result = checkBlueprintCoverage(
      { domain: "fashion", requiredComponentTypes: ["body_panel", "sleeve", "collar", "name_number"] },
      [],
    );
    expect(result.compatible).toBe(false);
    expect(result.missingFields).toHaveLength(4);
  });
});

// ── listCompatibleComponents ──────────────────────────────────────────────────

describe("listCompatibleComponents", () => {
  it("returns only graphic-supported components for graphic domain", () => {
    const comps = listCompatibleComponents(graphicCtx);
    expect(comps.length).toBeGreaterThan(0);
    expect(comps.every((c) => c.supportedDomains.includes("graphic"))).toBe(true);
  });

  it("returns 6 primary interior components with strictDomainMatch", () => {
    const comps = listCompatibleComponents({ domain: "interior", strictDomainMatch: true });
    expect(comps).toHaveLength(6);
    expect(comps.every((c) => c.domain === "interior")).toBe(true);
  });

  it("excludes forbidden types", () => {
    const comps = listCompatibleComponents({
      domain: "graphic",
      forbiddenComponentTypes: ["text", "logo", "chart"],
    });
    const types = comps.map((c) => c.type);
    expect(types).not.toContain("text");
    expect(types).not.toContain("logo");
    expect(types).not.toContain("chart");
  });

  it("returns packaging-compatible components for packaging domain", () => {
    const comps = listCompatibleComponents(packagingCtx);
    const types = comps.map((c) => c.type);
    expect(types).toContain("front");
    expect(types).toContain("barcode");
    expect(types).toContain("legal_block");
    expect(types).toContain("logo"); // cross-domain
    expect(types).not.toContain("sofa");
  });
});

// ── validateBlueprintComposition ──────────────────────────────────────────────

describe("validateBlueprintComposition", () => {
  it("validates a complete, valid graphic design composition", () => {
    const result = validateBlueprintComposition({
      context: {
        domain: "graphic",
        requiredComponentTypes: ["text", "logo"],
      },
      components: [
        { type: "text", instanceId: "t1" },
        { type: "logo", instanceId: "l1" },
        { type: "image", instanceId: "i1" },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.coverageResult.compatible).toBe(true);
    expect(result.instanceLimitViolations).toHaveLength(0);
  });

  it("fails when required component is missing", () => {
    const result = validateBlueprintComposition({
      context: {
        domain: "graphic",
        requiredComponentTypes: ["chart"],
      },
      components: [{ type: "text" }],
    });
    expect(result.valid).toBe(false);
    expect(result.coverageResult.missingFields).toContain("chart");
  });

  it("fails when component is incompatible with domain", () => {
    const result = validateBlueprintComposition({
      context: { domain: "interior" },
      components: [
        { type: "sofa" },
        { type: "chart" }, // chart doesn't support interior
      ],
    });
    expect(result.valid).toBe(false);
    const chartResult = result.componentResults.find((r) => r.type === "chart");
    expect(chartResult!.compatible).toBe(false);
  });

  it("enforces per-type instance limits", () => {
    const result = validateBlueprintComposition({
      context: {
        domain: "graphic",
        maxInstancesPerType: { logo: 1 },
      },
      components: [
        { type: "logo", instanceId: "l1" },
        { type: "logo", instanceId: "l2" }, // exceeds limit of 1
        { type: "text" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.instanceLimitViolations.length).toBeGreaterThan(0);
    expect(result.instanceLimitViolations[0]).toContain("logo");
  });

  it("allows multiple instances when no limit set", () => {
    const result = validateBlueprintComposition({
      context: { domain: "packaging" },
      components: [
        { type: "barcode" },
        { type: "barcode" },
        { type: "barcode" },
      ],
    });
    expect(result.instanceLimitViolations).toHaveLength(0);
  });

  it("validates a fashion jersey composition", () => {
    const result = validateBlueprintComposition({
      context: {
        domain: "fashion",
        requiredComponentTypes: ["body_panel", "name_number"],
      },
      components: [
        { type: "body_panel", instanceId: "front" },
        { type: "body_panel", instanceId: "back" },
        { type: "sleeve", instanceId: "sleeve-l" },
        { type: "sleeve", instanceId: "sleeve-r" },
        { type: "collar" },
        { type: "logo_area" },
        { type: "sponsor" },
        { type: "name_number" },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("validates a full packaging composition", () => {
    const result = validateBlueprintComposition({
      context: {
        domain: "packaging",
        requiredComponentTypes: ["front", "back", "barcode", "legal_block"],
      },
      components: [
        { type: "front" },
        { type: "back" },
        { type: "side" },
        { type: "top" },
        { type: "bottom" },
        { type: "barcode" },
        { type: "legal_block" },
        { type: "label" },
        { type: "logo" },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.coverageResult.compatible).toBe(true);
  });

  it("handles empty components array", () => {
    const result = validateBlueprintComposition({
      context: { domain: "graphic" },
      components: [],
    });
    expect(result.componentResults).toHaveLength(0);
    expect(result.valid).toBe(true); // no required types, no forbidden types → valid
  });
});

// ── isTypeCompatibleWithDomain ────────────────────────────────────────────────

describe("isTypeCompatibleWithDomain", () => {
  it("returns true for graphic/text", () => {
    expect(isTypeCompatibleWithDomain("text", "graphic")).toBe(true);
  });

  it("returns true for packaging/barcode", () => {
    expect(isTypeCompatibleWithDomain("barcode", "packaging")).toBe(true);
  });

  it("returns false for interior/chart", () => {
    expect(isTypeCompatibleWithDomain("chart", "interior")).toBe(false);
  });

  it("returns false for unknown type", () => {
    expect(isTypeCompatibleWithDomain("unicorn", "graphic")).toBe(false);
  });

  it("returns false for unknown domain", () => {
    expect(isTypeCompatibleWithDomain("text", "print")).toBe(false);
  });

  it("returns false for both unknown", () => {
    expect(isTypeCompatibleWithDomain("", "")).toBe(false);
  });
});
