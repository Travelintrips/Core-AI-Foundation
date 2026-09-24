import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  insertResults: [] as unknown[][],
  updateResults: [] as unknown[][],
  txExecute: vi.fn(),
  insertValues: vi.fn(),
  updateSet: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const graphTable = {
    id: "graph.id",
    taskId: "graph.taskId",
    planHash: "graph.planHash",
  };
  const workstreamTable = {
    id: "workstream.id",
    graphId: "workstream.graphId",
  };
  const handoffTable = {
    id: "handoff.id",
    graphId: "handoff.graphId",
    workstreamId: "handoff.workstreamId",
    claimAttempt: "handoff.claimAttempt",
    status: "handoff.status",
  };
  const dependencyTable = {
    graphId: "dependency.graphId",
    workstreamId: "dependency.workstreamId",
    dependsOnWorkstreamId: "dependency.dependsOnWorkstreamId",
  };

  const select = vi.fn(() => {
    const builder: any = {};
    builder.from = vi.fn(() => builder);
    builder.where = vi.fn(() => builder);
    builder.orderBy = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.for = vi.fn(() => builder);
    builder.then = (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) =>
      Promise.resolve(mocks.selectResults.shift() ?? []).then(resolve, reject);
    return builder;
  });

  const insert = vi.fn(() => {
    const builder: any = {};
    builder.values = mocks.insertValues.mockImplementation(() => builder);
    builder.returning = vi.fn(async () => mocks.insertResults.shift() ?? []);
    return builder;
  });

  const update = vi.fn(() => {
    const builder: any = {};
    builder.set = mocks.updateSet.mockImplementation(() => builder);
    builder.where = vi.fn(() => builder);
    builder.returning = vi.fn(async () => mocks.updateResults.shift() ?? []);
    return builder;
  });

  const tx = {
    execute: mocks.txExecute,
    select,
    insert,
    update,
  };

  return {
    aiCodingTaskGraphsTable: graphTable,
    aiCodingWorkstreamsTable: workstreamTable,
    aiCodingWorkstreamDependenciesTable: dependencyTable,
    aiCodingWorkstreamAiHandoffsTable: handoffTable,
    db: {
      select,
      transaction: vi.fn(
        async (callback: (value: typeof tx) => unknown) => callback(tx),
      ),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values: unknown[]) => values),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((...values: unknown[]) => values),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

import { hashCodingMultiTaskPlan } from "../localCodingTaskGraphService.js";
import {
  approveWorkstreamAiHandoff,
  assertApprovedWorkstreamAiHandoffFresh,
  buildWorkstreamAiHandoffPackage,
  consumeApprovedWorkstreamAiHandoff,
  hashWorkstreamAiHandoffPackage,
  prepareWorkstreamAiHandoff,
  revokeWorkstreamAiHandoff,
} from "../localCodingWorkstreamAiHandoffService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const GRAPH_ID = "22222222-2222-4222-8222-222222222222";
const WORKSTREAM_ID = "33333333-3333-4333-8333-333333333333";
const HANDOFF_ID = "44444444-4444-4444-8444-444444444444";
const BASE_SHA = "a".repeat(40);
const NOW = new Date("2026-09-24T12:00:00.000Z");

function plan() {
  return {
    version: 1 as const,
    taskId: TASK_ID,
    objective: "Build backend flow.",
    workstreams: [
      {
        id: "WS-001",
        title: "Backend",
        role: "backend" as const,
        instruction: "Implement backend flow.",
        dependencies: [],
        ownershipPaths: ["artifacts/api-server/src/example"],
        acceptanceCriteria: ["Targeted tests pass."],
        verificationProfiles: ["typecheck" as const, "unit_tests" as const],
        priority: 80,
      },
    ],
  };
}

function graph() {
  const value = plan();
  return {
    id: GRAPH_ID,
    taskId: TASK_ID,
    version: 1,
    contractVersion: 1,
    planHash: hashCodingMultiTaskPlan(value),
    objective: value.objective,
    status: "RUNNING",
    planJson: value,
    createdAt: NOW,
    approvedAt: NOW,
    startedAt: NOW,
    completedAt: null,
    updatedAt: NOW,
  } as any;
}

