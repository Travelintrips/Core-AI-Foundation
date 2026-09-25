import { describe, expect, it } from "vitest";
import {
  parseGeneratedCodingMultiTaskPlan,
  type AutomatedPlannerContext,
} from "../localCodingAutomatedMultiTaskPlannerService.js";
import {
  selectClaimableCodingWorkstreams,
} from "../localCodingMultiWorkerOrchestratorService.js";
import {
  summarizeCodingMissionControl,
} from "../localCodingMissionControlService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const GRAPH_ID = "22222222-2222-4222-8222-222222222222";

function context(): AutomatedPlannerContext {
  return {
    taskId: TASK_ID,
    repository: "Travelintrips/Core-AI-Foundation",
    branch: "main",
    instruction: "Build backend and frontend changes in parallel, then integrate.",
    headSha: "a".repeat(40),
    summary: "Backend and frontend files are relevant.",
    relevantFiles: [
      "artifacts/api-server/src/features/routes.ts",
      "artifacts/ai-platform/src/features/page.tsx",
      "artifacts/api-server/src/integration/index.ts",
    ],
    affectedFiles: [],
    relatedTests: [],
    verificationCommands: ["pnpm test", "pnpm typecheck"],
    filesInspected: [
      "artifacts/api-server/src/features/routes.ts",
      "artifacts/ai-platform/src/features/page.tsx",
      "artifacts/api-server/src/integration/index.ts",
    ],
  };
}

function rawPlan(): string {
  return JSON.stringify({
    version: 1,
    taskId: TASK_ID,
    objective: "Deliver parallel backend and frontend work, then integrate.",
    workstreams: [
      {
        id: "WS-001",
        title: "Backend",
        role: "backend",
        instruction: "Implement backend changes.",
        dependencies: [],
        ownershipPaths: ["artifacts/api-server/src/features/**"],
        acceptanceCriteria: ["Backend verification passes."],
        verificationProfiles: ["unit_tests", "typecheck"],
        priority: 90,
      },
      {
        id: "WS-002",
        title: "Frontend",
        role: "frontend",
        instruction: "Implement frontend changes.",
        dependencies: [],
        ownershipPaths: ["artifacts/ai-platform/src/features/**"],
        acceptanceCriteria: ["Frontend build passes."],
        verificationProfiles: ["build", "typecheck"],
        priority: 80,
      },
      {
        id: "WS-003",
        title: "Integration",
        role: "integration",
        instruction: "Integrate reviewed backend and frontend outputs.",
        dependencies: ["WS-001", "WS-002"],
        ownershipPaths: ["artifacts/api-server/src/integration/**"],
        acceptanceCriteria: ["Integration verification passes."],
        verificationProfiles: ["targeted_tests", "typecheck"],
        priority: 70,
      },
    ],
  });
}

