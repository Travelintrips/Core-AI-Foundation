/**
 * deliverableManifest.test.ts — Team 15 Graphic Design
 *
 * Tests for manifest building: tier gating, file listing, print spec embedding,
 * and QC summary propagation.
 */

import { describe, it, expect } from "vitest";
import {
  buildGdManifest,
  getExpectedFileNames,
  GD_DELIVERABLE_TEMPLATES,
} from "../deliverableManifest.js";
import { GRAPHIC_DESIGN_SERVICES, GD_PACKAGE_TIERS } from "../types.js";

// ── getExpectedFileNames ──────────────────────────────────────────────────────

describe("getExpectedFileNames", () => {
  it("logo starter: includes primary SVG, icon PNG, brand-colors, manifest, qc-report", () => {
    const files = getExpectedFileNames("logo", "starter");
    expect(files).toContain("logo-primary.svg");
    expect(files).toContain("logo-icon.png");
    expect(files).toContain("brand-colors.json");
    expect(files).toContain("manifest.json");
    expect(files).toContain("qc-report.json");
  });

  it("logo starter: does NOT include source EPS (business/enterprise only)", () => {
    const files = getExpectedFileNames("logo", "starter");
    expect(files).not.toContain("logo-primary.eps");
  });

  it("logo enterprise: includes source EPS and usage guidelines", () => {
    const files = getExpectedFileNames("logo", "enterprise");
    expect(files).toContain("logo-primary.eps");
    expect(files).toContain("usage-guidelines.pdf");
  });

  it("business-card starter: includes front PDF but not back PDF", () => {
    const starterFiles = getExpectedFileNames("business-card", "starter");
    expect(starterFiles).toContain("business-card-front.pdf");
    expect(starterFiles).not.toContain("business-card-back.pdf");
  });

  it("business-card professional: includes back PDF", () => {
    const proFiles = getExpectedFileNames("business-card", "professional");
    expect(proFiles).toContain("business-card-back.pdf");
  });

  it("social-media enterprise: includes all platform variants", () => {
    const files = getExpectedFileNames("social-media", "enterprise");
    expect(files).toContain("instagram-post.png");
    expect(files).toContain("instagram-story.png");
    expect(files).toContain("linkedin-banner.png");
    expect(files).toContain("tiktok-cover.png");
  });

  it("social-media starter: does NOT include tiktok or linkedin", () => {
    const files = getExpectedFileNames("social-media", "starter");
    expect(files).not.toContain("tiktok-cover.png");
    expect(files).not.toContain("linkedin-banner.png");
  });

  it("stationery enterprise: includes notepad-cover", () => {
    const files = getExpectedFileNames("stationery", "enterprise");
    expect(files).toContain("notepad-cover.pdf");
  });

  it("certificate starter: does NOT include source .ai", () => {
    const files = getExpectedFileNames("certificate", "starter");
    expect(files).not.toContain("certificate.ai");
  });
});

// ── buildGdManifest ───────────────────────────────────────────────────────────

const LOGO_QC = { score: 82, passed: true, warnings: [] };

function makeProducedFiles(names: string[]) {
  return names.map((fileName) => ({
    fileName,
    storagePath: `gd/logo/${fileName}`,
    fileSizeBytes: 1024,
    checksumSha256: "abc123",
  }));
}

