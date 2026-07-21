/**
 * WorkflowValidator Tests
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Covers (per spec):
 * - valid linear workflow
 * - valid parallel workflow
 * - circular dependency graph
 * - missing dependency
 * - unsupported (unknown) capability
 * - optional stage
 * - duplicate stage ID
 * - version mismatch (missing migrationMetadata)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { WorkflowValidator } from "../validator/WorkflowValidator.js";
import type { DesignWorkflowDefinition } from "../types/definition.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date("2024-01-01T00:00:00Z");

function makeWorkflow(
  overrides: Partial<DesignWorkflowDefinition> = {},
): DesignWorkflowDefinition {
  return {
    workflowId: "test.workflow",
    version: 1,
    name: "Test Workflow",
    pluginId: "test",
    supportedServiceTypes: ["test_service"],
    stages: [
      {
        id: "a",
        label: "Stage A",
        requiredCapability: "cap_a",
        dependencies: [],
        optional: false,
        repeatable: false,
        parallel: false,
      },
      {
        id: "b",
        label: "Stage B",
        requiredCapability: "cap_b",
        dependencies: ["a"],
        optional: false,
        repeatable: false,
        parallel: false,
      },
    ],
    requiredCapabilities: ["cap_a", "cap_b"],
    completionPolicy: { type: "all_required" },
    fallbackBehavior: {
      onRequiredStageFailure: "fail_workflow",
      onOptionalStageFailure: "continue",
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WorkflowValidator", () => {
  let validator: WorkflowValidator;

  beforeEach(() => {
    validator = new WorkflowValidator();
  });

  // ── Valid linear workflow ─────────────────────────────────────────────────

  it("accepts a valid linear workflow (A → B → C)", () => {
    const def = makeWorkflow({
      stages: [
        { id: "a", label: "A", requiredCapability: "cap_a", dependencies: [], optional: false, repeatable: false, parallel: false },
        { id: "b", label: "B", requiredCapability: "cap_b", dependencies: ["a"], optional: false, repeatable: false, parallel: false },
        { id: "c", label: "C", requiredCapability: "cap_c", dependencies: ["b"], optional: false, repeatable: false, parallel: false },
      ],
      requiredCapabilities: ["cap_a", "cap_b", "cap_c"],
    });
    const result = validator.validate(def);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ── Valid parallel workflow ───────────────────────────────────────────────

  it("accepts a valid parallel workflow (A → B‖C → D)", () => {
    const def = makeWorkflow({
      stages: [
        { id: "a", label: "A", requiredCapability: "cap_a", dependencies: [], optional: false, repeatable: false, parallel: false },
        { id: "b", label: "B", requiredCapability: "cap_b", dependencies: ["a"], optional: false, repeatable: false, parallel: true },
        { id: "c", label: "C", requiredCapability: "cap_c", dependencies: ["a"], optional: false, repeatable: false, parallel: true },
        { id: "d", label: "D", requiredCapability: "cap_d", dependencies: ["b", "c"], optional: false, repeatable: false, parallel: false },
      ],
      requiredCapabilities: ["cap_a", "cap_b", "cap_c", "cap_d"],
    });
    const result = validator.validate(def);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ── Circular dependency ───────────────────────────────────────────────────

  it("rejects a workflow with a circular dependency (A → B → C → A)", () => {
    const def = makeWorkflow({
      stages: [
        { id: "a", label: "A", requiredCapability: "cap_a", dependencies: ["c"], optional: false, repeatable: false, parallel: false },
        { id: "b", label: "B", requiredCapability: "cap_b", dependencies: ["a"], optional: false, repeatable: false, parallel: false },
        { id: "c", label: "C", requiredCapability: "cap_c", dependencies: ["b"], optional: false, repeatable: false, parallel: false },
      ],
      requiredCapabilities: ["cap_a", "cap_b", "cap_c"],
    });
    const result = validator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "CIRCULAR_DEPENDENCY")).toBe(true);
  });

  // ── Missing dependency ────────────────────────────────────────────────────

  it("rejects a workflow with a missing dependency", () => {
    const def = makeWorkflow({
      stages: [
        { id: "a", label: "A", requiredCapability: "cap_a", dependencies: [], optional: false, repeatable: false, parallel: false },
        { id: "b", label: "B", requiredCapability: "cap_b", dependencies: ["nonexistent"], optional: false, repeatable: false, parallel: false },
      ],
      requiredCapabilities: ["cap_a", "cap_b"],
    });
    const result = validator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_DEPENDENCY")).toBe(true);
  });

  // ── Duplicate stage ID ────────────────────────────────────────────────────

  it("rejects a workflow with duplicate stage IDs", () => {
    const def = makeWorkflow({
      stages: [
        { id: "a", label: "A", requiredCapability: "cap_a", dependencies: [], optional: false, repeatable: false, parallel: false },
        { id: "a", label: "A duplicate", requiredCapability: "cap_b", dependencies: [], optional: false, repeatable: false, parallel: false },
      ],
      requiredCapabilities: ["cap_a", "cap_b"],
    });
    const result = validator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "DUPLICATE_STAGE_ID")).toBe(true);
  });

  // ── Optional stage ────────────────────────────────────────────────────────

  it("accepts a workflow with optional stages and no errors", () => {
    const def = makeWorkflow({
      stages: [
        { id: "a", label: "A", requiredCapability: "cap_a", dependencies: [], optional: false, repeatable: false, parallel: false },
        { id: "opt", label: "Optional", requiredCapability: "cap_opt", dependencies: ["a"], optional: true, repeatable: false, parallel: false },
        { id: "b", label: "B", requiredCapability: "cap_b", dependencies: ["a"], optional: false, repeatable: false, parallel: false },
      ],
      requiredCapabilities: ["cap_a", "cap_opt", "cap_b"],
    });
    const result = validator.validate(def);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ── Unknown capability ────────────────────────────────────────────────────

  it("rejects unknown capabilities when knownCapabilities is provided", () => {
    const strictValidator = new WorkflowValidator({
      knownCapabilities: new Set(["cap_a"]), // cap_b not registered
    });
    const def = makeWorkflow();
    const result = strictValidator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "UNKNOWN_CAPABILITY" && e.stageIds?.includes("b"))).toBe(true);
  });

  it("skips capability validation when knownCapabilities is not provided", () => {
    const def = makeWorkflow();
    const result = validator.validate(def);
    expect(result.valid).toBe(true);
  });

  // ── Version mismatch / missing migrationMetadata ──────────────────────────

  it("rejects version > 1 without migrationMetadata", () => {
    const def = makeWorkflow({ version: 2, migrationMetadata: undefined });
    const result = validator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_MIGRATION_METADATA")).toBe(true);
  });

  it("accepts version > 1 with valid migrationMetadata", () => {
    const def = makeWorkflow({
      version: 2,
      migrationMetadata: {
        compatibleFromVersion: 1,
        changelog: "Added optional stage",
      },
    });
    const result = validator.validate(def);
    expect(result.valid).toBe(true);
  });

  it("rejects migrationMetadata.compatibleFromVersion > version", () => {
    const def = makeWorkflow({
      version: 2,
      migrationMetadata: {
        compatibleFromVersion: 3, // invalid: 3 > 2
      },
    });
    const result = validator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_MIGRATION_METADATA")).toBe(true);
  });

  // ── Self-loop ─────────────────────────────────────────────────────────────

  it("rejects a stage that depends on itself", () => {
    const def = makeWorkflow({
      stages: [
        { id: "a", label: "A", requiredCapability: "cap_a", dependencies: ["a"], optional: false, repeatable: false, parallel: false },
      ],
      requiredCapabilities: ["cap_a"],
    });
    const result = validator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "SELF_LOOP")).toBe(true);
  });

  // ── Capability not declared ───────────────────────────────────────────────

  it("flags capability used by stage but missing from requiredCapabilities", () => {
    const def = makeWorkflow({
      requiredCapabilities: ["cap_a"], // cap_b missing
    });
    const result = validator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "CAPABILITY_NOT_DECLARED")).toBe(true);
  });

  // ── assertValid ───────────────────────────────────────────────────────────

  it("assertValid does not throw for a valid workflow", () => {
    expect(() => validator.assertValid(makeWorkflow())).not.toThrow();
  });

  it("assertValid throws for an invalid workflow", () => {
    const def = makeWorkflow({ version: 2, migrationMetadata: undefined });
    expect(() => validator.assertValid(def)).toThrow();
  });

  // ── Fixture validation ────────────────────────────────────────────────────

  it("validates the fashion workflow fixture", async () => {
    const { fashionWorkflow } = await import("../fixtures/fashion.workflow.js");
    const result = validator.validate(fashionWorkflow);
    expect(result.valid).toBe(true);
  });

  it("validates the interior workflow fixture", async () => {
    const { interiorWorkflow } = await import("../fixtures/interior.workflow.js");
    const result = validator.validate(interiorWorkflow);
    expect(result.valid).toBe(true);
  });

  it("validates the packaging workflow fixture", async () => {
    const { packagingWorkflow } = await import("../fixtures/packaging.workflow.js");
    const result = validator.validate(packagingWorkflow);
    expect(result.valid).toBe(true);
  });

  it("validates the branding workflow fixture", async () => {
    const { brandingWorkflow } = await import("../fixtures/branding.workflow.js");
    const result = validator.validate(brandingWorkflow);
    expect(result.valid).toBe(true);
  });
});
