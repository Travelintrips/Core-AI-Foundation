import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeAnalyzer: vi.fn(),
  completeAnalyzer: vi.fn(),
  failAnalyzer: vi.fn(),
  startClaim: vi.fn(),
  heartbeatClaim: vi.fn(),
  markReview: vi.fn(),
  completeReviewed: vi.fn(),
  claimReady: vi.fn(),
  selectClaimable: vi.fn(),
  logAudit: vi.fn(),
  isTransientDatabaseConnectionError: vi.fn(),
  getAvailableOllamaCodingSlots: vi.fn(),
  ensureGcpOllamaVmStarted: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  aiCodingRunsTable: {},
  aiCodingTaskGraphsTable: {},
  aiCodingTasksTable: {},
  aiCodingWorkstreamDependenciesTable: {},
  aiCodingWorkstreamsTable: {},
  aiJobsTable: {},
  db: {},
  isTransientDatabaseConnectionError: mocks.isTransientDatabaseConnectionError,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("../aiAuditService.js", () => ({
  logAudit: mocks.logAudit,
}));

vi.mock("../priorityEngine.js", () => ({
  computePriorityScore: vi.fn(() => 100),
}));

vi.mock("../ollamaWorkerRegistryService.js", () => ({
  getAvailableOllamaCodingSlots: mocks.getAvailableOllamaCodingSlots,
}));

vi.mock("../gcpOllamaVmLifecycleService.js", () => ({
  ensureGcpOllamaVmStarted: mocks.ensureGcpOllamaVmStarted,
}));

vi.mock("../repositoryAnalyzerService.js", () => ({
  executeRepositoryAnalyzerJob: mocks.executeAnalyzer,
  completeRepositoryAnalyzerRun: mocks.completeAnalyzer,
  failRepositoryAnalyzerRun: mocks.failAnalyzer,
}));

vi.mock("../localCodingMultiWorkerOrchestratorService.js", () => ({
  claimReadyCodingWorkstreams: mocks.claimReady,
  heartbeatCodingWorkstreamClaim: mocks.heartbeatClaim,
  LocalCodingMultiWorkerError: class LocalCodingMultiWorkerError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly details?: Record<string, unknown>,
    ) {
      super(message);
    }
  },
  markCodingWorkstreamReviewRequired: mocks.markReview,
  completeReviewedCodingWorkstream: mocks.completeReviewed,
  selectClaimableCodingWorkstreams: mocks.selectClaimable,
  startCodingWorkstreamClaim: mocks.startClaim,
}));

import {
  buildCodingWorkstreamBranchBinding,
  codingWorkstreamOwnsFile,
  executeCodingWorkstreamJob,
  resolveCodingDispatchConcurrency,
  requestCodingWorkstreamCapacity,
} from "../localCodingMultiWorkerExecutionService.js";

const GRAPH_ID = "11111111-1111-4111-8111-111111111111";
const WS_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";

function job() {
  return {
    id: 17,
    payloadJson: {
      graphId: GRAPH_ID,
      workstreamId: WS_ID,
      workstreamKey: "WS-001",
      leaseToken: "lease-token-1",
      codingTaskId: TASK_ID,
      codingRunId: RUN_ID,
      repository: "Travelintrips/Core-AI-Foundation",
      branch: "main",
      title: "Backend workstream",
      description: "Implement backend.",
      ownershipPaths: ["artifacts/api-server/src/example/**"],
    },
  } as any;
}

describe("multi-worker GCP Ollama cold start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureGcpOllamaVmStarted.mockResolvedValue(true);
  });

  it("requests the configured GCP Ollama VM when no slot is available", async () => {
    await expect(requestCodingWorkstreamCapacity(0)).resolves.toBe(true);
    expect(mocks.ensureGcpOllamaVmStarted).toHaveBeenCalledTimes(1);
  });

  it("does not start GCP when Ollama capacity already exists", async () => {
    await expect(requestCodingWorkstreamCapacity(2)).resolves.toBe(false);
    expect(mocks.ensureGcpOllamaVmStarted).not.toHaveBeenCalled();
  });

  it("fails closed when the GCP start request is unavailable", async () => {
    mocks.ensureGcpOllamaVmStarted.mockRejectedValueOnce(new Error("not configured"));
    await expect(requestCodingWorkstreamCapacity(0)).resolves.toBe(false);
  });
});

describe("multi-worker Ollama capacity", () => {
  it("uses all available Ollama slots when no explicit limit is requested", () => {
    expect(resolveCodingDispatchConcurrency(undefined, 3)).toBe(3);
  });

  it("never exceeds available Ollama capacity", () => {
    expect(resolveCodingDispatchConcurrency(5, 3)).toBe(3);
    expect(resolveCodingDispatchConcurrency(8, 1)).toBe(1);
  });

  it("dispatches nothing when Ollama has no available slot", () => {
    expect(resolveCodingDispatchConcurrency(5, 0)).toBe(0);
  });

  it("respects an operator limit lower than available capacity", () => {
    expect(resolveCodingDispatchConcurrency(2, 3)).toBe(2);
  });
});

