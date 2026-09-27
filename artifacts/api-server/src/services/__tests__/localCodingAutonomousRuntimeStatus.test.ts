import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  aiCodingBridgeCommandsTable: {},
  aiCodingRunsTable: {},
  aiCodingTasksTable: {},
}));
vi.mock("../aiAuditService.js", () => ({ logAudit: vi.fn() }));
vi.mock("../localCodingControlBridgeService.js", () => ({ appendCodingBridgeResponse: vi.fn() }));
vi.mock("../localCodingTaskGraphService.js", () => ({ approveCodingTaskGraph: vi.fn(), getLatestCodingTaskGraph: vi.fn() }));
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
  approveAiHandoff: vi.fn(),
  assertApprovedAiHandoffFresh: vi.fn(),
  startAiHandoffPreparation: vi.fn(),
}));
vi.mock("../localCodingAiQueueRuntimeService.js", () => ({ enqueueCodingAiExecution: vi.fn() }));
vi.mock("../localCodingAiPatchApprovalService.js", () => ({ approveAndValidateAiPatch: vi.fn() }));
vi.mock("../localCodingCommitApprovalService.js", () => ({ approveCommitAndCreatePullRequest: vi.fn() }));
vi.mock("../localCodingPullRequestGateService.js", () => ({ startPullRequestVerification: vi.fn() }));
vi.mock("../codingCriticalApprovalService.js", () => ({ requestCodingCriticalApproval: vi.fn() }));
vi.mock("../codingControlBridgeSchemaService.js", () => ({ ensureCodingControlBridgeTables: vi.fn() }));
vi.mock("../localCodingMultiWorkerIntegrationFinalizerService.js", () => ({ finalizeCodingTaskGraphIntegration: vi.fn() }));

describe("autonomous runtime readiness status", () => {
  const originalEnabled = process.env["AI_CODING_AUTONOMOUS_ENABLED"];
  const originalPoll = process.env["AI_CODING_AUTONOMOUS_POLL_MS"];

  beforeEach(() => {
    process.env["AI_CODING_AUTONOMOUS_ENABLED"] = "true";
    process.env["AI_CODING_AUTONOMOUS_POLL_MS"] = "9000";
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env["AI_CODING_AUTONOMOUS_ENABLED"];
    else process.env["AI_CODING_AUTONOMOUS_ENABLED"] = originalEnabled;
    if (originalPoll === undefined) delete process.env["AI_CODING_AUTONOMOUS_POLL_MS"];
    else process.env["AI_CODING_AUTONOMOUS_POLL_MS"] = originalPoll;
  });

  it("reports configuration without exposing secrets", async () => {
    const service = await import("../localCodingAutonomousRepairService.js");
    const status = service.getAutonomousRuntimeStatus();
    expect(status.configured).toBe(true);
    expect(status.running).toBe(false);
    expect(status.pollIntervalMs).toBe(9000);
    expect(status.maxTasksPerTick).toBeGreaterThan(0);
    expect(status).not.toHaveProperty("token");
    expect(status).not.toHaveProperty("secret");
  });
});
