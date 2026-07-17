/**
 * graphic-design/tests/manifest.test.ts — Team 15
 *
 * Tests for the deliverable manifest factory:
 * - All 10 services produce non-empty manifests
 * - Higher tiers include more files
 * - File keys are unique within each manifest
 * - getRequiredFormats returns deduplicated format strings
 */

import { describe, it, expect } from "vitest";
import { buildDeliverableManifest, getRequiredFormats } from "../manifest.js";
import { GD_SERVICE_CODES } from "../schema.js";

// ── Coverage ──────────────────────────────────────────────────────────────────

describe("buildDeliverableManifest — coverage", () => {
  it("returns a manifest for every service code", () => {
    for (const code of GD_SERVICE_CODES) {
      const manifest = buildDeliverableManifest(code, "standard", "both");
      expect(manifest.serviceCode).toBe(code);
      expect(manifest.files.length).toBeGreaterThan(0);
    }
  });

  it("throws for an unknown service code", () => {
    expect(() => buildDeliverableManifest("GD-UNKNOWN" as never, "standard", "both")).toThrow();
  });
});

// ── Tier progression ──────────────────────────────────────────────────────────

describe("buildDeliverableManifest — tier progression", () => {
  const services = ["GD-LOGO", "GD-BCARD", "GD-SOCIAL", "GD-STATIONERY"] as const;

  for (const code of services) {
    it(`${code}: premium has ≥ standard files`, () => {
      const std  = buildDeliverableManifest(code, "standard", "both");
      const prem = buildDeliverableManifest(code, "premium",  "both");
      expect(prem.files.length).toBeGreaterThanOrEqual(std.files.length);
    });

    it(`${code}: standard has ≥ basic files`, () => {
      const basic = buildDeliverableManifest(code, "basic",    "both");
      const std   = buildDeliverableManifest(code, "standard", "both");
      expect(std.files.length).toBeGreaterThanOrEqual(basic.files.length);
    });
  }
});

// ── File key uniqueness ───────────────────────────────────────────────────────

describe("buildDeliverableManifest — file key uniqueness", () => {
  it("all fileKeys are unique within a manifest", () => {
    for (const code of GD_SERVICE_CODES) {
      for (const tier of ["basic", "standard", "premium"] as const) {
        const manifest = buildDeliverableManifest(code, tier, "both");
        const keys = manifest.files.map((f) => f.fileKey);
        const unique = new Set(keys);
        expect(unique.size, `Duplicate fileKey in ${code}/${tier}`).toBe(keys.length);
      }
    }
  });
});

// ── requiredCount ─────────────────────────────────────────────────────────────

describe("buildDeliverableManifest — requiredCount", () => {
  it("requiredCount matches files where required=true", () => {
    for (const code of GD_SERVICE_CODES) {
      const manifest = buildDeliverableManifest(code, "standard", "both");
      const counted  = manifest.files.filter((f) => f.required).length;
      expect(manifest.requiredCount, `${code} requiredCount mismatch`).toBe(counted);
    }
  });

  it("requiredCount is > 0 for all services", () => {
    for (const code of GD_SERVICE_CODES) {
      const manifest = buildDeliverableManifest(code, "basic", "both");
      expect(manifest.requiredCount, `${code} basic has no required files`).toBeGreaterThan(0);
    }
  });
});

// ── Output format filtering ───────────────────────────────────────────────────

describe("buildDeliverableManifest — outputFormat filtering", () => {
  it("digital-only order omits print-only PDF files", () => {
    const manifest = buildDeliverableManifest("GD-FLYER", "standard", "digital");
    // Should not contain a pure print PDF (non-digital key)
    const printPdfs = manifest.files.filter(
      (f) => f.format === "pdf" && !f.fileKey.includes("digital")
    );
    expect(printPdfs).toHaveLength(0);
  });

  it("print-only order omits animated formats", () => {
    const manifest = buildDeliverableManifest("GD-SOCIAL", "premium", "print");
    const animated = manifest.files.filter((f) => f.format === "gif" || f.format === "mp4");
    expect(animated).toHaveLength(0);
  });

  it("both-format order includes pdf and png", () => {
    const manifest = buildDeliverableManifest("GD-CERT", "standard", "both");
    const formats  = manifest.files.map((f) => f.format);
    expect(formats).toContain("pdf");
    expect(formats).toContain("png");
  });
});

// ── createdAt ─────────────────────────────────────────────────────────────────

describe("buildDeliverableManifest — metadata", () => {
  it("createdAt is a valid ISO string", () => {
    const manifest = buildDeliverableManifest("GD-LOGO", "standard", "both");
    expect(() => new Date(manifest.createdAt)).not.toThrow();
    expect(new Date(manifest.createdAt).toISOString()).toBe(manifest.createdAt);
  });
});

// ── getRequiredFormats ────────────────────────────────────────────────────────

describe("getRequiredFormats", () => {
  it("returns a deduplicated array of format strings", () => {
    const formats = getRequiredFormats("GD-LOGO", "standard", "both");
    expect(formats.length).toBeGreaterThan(0);
    const unique = new Set(formats);
    expect(unique.size).toBe(formats.length);
  });

  it("always includes pdf for print services", () => {
    for (const code of ["GD-FLYER", "GD-POSTER", "GD-BANNER", "GD-BCARD"] as const) {
      const formats = getRequiredFormats(code, "basic", "print");
      expect(formats, `${code} should include pdf`).toContain("pdf");
    }
  });

  it("always includes png for digital-heavy services", () => {
    const formats = getRequiredFormats("GD-SOCIAL", "basic", "digital");
    expect(formats).toContain("png");
  });
});
