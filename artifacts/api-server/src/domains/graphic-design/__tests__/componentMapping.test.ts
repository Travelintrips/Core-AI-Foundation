/**
 * componentMapping.test.ts — Team 15 Graphic Design
 *
 * Tests for the component checklist and component readiness checks.
 */

import { describe, it, expect } from "vitest";
import { getGdComponents, checkComponentReadiness, GD_REQUIRED_COMPONENTS } from "../componentMapping.js";
import { GRAPHIC_DESIGN_SERVICES } from "../types.js";

describe("getGdComponents", () => {
  it("returns components sorted: required first", () => {
    const comps = getGdComponents("logo");
    const firstOptional = comps.findIndex((c) => !c.required);
    const lastRequired = comps.reduceRight((acc, c, i) => (c.required && acc === -1 ? i : acc), -1);
    if (firstOptional !== -1 && lastRequired !== -1) {
      expect(lastRequired).toBeLessThan(firstOptional);
    }
  });

  it("logo: includes brand-colors, company-name, variant-sizes", () => {
    const names = getGdComponents("logo").map((c) => c.name);
    expect(names).toContain("brand-colors");
    expect(names).toContain("company-name");
    expect(names).toContain("variant-sizes");
  });

  it("business-card: includes contact-details and print-ready-pdf", () => {
    const names = getGdComponents("business-card").map((c) => c.name);
    expect(names).toContain("contact-details");
    expect(names).toContain("print-ready-pdf");
  });

  it("social-media: includes platform-list and post-visuals", () => {
    const names = getGdComponents("social-media").map((c) => c.name);
    expect(names).toContain("platform-list");
    expect(names).toContain("post-visuals");
  });
});

describe("GD_REQUIRED_COMPONENTS coverage", () => {
  it("every service has at least one required component", () => {
    for (const code of GRAPHIC_DESIGN_SERVICES) {
      const required = GD_REQUIRED_COMPONENTS[code].filter((c) => c.required);
      expect(required.length).toBeGreaterThan(0);
    }
  });

  it("every component has a non-empty description", () => {
    for (const code of GRAPHIC_DESIGN_SERVICES) {
      for (const comp of GD_REQUIRED_COMPONENTS[code]) {
        expect(comp.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("every required component has a valid source", () => {
    const validSources = ["brief", "brand-dna", "asset-library", "generated"];
    for (const code of GRAPHIC_DESIGN_SERVICES) {
      for (const comp of GD_REQUIRED_COMPONENTS[code]) {
        expect(validSources).toContain(comp.source);
      }
    }
  });
});

describe("checkComponentReadiness", () => {
  it("returns empty when all required non-brief components are available", () => {
    const unresolvable = checkComponentReadiness("business-card", {
      hasLogoAsset: true, hasBrandDna: true, hasAssetLibrary: true,
    });
    expect(unresolvable).toHaveLength(0);
  });

  it("returns font-pairing when brand-dna is missing for business-card", () => {
    const unresolvable = checkComponentReadiness("business-card", {
      hasLogoAsset: false, hasBrandDna: false, hasAssetLibrary: true,
    });
    expect(unresolvable).toContain("font-pairing");
  });

  it("does not flag optional logo-asset as unresolvable when missing", () => {
    // logo-asset is optional for business-card — should not appear in unresolvable list
    const unresolvable = checkComponentReadiness("business-card", {
      hasLogoAsset: false, hasBrandDna: true, hasAssetLibrary: true,
    });
    expect(unresolvable).not.toContain("logo-asset");
  });

  it("certificate: returns empty when all non-brief required components are available", () => {
    const unresolvable = checkComponentReadiness("certificate", {
      hasLogoAsset: false, hasBrandDna: false, hasAssetLibrary: false,
    });
    // certificate's required components are mostly from brief or generated
    expect(unresolvable).toHaveLength(0);
  });
});
