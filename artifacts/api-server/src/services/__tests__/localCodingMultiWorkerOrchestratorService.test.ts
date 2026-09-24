import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  graphFor: vi.fn(),
  workstreamWhere: vi.fn(),
  dependencyWhere: vi.fn(),
  claimSet: vi.fn(),
  claimWhere: vi.fn(),
  claimReturning: vi.fn(),
  graphSet: vi.fn(),
  graphWhere: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const graphTable = {
    id: "graph.id",
    taskId: "graph.taskId",
    status: "graph.status",
  };
  const workstreamTable = {
    id: "ws.id",
    graphId: "ws.graphId",
    status: "ws.status",
    leaseToken: "ws.leaseToken",
    leaseExpiresAt: "ws.leaseExpiresAt",
  };
  const dependencyTable = {
    graphId: "dep.graphId",
    workstreamId: "dep.workstreamId",
    dependsOnWorkstreamId: "dep.dependsOnWorkstreamId",
  };

  let selectCall = 0;
  let updateCall = 0;

  const tx = {
    execute: mocks.execute,
    select: vi.fn(() => {
      selectCall += 1;
      if (selectCall === 1) {
        const builder = {
          from: vi.fn(() => builder),
          where: vi.fn(() => builder),
          for: mocks.graphFor,
        };
        return builder;
      }
      if (selectCall === 2) {
        const builder = {
          from: vi.fn(() => builder),
          where: mocks.workstreamWhere,
        };
        return builder;
      }
      const builder = {
        from: vi.fn(() => builder),
        where: mocks.dependencyWhere,
      };
      return builder;
    }),
    update: vi.fn(() => {
      updateCall += 1;
      if (updateCall === 1) {
        return { set: mocks.claimSet };
      }
      return { set: mocks.graphSet };
    }),
  };

  mocks.claimSet.mockImplementation(() => ({
    where: mocks.claimWhere,
  }));
  mocks.claimWhere.mockImplementation(() => ({
    returning: mocks.claimReturning,
  }));
  mocks.graphSet.mockImplementation(() => ({
    where: mocks.graphWhere,
  }));

  return {
    aiCodingTaskGraphsTable: graphTable,
    aiCodingWorkstreamsTable: workstreamTable,
    aiCodingWorkstreamDependenciesTable: dependencyTable,
    db: {
      transaction: vi.fn(async (callback: (tx: typeof tx) => unknown) => {
        selectCall = 0;
        updateCall = 0;
        return callback(tx);
      }),
      update: vi.fn(),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values: unknown[]) => values),
  eq: vi.fn((...values: unknown[]) => values),
  inArray: vi.fn((...values: unknown[]) => values),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

import {
  buildCodingWorkstreamBranchName,
  claimReadyCodingWorkstreams,
  selectClaimableCodingWorkstreams,
} from "../localCodingMultiWorkerOrchestratorService.js";

const GRAPH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const BASE_SHA = "b".repeat(40);

function ws(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    graphId: GRAPH_ID,
    workstreamKey: "WS-001",
    title: "Backend",
    role: "backend",
    instruction: "Implement backend.",
    status: "READY",
    priority: 80,
    ownershipPaths: [],
    acceptanceCriteria: [],
    verificationProfiles: [],
    workerId: null,
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    branchName: null,
    baseSha: null,
    headSha: null,
    attemptCount: 0,
    resultJson: null,
    errorMessage: null,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

describe("multi-worker coding claim runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue(undefined);
    mocks.graphFor.mockResolvedValue([{
      id: GRAPH_ID,
      taskId: TASK_ID,
      status: "APPROVED",
      startedAt: null,
    }]);
    mocks.workstreamWhere.mockResolvedValue([ws()]);
    mocks.dependencyWhere.mockResolvedValue([]);
    mocks.claimReturning.mockResolvedValue([
      ws({
        status: "CLAIMED",
        workerId: "worker-1",
        attemptCount: 1,
      }),
    ]);
    mocks.graphWhere.mockResolvedValue(undefined);
  });

  it("selects only dependency-ready or expired-lease workstreams", () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const rows = [
      ws({ id: "done", workstreamKey: "WS-001", status: "COMPLETED", priority: 90 }),
      ws({ id: "ready", workstreamKey: "WS-002", status: "PENDING", priority: 80 }),
      ws({ id: "blocked", workstreamKey: "WS-003", status: "PENDING", priority: 70 }),
      ws({
        id: "expired",
        workstreamKey: "WS-004",
        status: "RUNNING",
        priority: 60,
        leaseExpiresAt: new Date("2026-09-24T11:59:00.000Z"),
      }),
      ws({
        id: "live",
        workstreamKey: "WS-005",
        status: "CLAIMED",
        priority: 100,
        leaseExpiresAt: new Date("2026-09-24T12:05:00.000Z"),
      }),
    ];
    const deps = [
      { workstreamId: "ready", dependsOnWorkstreamId: "done" },
      { workstreamId: "blocked", dependsOnWorkstreamId: "missing" },
    ];

    expect(
      selectClaimableCodingWorkstreams(rows, deps, now).map(
        (item) => item.workstreamKey,
      ),
    ).toEqual(["WS-002", "WS-004"]);
  });

  it("builds deterministic isolated branch names per workstream attempt", () => {
    expect(
      buildCodingWorkstreamBranchName(TASK_ID, "WS-002", 3),
    ).toBe("ai-core/111111111111/ws-002-a3");
  });

  it("claims a ready workstream under a graph-scoped advisory lock", async () => {
    const claims = await claimReadyCodingWorkstreams(
      GRAPH_ID,
      "worker-1",
      {
        maxClaims: 2,
        leaseSeconds: 120,
        baseSha: BASE_SHA,
      },
    );

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.claimSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "CLAIMED",
        workerId: "worker-1",
        baseSha: BASE_SHA,
        attemptCount: 1,
        errorMessage: null,
      }),
    );
    expect(mocks.graphSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "RUNNING" }),
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      workstreamId: "w1",
      workstreamKey: "WS-001",
      workerId: "worker-1",
      baseSha: BASE_SHA,
      attempt: 1,
    });
    expect(claims[0]?.leaseToken).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(claims[0]?.branchName).toBe(
      "ai-core/111111111111/ws-001-a1",
    );
  });

  it("refuses claims until the graph is explicitly approved", async () => {
    mocks.graphFor.mockResolvedValueOnce([{
      id: GRAPH_ID,
      taskId: TASK_ID,
      status: "PREPARED",
      startedAt: null,
    }]);

    await expect(
      claimReadyCodingWorkstreams(GRAPH_ID, "worker-1", {
        baseSha: BASE_SHA,
      }),
    ).rejects.toMatchObject({ code: "NOT_READY" });

    expect(mocks.claimSet).not.toHaveBeenCalled();
  });
});
