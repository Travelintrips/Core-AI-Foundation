import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  dbSelect: vi.fn(),
  getLatestCodingTaskGraph: vi.fn(),
  startAiHandoffPreparation: vi.fn(),
  approveAiHandoff: vi.fn(),
  assertApprovedAiHandoffFresh: vi.fn(),
  enqueueCodingAiExecution: vi.fn(),
  approveAndValidateAiPatch: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: mocks.dbExecute,
    select: mocks.dbSelect,
  },
  aiCodingBridgeCommandsTable: {},
  aiCodingRunsTable: {},
  aiCodingTasksTable: {},
}));
vi.mock("../aiAuditService.js", () => ({ logAudit: vi.fn() }));
vi.mock("../localCodingControlBridgeService.js", () => ({ appendCodingBridgeResponse: vi.fn() }));
vi.mock("../localCodingTaskGraphService.js", () => ({
  approveCodingTaskGraph: vi.fn(),
  getLatestCodingTaskGraph: mocks.getLatestCodingTaskGraph,
}));
vi.mock("../localCodingMultiWorkerExecutionService.js", () => ({ dispatchReadyCodingWorkstreams: vi.fn() }));
vi.mock("../localCodingWorkstreamAiExecutionService.js", () => ({
  approveWorkstreamAiCandidatePatch: vi.fn(),
  approveWorkstreamAiExecutionHandoff: vi.fn(),
  enqueueWorkstreamAiExecution: vi.fn(),
  materializeApprovedWorkstreamAiCandidate: vi.fn(),
  prepareWorkstreamAiExecutionHandoff: vi.fn(),
}));
vi.mock("../localCodingMultiWorkerOrchestratorService.js", () => ({ completeReviewedCodingWorkstream: vi.fn() }));
vi.mock("../localCodingPatchApprovalService.js", () => ({ approveAndValidateLocalPatch: vi.fn() }));
vi.mock("../localCodingSandboxGateService.js", () => ({ startSandboxVerification: vi.fn() }));
vi.mock("../localCodingDeterministicRecoveryService.js", () => ({ startDeterministicLocalRecovery: vi.fn() }));
vi.mock("../localCodingAiHandoffService.js", () => ({
  approveAiHandoff: mocks.approveAiHandoff,
  assertApprovedAiHandoffFresh: mocks.assertApprovedAiHandoffFresh,
  startAiHandoffPreparation: mocks.startAiHandoffPreparation,
}));
vi.mock("../localCodingAiQueueRuntimeService.js", () => ({
  enqueueCodingAiExecution: mocks.enqueueCodingAiExecution,
}));
vi.mock("../localCodingAiPatchApprovalService.js", () => ({
  approveAndValidateAiPatch: mocks.approveAndValidateAiPatch,
}));
vi.mock("../localCodingCommitApprovalService.js", () => ({ approveCommitAndCreatePullRequest: vi.fn() }));
vi.mock("../localCodingPullRequestGateService.js", () => ({ startPullRequestVerification: vi.fn() }));
vi.mock("../codingCriticalApprovalService.js", () => ({ requestCodingCriticalApproval: vi.fn() }));
vi.mock("../codingControlBridgeSchemaService.js", () => ({ ensureCodingControlBridgeTables: vi.fn() }));

const taskId = "11111111-1111-4111-8111-111111111111";

function queueTaskState(nextAction: string): void {
  mocks.dbSelect
    .mockImplementationOnce(() => ({
      from: () => ({
        where: async () => [{
          id: taskId,
          status: "READY_REVIEW",
          resultSummary: null,
        }],
      }),
    }))
    .mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [{
            id: 1,
            taskId,
            agentName: "Coding Orchestrator",
            status: "COMPLETED",
            startedAt: new Date("2026-09-27T00:00:00.000Z"),
            logs: JSON.stringify({
              orchestration: { nextAction },
              contextPackage: { headSha: "a".repeat(40) },
            }),
          }],
        }),
      }),
    }));
}

describe("autonomous coding workstream lease handling", () => {
  it("waits only for live claims and lets expired claims be reclaimed", async () => {
    const { hasLiveCodingWorkstreamClaim } = await import("../localCodingAutonomousRepairService.js");
    const now = new Date("2026-09-27T07:23:50.000Z");

    expect(
      hasLiveCodingWorkstreamClaim(
        [{
          status: "CLAIMED",
          leaseExpiresAt: "2026-09-27T07:22:41.522Z",
        }],
        now,
      ),
    ).toBe(false);

    expect(
      hasLiveCodingWorkstreamClaim(
        [{
          status: "RUNNING",
          leaseExpiresAt: "2026-09-27T07:24:41.522Z",
        }],
        now,
      ),
    ).toBe(true);
  });

  it("fails closed and waits when an active claim has no lease expiry", async () => {
    const { hasLiveCodingWorkstreamClaim } = await import("../localCodingAutonomousRepairService.js");
    expect(
      hasLiveCodingWorkstreamClaim(
        [{ status: "CLAIMED", leaseExpiresAt: null }],
        new Date("2026-09-27T07:23:50.000Z"),
      ),
    ).toBe(true);
  });
});

