import { describe, expect, it } from "vitest";
import { buildCodingTaskGraphPlanReviewModel } from "./codingTaskGraphPlanReviewModel";

function workstream(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    key: "WS-001",
    title: "Backend",
    role: "backend",
    instruction: "Implement the bounded backend change.",
    status: "READY",
    priority: 90,
    ownershipPaths: ["artifacts/api-server/src/features/**"],
    acceptanceCriteria: ["Backend verification passes."],
    verificationProfiles: ["unit_tests", "typecheck"],
    dependencies: [],
    ...overrides,
  } as any;
}

describe("coding task graph plan review model", () => {
  it("marks a complete bounded plan as eligible for explicit approval", () => {
    const model = buildCodingTaskGraphPlanReviewModel([
      workstream(),
      workstream({
        id: "22222222-2222-4222-8222-222222222222",
        key: "WS-002",
        title: "Frontend",
        role: "frontend",
        priority: 80,
        ownershipPaths: ["artifacts/ai-platform/src/features/**"],
        acceptanceCriteria: ["Frontend build passes."],
        verificationProfiles: ["build", "typecheck"],
        dependencies: ["WS-001"],
      }),
    ]);

    expect(model.completeForApproval).toBe(true);
    expect(model.issues).toEqual([]);
    expect(model.rootWorkstreams).toEqual(["WS-001"]);
    expect(model.dependencyEdges).toBe(1);
  });

  it("blocks approval when ownership, acceptance, verification, or instruction evidence is missing", () => {
    const model = buildCodingTaskGraphPlanReviewModel([
      workstream({
        instruction: "",
        ownershipPaths: [],
        acceptanceCriteria: [],
        verificationProfiles: [],
      }),
    ]);

    expect(model.completeForApproval).toBe(false);
    expect(model.issues).toEqual(
      expect.arrayContaining([
        "WS-001: missing instruction",
        "WS-001: missing ownership boundary",
        "WS-001: missing acceptance criteria",
        "WS-001: missing verification profile",
      ]),
    );
  });

  it("blocks duplicate keys, unknown dependencies, self dependencies, and invalid priority", () => {
    const model = buildCodingTaskGraphPlanReviewModel([
      workstream({
        priority: 101,
        dependencies: ["WS-404", "WS-001"],
      }),
      workstream({
        id: "22222222-2222-4222-8222-222222222222",
        key: "WS-001",
        title: "Duplicate",
      }),
    ]);

    expect(model.completeForApproval).toBe(false);
    expect(model.issues).toEqual(
      expect.arrayContaining([
        "WS-001: duplicate workstream key",
        "WS-001: priority must be an integer between 0 and 100",
        "WS-001: unknown dependency WS-404",
        "WS-001: self dependency",
      ]),
    );
  });

  it("blocks an empty task graph", () => {
    const model = buildCodingTaskGraphPlanReviewModel([]);

    expect(model.completeForApproval).toBe(false);
    expect(model.issues).toEqual(["task graph has no workstreams"]);
  });
});
