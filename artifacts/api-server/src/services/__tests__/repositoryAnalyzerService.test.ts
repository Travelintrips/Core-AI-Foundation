import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockDbTransaction = vi.hoisted(() => vi.fn());
const mockTxUpdateSet = vi.hoisted(() => vi.fn());
const mockTxUpdateWhere = vi.hoisted(() => vi.fn());
const mockTxUpdateReturning = vi.hoisted(() => vi.fn());

const selectBuilder = {
  from: vi.fn(() => selectBuilder),
  where: vi.fn(() => Promise.resolve([{
    id: "11111111-1111-4111-8111-111111111111",
    projectName: "Analyzer test",
    repository: ".",
    branch: "main",
    instruction: "Inspect the repository",
  }])),
};
const updateBuilder = {
  set: mockTxUpdateSet,
  where: mockTxUpdateWhere,
  returning: mockTxUpdateReturning,
};
const tx = {
  update: vi.fn(() => updateBuilder),
};

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((...conditions: unknown[]) => conditions),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    transaction: mockDbTransaction,
  },
  aiCodingRunsTable: {
    id: "codingRuns.id",
    status: "codingRuns.status",
  },
  aiCodingTasksTable: {
    id: "codingTasks.id",
  },
  aiJobsTable: {
    id: "jobs.id",
    status: "jobs.status",
  },
}));

const {
  completeRepositoryAnalyzerRun,
  executeRepositoryAnalyzerJob,
  failRepositoryAnalyzerRun,
} = await import("../repositoryAnalyzerService.js");

const taskId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

describe("repository analyzer execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue(selectBuilder);
    mockDbTransaction.mockImplementation((callback: (executor: typeof tx) => unknown) => callback(tx));
    mockTxUpdateSet.mockReturnValue(updateBuilder);
    mockTxUpdateWhere.mockReturnValue(updateBuilder);
    mockTxUpdateReturning.mockResolvedValue([{ id: runId }]);
  });

  it("accepts the coding task/run context and returns structured repository findings", async () => {
    const result = await executeRepositoryAnalyzerJob({
      id: 701,
      jobType: "coding_repository_analyzer",
      payloadJson: {
        codingTaskId: taskId,
        codingRunId: runId,
        repository: ".",
        branch: "main",
        title: "Analyzer test",
        description: "Inspect the repository",
      },
    } as never);

    expect(result).toMatchObject({
      codingTaskId: taskId,
      codingRunId: runId,
      executionStatus: "COMPLETED",
      sourceTarget: ".",
      branch: "main",
    });
    expect(Array.isArray(result.filesInspected)).toBe(true);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.recommendedChanges)).toBe(true);
  });

  it("persists successful analysis and moves the task to READY_REVIEW", async () => {
    const result = {
      codingTaskId: taskId,
      codingRunId: runId,
      executionStatus: "COMPLETED",
      summary: "Repository analysis completed.",
      findings: [],
    };

    await completeRepositoryAnalyzerRun(result);

    expect(mockDbTransaction).toHaveBeenCalledOnce();
    expect(mockTxUpdateSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: "COMPLETED",
      finishedAt: expect.any(Date),
      logs: expect.stringContaining('"executionStatus": "COMPLETED"'),
      errorMessage: null,
    }));
    expect(mockTxUpdateSet).toHaveBeenNthCalledWith(2, {
      status: "READY_REVIEW",
      resultSummary: "Repository analysis completed.",
    });
  });

  it("persists analyzer failure and prevents a stale RUNNING task", async () => {
    await failRepositoryAnalyzerRun(
      { codingTaskId: taskId, codingRunId: runId },
      "branch was not found",
    );

    expect(mockTxUpdateSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: "FAILED",
      finishedAt: expect.any(Date),
      errorMessage: "branch was not found",
      logs: expect.stringContaining('"executionStatus": "FAILED"'),
    }));
    expect(mockTxUpdateSet).toHaveBeenNthCalledWith(2, {
      status: "FAILED",
      resultSummary: "Repository Analyzer failed: branch was not found",
    });
  });
});