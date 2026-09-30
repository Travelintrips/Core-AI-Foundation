import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  withTransientDatabaseRetry: vi.fn(async (operation: () => Promise<unknown>) => operation()),
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

describe("autonomous coding cycle budget", () => {
  it("never widens an existing cycle budget during re-enable", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("max_cycles = LEAST(");
    expect(source).toContain("ai_platform.ai_coding_autonomous_tasks.max_cycles");
    expect(source).toContain("EXCLUDED.max_cycles");
  });
});

describe("autonomous coding repair runtime contract", () => {
  it("exports bounded lifecycle controls", async () => {
    const service = await import("../localCodingAutonomousRepairService.js");
    expect(service).toHaveProperty("enableAutonomousCodingTask");
    expect(service).toHaveProperty("disableAutonomousCodingTask");
    expect(service).toHaveProperty("runAutonomousCodingCycle");
    expect(service).toHaveProperty("getAutonomousCodingTaskStatus");
    expect(service).toHaveProperty("startAutonomousCodingRuntime");
    expect(service).toHaveProperty("stopAutonomousCodingRuntime");
  });
});
