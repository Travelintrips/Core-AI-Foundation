import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInsertValues = vi.hoisted(() => vi.fn());
const mockInsertOnConflictDoNothing = vi.hoisted(() => vi.fn());
const mockUpdateSet = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockEnqueue = vi.hoisted(() => vi.fn());
const mockExecuteRepositoryAnalyzerJobOnDemand = vi.hoisted(() => vi.fn());
const mockRouteToModel = vi.hoisted(() => vi.fn());
const mockGetFallbackModels = vi.hoisted(() => vi.fn());
const mockExecuteAI = vi.hoisted(() => vi.fn());
const mockLogAudit = vi.hoisted(() => vi.fn());
const mockGenerateAndPersistCodingMultiTaskPlan = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());

const insertBuilder = {
  values: mockInsertValues,
  onConflictDoNothing: mockInsertOnConflictDoNothing,
};
const updateBuilder = {
  set: mockUpdateSet,
  where: mockUpdateWhere,
};
const selectBuilder = {
  from: vi.fn(() => selectBuilder),
  where: vi.fn(() => selectBuilder),
  limit: mockSelectLimit,
};
const tx = {
  update: vi.fn(() => updateBuilder),
};

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: mockSpawn,
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((...args: unknown[]) => args),
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn(() => insertBuilder),
    select: vi.fn(() => selectBuilder),
    update: vi.fn(() => updateBuilder),
    transaction: mockTransaction,
  },
  aiCodingRunsTable: { id: "runs.id" },
  aiCodingTasksTable: { id: "tasks.id" },
  aiJobsTable: { id: "jobs.id", jobType: "jobs.jobType", status: "jobs.status" },
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

vi.mock("../localCodingAutomatedMultiTaskPlannerService.js", () => ({
  generateAndPersistCodingMultiTaskPlan: mockGenerateAndPersistCodingMultiTaskPlan,
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

    mockInsertValues.mockReturnValue(insertBuilder);
    mockInsertOnConflictDoNothing.mockResolvedValue([]);
    mockUpdateSet.mockReturnValue(updateBuilder);
    mockUpdateWhere.mockResolvedValue([]);
    mockTransaction.mockImplementation((callback: (executor: typeof tx) => unknown) => callback(tx));
    mockSelectLimit.mockResolvedValue([]);
    mockLogAudit.mockResolvedValue(undefined);
    mockSpawn.mockReturnValue({ unref: vi.fn(), once: vi.fn() });

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
      recommendedChanges: ["Use AI reasoning only if needed."],
      localExecutionPlan: {
        status: "AI_REQUIRED",
        reason: "No deterministic local edit directive was detected.",
        operations: [],
        verificationCommands: ["pnpm test"],
        targetFiles: [],
        warnings: [],
      },
      localExecution: null,
    });

    mockRouteToModel.mockResolvedValue({
      model: { id: 14, modelId: "codestral-latest", capabilities: ["text", "code"] },
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

    mockGenerateAndPersistCodingMultiTaskPlan.mockResolvedValue({
      created: true,
      graphId: "33333333-3333-4333-8333-333333333333",
      graphVersion: 1,
      planHash: "a".repeat(64),
      graphStatus: "PREPARED",
      plan: {
        version: 1,
        taskId: task.id,
        objective: "Implement semantic change safely",
        workstreams: [],
      },
      model: {
        provider: "openai",
        model: "gpt-5",
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
        latencyMs: 300,
      },
      nextAction: "APPROVE_TASK_GRAPH",
    });
  });

  it("escalates AI_REQUIRED into a PREPARED task graph without coding execution", async () => {
    const started = await startCodingOrchestration({ task: task as never, run: run as never });

    expect(started.sessionId).toBe(`coding-${run.id}`);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: "coding_repository_analyzer",
      requiredCapability: "coding_repository_analyzer_on_demand",
      payloadJson: expect.objectContaining({
        orchestratorSessionId: `coding-${run.id}`,
        codingTaskId: task.id,
        codingRunId: run.id,
      }),
    }));

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([expect.stringContaining("repository-analyzer-worker.mjs"), "701"]),
    );
    // Heavy analysis/planning now belongs to the dedicated child process.
    expect(mockExecuteRepositoryAnalyzerJobOnDemand).not.toHaveBeenCalled();
    expect(mockGenerateAndPersistCodingMultiTaskPlan).not.toHaveBeenCalled();
    expect(mockRouteToModel).not.toHaveBeenCalled();
    expect(mockGetFallbackModels).not.toHaveBeenCalled();
    expect(mockExecuteAI).not.toHaveBeenCalled();
  });

  it("retries transient orchestrator session bootstrap failures idempotently", async () => {
    mockInsertOnConflictDoNothing
      .mockRejectedValueOnce(new Error("session insert timeout"))
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce([]);

    const started = await startCodingOrchestration({
      task: task as never,
      run: run as never,
    });

    expect(started.sessionId).toBe(`coding-${run.id}`);
    expect(mockInsertOnConflictDoNothing).toHaveBeenCalledTimes(3);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([expect.stringContaining("repository-analyzer-worker.mjs"), "701"]),
    );
  });

  it("retries ambiguous analyzer enqueue failures with one stable idempotency key", async () => {
    mockEnqueue
      .mockRejectedValueOnce(new Error("transient db timeout"))
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce({
        id: 702,
        jobType: "coding_repository_analyzer",
        status: "queued",
        payloadJson: {
          codingTaskId: task.id,
          codingRunId: run.id,
        },
      });

    const started = await startCodingOrchestration({
      task: task as never,
      run: run as never,
    });

    expect(started.sessionId).toBe(`coding-${run.id}`);
    expect(mockEnqueue).toHaveBeenCalledTimes(3);
    for (const [input] of mockEnqueue.mock.calls) {
      expect(input).toMatchObject({
        idempotencyKey: `coding-repository-analyzer:${run.id}`,
        jobType: "coding_repository_analyzer",
        requiredCapability: "coding_repository_analyzer_on_demand",
      });
    }

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([expect.stringContaining("repository-analyzer-worker.mjs"), "702"]),
    );
  });

  it("launches the dedicated analyzer without running heavy work in the API process", async () => {
    await startCodingOrchestration({ task: task as never, run: run as never });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockExecuteRepositoryAnalyzerJobOnDemand).not.toHaveBeenCalled();
    expect(mockGenerateAndPersistCodingMultiTaskPlan).not.toHaveBeenCalled();
  });});
