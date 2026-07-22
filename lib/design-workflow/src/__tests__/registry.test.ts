/**
 * WorkflowRegistry Tests
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Covers (per spec):
 * - duplicate version rejection
 * - workflow resolution (by id, by plugin, by service type)
 * - ambiguous query detection
 * - version-specific resolution
 * - explainability of resolution
 */

import { describe, it, expect, beforeEach } from "vitest";
import { WorkflowRegistry, WorkflowRegistryError } from "../registry/WorkflowRegistry.js";
import type { DesignWorkflowDefinition } from "../types/definition.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date("2024-01-01T00:00:00Z");

function makeWorkflow(
  partial: Partial<DesignWorkflowDefinition> & {
    workflowId: string;
    pluginId: string;
    version?: number;
    supportedServiceTypes?: string[];
  },
): DesignWorkflowDefinition {
  const { workflowId, pluginId, version, supportedServiceTypes, ...rest } = partial;
  return {
    workflowId,
    version: version ?? 1,
    name: `${workflowId} workflow`,
    pluginId,
    supportedServiceTypes: supportedServiceTypes ?? ["default_service"],
    stages: [
      {
        id: "stage_a",
        label: "Stage A",
        requiredCapability: "cap_a",
        dependencies: [],
        optional: false,
        repeatable: false,
        parallel: false,
      },
    ],
    requiredCapabilities: ["cap_a"],
    completionPolicy: { type: "all_required" },
    fallbackBehavior: {
      onRequiredStageFailure: "fail_workflow",
      onOptionalStageFailure: "continue",
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...rest,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WorkflowRegistry", () => {
  let registry: WorkflowRegistry;

  beforeEach(() => {
    registry = new WorkflowRegistry();
  });

  // ── Registration ──────────────────────────────────────────────────────────

  it("registers a workflow successfully", () => {
    const def = makeWorkflow({ workflowId: "fashion.full", pluginId: "fashion" });
    expect(() => registry.register(def)).not.toThrow();
    expect(registry.size).toBe(1);
  });

  it("rejects duplicate workflowId + version (DUPLICATE_VERSION)", () => {
    const def = makeWorkflow({ workflowId: "fashion.full", pluginId: "fashion" });
    registry.register(def);
    expect(() => registry.register(def)).toThrow(WorkflowRegistryError);
    try {
      registry.register(def);
    } catch (e) {
      expect((e as WorkflowRegistryError).code).toBe("DUPLICATE_VERSION");
    }
  });

  it("allows registering the same workflowId at a different version", () => {
    const v1 = makeWorkflow({ workflowId: "fashion.full", pluginId: "fashion", version: 1 });
    const v2 = makeWorkflow({
      workflowId: "fashion.full",
      pluginId: "fashion",
      version: 2,
      migrationMetadata: { compatibleFromVersion: 1 },
    });
    registry.register(v1);
    registry.register(v2);
    expect(registry.size).toBe(2);
    expect(registry.getVersions("fashion.full")).toEqual([1, 2]);
  });

  // ── Unregister ────────────────────────────────────────────────────────────

  it("unregisters a workflow", () => {
    const def = makeWorkflow({ workflowId: "fashion.full", pluginId: "fashion" });
    registry.register(def);
    registry.unregister("fashion.full", 1);
    expect(registry.size).toBe(0);
  });

  it("throws NOT_FOUND when unregistering an unknown workflow", () => {
    expect(() => registry.unregister("nonexistent", 1)).toThrow(WorkflowRegistryError);
  });

  // ── Resolution ────────────────────────────────────────────────────────────

  it("resolves by exact workflowId + version", () => {
    const v1 = makeWorkflow({ workflowId: "fashion.full", pluginId: "fashion", version: 1 });
    const v2 = makeWorkflow({
      workflowId: "fashion.full", pluginId: "fashion", version: 2,
      migrationMetadata: { compatibleFromVersion: 1 },
    });
    registry.register(v1);
    registry.register(v2);

    const { definition, explanation } = registry.resolve({ workflowId: "fashion.full", version: 1 });
    expect(definition.version).toBe(1);
    expect(explanation.matchedCriteria).toContain("workflowId");
    expect(explanation.matchedCriteria).toContain("version");
  });

  it("resolves latest version when only workflowId is provided", () => {
    const v1 = makeWorkflow({ workflowId: "fashion.full", pluginId: "fashion", version: 1 });
    const v2 = makeWorkflow({
      workflowId: "fashion.full", pluginId: "fashion", version: 2,
      migrationMetadata: { compatibleFromVersion: 1 },
    });
    registry.register(v1);
    registry.register(v2);

    const { definition, explanation } = registry.resolve({ workflowId: "fashion.full" });
    expect(definition.version).toBe(2);
    expect(explanation.reason).toContain("Latest version");
  });

  it("resolves by pluginId + serviceType", () => {
    const def = makeWorkflow({
      workflowId: "fashion.campaign",
      pluginId: "fashion",
      supportedServiceTypes: ["fashion_campaign"],
    });
    registry.register(def);

    const { definition, explanation } = registry.resolve({
      pluginId: "fashion",
      serviceType: "fashion_campaign",
    });
    expect(definition.workflowId).toBe("fashion.campaign");
    expect(explanation.matchedCriteria).toContain("pluginId");
    expect(explanation.matchedCriteria).toContain("serviceType");
  });

  it("throws AMBIGUOUS_QUERY when multiple workflows match", () => {
    registry.register(makeWorkflow({ workflowId: "fashion.a", pluginId: "fashion" }));
    registry.register(makeWorkflow({ workflowId: "fashion.b", pluginId: "fashion" }));

    expect(() => registry.resolve({ pluginId: "fashion" })).toThrow(WorkflowRegistryError);
    try {
      registry.resolve({ pluginId: "fashion" });
    } catch (e) {
      expect((e as WorkflowRegistryError).code).toBe("AMBIGUOUS_QUERY");
    }
  });

  it("throws NOT_FOUND for unknown workflowId", () => {
    expect(() => registry.resolve({ workflowId: "nonexistent" })).toThrow(WorkflowRegistryError);
    try {
      registry.resolve({ workflowId: "nonexistent" });
    } catch (e) {
      expect((e as WorkflowRegistryError).code).toBe("NOT_FOUND");
    }
  });

  it("throws VERSION_MISMATCH when workflowId exists but requested version does not", () => {
    registry.register(makeWorkflow({ workflowId: "fashion.full", pluginId: "fashion", version: 1 }));
    expect(() => registry.resolve({ workflowId: "fashion.full", version: 99 })).toThrow(WorkflowRegistryError);
    try {
      registry.resolve({ workflowId: "fashion.full", version: 99 });
    } catch (e) {
      expect((e as WorkflowRegistryError).code).toBe("VERSION_MISMATCH");
    }
  });

  it("throws EMPTY_QUERY when no criteria are provided", () => {
    expect(() => registry.resolve({})).toThrow(WorkflowRegistryError);
    try {
      registry.resolve({});
    } catch (e) {
      expect((e as WorkflowRegistryError).code).toBe("EMPTY_QUERY");
    }
  });

  // ── Explainability ────────────────────────────────────────────────────────

  it("provides a non-empty resolution reason", () => {
    registry.register(makeWorkflow({ workflowId: "branding.full", pluginId: "branding" }));
    const { explanation } = registry.resolve({ workflowId: "branding.full" });
    expect(explanation.reason).toBeTruthy();
    expect(explanation.reason.length).toBeGreaterThan(10);
  });

  // ── list / getVersions ────────────────────────────────────────────────────

  it("list() returns all entries", () => {
    registry.register(makeWorkflow({ workflowId: "a.x", pluginId: "a" }));
    registry.register(makeWorkflow({ workflowId: "b.x", pluginId: "b" }));
    expect(registry.list()).toHaveLength(2);
  });

  it("getVersions() returns sorted versions", () => {
    registry.register(makeWorkflow({ workflowId: "a.x", pluginId: "a", version: 1 }));
    registry.register(makeWorkflow({
      workflowId: "a.x", pluginId: "a", version: 3,
      migrationMetadata: { compatibleFromVersion: 1 },
    }));
    registry.register(makeWorkflow({
      workflowId: "a.x", pluginId: "a", version: 2,
      migrationMetadata: { compatibleFromVersion: 1 },
    }));
    expect(registry.getVersions("a.x")).toEqual([1, 2, 3]);
  });

  it("getVersions() returns empty array for unknown workflowId", () => {
    expect(registry.getVersions("nonexistent")).toEqual([]);
  });

  // ── Fixture workflows ─────────────────────────────────────────────────────

  it("can register and resolve all four domain fixtures", async () => {
    const { fashionWorkflow } = await import("../fixtures/fashion.workflow.js");
    const { interiorWorkflow } = await import("../fixtures/interior.workflow.js");
    const { packagingWorkflow } = await import("../fixtures/packaging.workflow.js");
    const { brandingWorkflow } = await import("../fixtures/branding.workflow.js");

    registry.register(fashionWorkflow);
    registry.register(interiorWorkflow);
    registry.register(packagingWorkflow);
    registry.register(brandingWorkflow);

    expect(registry.size).toBe(4);

    const { definition } = registry.resolve({ workflowId: "fashion.full_production" });
    expect(definition.pluginId).toBe("fashion");
  });
});
