/**
 * fixtures.test.ts
 *
 * Verifies that the provided fixture schemas and capabilities:
 *  - register without collision
 *  - can be resolved by id
 *  - reference existing AI capability skills (aiCapabilityRef values match known skills)
 *  - cover the expected domains (fashion, interior, packaging)
 *  - sample data validates correctly against brief schemas
 *  - capabilities applicable to each domain+stage can be listed
 *  - serialization stability of fixture data
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  DesignSchemaRegistry,
  DesignCapabilityRegistry,
  CapabilityResolver,
  registerFixtures,
  FIXTURE_SCHEMAS,
  FIXTURE_CAPABILITIES,
} from "../index.js";

describe("Registry fixtures", () => {
  let schemaReg: DesignSchemaRegistry;
  let capReg: DesignCapabilityRegistry;
  let resolver: CapabilityResolver;

  beforeEach(() => {
    schemaReg = new DesignSchemaRegistry();
    capReg = new DesignCapabilityRegistry();
    resolver = new CapabilityResolver(capReg, schemaReg);
    registerFixtures(schemaReg, capReg);
  });

  // ── Schema registration ─────────────────────────────────────────────────────

  it("registers all fixture schemas without collision", () => {
    expect(schemaReg.size).toBe(FIXTURE_SCHEMAS.length);
  });

  it("all fixture schemas are retrievable by id", () => {
    for (const schema of FIXTURE_SCHEMAS) {
      expect(schemaReg.get(schema.id)).toBeDefined();
    }
  });

  // ── Capability registration ─────────────────────────────────────────────────

  it("registers all fixture capabilities without collision", () => {
    expect(capReg.size).toBe(FIXTURE_CAPABILITIES.length);
  });

  it("all fixture capabilities are retrievable by id", () => {
    for (const cap of FIXTURE_CAPABILITIES) {
      expect(capReg.get(cap.id)).toBeDefined();
    }
  });

  // ── Domain coverage ─────────────────────────────────────────────────────────

  it("covers the fashion domain", () => {
    expect(capReg.listByDomain("fashion").length).toBeGreaterThan(0);
  });

  it("covers the interior domain", () => {
    expect(capReg.listByDomain("interior").length).toBeGreaterThan(0);
  });

  it("covers the packaging domain", () => {
    expect(capReg.listByDomain("packaging").length).toBeGreaterThan(0);
  });

  // ── Stage coverage ──────────────────────────────────────────────────────────

  it("has capabilities for the brief stage across multiple domains", () => {
    const briefCaps = capReg.listByStage("brief");
    const domains = new Set(briefCaps.map((c) => c.domain));
    expect(domains.has("fashion")).toBe(true);
    expect(domains.has("interior")).toBe(true);
    expect(domains.has("packaging")).toBe(true);
  });

  it("has capabilities for the moodboard stage", () => {
    expect(capReg.listByStage("moodboard").length).toBeGreaterThan(0);
  });

  it("has capabilities for the export stage", () => {
    expect(capReg.listByStage("export").length).toBeGreaterThan(0);
  });

  // ── AI capability ref reuse ─────────────────────────────────────────────────

  it("reuses existing AI capability ref 'creative_brief' for brief-stage capabilities", () => {
    const refs = capReg.findByAiCapabilityRef("creative_brief");
    expect(refs.length).toBeGreaterThan(0);
    // All should be brief-stage
    for (const cap of refs) {
      expect(cap.stageApplicability).toContain("brief");
    }
  });

  it("reuses existing AI capability ref 'image_generation' for image capabilities", () => {
    const refs = capReg.findByAiCapabilityRef("image_generation");
    expect(refs.length).toBeGreaterThan(0);
    for (const cap of refs) {
      expect(cap.executionKind).toBe("ai_image");
    }
  });

  // ── Resolution ──────────────────────────────────────────────────────────────

  it("resolves fashion brief capability with schema verification", () => {
    const result = resolver.resolve("design:fashion:brief:analyze", { verifySchemas: true });
    expect(result.found).toBe(true);
  });

  it("resolves interior moodboard capability with schema verification", () => {
    const result = resolver.resolve("design:interior:moodboard:generate", { verifySchemas: true });
    expect(result.found).toBe(true);
  });

  it("resolves packaging spec capability with schema verification", () => {
    const result = resolver.resolve("design:packaging:spec:generate", { verifySchemas: true });
    expect(result.found).toBe(true);
  });

  // ── Schema validation against real fixture validators ───────────────────────

  it("validates a valid fashion brief", () => {
    const result = schemaReg.validate("design.brief.fashion", {
      garmentType: "dress",
      targetMarket: "young women 18-30",
      styleKeywords: ["bohemian", "floral"],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an invalid fashion brief (missing required field)", () => {
    const result = schemaReg.validate("design.brief.fashion", {
      // garmentType is required — missing
      targetMarket: "young women",
      styleKeywords: ["casual"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("validates a valid interior brief", () => {
    const result = schemaReg.validate("design.brief.interior", {
      roomType: "living room",
      designStyle: "Scandinavian",
      squareMeters: 32,
    });
    expect(result.valid).toBe(true);
  });

  it("validates a valid packaging brief", () => {
    const result = schemaReg.validate("design.brief.packaging", {
      productCategory: "skincare",
      packagingType: "bottle",
      brandKeywords: ["clean", "minimal", "luxury"],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects invalid packaging type enum value", () => {
    const result = schemaReg.validate("design.brief.packaging", {
      productCategory: "food",
      packagingType: "tank",   // not in enum
      brandKeywords: ["bold"],
    });
    expect(result.valid).toBe(false);
  });

  // ── Serialization stability ─────────────────────────────────────────────────

  it("fixture capability fields are JSON-serializable", () => {
    for (const cap of FIXTURE_CAPABILITIES) {
      const serializable = {
        id: cap.id,
        domain: cap.domain,
        aiCapabilityRef: cap.aiCapabilityRef,
        stageApplicability: cap.stageApplicability,
        executionKind: cap.executionKind,
        inputSchemaId: cap.inputSchemaId,
        outputSchemaId: cap.outputSchemaId,
        guardrailOverrides: cap.guardrailOverrides,
        costObservabilityRequired: cap.costObservabilityRequired,
      };
      expect(() => JSON.stringify(serializable)).not.toThrow();
      const parsed = JSON.parse(JSON.stringify(serializable));
      expect(parsed.id).toBe(cap.id);
    }
  });

  it("fixture schema non-function fields are JSON-serializable", () => {
    for (const schema of FIXTURE_SCHEMAS) {
      const serializable = {
        id: schema.id,
        version: schema.version,
        category: schema.category,
        description: schema.description,
        compatibilityMetadata: schema.compatibilityMetadata,
      };
      expect(() => JSON.stringify(serializable)).not.toThrow();
      const parsed = JSON.parse(JSON.stringify(serializable));
      expect(parsed.id).toBe(schema.id);
      expect(parsed.version).toBe(schema.version);
    }
  });

  // ── No duplicate source of truth ────────────────────────────────────────────

  it("has no duplicate capability ids across fixtures", () => {
    const ids = FIXTURE_CAPABILITIES.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("has no duplicate schema ids+versions across fixtures", () => {
    const keys = FIXTURE_SCHEMAS.map((s) => `${s.id}@${s.version}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});
