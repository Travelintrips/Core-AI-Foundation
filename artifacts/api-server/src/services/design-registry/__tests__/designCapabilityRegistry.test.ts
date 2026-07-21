/**
 * designCapabilityRegistry.test.ts
 *
 * Covers:
 *  - register capability (success)
 *  - duplicate registration (collision)
 *  - get by id (found / not found)
 *  - list all
 *  - listByStage
 *  - listByDomain
 *  - findByAiCapabilityRef (legacy AI capability mapping)
 *  - resolve — exact match (CapabilityResolver)
 *  - resolve — not found → explicit unsupported result
 *  - resolve — verifySchemas detects missing schema
 *  - resolveByStage — found / empty
 *  - availability — worker available
 *  - availability — worker unavailable
 *  - availability — platform-managed kind (always available)
 *  - availability — unknown capability
 *  - resolver explanation content
 *  - guardrail metadata preserved in resolved entry
 *  - version compatibility explanation
 *  - serialization stability
 */

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod/v4";
import {
  DesignSchemaRegistry,
  DesignCapabilityRegistry,
  CapabilityResolver,
  CapabilityAvailabilityChecker,
  CapabilityRegistrationCollisionError,
} from "../index.js";
import type { DesignCapabilityEntry, DesignSchemaEntry, WorkerAvailabilityPort } from "../index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCapability(overrides: Partial<DesignCapabilityEntry> = {}): DesignCapabilityEntry {
  return {
    id: "design:test:brief:analyze",
    domain: "test",
    stageApplicability: ["brief"],
    executionKind: "ai_text",
    inputSchemaId: "test.input",
    outputSchemaId: "test.output",
    costObservabilityRequired: true,
    description: "Test capability",
    ...overrides,
  };
}

function makeSchemaEntry(id: string, version = "1.0.0"): DesignSchemaEntry {
  return {
    id,
    version,
    category: "brief",
    validator: z.object({ field: z.string() }),
    compatibilityMetadata: {},
  };
}