describe("autonomous coding repair runtime contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbExecute.mockResolvedValue({
      rows: [{
        task_id: taskId,
        enabled: true,
        status: "ACTIVE",
        cycle_count: 0,
        max_cycles: 10,
        last_action: null,
        last_error: null,
      }],
    });
    mocks.getLatestCodingTaskGraph.mockResolvedValue(null);
    mocks.assertApprovedAiHandoffFresh.mockResolvedValue({
      packageHash: "b".repeat(64),
    });
  });

  it("exports bounded lifecycle controls", async () => {
    const service = await import("../localCodingAutonomousRepairService.js");
    expect(service).toHaveProperty("enableAutonomousCodingTask");
    expect(service).toHaveProperty("disableAutonomousCodingTask");
    expect(service).toHaveProperty("runAutonomousCodingCycle");
    expect(service).toHaveProperty("getAutonomousCodingTaskStatus");
    expect(service).toHaveProperty("startAutonomousCodingRuntime");
    expect(service).toHaveProperty("stopAutonomousCodingRuntime");
  });

  it("prefers the newest completed transition nextAction over a stale orchestrator action", async () => {
    const { runAutonomousCodingCycle } = await import("../localCodingAutonomousRepairService.js");

    mocks.dbSelect
      .mockImplementationOnce(() => ({
        from: () => ({
          where: async () => [{
            id: taskId,
            status: "READY_REVIEW",
            resultSummary: null,
          }],
        }),
      }))
      .mockImplementationOnce(() => ({
        from: () => ({
          where: () => ({
            orderBy: async () => [
              {
                id: "handoff-run",
                taskId,
                agentName: "AI Handoff Gate",
                status: "COMPLETED",
                startedAt: new Date("2026-09-27T00:00:02.000Z"),
                logs: JSON.stringify({
                  executionStatus: "COMPLETED",
                  nextAction: "APPROVE_AI_HANDOFF",
                }),
              },
              {
                id: "orchestrator-run",
                taskId,
                agentName: "Coding Orchestrator",
                status: "COMPLETED",
                startedAt: new Date("2026-09-27T00:00:00.000Z"),
                logs: JSON.stringify({
                  orchestration: { nextAction: "AI_REQUIRED" },
                  contextPackage: { headSha: "a".repeat(40) },
                }),
              },
            ],
          }),
        }),
      }));

    mocks.getLatestCodingTaskGraph.mockResolvedValueOnce(null);

    await expect(runAutonomousCodingCycle(taskId)).resolves.toMatchObject({
      status: "ACTIVE",
      action: "AUTO_APPROVE_AI_HANDOFF",
    });
    expect(mocks.approveAiHandoff).toHaveBeenCalledWith(taskId);
  });

  it("smoke-tests the bounded AI repair sequence without shell or merge authority", async () => {
    const { runAutonomousCodingCycle } = await import("../localCodingAutonomousRepairService.js");

    queueTaskState("AI_REQUIRED");
    await expect(runAutonomousCodingCycle(taskId)).resolves.toMatchObject({
      status: "WAITING",
      action: "AUTO_PREPARE_AI_HANDOFF",
    });
    expect(mocks.startAiHandoffPreparation).toHaveBeenCalledWith(taskId);

    queueTaskState("APPROVE_AI_HANDOFF");
    await expect(runAutonomousCodingCycle(taskId)).resolves.toMatchObject({
      status: "ACTIVE",
      action: "AUTO_APPROVE_AI_HANDOFF",
    });
    expect(mocks.approveAiHandoff).toHaveBeenCalledWith(taskId);

    queueTaskState("AI_HANDOFF_APPROVED");
    await expect(runAutonomousCodingCycle(taskId)).resolves.toMatchObject({
      status: "WAITING",
      action: "AUTO_RUN_CONSTRAINED_AI",
    });
    expect(mocks.assertApprovedAiHandoffFresh).toHaveBeenCalledWith(taskId);
    expect(mocks.enqueueCodingAiExecution).toHaveBeenCalledWith(taskId, {
      requestedBy: "autonomous-repair-loop",
      expectedPackageHash: "b".repeat(64),
    });

    queueTaskState("REVIEW_AI_PATCH");
    await expect(runAutonomousCodingCycle(taskId)).resolves.toMatchObject({
      status: "WAITING",
      action: "AUTO_APPROVE_AI_PATCH",
    });
    expect(mocks.approveAndValidateAiPatch).toHaveBeenCalledWith(taskId);

    expect(mocks.enqueueCodingAiExecution).toHaveBeenCalledTimes(1);
  });
});
