import { beforeEach, describe, expect, it, vi } from "vitest";

const TABLES = vi.hoisted(() => ({
  graphs: { id: "graphs.id", taskId: "graphs.taskId", version: "graphs.version" },
  workstreams: { id: "workstreams.id", graphId: "workstreams.graphId" },
  dependencies: { id: "dependencies.id", graphId: "dependencies.graphId" },
}));

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  latestLimit: vi.fn(),
  selectFor: vi.fn(),
  graphValues: vi.fn(),
  graphReturning: vi.fn(),
  workstreamValues: vi.fn(),
  workstreamReturning: vi.fn(),
  dependencyValues: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const selectBuilder = {
    from: vi.fn(() => selectBuilder),
    where: vi.fn(() => selectBuilder),
    orderBy: vi.fn(() => selectBuilder),
    limit: mocks.latestLimit,
    for: mocks.selectFor,
  };

  const graphInsertBuilder = {
    values: mocks.graphValues,
    returning: mocks.graphReturning,
  };
  const workstreamInsertBuilder = {
    values: mocks.workstreamValues,
    returning: mocks.workstreamReturning,
  };
  const dependencyInsertBuilder = {
    values: mocks.dependencyValues,
  };

  let insertCall = 0;
  const tx = {
    execute: mocks.execute,
    select: vi.fn(() => selectBuilder),
    insert: vi.fn(() => {
      insertCall += 1;
      if (insertCall === 1) return graphInsertBuilder;
      if (insertCall === 2) return workstreamInsertBuilder;
      return dependencyInsertBuilder;
    }),
    update: vi.fn(() => ({
      set: mocks.updateSet,
    })),
  };

  mocks.updateSet.mockImplementation(() => ({
    where: mocks.updateWhere,
  }));
  mocks.updateWhere.mockImplementation(() => ({
    returning: mocks.updateReturning,
  }));

  return {
    aiCodingTaskGraphsTable: TABLES.graphs,
    aiCodingWorkstreamsTable: TABLES.workstreams,
    aiCodingWorkstreamDependenciesTable: TABLES.dependencies,
    db: {
      transaction: vi.fn(async (callback: (tx: typeof tx) => unknown) => {
        insertCall = 0;
        return callback(tx);
      }),
      select: vi.fn(() => selectBuilder),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((...args: unknown[]) => args),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

import {
  approveCodingTaskGraph,
  hashCodingMultiTaskPlan,
  persistCodingTaskGraph,
  readyPersistedCodingWorkstreams,
  type CodingTaskGraphSnapshot,
} from "../localCodingTaskGraphService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

function plan() {
  return {
    version: 1,
    taskId: TASK_ID,
    objective: "Build a safe parallel coding change.",
    workstreams: [
      {
        id: "WS-001",
        title: "Database",
        role: "database",
        instruction: "Add schema.",
        dependencies: [],
        ownershipPaths: ["lib/db/src/schema/example"],
        acceptanceCriteria: ["Schema compiles."],
        verificationProfiles: ["typecheck"],
        priority: 90,
      },
      {
        id: "WS-002",
        title: "Backend",
        role: "backend",
        instruction: "Add API.",
        dependencies: ["WS-001"],
        ownershipPaths: ["artifacts/api-server/src/example"],
        acceptanceCriteria: ["API tests pass."],
        verificationProfiles: ["unit_tests", "typecheck"],
        priority: 80,
      },
      {
        id: "WS-003",
        title: "Frontend",
        role: "frontend",
        instruction: "Add UI.",
        dependencies: ["WS-001"],
        ownershipPaths: ["artifacts/ai-platform/src/example"],
        acceptanceCriteria: ["UI builds."],
        verificationProfiles: ["build", "typecheck"],
        priority: 70,
      },
    ],
  };
}

describe("durable coding task graph service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue(undefined);
    mocks.latestLimit.mockResolvedValue([]);
    mocks.graphValues.mockImplementation(() => ({
      returning: mocks.graphReturning,
    }));
    mocks.graphReturning.mockResolvedValue([{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      taskId: TASK_ID,
      version: 1,
      contractVersion: 1,
      planHash: hashCodingMultiTaskPlan(plan()),
      objective: plan().objective,
      status: "PREPARED",
      planJson: plan(),
    }]);
    mocks.workstreamValues.mockImplementation(() => ({
      returning: mocks.workstreamReturning,
    }));
    mocks.workstreamReturning.mockResolvedValue([
      { id: "w1", workstreamKey: "WS-001" },
      { id: "w2", workstreamKey: "WS-002" },
      { id: "w3", workstreamKey: "WS-003" },
    ]);
    mocks.dependencyValues.mockResolvedValue(undefined);
    mocks.selectFor.mockResolvedValue([]);
    mocks.updateReturning.mockResolvedValue([]);
  });

  it("hashes equivalent plans deterministically regardless of workstream order", () => {
    const first = plan();
    const second = plan();
    second.workstreams = [
      second.workstreams[2]!,
      second.workstreams[0]!,
      second.workstreams[1]!,
    ];

    expect(hashCodingMultiTaskPlan(first)).toBe(hashCodingMultiTaskPlan(second));
    expect(hashCodingMultiTaskPlan(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("derives dependency-ready workstreams from persisted completion state", () => {
    const snapshot = {
      graph: { id: "graph" },
      workstreams: [
        {
          id: "w1",
          key: "WS-001",
          title: "DB",
          role: "database",
          instruction: "db",
          status: "COMPLETED",
          priority: 90,
          ownershipPaths: [],
          acceptanceCriteria: [],
          verificationProfiles: [],
          workerId: null,
          branchName: null,
          baseSha: null,
          headSha: null,
          attemptCount: 1,
          errorMessage: null,
          dependencies: [],
        },
        {
          id: "w2",
          key: "WS-002",
          title: "Backend",
          role: "backend",
          instruction: "api",
          status: "PENDING",
          priority: 80,
          ownershipPaths: [],
          acceptanceCriteria: [],
          verificationProfiles: [],
          workerId: null,
          branchName: null,
          baseSha: null,
          headSha: null,
          attemptCount: 0,
          errorMessage: null,
          dependencies: ["WS-001"],
        },
        {
          id: "w3",
          key: "WS-003",
          title: "Frontend",
          role: "frontend",
          instruction: "ui",
          status: "PENDING",
          priority: 70,
          ownershipPaths: [],
          acceptanceCriteria: [],
          verificationProfiles: [],
          workerId: null,
          branchName: null,
          baseSha: null,
          headSha: null,
          attemptCount: 0,
          errorMessage: null,
          dependencies: ["WS-001"],
        },
      ],
    } as unknown as CodingTaskGraphSnapshot;

    expect(
      readyPersistedCodingWorkstreams(snapshot).map((item) => item.key),
    ).toEqual(["WS-002", "WS-003"]);
  });

  it("persists a validated graph atomically under a task-scoped advisory lock", async () => {
    const result = await persistCodingTaskGraph(TASK_ID, plan());

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.graphValues).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        version: 1,
        contractVersion: 1,
        status: "PREPARED",
      }),
    );
    expect(mocks.workstreamValues).toHaveBeenCalledWith([
      expect.objectContaining({ workstreamKey: "WS-001", status: "READY" }),
      expect.objectContaining({ workstreamKey: "WS-002", status: "PENDING" }),
      expect.objectContaining({ workstreamKey: "WS-003", status: "PENDING" }),
    ]);
    expect(mocks.dependencyValues).toHaveBeenCalledWith([
      {
        graphId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workstreamId: "w2",
        dependsOnWorkstreamId: "w1",
      },
      {
        graphId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workstreamId: "w3",
        dependsOnWorkstreamId: "w1",
      },
    ]);
    expect(result.created).toBe(true);
  });

  it("returns the existing graph for an identical plan hash without duplicating rows", async () => {
    const existing = {
      id: "existing",
      taskId: TASK_ID,
      version: 4,
      contractVersion: 1,
      planHash: hashCodingMultiTaskPlan(plan()),
      objective: plan().objective,
      status: "PREPARED",
      planJson: plan(),
    };
    mocks.latestLimit.mockResolvedValueOnce([existing]);

    await expect(persistCodingTaskGraph(TASK_ID, plan())).resolves.toEqual({
      graph: existing,
      created: false,
    });
    expect(mocks.workstreamValues).not.toHaveBeenCalled();
  });

  it("rejects replanning over an approved/running graph", async () => {
    const different = plan();
    different.objective = "A changed objective.";

    mocks.latestLimit.mockResolvedValueOnce([{
      id: "active",
      taskId: TASK_ID,
      version: 2,
      planHash: "f".repeat(64),
      status: "RUNNING",
    }]);

    await expect(
      persistCodingTaskGraph(TASK_ID, different),
    ).rejects.toMatchObject({ code: "ACTIVE_GRAPH_EXISTS" });
  });

  it("rejects task binding mismatch before touching persistence", async () => {
    const mismatched = plan();
    mismatched.taskId = "22222222-2222-4222-8222-222222222222";

    await expect(
      persistCodingTaskGraph(TASK_ID, mismatched),
    ).rejects.toMatchObject({ code: "TASK_MISMATCH" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("requires explicit approval from PREPARED", async () => {
    const graph = {
      id: "graph-1",
      taskId: TASK_ID,
      status: "PREPARED",
    };
    mocks.selectFor.mockResolvedValueOnce([graph]);
    mocks.updateReturning.mockResolvedValueOnce([
      { ...graph, status: "APPROVED" },
    ]);

    await expect(
      approveCodingTaskGraph(TASK_ID, "graph-1"),
    ).resolves.toMatchObject({ status: "APPROVED" });
  });
});