function makeWorkerPort(types: string[]): WorkerAvailabilityPort {
  return {
    getRegisteredWorkerTypes: async () => types,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("DesignCapabilityRegistry", () => {
  let capReg: DesignCapabilityRegistry;
  let schemaReg: DesignSchemaRegistry;
  let resolver: CapabilityResolver;

  beforeEach(() => {
    capReg = new DesignCapabilityRegistry();
    schemaReg = new DesignSchemaRegistry();
    resolver = new CapabilityResolver(capReg, schemaReg);
  });

  // ── Registration ────────────────────────────────────────────────────────────

  it("registers a capability successfully", () => {
    capReg.register(makeCapability());
    expect(capReg.size).toBe(1);
  });

  it("throws CapabilityRegistrationCollisionError on duplicate id", () => {
    capReg.register(makeCapability());
    expect(() => capReg.register(makeCapability())).toThrow(CapabilityRegistrationCollisionError);
    expect(() => capReg.register(makeCapability())).toThrow(/collision/i);
  });

  it("allows registering capabilities with different ids", () => {
    capReg.register(makeCapability({ id: "design:a:brief:analyze" }));
    capReg.register(makeCapability({ id: "design:b:brief:analyze" }));
    expect(capReg.size).toBe(2);
  });

  // ── Retrieval ───────────────────────────────────────────────────────────────

  it("gets a capability by id", () => {
    capReg.register(makeCapability({ id: "design:test:brief:analyze" }));
    const entry = capReg.get("design:test:brief:analyze");
    expect(entry?.id).toBe("design:test:brief:analyze");
  });

  it("returns undefined for an unregistered id", () => {
    expect(capReg.get("not.registered")).toBeUndefined();
  });

  // ── List ────────────────────────────────────────────────────────────────────

  it("list() returns all capabilities", () => {
    capReg.register(makeCapability({ id: "cap:a" }));
    capReg.register(makeCapability({ id: "cap:b" }));
    expect(capReg.list()).toHaveLength(2);
  });

  it("listByStage returns capabilities for the given stage", () => {
    capReg.register(makeCapability({ id: "cap:brief", stageApplicability: ["brief"] }));
    capReg.register(makeCapability({ id: "cap:export", stageApplicability: ["export"] }));
    expect(capReg.listByStage("brief")).toHaveLength(1);
    expect(capReg.listByStage("export")).toHaveLength(1);
    expect(capReg.listByStage("concept")).toHaveLength(0);
  });

  it("listByStage filters by executionKind when provided", () => {
    capReg.register(makeCapability({ id: "cap:text", stageApplicability: ["brief"], executionKind: "ai_text" }));
    capReg.register(makeCapability({ id: "cap:image", stageApplicability: ["brief"], executionKind: "ai_image" }));
    expect(capReg.listByStage("brief", "ai_text")).toHaveLength(1);
    expect(capReg.listByStage("brief", "ai_image")).toHaveLength(1);
    expect(capReg.listByStage("brief", "render")).toHaveLength(0);
  });

  it("listByDomain filters capabilities by domain", () => {
    capReg.register(makeCapability({ id: "cap:fashion", domain: "fashion" }));
    capReg.register(makeCapability({ id: "cap:interior", domain: "interior" }));
    expect(capReg.listByDomain("fashion")).toHaveLength(1);
    expect(capReg.listByDomain("packaging")).toHaveLength(0);
  });

  // ── Legacy AI capability mapping ─────────────────────────────────────────────

  it("findByAiCapabilityRef locates capabilities referencing an existing skill", () => {
    capReg.register(makeCapability({ id: "cap:a", aiCapabilityRef: "creative_brief" }));
    capReg.register(makeCapability({ id: "cap:b", aiCapabilityRef: "creative_brief" }));
    capReg.register(makeCapability({ id: "cap:c", aiCapabilityRef: "image_generation" }));
    expect(capReg.findByAiCapabilityRef("creative_brief")).toHaveLength(2);
    expect(capReg.findByAiCapabilityRef("image_generation")).toHaveLength(1);
    expect(capReg.findByAiCapabilityRef("nonexistent")).toHaveLength(0);
  });

  // ── Resolution (CapabilityResolver) ─────────────────────────────────────────

  it("resolves a registered capability (found=true)", () => {
    capReg.register(makeCapability());
    const result = resolver.resolve("design:test:brief:analyze");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.capability.id).toBe("design:test:brief:analyze");
      expect(result.explanation).toMatch(/resolved/i);
    }
  });

  it("returns found=false with explanation for unregistered capability", () => {
    const result = resolver.resolve("not.registered");
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.capabilityId).toBe("not.registered");
      expect(result.explanation).toMatch(/not registered/i);
    }
  });

  it("verifySchemas=true returns found=false when input schema is missing", () => {
    capReg.register(makeCapability({ inputSchemaId: "missing.input", outputSchemaId: "missing.output" }));
    const result = resolver.resolve("design:test:brief:analyze", { verifySchemas: true });
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.explanation).toMatch(/unregistered schema/i);
    }
  });

  it("verifySchemas=true succeeds when schemas are registered", () => {
    schemaReg.register(makeSchemaEntry("test.input"));
    schemaReg.register(makeSchemaEntry("test.output"));
    capReg.register(makeCapability());
    const result = resolver.resolve("design:test:brief:analyze", { verifySchemas: true });
    expect(result.found).toBe(true);
  });

  it("resolver explanation includes executionKind and domain", () => {
    capReg.register(makeCapability({ domain: "fashion", executionKind: "ai_image" }));
    const result = resolver.resolve("design:test:brief:analyze");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.explanation).toMatch(/ai_image/);
      expect(result.explanation).toMatch(/fashion/);
    }
  });

  it("resolver explanation includes aiCapabilityRef when present", () => {
    capReg.register(makeCapability({ aiCapabilityRef: "creative_brief" }));
    const result = resolver.resolve("design:test:brief:analyze");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.explanation).toMatch(/creative_brief/);
    }
  });

  // ── resolveByStage ───────────────────────────────────────────────────────────

  it("resolveByStage returns all matching capabilities", () => {
    capReg.register(makeCapability({ id: "cap:a", stageApplicability: ["brief", "moodboard"] }));
    capReg.register(makeCapability({ id: "cap:b", stageApplicability: ["brief"] }));
    const result = resolver.resolveByStage("brief");
    expect(result.capabilities).toHaveLength(2);
    expect(result.explanation).toMatch(/2 capability/i);
  });

  it("resolveByStage returns empty with explanation when no match", () => {
    const result = resolver.resolveByStage("export");
    expect(result.capabilities).toHaveLength(0);
    expect(result.explanation).toMatch(/no capabilities/i);
  });

  // ── Guardrail metadata ───────────────────────────────────────────────────────

  it("preserves guardrailOverrides in the resolved capability entry", () => {
    const overrides = { maxCostPerRequest: 0.25, providerTimeoutMs: 30000, fallbackEnabled: false };
    capReg.register(makeCapability({ guardrailOverrides: overrides }));
    const result = resolver.resolve("design:test:brief:analyze");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.capability.guardrailOverrides).toEqual(overrides);
    }
  });

  // ── Availability (CapabilityAvailabilityChecker) ─────────────────────────────

  describe("CapabilityAvailabilityChecker", () => {
    it("returns available=true when required worker type is present", async () => {
      capReg.register(makeCapability({ executionKind: "ai_text" }));
      const checker = new CapabilityAvailabilityChecker(capReg, makeWorkerPort(["text_worker"]));
      const result = await checker.check("design:test:brief:analyze");
      expect(result.available).toBe(true);
      expect(result.workerType).toBe("text_worker");
    });

    it("returns available=false when required worker type is absent", async () => {
      capReg.register(makeCapability({ executionKind: "ai_text" }));
      const checker = new CapabilityAvailabilityChecker(capReg, makeWorkerPort(["image_worker"]));
      const result = await checker.check("design:test:brief:analyze");
      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/text_worker/);
    });

    it("returns available=true for platform-managed executionKind (pure)", async () => {
      capReg.register(makeCapability({ executionKind: "pure" }));
      const checker = new CapabilityAvailabilityChecker(capReg, makeWorkerPort([]));
      const result = await checker.check("design:test:brief:analyze");
      expect(result.available).toBe(true);
      expect(result.workerType).toBeUndefined();
      expect(result.reason).toMatch(/platform-managed/i);
    });

    it("returns available=true for human_review (platform-managed)", async () => {
      capReg.register(makeCapability({ executionKind: "human_review" }));
      const checker = new CapabilityAvailabilityChecker(capReg, makeWorkerPort([]));
      const result = await checker.check("design:test:brief:analyze");
      expect(result.available).toBe(true);
    });

    it("returns available=false for an unregistered capability", async () => {
      const checker = new CapabilityAvailabilityChecker(capReg, makeWorkerPort(["text_worker"]));
      const result = await checker.check("not.registered");
      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/not registered/i);
    });

    it("returns available=false when worker port throws", async () => {
      capReg.register(makeCapability({ executionKind: "ai_image" }));
      const failingPort: WorkerAvailabilityPort = {
        getRegisteredWorkerTypes: async () => { throw new Error("cluster unreachable"); },
      };
      const checker = new CapabilityAvailabilityChecker(capReg, failingPort);
      const result = await checker.check("design:test:brief:analyze");
      expect(result.available).toBe(false);
      expect(result.reason).toMatch(/cluster unreachable/i);
    });

    it("checkMany returns results for all requested capabilities", async () => {
      capReg.register(makeCapability({ id: "cap:a", executionKind: "ai_text" }));
      capReg.register(makeCapability({ id: "cap:b", executionKind: "ai_image" }));
      const checker = new CapabilityAvailabilityChecker(
        capReg,
        makeWorkerPort(["text_worker", "image_worker"]),
      );
      const results = await checker.checkMany(["cap:a", "cap:b"]);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.available)).toBe(true);
    });
  });

  // ── Version compatibility ─────────────────────────────────────────────────────

  describe("schema version compatibility", () => {
    it("returns compatible=true within range", () => {
      schemaReg.register(
        makeSchemaEntry("compat.schema", "2.0.0"),
      );
      // Patch to add version range
      const entry = schemaReg.get("compat.schema")!;
      (entry.compatibilityMetadata as { minVersion?: string; maxVersion?: string }).minVersion = "1.0.0";
      (entry.compatibilityMetadata as { minVersion?: string; maxVersion?: string }).maxVersion = "3.0.0";

      expect(resolver.isSchemaVersionCompatible("compat.schema", "2.5.0")).toBe(true);
    });

    it("returns compatible=false below minVersion", () => {
      schemaReg.register(makeSchemaEntry("compat.schema", "2.0.0"));
      const entry = schemaReg.get("compat.schema")!;
      (entry.compatibilityMetadata as { minVersion?: string }).minVersion = "2.0.0";
      expect(resolver.isSchemaVersionCompatible("compat.schema", "1.9.9")).toBe(false);
    });

    it("explainSchemaCompatibility reports the reason", () => {
      schemaReg.register(makeSchemaEntry("compat.schema", "1.0.0"));
      const explanation = resolver.explainSchemaCompatibility("compat.schema", "1.0.0");
      expect(explanation).toMatch(/compatible/i);
    });

    it("explainSchemaCompatibility reports NOT for unregistered schema", () => {
      const explanation = resolver.explainSchemaCompatibility("missing.schema", "1.0.0");
      expect(explanation).toMatch(/not registered/i);
    });
  });

  // ── Serialization stability ─────────────────────────────────────────────────

  it("non-function fields of a capability round-trip through JSON", () => {
    const cap = makeCapability({
      id: "cap:stable",
      domain: "packaging",
      aiCapabilityRef: "creative_brief",
      guardrailOverrides: { maxCostPerRequest: 0.2 },
      costObservabilityRequired: true,
    });
    capReg.register(cap);
    const stored = capReg.get("cap:stable")!;

    const serialized = JSON.stringify({
      id: stored.id,
      domain: stored.domain,
      aiCapabilityRef: stored.aiCapabilityRef,
      stageApplicability: stored.stageApplicability,
      executionKind: stored.executionKind,
      inputSchemaId: stored.inputSchemaId,
      outputSchemaId: stored.outputSchemaId,
      guardrailOverrides: stored.guardrailOverrides,
      costObservabilityRequired: stored.costObservabilityRequired,
    });

    const parsed = JSON.parse(serialized);
    expect(parsed.id).toBe("cap:stable");
    expect(parsed.domain).toBe("packaging");
    expect(parsed.aiCapabilityRef).toBe("creative_brief");
    expect(parsed.guardrailOverrides.maxCostPerRequest).toBe(0.2);
  });

  // ── Clear ───────────────────────────────────────────────────────────────────

  it("clear() empties the registry", () => {
    capReg.register(makeCapability());
    capReg.clear();
    expect(capReg.size).toBe(0);
    expect(capReg.list()).toHaveLength(0);
  });
});
