import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  aiCodingTaskGraphsTable: {},
  aiCodingWorkstreamsTable: {},
  aiCodingWorkstreamDependenciesTable: {},
  aiCodingWorkstreamAiHandoffsTable: {},
  db: {},
}));

import { hashCodingMultiTaskPlan } from "../localCodingTaskGraphService.js";
import {
  buildWorkstreamAiHandoffPackage,
  hashWorkstreamAiHandoffPackage,
  resolveWorkstreamAiHandoffTtlSeconds,
} from "../localCodingWorkstreamAiHandoffService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const GRAPH_ID = "22222222-2222-4222-8222-222222222222";
const WORKSTREAM_ID = "33333333-3333-4333-8333-333333333333";
const BASE_SHA = "a".repeat(40);

function plan() {
  return {
    version: 1 as const,
    taskId: TASK_ID,
    objective: "Build a bounded backend change.",
    workstreams: [
      {
        id: "WS-001",
        title: "Backend",
        role: "backend" as const,
        instruction: "Implement the approved backend change.",
        dependencies: [],
        ownershipPaths: [
          "artifacts/api-server/src/example",
          "artifacts/api-server/src/services/example.ts",
        ],
        acceptanceCriteria: [
          "Inputs are validated.",
          "Targeted tests pass.",
        ],
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
    createdAt: new Date(),
    approvedAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
  } as any;
}

function workstream() {
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
    leaseToken: "secret-worker-lease-token",
    leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    heartbeatAt: new Date(),
    branchName: "ai-core/111111111111/ws-001-a1",
    baseSha: BASE_SHA,
    headSha: null,
    attemptCount: 1,
    resultJson: null,
    errorMessage: null,
    claimedAt: new Date(),
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

describe("per-workstream AI handoff contract", () => {
  it("builds a deterministic one-shot package bound to graph, claim attempt, branch and ownership", () => {
    const pkg = buildWorkstreamAiHandoffPackage(graph(), workstream());

    expect(pkg).toMatchObject({
      version: 1,
      taskId: TASK_ID,
      graph: {
        id: GRAPH_ID,
        version: 1,
        planHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      workstream: {
        id: WORKSTREAM_ID,
        key: "WS-001",
        claimAttempt: 1,
        branchName: "ai-core/111111111111/ws-001-a1",
        baseSha: BASE_SHA,
      },
      policy: {
        readOnlyContext: true,
        allowedPathScopesOnly: true,
        repositoryConnectorAccess: false,
        shellAccess: false,
        networkAccess: false,
        secretAccess: false,
        envAccess: false,
        directSourceWrite: false,
        commitPushMerge: false,
        modelInvoked: false,
        requiresExplicitApprovalBeforeModel: true,
        oneShotPrivilege: true,
      },
    });

    expect(JSON.stringify(pkg)).not.toContain("secret-worker-lease-token");
    expect(JSON.stringify(pkg)).not.toContain('"workerId"');
    expect(hashWorkstreamAiHandoffPackage(pkg)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashWorkstreamAiHandoffPackage(pkg)).toBe(
      hashWorkstreamAiHandoffPackage(
        buildWorkstreamAiHandoffPackage(graph(), workstream()),
      ),
    );
  });

  it("fails closed when persisted workstream scope diverges from the approved plan", () => {
    const altered = workstream();
    altered.ownershipPaths = ["artifacts/api-server/src"];

    expect(() =>
      buildWorkstreamAiHandoffPackage(graph(), altered),
    ).toThrow(
      expect.objectContaining({ code: "STALE_CONTEXT" }),
    );
  });

  it("fails closed when the persisted plan JSON no longer matches its graph hash", () => {
    const alteredGraph = graph();
    alteredGraph.planJson = {
      ...plan(),
      objective: "tampered objective",
    };

    expect(() =>
      buildWorkstreamAiHandoffPackage(alteredGraph, workstream()),
    ).toThrow(
      expect.objectContaining({ code: "STALE_CONTEXT" }),
    );
  });

  it("rejects missing claim/base branch binding", () => {
    const missingBranch = workstream();
    missingBranch.branchName = null;
    expect(() =>
      buildWorkstreamAiHandoffPackage(graph(), missingBranch),
    ).toThrow(expect.objectContaining({ code: "INVALID_CONTEXT" }));

    const invalidSha = workstream();
    invalidSha.baseSha = "not-a-sha";
    expect(() =>
      buildWorkstreamAiHandoffPackage(graph(), invalidSha),
    ).toThrow(expect.objectContaining({ code: "INVALID_CONTEXT" }));
  });

  it("bounds workstream handoff approval TTL", () => {
    expect(resolveWorkstreamAiHandoffTtlSeconds(undefined)).toBe(900);
    expect(resolveWorkstreamAiHandoffTtlSeconds("1")).toBe(60);
    expect(resolveWorkstreamAiHandoffTtlSeconds("999999")).toBe(3600);
    expect(resolveWorkstreamAiHandoffTtlSeconds("300")).toBe(300);
  });
});
