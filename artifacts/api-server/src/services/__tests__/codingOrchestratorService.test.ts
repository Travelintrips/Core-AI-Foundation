import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecuteRepositoryAnalyzerJob = vi.hoisted(() => vi.fn());
const mockCompleteRepositoryAnalyzerRun = vi.hoisted(() => vi.fn());
const mockFailRepositoryAnalyzerRun = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((...conditions: unknown[]) => conditions),
}));

vi.mock("@workspace/db", () => ({
  db: {
    update: vi.fn(),
  },
  aiJobsTable: {
    id: "jobs.id",
    status: "jobs.status",
  },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../repositoryAnalyzerService.js", () => ({
  executeRepositoryAnalyzerJob: mockExecuteRepositoryAnalyzerJob,
  completeRepositoryAnalyzerRun: mockCompleteRepositoryAnalyzerRun,
  failRepositoryAnalyzerRun: mockFailRepositoryAnalyzerRun,
}));

const {
  executeCodingOrchestratorJob,
  completeCodingOrchestratorRun,
  failCodingOrchestratorRun,
} = await import("../codingOrchestratorService.js");

describe("Coding Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteRepositoryAnalyzerJob.mockResolvedValue({
      codingTaskId: "11111111-1111-4111-8111-111111111111",
      codingRunId: "22222222-2222-4222-8222-222222222222",
      executionStatus: "COMPLETED",
      summary: "Repository Analyzer inspected 10 files.",
      sourceTarget: "owner/repo",
      branch: "main",
      filesInspected: ["package.json"],
      relevantFiles: ["package.json"],
      findings: [{
        severity: "info",
        title: "Repository inventory complete",
        detail: "Inspected 10 files.",
      }],
      recommendedChanges: ["Proceed to planning."],
    });
  });

  it("wraps Repository Analyzer output in a deterministic multi-agent plan", async () => {
    const result = await executeCodingOrchestratorJob({
      id: 701,
      jobType: "coding_orchestrator",
      payloadJson: {},
    } as never);

    expect(result).toMatchObject({
      codingTaskId: "11111111-1111-4111-8111-111111111111",
      codingRunId: "22222222-2222-4222-8222-222222222222",
      executionStatus: "COMPLETED",
      orchestration: {
        version: "1.0",
        currentStage: "ANALYZE",
        nextStage: "PLAN",
        stages: [
          { stage: "ANALYZE", agent: "Repository Analyzer", status: "COMPLETED" },
          { stage: "PLAN", agent: "Planning Agent", status: "READY" },
          { stage: "CODE", agent: "Coding Agent", status: "PENDING" },
          { stage: "TEST", agent: "Test Agent", status: "PENDING" },
          { stage: "REVIEW", agent: "Review Agent", status: "PENDING" },
        ],
      },
    });
  });

  it("persists orchestrator success through the canonical coding-run completion", async () => {
    const result = { codingTaskId: "task", codingRunId: "run", summary: "done" };
    await completeCodingOrchestratorRun(result);
    expect(mockCompleteRepositoryAnalyzerRun).toHaveBeenCalledWith(result);
  });

  it("persists orchestrator failure through the canonical coding-run failure path", async () => {
    const payload = { codingTaskId: "task", codingRunId: "run" };
    await failCodingOrchestratorRun(payload, "failed");
    expect(mockFailRepositoryAnalyzerRun).toHaveBeenCalledWith(payload, "failed");
  });
});
