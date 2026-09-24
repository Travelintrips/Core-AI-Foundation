import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeAnalyzer: vi.fn(),
  completeAnalyzer: vi.fn(),
  failAnalyzer: vi.fn(),
  startClaim: vi.fn(),
  heartbeatClaim: vi.fn(),
  markReview: vi.fn(),
  claimReady: vi.fn(),
  selectClaimable: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  aiCodingRunsTable: {},
  aiCodingTaskGraphsTable: {},
  aiCodingTasksTable: {},
  aiCodingWorkstreamDependenciesTable: {},
  aiCodingWorkstreamsTable: {},
  aiJobsTable: {},
  db: {},
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
  selectClaimableCodingWorkstreams: mocks.selectClaimable,
  startCodingWorkstreamClaim: mocks.startClaim,
}));

import {
  codingWorkstreamOwnsFile,
  executeCodingWorkstreamJob,
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
    mocks.completeAnalyzer.mockResolvedValue(undefined);
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

  it("moves a successful analyzer result to REVIEW_WORKSTREAM, not COMPLETED", async () => {
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
    expect(result).toMatchObject({
      graphId: GRAPH_ID,
      workstreamId: WS_ID,
      workstreamKey: "WS-001",
      ownershipValidated: true,
      nextAction: "REVIEW_WORKSTREAM",
    });
  });
});
