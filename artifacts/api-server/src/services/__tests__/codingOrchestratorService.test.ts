import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInsertValues = vi.hoisted(() => vi.fn());
const mockUpdateSet = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());
const mockEnqueue = vi.hoisted(() => vi.fn());
const mockExecuteRepositoryAnalyzerJobOnDemand = vi.hoisted(() => vi.fn());
const mockRouteToModel = vi.hoisted(() => vi.fn());
const mockGetFallbackModels = vi.hoisted(() => vi.fn());
const mockExecuteAI = vi.hoisted(() => vi.fn());
const mockLogAudit = vi.hoisted(() => vi.fn());

const insertBuilder = {
  values: mockInsertValues,
};
const updateBuilder = {
  set: mockUpdateSet,
  where: mockUpdateWhere,
};
const tx = {
  update: vi.fn(() => updateBuilder),
};

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn(() => insertBuilder),
    update: vi.fn(() => updateBuilder),
    transaction: mockTransaction,
  },
  aiCodingRunsTable: { id: "runs.id" },
  aiCodingTasksTable: { id: "tasks.id" },
  aiOrchestratorSessionsTable: { sessionId: "sessions.sessionId" },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../aiAuditService.js", () => ({
  logAudit: mockLogAudit,
}));

vi.mock("../queueManagerService.js", () => ({
  enqueue: mockEnqueue,
}));

vi.mock("../repositoryAnalyzerService.js", () => ({
  executeRepositoryAnalyzerJobOnDemand: mockExecuteRepositoryAnalyzerJobOnDemand,
}));

vi.mock("../aiModelRouter.js", () => ({
  routeToModel: mockRouteToModel,
  getFallbackModels: mockGetFallbackModels,
}));

vi.mock("../aiExecutionService.js", () => ({
  executeAI: mockExecuteAI,
}));

const { startCodingOrchestration } = await import("../codingOrchestratorService.js");

const task = {
  id: "11111111-1111-4111-8111-111111111111",
  taskNumber: "CWS-ORCH",
  projectName: "Orchestrator test",
  repository: "Travelintrips/Core-AI-Foundation",
  branch: "main",
  instruction: "Add a safe feature",
  status: "ANALYZING",
  priority: 50,
  resultSummary: null,
  commitSha: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const run = {
  id: "22222222-2222-4222-8222-222222222222",
  taskId: task.id,
  agentName: "Coding Orchestrator",
  status: "RUNNING",
  startedAt: new Date("2026-01-01T00:01:00.000Z"),
  finishedAt: null,
  logs: null,
  errorMessage: null,
};

describe("Coding Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockInsertValues.mockResolvedValue([]);
    mockUpdateSet.mockReturnValue(updateBuilder);
    mockUpdateWhere.mockResolvedValue([]);
    mockTransaction.mockImplementation((callback: (executor: typeof tx) => unknown) => callback(tx));
    mockLogAudit.mockResolvedValue(undefined);

    mockEnqueue.mockResolvedValue({
      id: 701,
      jobType: "coding_repository_analyzer",
      status: "queued",
      payloadJson: {
        codingTaskId: task.id,
        codingRunId: run.id,
      },
    });

    mockExecuteRepositoryAnalyzerJobOnDemand.mockResolvedValue({
      codingTaskId: task.id,
      codingRunId: run.id,
      executionStatus: "COMPLETED",
      summary: "Repository Analyzer inspected 20 files.",
      relevantFiles: ["package.json", "src/index.ts"],
      filesInspected: ["package.json", "src/index.ts"],
      findings: [{ severity: "info", title: "Inventory complete", detail: "20 files" }],
      recommendedChanges: ["Update src/index.ts"],
    });

    mockRouteToModel.mockResolvedValue({
      model: { id: 14, modelId: "codestral-latest" },
      provider: { id: 5, slug: "mistral" },
    });
    mockGetFallbackModels.mockResolvedValue([]);
    mockExecuteAI.mockResolvedValue({
      content: JSON.stringify({
        summary: "Implement the requested change in one focused patch.",
        objectives: ["Preserve current behavior"],
        filesToInspect: ["src/index.ts"],
        implementationSteps: ["Update the target implementation"],
        verificationSteps: ["Run typecheck", "Run tests"],
        risks: ["Regression in existing flow"],
      }),
      promptTokens: 100,
      completionTokens: 80,
      tokensUsed: 180,
      latencyMs: 250,
    });
  });

  it("runs Analyzer then Planner and leaves write stages blocked", async () => {
    const started = await startCodingOrchestration({ task: task as never, run: run as never });

    expect(started.sessionId).toBe(`coding-${run.id}`);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: "coding_repository_analyzer",
      requiredCapability: "coding_repository_analyzer",
      payloadJson: expect.objectContaining({
        orchestratorSessionId: `coding-${run.id}`,
        codingTaskId: task.id,
        codingRunId: run.id,
      }),
    }));

    await vi.waitFor(() => {
      expect(mockExecuteRepositoryAnalyzerJobOnDemand).toHaveBeenCalledWith(
        expect.objectContaining({ id: 701 }),
        { finalizeCodingRun: false },
      );
      expect(mockExecuteAI).toHaveBeenCalledOnce();
    });

    const runUpdates = mockUpdateSet.mock.calls
      .map(([value]) => value)
      .filter((value) => value && typeof value === "object");

    expect(runUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "COMPLETED",
        logs: expect.stringContaining('"nextAction": "APPROVE_PLAN"'),
      }),
      expect.objectContaining({
        status: "READY_REVIEW",
        resultSummary: expect.stringContaining("awaiting approval"),
      }),
    ]));

    const finalLogs = runUpdates
      .map((value) => (value as { logs?: string }).logs)
      .find((value): value is string => typeof value === "string" && value.includes('"implementationPlan"'));

    expect(finalLogs).toContain('"Coding Agent"');
    expect(finalLogs).toContain('"status": "BLOCKED"');
  });
});