function workstream(
  overrides: Record<string, unknown> = {},
) {
  const item = plan().workstreams[0]!;
  return {
    id: WORKSTREAM_ID,
    graphId: GRAPH_ID,
    workstreamKey: item.id,
    title: item.title,
    role: item.role,
    instruction: item.instruction,
    status: "CLAIMED",
    priority: item.priority,
    ownershipPaths: item.ownershipPaths,
    acceptanceCriteria: item.acceptanceCriteria,
    verificationProfiles: item.verificationProfiles,
    workerId: "worker-1",
    leaseToken: "worker-lease-token",
    leaseExpiresAt: new Date("2026-09-24T12:10:00.000Z"),
    heartbeatAt: NOW,
    branchName: "ai-core/111111111111/ws-001-a1",
    baseSha: BASE_SHA,
    headSha: null,
    attemptCount: 1,
    resultJson: null,
    errorMessage: null,
    claimedAt: NOW,
    startedAt: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as any;
}

function handoff(
  status: "PREPARED" | "APPROVED" | "CONSUMED" | "REVOKED" = "PREPARED",
  overrides: Record<string, unknown> = {},
) {
  const g = graph();
  const w = workstream();
  const pkg = buildWorkstreamAiHandoffPackage(g, w);
  return {
    id: HANDOFF_ID,
    graphId: GRAPH_ID,
    workstreamId: WORKSTREAM_ID,
    claimAttempt: 1,
    packageVersion: 1,
    packageHash: hashWorkstreamAiHandoffPackage(pkg),
    planHash: g.planHash,
    baseSha: BASE_SHA,
    status,
    packageJson: pkg,
    preparedAt: NOW,
    approvedAt:
      status === "APPROVED" || status === "CONSUMED" ? NOW : null,
    expiresAt:
      status === "APPROVED" || status === "CONSUMED"
        ? new Date("2026-09-24T12:15:00.000Z")
        : null,
    revokedAt: status === "REVOKED" ? NOW : null,
    consumedAt: status === "CONSUMED" ? NOW : null,
    consumedExecutionId: status === "CONSUMED" ? "exec-1" : null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as any;
}

describe("per-workstream AI handoff lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.length = 0;
    mocks.insertResults.length = 0;
    mocks.updateResults.length = 0;
    mocks.txExecute.mockResolvedValue(undefined);
  });

  it("prepares one idempotent package for the current worker claim attempt", async () => {
    const prepared = handoff("PREPARED");
    mocks.selectResults.push([workstream()], [graph()], []);
    mocks.insertResults.push([prepared]);

    await expect(
      prepareWorkstreamAiHandoff(WORKSTREAM_ID, NOW),
    ).resolves.toEqual({ handoff: prepared, created: true });

    expect(mocks.txExecute).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        graphId: GRAPH_ID,
        workstreamId: WORKSTREAM_ID,
        claimAttempt: 1,
        packageVersion: 1,
        packageHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        baseSha: BASE_SHA,
        status: "PREPARED",
      }),
    );

    vi.clearAllMocks();
    mocks.selectResults.push(
      [workstream()],
      [graph()],
      [prepared],
    );
    await expect(
      prepareWorkstreamAiHandoff(WORKSTREAM_ID, NOW),
    ).resolves.toEqual({ handoff: prepared, created: false });
  });

  it("refuses preparation when the worker claim lease already expired", async () => {
    mocks.selectResults.push([
      workstream({
        leaseExpiresAt: new Date("2026-09-24T11:59:59.000Z"),
      }),
    ], [graph()]);

    await expect(
      prepareWorkstreamAiHandoff(WORKSTREAM_ID, NOW),
    ).rejects.toMatchObject({ code: "STALE_CLAIM" });

    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("explicitly approves a still-bound PREPARED handoff and creates TTL", async () => {
    const prepared = handoff("PREPARED");
    const approved = handoff("APPROVED");
    mocks.selectResults.push([prepared], [workstream()], [graph()]);
    mocks.updateResults.push([approved]);

    const lease = await approveWorkstreamAiHandoff(
      WORKSTREAM_ID,
      HANDOFF_ID,
      NOW,
    );

    expect(lease).toMatchObject({
      handoffId: HANDOFF_ID,
      workstreamId: WORKSTREAM_ID,
      graphId: GRAPH_ID,
      claimAttempt: 1,
      packageHash: prepared.packageHash,
      approvedAt: "2026-09-24T12:00:00.000Z",
      expiresAt: "2026-09-24T12:15:00.000Z",
    });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "APPROVED",
        approvedAt: NOW,
      }),
    );
  });

  it("asserts freshness against current graph, workstream claim and TTL", async () => {
    const approved = handoff("APPROVED");
    mocks.selectResults.push([workstream()], [graph()], [approved]);

    await expect(
      assertApprovedWorkstreamAiHandoffFresh(WORKSTREAM_ID, NOW),
    ).resolves.toMatchObject({
      handoffId: HANDOFF_ID,
      packageHash: approved.packageHash,
      claimAttempt: 1,
    });

    const expired = handoff("APPROVED", {
      expiresAt: new Date("2026-09-24T11:59:59.000Z"),
    });
    mocks.selectResults.push([workstream()], [graph()], [expired]);
    await expect(
      assertApprovedWorkstreamAiHandoffFresh(WORKSTREAM_ID, NOW),
    ).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("consumes the approved one-shot privilege only for the exact package hash", async () => {
    const approved = handoff("APPROVED");
    const consumed = handoff("CONSUMED", {
      consumedExecutionId: "workstream-exec-1",
    });
    mocks.selectResults.push([workstream()], [graph()], [approved]);
    mocks.updateResults.push([consumed]);

    await expect(
      consumeApprovedWorkstreamAiHandoff(
        WORKSTREAM_ID,
        approved.packageHash,
        "workstream-exec-1",
        NOW,
      ),
    ).resolves.toMatchObject({
      handoffId: HANDOFF_ID,
      packageHash: approved.packageHash,
    });

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "CONSUMED",
        consumedExecutionId: "workstream-exec-1",
      }),
    );
  });

  it("blocks replay after one-shot consumption", async () => {
    const consumed = handoff("CONSUMED");
    mocks.selectResults.push([workstream()], [graph()], [consumed]);

    await expect(
      consumeApprovedWorkstreamAiHandoff(
        WORKSTREAM_ID,
        consumed.packageHash,
        "exec-replay",
        NOW,
      ),
    ).rejects.toMatchObject({ code: "CONSUMED" });

    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("revokes PREPARED/APPROVED handoff and prevents reuse", async () => {
    const approved = handoff("APPROVED");
    const revoked = handoff("REVOKED");
    mocks.selectResults.push([approved]);
    mocks.updateResults.push([revoked]);

    await expect(
      revokeWorkstreamAiHandoff(WORKSTREAM_ID, NOW),
    ).resolves.toMatchObject({
      id: HANDOFF_ID,
      status: "REVOKED",
    });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "REVOKED",
        revokedAt: NOW,
      }),
    );
  });
});
