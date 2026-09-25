import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  readyCodingWorkstreams,
  validateCodingMultiTaskPlanV1,
} from "../localCodingMultiTaskPlannerService.js";
import {
  selectClaimableCodingWorkstreams,
} from "../localCodingMultiWorkerOrchestratorService.js";
import {
  codingWorkstreamOwnsFile,
} from "../localCodingMultiWorkerExecutionService.js";
import {
  buildCodingIntegrationManifest,
  CodingIntegrationGateError,
} from "../localCodingMultiWorkerIntegrationGateService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const GRAPH_ID = "22222222-2222-4222-8222-222222222222";
const BASE_SHA = "a".repeat(40);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function plan() {
  return {
    version: 1 as const,
    taskId: TASK_ID,
    objective:
      "Build backend and frontend workstreams in parallel, then integrate them.",
    workstreams: [
      {
        id: "WS-001",
        title: "Backend",
        role: "backend" as const,
        instruction: "Implement the backend endpoint.",
        dependencies: [],
        ownershipPaths: ["artifacts/api-server/src/features/**"],
        acceptanceCriteria: ["Backend tests pass."],
        verificationProfiles: ["unit_tests" as const, "typecheck" as const],
        priority: 90,
      },
      {
        id: "WS-002",
        title: "Frontend",
        role: "frontend" as const,
        instruction: "Implement the frontend surface.",
        dependencies: [],
        ownershipPaths: ["artifacts/ai-platform/src/features/**"],
        acceptanceCriteria: ["Frontend build passes."],
        verificationProfiles: ["build" as const, "typecheck" as const],
        priority: 80,
      },
      {
        id: "WS-003",
        title: "Integration",
        role: "integration" as const,
        instruction: "Integrate the completed backend and frontend outputs.",
        dependencies: ["WS-001", "WS-002"],
        ownershipPaths: ["artifacts/api-server/src/integration/**"],
        acceptanceCriteria: ["Integration verification passes."],
        verificationProfiles: ["targeted_tests" as const, "typecheck" as const],
        priority: 70,
      },
    ],
  };
}