describe("multi-worker execution branch isolation", () => {
  it("keeps clone source on the parent branch but binds child execution to its isolated branch/base SHA", () => {
    expect(
      buildCodingWorkstreamBranchBinding("main", {
        branchName: "ai-core/111111111111/ws-001-a2",
        baseSha: "b".repeat(40),
      }),
    ).toEqual({
      childTaskBranch: "main",
      analyzerSourceBranch: "main",
      isolatedBranchName: "ai-core/111111111111/ws-001-a2",
      expectedBaseSha: "b".repeat(40),
    });
  });
});

describe("multi-worker execution boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startClaim.mockResolvedValue({
      id: WS_ID,
      status: "RUNNING",
    });
    mocks.heartbeatClaim.mockResolvedValue({
      id: WS_ID,
      status: "RUNNING",
    });
    mocks.markReview.mockResolvedValue({
      id: WS_ID,
      status: "REVIEW_REQUIRED",
    });
    mocks.completeReviewed.mockResolvedValue({
      id: WS_ID,
      status: "COMPLETED",
    });
    mocks.completeAnalyzer.mockResolvedValue(undefined);
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.isTransientDatabaseConnectionError.mockReturnValue(false);
    mocks.executeAnalyzer.mockResolvedValue({
      codingTaskId: TASK_ID,
      codingRunId: RUN_ID,
      localExecution: {
        status: "APPLIED",
        changedFiles: ["artifacts/api-server/src/example/routes.ts"],
      },
      contextPackage: {
        headSha: "a".repeat(40),
      },
    });
  });

  it("accepts exact/prefix/glob ownership and rejects traversal", () => {
    expect(
      codingWorkstreamOwnsFile(
        "artifacts/api-server/src/example/routes.ts",
        ["artifacts/api-server/src/example/**"],
      ),
    ).toBe(true);
    expect(
      codingWorkstreamOwnsFile(
        "artifacts/api-server/src/example",
        ["artifacts/api-server/src/example"],
      ),
    ).toBe(true);
    expect(
      codingWorkstreamOwnsFile(
        "artifacts/ai-platform/src/example.tsx",
        ["artifacts/api-server/src/**"],
      ),
    ).toBe(false);
    expect(codingWorkstreamOwnsFile("../secret.ts", ["**"])).toBe(false);
    expect(codingWorkstreamOwnsFile("/etc/passwd", ["**"])).toBe(false);
  });

  it("keeps transient database failures retryable instead of failing the workstream", async () => {
    const transient = new Error("timeout exceeded when trying to connect");
    mocks.executeAnalyzer.mockRejectedValueOnce(transient);
    mocks.isTransientDatabaseConnectionError.mockReturnValueOnce(true);

    await expect(executeCodingWorkstreamJob(job())).rejects.toThrow(
      /timeout exceeded/,
    );

    expect(mocks.failAnalyzer).not.toHaveBeenCalled();
    expect(mocks.logAudit).toHaveBeenCalledWith(
      "coding-multi-worker",
      "workstream_transient_db_retry",
      WS_ID,
      "coding_workstream",
      "success",
      expect.objectContaining({ graphId: GRAPH_ID, jobId: 17 }),
    );
  });

  it("moves a successful analyzer result with changes to REVIEW_WORKSTREAM", async () => {
    const result = await executeCodingWorkstreamJob(job());

    expect(mocks.startClaim).toHaveBeenCalledWith(WS_ID, "lease-token-1");
    expect(mocks.executeAnalyzer).toHaveBeenCalledTimes(1);
    expect(mocks.heartbeatClaim).toHaveBeenCalledWith(
      WS_ID,
      "lease-token-1",
    );
    expect(mocks.markReview).toHaveBeenCalledWith(
      WS_ID,
      "lease-token-1",
      {
        baseSha: "a".repeat(40),
        resultJson: expect.any(Object),
      },
    );
    expect(mocks.completeAnalyzer).toHaveBeenCalledTimes(1);
    expect(mocks.completeAnalyzer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markReview.mock.invocationCallOrder[0]!,
    );
    expect(mocks.completeReviewed).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      graphId: GRAPH_ID,
      workstreamId: WS_ID,
      workstreamKey: "WS-001",
      ownershipValidated: true,
      nextAction: "REVIEW_WORKSTREAM",
    });
  });

  it("auto-finishes a completed no-op workstream instead of leaving it in review", async () => {
    mocks.executeAnalyzer.mockResolvedValueOnce({
      codingTaskId: TASK_ID,
      codingRunId: RUN_ID,
      localExecutionPlan: {
        status: "EXECUTABLE",
      },
      localExecution: {
        status: "NO_CHANGES",
        changedFiles: [],
      },
      contextPackage: {
        headSha: "a".repeat(40),
      },
    });

    const result = await executeCodingWorkstreamJob(job());

    expect(mocks.markReview).toHaveBeenCalledTimes(1);
    expect(mocks.completeAnalyzer).toHaveBeenCalledTimes(1);
    expect(mocks.completeReviewed).toHaveBeenCalledWith(WS_ID, {
      completeChildTask: true,
      childTaskResultSummary:
        "Repository analysis completed with no code changes; workstream auto-finished.",
    });
    expect(result).toMatchObject({
      graphId: GRAPH_ID,
      workstreamId: WS_ID,
      workstreamKey: "WS-001",
      ownershipValidated: true,
      nextAction: "COMPLETED",
    });
  });
});
