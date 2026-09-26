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
const mockGenerateAndPersistCodingMultiTaskPlan = vi.hoisted(() => vi.fn());

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

    await vi.waitFor(() => {
      expect(mockExecuteRepositoryAnalyzerJobOnDemand).toHaveBeenCalledWith(
        expect.objectContaining({ id: 701 }),
        { finalizeCodingRun: false },
      );
    });

    expect(mockGenerateAndPersistCodingMultiTaskPlan).toHaveBeenCalledTimes(1);
    expect(mockGenerateAndPersistCodingMultiTaskPlan).toHaveBeenCalledWith(task.id);
    expect(mockRouteToModel).not.toHaveBeenCalled();
    expect(mockGetFallbackModels).not.toHaveBeenCalled();
    expect(mockExecuteAI).not.toHaveBeenCalled();

    const runUpdates = mockUpdateSet.mock.calls
      .map(([value]) => value)
      .filter((value) => value && typeof value === "object");

    expect(runUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "COMPLETED",
        logs: expect.stringContaining('"nextAction": "APPROVE_TASK_GRAPH"'),
      }),
      expect.objectContaining({
        status: "READY_REVIEW",
        resultSummary: expect.stringContaining("bounded AI planner generated a PREPARED task graph"),
      }),
    ]));

    const finalLogs = runUpdates
      .map((value) => (value as { logs?: string }).logs)
      .find((value): value is string =>
        typeof value === "string" && value.includes('"nextAction": "APPROVE_TASK_GRAPH"'),
      );

    expect(finalLogs).toContain('"Local Deterministic Planner"');
    expect(finalLogs).toContain('"Local Coding Executor"');
    expect(finalLogs).toContain('"status": "BLOCKED"');
    expect(finalLogs).toContain('"graphStatus": "PREPARED"');
    expect(finalLogs).toContain('"graphVersion": 1');
    expect(finalLogs).toContain('"provider": "openai"');
    expect(finalLogs).not.toContain('"implementationPlan"');
  });

  it("surfaces a deterministic review-only patch before any AI fallback", async () => {
    mockExecuteRepositoryAnalyzerJobOnDemand.mockResolvedValueOnce({
      codingTaskId: task.id,
      codingRunId: run.id,
      executionStatus: "COMPLETED",
      summary: "Local Coding Executor produced a review-only patch.",
      relevantFiles: ["src/index.ts"],
      filesInspected: ["src/index.ts"],
      findings: [],
      recommendedChanges: ["Review the deterministic patch."],
      localExecutionPlan: {
        status: "EXECUTABLE",
        reason: "Detected one deterministic local edit operation.",
        operations: [{
          kind: "replace_text",
          path: "src/index.ts",
          search: "old",
          replacement: "new",
        }],
        verificationCommands: ["pnpm test"],
        targetFiles: ["src/index.ts"],
        warnings: [],
      },
      localExecution: {
        status: "APPLIED",
        reason: "Deterministic local patch was produced; verification was intentionally not executed.",
        changedFiles: ["src/index.ts"],
        patch: "diff --git a/src/index.ts b/src/index.ts",
        verification: [],
        rolledBack: false,
        warnings: ["Verification was skipped; repository scripts were not executed."],
      },
    });

    await startCodingOrchestration({ task: task as never, run: run as never });

    await vi.waitFor(() => {
      const logs = mockUpdateSet.mock.calls
        .map(([value]) => (value as { logs?: string })?.logs)
        .find((value): value is string =>
          typeof value === "string" && value.includes('"nextAction": "REVIEW_LOCAL_PATCH"'),
        );
      expect(logs).toContain('"Local Deterministic Planner"');
      expect(logs).toContain('"Local Coding Executor"');
      expect(logs).toContain('"status": "COMPLETED"');
    });

    expect(mockGenerateAndPersistCodingMultiTaskPlan).not.toHaveBeenCalled();
    expect(mockRouteToModel).not.toHaveBeenCalled();
    expect(mockGetFallbackModels).not.toHaveBeenCalled();
    expect(mockExecuteAI).not.toHaveBeenCalled();
  });
});
