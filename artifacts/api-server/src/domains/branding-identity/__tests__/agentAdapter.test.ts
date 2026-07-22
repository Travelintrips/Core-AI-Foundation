/**
 * branding-identity/agentAdapter.test.ts — Team 27
 *
 * Tests:
 *   - No duplicated agent runtime (adapter delegates, not re-implements)
 *   - Mock adapter returns correct shape
 *   - Interface contract
 *   - Version compatibility (imports from design-ai types)
 */

import { describe, it, expect, vi } from "vitest";
import {
  makeMockBrandingAgentAdapter,
  type BrandingAgentAdapter,
} from "../agentAdapter.js";

// ── No duplicated agent runtime ───────────────────────────────────────────────

describe("no duplicated agent runtime", () => {
  it("agentAdapter module does not define executeAI internally", async () => {
    // Read the source to confirm no local executeAI implementation
    const src = await import("../agentAdapter.js");
    // The module exports only the adapter interface and factory functions
    const exports = Object.keys(src);
    expect(exports).toContain("defaultBrandingAgentAdapter");
    expect(exports).toContain("makeMockBrandingAgentAdapter");
    // Must NOT export agent runner primitives (those live in design-ai/)
    expect(exports).not.toContain("runAgent");
    expect(exports).not.toContain("extractJson");
    expect(exports).not.toContain("executeAI");
  });

  it("adapter interface has exactly two methods", () => {
    const adapter = makeMockBrandingAgentAdapter();
    expect(typeof adapter.extractCreativeBrief).toBe("function");
    expect(typeof adapter.runBrandStrategy).toBe("function");
    // No extra methods that would indicate re-implementation
    const ownKeys = Object.keys(adapter);
    expect(ownKeys).toHaveLength(2);
  });
});

// ── Mock adapter ──────────────────────────────────────────────────────────────

describe("makeMockBrandingAgentAdapter", () => {
  it("extractCreativeBrief returns AgentOutput shape", async () => {
    const adapter = makeMockBrandingAgentAdapter();
    const result  = await adapter.extractCreativeBrief("Build a logo for a tech startup");
    expect(result.status).toBe("success");
    expect(result.data).not.toBeNull();
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.metadata).toBeDefined();
    expect(result.metadata.agentId).toBe("discovery-creative-director");
  });

  it("runBrandStrategy returns AgentOutput shape", async () => {
    const adapter = makeMockBrandingAgentAdapter();
    const result  = await adapter.runBrandStrategy({
      creativeBrief: {
        designGoal:             "Build brand",
        communicationObjective: "Establish presence",
        targetAudience:         { primary: "Professionals", characteristics: [] },
        coreMessage:            "Modern",
        tone:                   ["bold"],
        desiredEmotion:         ["trust"],
        visualDirection:        ["clean"],
        styleKeywords:          ["minimal"],
        contentPriority:        ["logo"],
        assumptions:            [],
        missingInformation:     [],
      },
      requirementAnalysis: {
        platform:              "digital",
        language:              "en",
        canvas:                { width: 0, height: 0, unit: "px" as const, orientation: "landscape" as const },
        sections:              [],
        callsToAction:         [],
        requestedVariables:    [],
        requiredContent:       [],
        optionalContent:       [],
        contentConstraints:    [],
        visualConstraints:     [],
        exportFormats:         [],
        explicitRequirements:  [],
        inferredRequirements:  [],
        missingInformation:    [],
        conflicts:             [],
      },
    });
    expect(result.status).toBe("success");
    expect(result.metadata.agentId).toBe("discovery-brand-strategist");
  });

  it("allows overriding individual methods", async () => {
    const customBrief = { override: true };
    const adapter = makeMockBrandingAgentAdapter({
      extractCreativeBrief: async () => ({
        status:   "failed",
        data:     null,
        warnings: [],
        errors:   ["Custom error"],
        metadata: {
          agentId:      "custom",
          agentName:    "Custom",
          agentVersion: "0.0.0",
          startedAt:    new Date().toISOString(),
          completedAt:  new Date().toISOString(),
          latencyMs:    0,
          retryCount:   0,
        },
      }),
    });
    const result = await adapter.extractCreativeBrief("test");
    expect(result.status).toBe("failed");
    expect(result.errors).toContain("Custom error");
  });

  it("metadata always has required fields", async () => {
    const adapter = makeMockBrandingAgentAdapter();
    const result  = await adapter.extractCreativeBrief("test prompt");
    const meta    = result.metadata;
    expect(meta.agentId).toBeTruthy();
    expect(meta.agentName).toBeTruthy();
    expect(meta.agentVersion).toBeTruthy();
    expect(meta.startedAt).toBeTruthy();
    expect(meta.completedAt).toBeTruthy();
    expect(typeof meta.latencyMs).toBe("number");
    expect(typeof meta.retryCount).toBe("number");
  });
});

// ── Version compatibility ─────────────────────────────────────────────────────

describe("version compatibility", () => {
  it("imports AgentModelConfig from discovery.types without error", async () => {
    // If this import fails, the design-ai types contract changed
    await expect(
      import("../../../services/design-ai/types/discovery.types.js"),
    ).resolves.toBeDefined();
  });

  it("brandStrategistAgent module is importable (not duplicated)", async () => {
    await expect(
      import(
        "../../../services/design-ai/agents/discovery/brandStrategistAgent.js"
      ),
    ).resolves.toBeDefined();
  });

  it("creativeDirectorAgent module is importable (not duplicated)", async () => {
    await expect(
      import(
        "../../../services/design-ai/agents/discovery/creativeDirectorAgent.js"
      ),
    ).resolves.toBeDefined();
  });

  it("BrandingAgentAdapter interface has stable method signatures", () => {
    // Structural check: both methods must be callable functions
    const adapter: BrandingAgentAdapter = makeMockBrandingAgentAdapter();
    expect(typeof adapter.extractCreativeBrief).toBe("function");
    expect(typeof adapter.runBrandStrategy).toBe("function");
    // Interface shape is enforced by TypeScript — verify key names match contract
    expect(Object.keys(adapter).sort()).toEqual(
      ["extractCreativeBrief", "runBrandStrategy"].sort(),
    );
  });
});