function persistedWorkstream(
  id: string,
  key: string,
  status: string,
  priority: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    graphId: GRAPH_ID,
    workstreamKey: key,
    title: key,
    role: "backend",
    instruction: "execute",
    status,
    priority,
    ownershipPaths: [],
    acceptanceCriteria: [],
    verificationProfiles: [],
    workerId: null,
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    branchName: null,
    childTaskId: null,
    childRunId: null,
    jobId: null,
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

function completedSnapshot(reviewStatus = "APPROVED") {
  const backendPatch =
    "diff --git a/artifacts/api-server/src/features/routes.ts b/artifacts/api-server/src/features/routes.ts\n+backend";
  const frontendPatch =
    "diff --git a/artifacts/ai-platform/src/features/page.tsx b/artifacts/ai-platform/src/features/page.tsx\n+frontend";
  const integrationPatch =
    "diff --git a/artifacts/api-server/src/integration/index.ts b/artifacts/api-server/src/integration/index.ts\n+integration";

  return {
    graph: {
      id: GRAPH_ID,
      taskId: TASK_ID,
      version: 1,
      contractVersion: 1,
      planHash: "f".repeat(64),
      objective: plan().objective,
      status: "COMPLETED",
      planJson: plan(),
      approvedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    workstreams: [
      {
        id: "w1",
        key: "WS-001",
        title: "Backend",
        role: "backend",
        instruction: "Implement backend.",
        status: "COMPLETED",
        priority: 90,
        ownershipPaths: ["artifacts/api-server/src/features/**"],
        acceptanceCriteria: ["Backend tests pass."],
        verificationProfiles: ["unit_tests", "typecheck"],
        workerId: null,
        branchName: "ai-core/task/ws-001-a1",
        childTaskId: null,
        childRunId: null,
        jobId: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        baseSha: BASE_SHA,
        headSha: null,
        attemptCount: 1,
        resultJson: {
          localExecution: {
            status: "APPLIED",
            changedFiles: ["artifacts/api-server/src/features/routes.ts"],
            patch: backendPatch,
          },
        },
        errorMessage: null,
        dependencies: [],
      },
      {
        id: "w2",
        key: "WS-002",
        title: "Frontend",
        role: "frontend",
        instruction: "Implement frontend.",
        status: "COMPLETED",
        priority: 80,
        ownershipPaths: ["artifacts/ai-platform/src/features/**"],
        acceptanceCriteria: ["Frontend build passes."],
        verificationProfiles: ["build", "typecheck"],
        workerId: null,
        branchName: "ai-core/task/ws-002-a1",
        childTaskId: null,
        childRunId: null,
        jobId: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        baseSha: BASE_SHA,
        headSha: null,
        attemptCount: 1,
        resultJson: {
          workstreamAiExecution: {
            status: "CANDIDATE_READY",
            reviewStatus,
            changedFiles: ["artifacts/ai-platform/src/features/page.tsx"],
            patch: frontendPatch,
            patchSha256: sha256(frontendPatch),
          },
        },
        errorMessage: null,
        dependencies: [],
      },
      {
        id: "w3",
        key: "WS-003",
        title: "Integration",
        role: "integration",
        instruction: "Integrate.",
        status: "COMPLETED",
        priority: 70,
        ownershipPaths: ["artifacts/api-server/src/integration/**"],
        acceptanceCriteria: ["Integration verification passes."],
        verificationProfiles: ["targeted_tests", "typecheck"],
        workerId: null,
        branchName: "ai-core/task/ws-003-a1",
        childTaskId: null,
        childRunId: null,
        jobId: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        baseSha: BASE_SHA,
        headSha: null,
        attemptCount: 1,
        resultJson: {
          localExecution: {
            status: "APPLIED",
            changedFiles: ["artifacts/api-server/src/integration/index.ts"],
            patch: integrationPatch,
          },
        },
        errorMessage: null,
        dependencies: ["WS-001", "WS-002"],
      },
    ],
  } as any;
}

describe("multi-worker coding orchestration E2E contract", () => {
  it("runs parallel roots, unlocks dependent integration, enforces ownership, and produces a review-only manifest", () => {
    const validated = validateCodingMultiTaskPlanV1(plan());

    expect(
      readyCodingWorkstreams(validated, []).map((item) => item.id),
    ).toEqual(["WS-001", "WS-002"]);

    const now = new Date("2026-09-25T08:00:00.000Z");
    const rows = [
      persistedWorkstream("w1", "WS-001", "READY", 90),
      persistedWorkstream("w2", "WS-002", "READY", 80),
      persistedWorkstream("w3", "WS-003", "PENDING", 70),
    ];
    const dependencies = [
      { workstreamId: "w3", dependsOnWorkstreamId: "w1" },
      { workstreamId: "w3", dependsOnWorkstreamId: "w2" },
    ];

    expect(
      selectClaimableCodingWorkstreams(rows, dependencies, now).map(
        (item) => item.workstreamKey,
      ),
    ).toEqual(["WS-001", "WS-002"]);

    expect(
      codingWorkstreamOwnsFile(
        "artifacts/api-server/src/features/routes.ts",
        validated.workstreams[0]!.ownershipPaths,
      ),
    ).toBe(true);
    expect(
      codingWorkstreamOwnsFile(
        "artifacts/ai-platform/src/features/page.tsx",
        validated.workstreams[0]!.ownershipPaths,
      ),
    ).toBe(false);

    expect(
      readyCodingWorkstreams(validated, ["WS-001", "WS-002"]).map(
        (item) => item.id,
      ),
    ).toEqual(["WS-003"]);

    const afterRoots = [
      persistedWorkstream("w1", "WS-001", "COMPLETED", 90),
      persistedWorkstream("w2", "WS-002", "COMPLETED", 80),
      persistedWorkstream("w3", "WS-003", "PENDING", 70),
    ];
    expect(
      selectClaimableCodingWorkstreams(afterRoots, dependencies, now).map(
        (item) => item.workstreamKey,
      ),
    ).toEqual(["WS-003"]);

    const manifest = buildCodingIntegrationManifest(
      TASK_ID,
      completedSnapshot(),
    );

    expect(manifest).toMatchObject({
      version: 1,
      taskId: TASK_ID,
      graphId: GRAPH_ID,
      baseSha: BASE_SHA,
      patchCount: 3,
      nextAction: "REVIEW_INTEGRATION_MANIFEST",
      commitCreated: false,
      pushed: false,
      merged: false,
    });
    expect(manifest.workstreams.map((item) => item.key)).toEqual([
      "WS-001",
      "WS-002",
      "WS-003",
    ]);
    expect(manifest.workstreams.map((item) => item.source)).toEqual([
      "LOCAL_DETERMINISTIC",
      "AI_CANDIDATE",
      "LOCAL_DETERMINISTIC",
    ]);
    expect(manifest.changedFiles).toEqual([
      "artifacts/ai-platform/src/features/page.tsx",
      "artifacts/api-server/src/features/routes.ts",
      "artifacts/api-server/src/integration/index.ts",
    ]);
    expect(manifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed if a completed workstream contains an AI candidate that was never explicitly approved", () => {
    expect(() =>
      buildCodingIntegrationManifest(
        TASK_ID,
        completedSnapshot("PENDING"),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "NOT_READY",
      } satisfies Partial<CodingIntegrationGateError>),
    );
  });
});
