/**
 * seedCatalogContract.test.ts — UAT regression: Presentation Document seed contract
 *
 * Covers:
 * - All 8 pd-* service codes are defined in seedCatalog
 * - Service codes are unique within the presentation-document category
 * - Re-running catalog definition doesn't produce duplicate service codes
 * - presentation-document category has the correct number of services
 * - creative services remain in the 'creative' category (no category corruption)
 */
import { describe, it, expect } from "vitest";

// Import the raw catalog data from the seed file (no DB needed)
// We test the data contract at the module level.
import { CATEGORIES, SERVICES } from "../../seedCatalog.js";

const PD_REQUIRED_CODES = [
  "pd-pitch-deck",
  "pd-business-proposal",
  "pd-company-profile-doc",
  "pd-annual-report",
  "pd-executive-summary",
  "pd-product-catalog",
  "pd-meeting-deck",
  "pd-training-material",
] as const;

describe("Presentation Document seed contract", () => {
  it("✓ presentation-document category is defined", () => {
    const cat = CATEGORIES.find((c) => c.code === "presentation-document");
    expect(cat).toBeDefined();
    expect(cat?.name).toBeTruthy();
  });

  it("✓ all 8 pd-* service codes are present", () => {
    const pdServices = SERVICES["presentation-document"] ?? [];
    const definedCodes = pdServices.map((s) => s.serviceCode);

    for (const code of PD_REQUIRED_CODES) {
      expect(definedCodes, `Missing service code: ${code}`).toContain(code);
    }
  });

  it("✓ presentation-document has exactly 8 services", () => {
    const pdServices = SERVICES["presentation-document"] ?? [];
    expect(pdServices).toHaveLength(8);
  });

  it("✓ service codes within presentation-document are unique (no duplicates)", () => {
    const pdServices = SERVICES["presentation-document"] ?? [];
    const codes = pdServices.map((s) => s.serviceCode);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });

  it("✓ service codes across ALL categories are globally unique", () => {
    const allCodes: string[] = [];
    for (const services of Object.values(SERVICES)) {
      for (const svc of services) {
        allCodes.push(svc.serviceCode);
      }
    }
    const unique = new Set(allCodes);
    expect(unique.size).toBe(allCodes.length);
  });

  it("✓ creative services remain under 'creative' category (no category corruption)", () => {
    const creativeServices = SERVICES["creative"] ?? [];
    expect(creativeServices.length).toBeGreaterThan(0);

    // None of the creative services should appear in presentation-document
    const pdCodes = new Set((SERVICES["presentation-document"] ?? []).map((s) => s.serviceCode));
    for (const svc of creativeServices) {
      expect(pdCodes, `Creative service '${svc.serviceCode}' leaked into presentation-document`).not.toContain(svc.serviceCode);
    }
  });

  it("✓ all pd-* services have a valid serviceCode format", () => {
    const pdServices = SERVICES["presentation-document"] ?? [];
    for (const svc of pdServices) {
      expect(svc.serviceCode).toMatch(/^pd-[a-z0-9-]+$/);
    }
  });

  it("✓ categories list has no duplicate codes", () => {
    const codes = CATEGORIES.map((c) => c.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});
