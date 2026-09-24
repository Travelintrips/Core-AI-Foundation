import { describe, expect, it } from "vitest";
import {
  CODING_MULTI_TASK_PLAN_VERSION,
  readyCodingWorkstreams,
  topologicalCodingWorkstreams,
  validateCodingMultiTaskPlanV1,
} from "../localCodingMultiTaskPlannerService.js";

const plan = () => ({
  version: CODING_MULTI_TASK_PLAN_VERSION,
  taskId: "task-1",
  objective: "Build corporate invoice flow.",
  workstreams: [
    {
      id: "WS-001",
      title: "Database",
      role: "database",
      instruction: "Add schema changes.",
      dependencies: [],
      ownershipPaths: ["lib/db/src/schema/invoice"],
      acceptanceCriteria: ["Schema is typed and migratable."],
      verificationProfiles: ["typecheck"],
      priority: 90,
    },
    {
      id: "WS-002",
      title: "Backend",
      role: "backend",
      instruction: "Add API and business logic.",
      dependencies: ["WS-001"],
      ownershipPaths: ["artifacts/api-server/src/invoice"],
      acceptanceCriteria: ["API validates inputs."],
      verificationProfiles: ["typecheck", "unit_tests"],
      priority: 80,
    },
    {
      id: "WS-003",
      title: "Frontend",
      role: "frontend",
      instruction: "Build invoice UI.",
      dependencies: ["WS-001"],
      ownershipPaths: ["artifacts/ai-platform/src/invoice"],
      acceptanceCriteria: ["UI renders invoice state."],
      verificationProfiles: ["typecheck", "build"],
      priority: 70,
    },
    {
      id: "WS-004",
      title: "Integration",
      role: "integration",
      instruction: "Integrate and verify all workstreams.",
      dependencies: ["WS-002", "WS-003"],
      ownershipPaths: [],
      acceptanceCriteria: ["Integrated flow passes verification."],
      verificationProfiles: ["typecheck", "unit_tests", "build"],
      priority: 60,
    },
  ],
});

describe("Coding multi-task planner contract", () => {
  it("validates a bounded DAG and returns deterministic topology", () => {
    const parsed = validateCodingMultiTaskPlanV1(plan());
    expect(parsed.workstreams).toHaveLength(4);
    expect(topologicalCodingWorkstreams(parsed).map((item) => item.id)).toEqual([
      "WS-001",
      "WS-002",
      "WS-003",
      "WS-004",
    ]);
  });

  it("returns parallel ready workstreams after dependencies finish", () => {
    expect(readyCodingWorkstreams(plan(), []).map((item) => item.id)).toEqual([
      "WS-001",
    ]);
    expect(
      readyCodingWorkstreams(plan(), ["WS-001"]).map((item) => item.id),
    ).toEqual(["WS-002", "WS-003"]);
    expect(
      readyCodingWorkstreams(plan(), ["WS-001", "WS-002", "WS-003"]).map(
        (item) => item.id,
      ),
    ).toEqual(["WS-004"]);
  });

  it("rejects missing and self dependencies", () => {
    const missing = plan();
    missing.workstreams[1]!.dependencies = ["WS-999"];
    expect(() => validateCodingMultiTaskPlanV1(missing)).toThrow(
      expect.objectContaining({ code: "MISSING_DEPENDENCY" }),
    );

    const self = plan();
    self.workstreams[0]!.dependencies = ["WS-001"];
    expect(() => validateCodingMultiTaskPlanV1(self)).toThrow(
      expect.objectContaining({ code: "SELF_DEPENDENCY" }),
    );
  });

  it("rejects cyclic dependency graphs", () => {
    const cyclic = plan();
    cyclic.workstreams[0]!.dependencies = ["WS-004"];
    expect(() => validateCodingMultiTaskPlanV1(cyclic)).toThrow(
      expect.objectContaining({ code: "CYCLIC_DEPENDENCY" }),
    );
  });

  it("rejects overlapping ownership for workstreams that can run in parallel", () => {
    const conflict = plan();
    conflict.workstreams[2]!.ownershipPaths = [
      "artifacts/api-server/src/invoice/routes",
    ];
    expect(() => validateCodingMultiTaskPlanV1(conflict)).toThrow(
      expect.objectContaining({ code: "OWNERSHIP_CONFLICT" }),
    );
  });

  it("allows overlapping ownership only when dependencies serialize the work", () => {
    const serialized = plan();
    serialized.workstreams[2]!.dependencies = ["WS-002"];
    serialized.workstreams[2]!.ownershipPaths = [
      "artifacts/api-server/src/invoice/routes",
    ];
    serialized.workstreams[1]!.ownershipPaths = [
      "artifacts/api-server/src/invoice",
    ];

    expect(() => validateCodingMultiTaskPlanV1(serialized)).not.toThrow();
  });

  it("rejects unsafe ownership paths and unknown fields", () => {
    const unsafe = plan();
    unsafe.workstreams[0]!.ownershipPaths = ["../outside"];
    expect(() => validateCodingMultiTaskPlanV1(unsafe)).toThrow(
      expect.objectContaining({ code: "INVALID_SCHEMA" }),
    );

    const unknown = {
      ...plan(),
      shellCommand: "git push",
    };
    expect(() => validateCodingMultiTaskPlanV1(unknown)).toThrow(
      expect.objectContaining({ code: "INVALID_SCHEMA" }),
    );
  });
});