function snapshotFromPlan(
  graphStatus: string,
  statuses: Record<string, string>,
) {
  const plan = parseGeneratedCodingMultiTaskPlan(rawPlan(), context());
  const ids: Record<string, string> = {
    "WS-001": "33333333-3333-4333-8333-333333333331",
    "WS-002": "33333333-3333-4333-8333-333333333332",
    "WS-003": "33333333-3333-4333-8333-333333333333",
  };

  return {
    graph: {
      id: GRAPH_ID,
      taskId: TASK_ID,
      version: 1,
      contractVersion: 1,
      planHash: "f".repeat(64),
      objective: plan.objective,
      status: graphStatus,
      planJson: plan,
      approvedAt: graphStatus === "PREPARED" ? null : new Date(),
      startedAt: graphStatus === "RUNNING" ? new Date() : null,
      completedAt: graphStatus === "COMPLETED" ? new Date() : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    workstreams: plan.workstreams.map((item) => ({
      id: ids[item.id]!,
      key: item.id,
      title: item.title,
      role: item.role,
      instruction: item.instruction,
      status: statuses[item.id] ?? "PENDING",
      priority: item.priority,
      ownershipPaths: item.ownershipPaths,
      acceptanceCriteria: item.acceptanceCriteria,
      verificationProfiles: item.verificationProfiles,
      workerId: null,
      branchName: null,
      childTaskId: null,
      childRunId: null,
      jobId: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      baseSha: null,
      headSha: null,
      attemptCount: 0,
      resultJson: null,
      errorMessage: null,
      dependencies: item.dependencies,
    })),
  } as any;
}

function dependencyRows(snapshot: ReturnType<typeof snapshotFromPlan>) {
  const byKey = new Map(
    snapshot.workstreams.map((item: any) => [item.key, item.id]),
  );
  return snapshot.workstreams.flatMap((item: any) =>
    item.dependencies.map((dependency: string) => ({
      workstreamId: item.id,
      dependsOnWorkstreamId: byKey.get(dependency)!,
    })),
  );
}

describe("automated planner -> control tower production E2E contract", () => {
  it("requires graph approval before dispatch, then advances through dependency gates to integration review", () => {
    const prepared = snapshotFromPlan("PREPARED", {
      "WS-001": "READY",
      "WS-002": "READY",
      "WS-003": "PENDING",
    });

    const preparedControl = summarizeCodingMissionControl(TASK_ID, prepared);
    expect(preparedControl.nextActions).toEqual(["APPROVE_TASK_GRAPH"]);
    expect(preparedControl.nextActions).not.toContain(
      "DISPATCH_READY_WORKSTREAMS",
    );

    const approved = snapshotFromPlan("APPROVED", {
      "WS-001": "READY",
      "WS-002": "READY",
      "WS-003": "PENDING",
    });

    const approvedControl = summarizeCodingMissionControl(TASK_ID, approved);
    expect(approvedControl.nextActions).toEqual([
      "DISPATCH_READY_WORKSTREAMS",
    ]);

    const roots = selectClaimableCodingWorkstreams(
      approved.workstreams.map((item: any) => ({
        ...item,
        workstreamKey: item.key,
        graphId: GRAPH_ID,
        leaseToken: null,
        leaseExpiresAt: null,
        claimedAt: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      dependencyRows(approved),
      new Date("2026-09-25T09:00:00.000Z"),
    );
    expect(roots.map((item) => item.workstreamKey)).toEqual([
      "WS-001",
      "WS-002",
    ]);

    const running = snapshotFromPlan("RUNNING", {
      "WS-001": "RUNNING",
      "WS-002": "RUNNING",
      "WS-003": "PENDING",
    });
    expect(
      summarizeCodingMissionControl(TASK_ID, running).nextActions,
    ).toEqual(["MONITOR_ACTIVE_LEASES"]);

    const integrationReady = snapshotFromPlan("RUNNING", {
      "WS-001": "COMPLETED",
      "WS-002": "COMPLETED",
      "WS-003": "READY",
    });
    expect(
      summarizeCodingMissionControl(TASK_ID, integrationReady).nextActions,
    ).toEqual(["DISPATCH_READY_WORKSTREAMS"]);

    const reviewRequired = snapshotFromPlan("RUNNING", {
      "WS-001": "COMPLETED",
      "WS-002": "COMPLETED",
      "WS-003": "REVIEW_REQUIRED",
    });
    expect(
      summarizeCodingMissionControl(TASK_ID, reviewRequired).nextActions,
    ).toEqual(["REVIEW_WORKSTREAMS"]);

    const completed = snapshotFromPlan("COMPLETED", {
      "WS-001": "COMPLETED",
      "WS-002": "COMPLETED",
      "WS-003": "COMPLETED",
    });
    expect(
      summarizeCodingMissionControl(TASK_ID, completed).nextActions,
    ).toEqual(["REVIEW_INTEGRATION_MANIFEST"]);
    expect(
      summarizeCodingMissionControl(TASK_ID, completed).progressPercent,
    ).toBe(100);
  });

  it("never offers integration review unless the graph itself is COMPLETED", () => {
    const inconsistent = snapshotFromPlan("RUNNING", {
      "WS-001": "COMPLETED",
      "WS-002": "COMPLETED",
      "WS-003": "COMPLETED",
    });

    expect(
      summarizeCodingMissionControl(TASK_ID, inconsistent).nextActions,
    ).not.toContain("REVIEW_INTEGRATION_MANIFEST");
  });
});