describe("buildGdManifest — logo starter", () => {
  const producedFiles = makeProducedFiles([
    "logo-primary.svg", "logo-primary.png", "logo-icon.png",
    "brand-colors.json", "manifest.json", "qc-report.json",
  ]);

  it("builds a valid manifest", () => {
    const manifest = buildGdManifest({
      gdRequestId: 42,
      serviceCode: "logo",
      packageTier: "starter",
      tenantId: "cst",
      producedFiles,
      qcSummary: LOGO_QC,
    });

    expect(manifest.version).toBe("1.0");
    expect(manifest.gdRequestId).toBe(42);
    expect(manifest.serviceCode).toBe("logo");
    expect(manifest.packageTier).toBe("starter");
    expect(manifest.tenantId).toBe("cst");
    expect(manifest.deliverables.length).toBeGreaterThan(0);
    expect(manifest.qcSummary.passed).toBe(true);
    expect(manifest.qcSummary.score).toBe(82);
  });

  it("printSpec is null for digital-only services", () => {
    const manifest = buildGdManifest({
      gdRequestId: 42, serviceCode: "logo", packageTier: "starter",
      tenantId: "cst", producedFiles, qcSummary: LOGO_QC,
    });
    expect(manifest.printSpec).toBeNull();
  });

  it("only includes files that were actually produced", () => {
    const subset = makeProducedFiles(["logo-primary.svg", "manifest.json"]);
    const manifest = buildGdManifest({
      gdRequestId: 1, serviceCode: "logo", packageTier: "starter",
      tenantId: "t1", producedFiles: subset, qcSummary: LOGO_QC,
    });
    const names = manifest.deliverables.map((d) => d.fileName);
    expect(names).toContain("logo-primary.svg");
    expect(names).not.toContain("logo-primary.png");   // not produced
  });
});

describe("buildGdManifest — business-card (print service)", () => {
  const files = makeProducedFiles([
    "business-card-front.pdf", "business-card-preview.png", "manifest.json", "qc-report.json",
  ]);

  it("includes non-null printSpec for print services", () => {
    const manifest = buildGdManifest({
      gdRequestId: 10, serviceCode: "business-card", packageTier: "starter",
      tenantId: "acme", producedFiles: files, qcSummary: { score: 70, passed: true, warnings: [] },
    });
    expect(manifest.printSpec).not.toBeNull();
    expect(manifest.printSpec?.widthMm).toBe(88.9);
    expect(manifest.printSpec?.bleedMm).toBe(3.175);
    expect(manifest.printSpec?.colorMode).toBe("cmyk");
  });
});

describe("buildGdManifest — exportedAt is a valid ISO datetime", () => {
  it("exportedAt parses as a valid Date", () => {
    const manifest = buildGdManifest({
      gdRequestId: 1, serviceCode: "flyer", packageTier: "starter",
      tenantId: "t1", producedFiles: makeProducedFiles(["flyer-front.pdf","manifest.json"]),
      qcSummary: { score: 65, passed: true, warnings: [] },
    });
    const d = new Date(manifest.exportedAt);
    expect(isNaN(d.getTime())).toBe(false);
  });
});

// ── Template coverage ─────────────────────────────────────────────────────────

describe("GD_DELIVERABLE_TEMPLATES coverage", () => {
  it("every service has templates defined", () => {
    for (const code of GRAPHIC_DESIGN_SERVICES) {
      expect(GD_DELIVERABLE_TEMPLATES[code]).toBeDefined();
      expect(GD_DELIVERABLE_TEMPLATES[code].length).toBeGreaterThan(0);
    }
  });

  it("every service has at least one primary deliverable", () => {
    for (const code of GRAPHIC_DESIGN_SERVICES) {
      const templates = GD_DELIVERABLE_TEMPLATES[code];
      expect(templates.some((t) => t.purpose === "primary")).toBe(true);
    }
  });

  it("every service has manifest.json and qc-report.json in all tiers", () => {
    for (const code of GRAPHIC_DESIGN_SERVICES) {
      for (const tier of GD_PACKAGE_TIERS) {
        const files = getExpectedFileNames(code, tier);
        expect(files).toContain("manifest.json");
        expect(files).toContain("qc-report.json");
      }
    }
  });

  it("enterprise always has a superset of starter files", () => {
    for (const code of GRAPHIC_DESIGN_SERVICES) {
      const starter = new Set(getExpectedFileNames(code, "starter"));
      const enterprise = new Set(getExpectedFileNames(code, "enterprise"));
      for (const f of starter) {
        expect(enterprise.has(f)).toBe(true);
      }
    }
  });
});
