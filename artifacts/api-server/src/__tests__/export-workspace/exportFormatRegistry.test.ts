/**
 * Tests for ExportFormatRegistry — Team 17
 * Covers: registration, duplicate rejection, capability filtering,
 * preset validation, honest unavailability.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ExportFormatRegistry,
  type ExportFormatDefinition,
  type ExportPreset,
} from "../../services/export-workspace/exportFormatRegistry.js";

// Helper: minimal valid format definition
function makeFormat(overrides: Partial<ExportFormatDefinition> = {}): ExportFormatDefinition {
  return {
    formatId: "test_pdf",
    label: "Test PDF",
    mimeType: "application/pdf",
    engineType: "document",
    extension: "pdf",
    supportsResolution: false,
    supportsDimensions: false,
    supportsQuality: false,
    supportsCompression: false,
    supportsBackground: true,
    supportsAnnotations: false,
    supportsPageSelection: true,
    supportsVersionSelection: true,
    supportsMetadata: true,
    supportsFilename: true,
    domains: [],
    available: true,
    estimatedCostCentsPerPage: 0,
    estimatedSecondsPerPage: 4,
    maxFileSizeMb: 50,
    ...overrides,
  };
}

function makePreset(formatId: string, overrides: Partial<ExportPreset> = {}): ExportPreset {
  return {
    presetId: "test_preset",
    label: "Test Preset",
    formatId,
    settings: { formatId },
    domains: [],
    builtIn: true,
    ...overrides,
  };
}

// ── 1. Format registry ────────────────────────────────────────────────────────

describe("ExportFormatRegistry — format registration", () => {
  let registry: ExportFormatRegistry;

  beforeEach(() => {
    registry = new ExportFormatRegistry();
  });

  it("registers a valid format", () => {
    registry.register(makeFormat());
    expect(registry.size).toBe(1);
  });

  it("retrieves a registered format by formatId", () => {
    const def = makeFormat();
    registry.register(def);
    expect(registry.getFormat("test_pdf")).toEqual(def);
  });

  it("returns undefined for an unknown formatId", () => {
    expect(registry.getFormat("nonexistent")).toBeUndefined();
  });

  // ── 2. Duplicate format rejection ────────────────────────────────────────

  it("throws on duplicate formatId registration", () => {
    registry.register(makeFormat());
    expect(() => registry.register(makeFormat())).toThrow(/duplicate formatId/);
  });

  it("allows registering formats with different IDs", () => {
    registry.register(makeFormat({ formatId: "pdf" }));
    registry.register(makeFormat({ formatId: "pptx", label: "PPTX" }));
    expect(registry.size).toBe(2);
  });

  // ── 3. Capability filtering ──────────────────────────────────────────────

  it("listFormats returns all formats when no domain filter", () => {
    registry.register(makeFormat({ formatId: "pdf" }));
    registry.register(makeFormat({ formatId: "png", label: "PNG", domains: ["graphic_design"] }));
    expect(registry.listFormats()).toHaveLength(2);
  });

  it("listFormats filters by domain — includes domain-scoped formats and universal formats", () => {
    registry.register(makeFormat({ formatId: "pdf", domains: [] }));
    registry.register(makeFormat({ formatId: "png", label: "PNG", domains: ["graphic_design"] }));
    registry.register(makeFormat({ formatId: "svg", label: "SVG", domains: ["interior"] }));

    const results = registry.listFormats({ domain: "graphic_design" });
    const ids = results.map((f) => f.formatId);
    expect(ids).toContain("pdf");     // universal
    expect(ids).toContain("png");     // graphic_design domain
    expect(ids).not.toContain("svg"); // interior only
  });

  it("getCapability returns null for unknown format", () => {
    expect(registry.getCapability("unknown")).toBeNull();
  });

  it("getCapability marks available=false for unavailable format", () => {
    registry.register(makeFormat({
      formatId: "svg",
      available: false,
      unavailableReason: "SVG not wired",
    }));
    const cap = registry.getCapability("svg");
    expect(cap?.available).toBe(false);
    expect(cap?.unavailableReason).toBe("SVG not wired");
  });

  it("getCapability marks available=false when domain is not supported", () => {
    registry.register(makeFormat({ formatId: "pdf", domains: ["fashion"] }));
    const cap = registry.getCapability("pdf", "interior");
    expect(cap?.available).toBe(false);
    expect(cap?.unavailableReason).toMatch(/not available for domain/);
  });

  it("getCapability marks available=true when domain matches", () => {
    registry.register(makeFormat({ formatId: "pdf", domains: ["fashion"] }));
    const cap = registry.getCapability("pdf", "fashion");
    expect(cap?.available).toBe(true);
  });

  it("getCapability marks available=true for universal format (empty domains)", () => {
    registry.register(makeFormat({ formatId: "pdf", domains: [] }));
    const cap = registry.getCapability("pdf", "any_domain");
    expect(cap?.available).toBe(true);
  });

  // ── 4. Preset validation ─────────────────────────────────────────────────

  it("registers a preset for an existing format", () => {
    registry.register(makeFormat({ formatId: "pdf" }));
    registry.registerPreset(makePreset("pdf"));
    expect(registry.listPresets()).toHaveLength(1);
  });

  it("throws on duplicate presetId", () => {
    registry.register(makeFormat({ formatId: "pdf" }));
    registry.registerPreset(makePreset("pdf"));
    expect(() => registry.registerPreset(makePreset("pdf"))).toThrow(/duplicate presetId/);
  });

  it("throws when preset references unknown formatId", () => {
    expect(() => registry.registerPreset(makePreset("unknown_format"))).toThrow(
      /unknown formatId/,
    );
  });

  it("listPresets filters by domain", () => {
    registry.register(makeFormat({ formatId: "pdf" }));
    registry.registerPreset(makePreset("pdf", { presetId: "a", domains: [] }));
    registry.registerPreset(makePreset("pdf", { presetId: "b", domains: ["fashion"] }));
    registry.registerPreset(makePreset("pdf", { presetId: "c", domains: ["interior"] }));

    const results = registry.listPresets({ domain: "fashion" });
    const ids = results.map((p) => p.presetId);
    expect(ids).toContain("a");  // universal
    expect(ids).toContain("b");  // fashion
    expect(ids).not.toContain("c"); // interior only
  });
});
