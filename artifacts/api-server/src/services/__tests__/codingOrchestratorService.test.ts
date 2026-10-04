import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInsertValues = vi.hoisted(() => vi.fn());
const mockInsertOnConflictDoNothing = vi.hoisted(() => vi.fn());
const mockUpdateSet = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockDbExecute = vi.hoisted(() => vi.fn());
const mockWithTransientDatabaseRetry = vi.hoisted(() => vi.fn());
const mockEnqueue = vi.hoisted(() => vi.fn());
const mockExecuteRepositoryAnalyzerJobOnDemand = vi.hoisted(() => vi.fn());
const mockFailStaleRepositoryAnalyzerRuns = vi.hoisted(() => vi.fn());
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
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn(() => insertBuilder),
    select: vi.fn(() => selectBuilder),
    update: vi.fn(() => updateBuilder),
    execute: mockDbExecute,
    transaction: mockTransaction,
  },
  withTransientDatabaseRetry: mockWithTransientDatabaseRetry,
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
  failStaleRepositoryAnalyzerRuns: mockFailStaleRepositoryAnalyzerRuns,
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

const {
  startCodingOrchestration,
  resumeDeferredCodingOrchestrations,
  startCodingOrchestrationRecoveryRuntime,
  stopCodingOrchestrationRecoveryRuntime,
  shouldPreserveAdvancedAiGate,
} = await import("../codingOrchestratorService.js");

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

describe("Coding Orchestrator autonomous fail-closed policy", () => {
  it("does not treat an unreadable autonomous state as permission to enable", () => {
    const source = readFileSync(
      new URL("../codingOrchestratorService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("autonomous_enable_deferred_state_unreadable");
    expect(source).toContain("if (autonomousStateReadable && !explicitlyDisabled)");
    expect(source).not.toContain(
      "getAutonomousCodingTaskStatus(input.task.id).catch(() => null)",
    );
  });
});

describe("Coding Orchestrator AI gate monotonicity", () => {
  it("preserves handoff gates that already advanced beyond AI_REQUIRED", () => {
    expect(
      shouldPreserveAdvancedAiGate(
        "AI_REQUIRED",
        JSON.stringify({
          orchestration: { nextAction: "AI_HANDOFF_APPROVED" },
          aiHandoff: { status: "APPROVED" },
        }),
      ),
    ).toBe(true);

    expect(
      shouldPreserveAdvancedAiGate(
        "AI_REQUIRED",
        JSON.stringify({
          orchestration: { nextAction: "AI_REQUIRED" },
          aiHandoff: { status: "APPROVED" },
        }),
      ),
    ).toBe(true);
  });

  it("does not preserve an ordinary unadvanced AI_REQUIRED snapshot", () => {
    expect(
      shouldPreserveAdvancedAiGate(
        "AI_REQUIRED",
        JSON.stringify({ orchestration: { nextAction: "AI_REQUIRED" } }),
      ),
    ).toBe(false);
  });
});

describe("Coding Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockInsertValues.mockReturnValue(insertBuilder);
    mockInsertOnConflictDoNothing.mockResolvedValue([]);
    mockUpdateSet.mockReturnValue(updateBuilder);
    mockUpdateWhere.mockResolvedValue([]);
    mockTransaction.mockImplementation((callback: (executor: typeof tx) => unknown) => callback(tx));
    mockSelectLimit.mockResolvedValue([]);
    mockDbExecute.mockResolvedValue({ rows: [] });
    mockWithTransientDatabaseRetry.mockImplementation(
      async (operation: () => Promise<unknown>) => operation(),
    );
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

    mockFailStaleRepositoryAnalyzerRuns.mockResolvedValue(0);
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

  it("recovers stale analyzer runs before enforcing single-flight", async () => {
    mockFailStaleRepositoryAnalyzerRuns.mockResolvedValueOnce(1);

    await startCodingOrchestration({
      task: task as never,
      run: run as never,
    });

    expect(mockFailStaleRepositoryAnalyzerRuns).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("reconciles orphaned analyzer queue rows before enforcing single-flight", async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 699 }] });

    const started = await startCodingOrchestration({
      task: task as never,
      run: run as never,
    });

    expect(started.sessionId).toBe(`coding-${run.id}`);
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("uses transient DB retry for the analyzer single-flight probe", async () => {
    await startCodingOrchestration({
      task: task as never,
      run: run as never,
    });

    expect(mockWithTransientDatabaseRetry).toHaveBeenCalledWith(
      expect.any(Function),
      { attempts: 4, baseDelayMs: 250 },
    );
  });

  it("defers instead of failing when the analyzer single-flight slot is busy", async () => {
    mockSelectLimit.mockResolvedValueOnce([{ id: 1509 }]);

    const started = await startCodingOrchestration({
      task: task as never,
      run: run as never,
    });

    expect(started.sessionId).toBe(`coding-${run.id}`);
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
    const checkpoint = JSON.parse(mockUpdateSet.mock.calls[0]![0].logs);
    expect(checkpoint.orchestration.nextAction).toBe("WAIT_REPOSITORY_ANALYZER_SLOT");
    expect(checkpoint.orchestration.activeAnalyzerJobId).toBe(1509);
    expect(mockLogAudit).toHaveBeenCalledWith(
      "coding-orchestrator",
      "repository_analyzer_deferred",
      task.id,
      "coding_task",
      "success",
      expect.objectContaining({ activeAnalyzerJobId: 1509 }),
    );
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
  });

  it("fails over in-process when local analyzer spawn hits EAGAIN", async () => {
    let spawnErrorHandler: ((error: Error) => void) | undefined;
    mockSpawn.mockReturnValueOnce({
      unref: vi.fn(),
      once: vi.fn((event: string, handler: (error: Error) => void) => {
        if (event === "error") spawnErrorHandler = handler;
      }),
    });

    await startCodingOrchestration({ task: task as never, run: run as never });
    expect(spawnErrorHandler).toBeTypeOf("function");

    const error = Object.assign(
      new Error("spawn /opt/alt/alt-nodejs22/root/usr/bin/node EAGAIN"),
      { code: "EAGAIN" },
    );
    spawnErrorHandler!(error);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();

    expect(mockExecuteRepositoryAnalyzerJobOnDemand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 701, status: "queued" }),
      { finalizeCodingRun: false },
    );
  });

  it("fails over in-process when a dedicated analyzer never claims the queued job", async () => {
    vi.useFakeTimers();
    vi.stubEnv("REPOSITORY_ANALYZER_EXECUTION_MODE", "remote");
    const queuedJob = {
      id: 1701,
      jobType: "coding_repository_analyzer",
      status: "queued",
      payloadJson: {
        codingTaskId: task.id,
        codingRunId: run.id,
      },
    };
    mockEnqueue.mockResolvedValueOnce(queuedJob);
    mockSelectLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([queuedJob]);

    try {
      await startCodingOrchestration({ task: task as never, run: run as never });
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockExecuteRepositoryAnalyzerJobOnDemand).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(15_000);
      for (let i = 0; i < 20; i += 1) await Promise.resolve();

      expect(mockExecuteRepositoryAnalyzerJobOnDemand).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1701, status: "queued" }),
        { finalizeCodingRun: false },
      );
      expect(mockLogAudit).toHaveBeenCalledWith(
        "coding-orchestrator",
        "repository_analyzer_claim_failover",
        task.id,
        "coding_task",
        "success",
        expect.objectContaining({
          codingRunId: run.id,
          jobId: 1701,
          failoverAfterMs: 15_000,
        }),
      );
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it("resumes the same deferred run after the analyzer slot becomes available", async () => {
    mockSelectLimit.mockResolvedValueOnce([{ id: 1509 }]);
    await startCodingOrchestration({ task: task as never, run: run as never });
    expect(mockEnqueue).not.toHaveBeenCalled();
    const deferredRun = { ...run, logs: mockUpdateSet.mock.calls[0]![0].logs };

    mockDbExecute.mockResolvedValueOnce({ rows: [{ run_id: run.id, task_id: task.id }] });
    mockSelectLimit.mockResolvedValueOnce([task]).mockResolvedValueOnce([deferredRun]).mockResolvedValueOnce([]);
    expect(await resumeDeferredCodingOrchestrations()).toBe(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `coding-repository-analyzer:${run.id}`,
      payloadJson: expect.objectContaining({ codingRunId: run.id, codingTaskId: task.id }),
    }));
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("keeps a deferred run waiting while the original analyzer still owns the slot", async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ run_id: run.id, task_id: task.id }] });
    mockSelectLimit.mockResolvedValueOnce([task]).mockResolvedValueOnce([run]).mockResolvedValueOnce([{ id: 1509 }]);
    await resumeDeferredCodingOrchestrations();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(JSON.parse(mockUpdateSet.mock.calls[0]![0].logs).orchestration.nextAction)
      .toBe("WAIT_REPOSITORY_ANALYZER_SLOT");
  });

  it("does not revive a run whose task was stopped after recovery selected it", async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ run_id: run.id, task_id: task.id }] });
    mockSelectLimit.mockResolvedValueOnce([{ ...task, status: "FAILED" }]).mockResolvedValueOnce([run]);
    expect(await resumeDeferredCodingOrchestrations()).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("enqueues a recovered analysis for the remote worker without launching a local child", async () => {
    vi.stubEnv("REPOSITORY_ANALYZER_EXECUTION_MODE", "remote");
    try {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ run_id: run.id, task_id: task.id }] });
      mockSelectLimit.mockResolvedValueOnce([task]).mockResolvedValueOnce([run]).mockResolvedValueOnce([]);
      expect(await resumeDeferredCodingOrchestrations()).toBe(1);
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockSpawn).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("runs recovery independently of autonomous execution and retries transient query failures", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_CODING_AUTONOMOUS_ENABLED", "false");
    mockDbExecute.mockRejectedValueOnce(new Error("transient query timeout"));
    try {
      startCodingOrchestrationRecoveryRuntime();
      startCodingOrchestrationRecoveryRuntime();
      await vi.advanceTimersByTimeAsync(8_000);
      expect(mockDbExecute).toHaveBeenCalledTimes(2);
      stopCodingOrchestrationRecoveryRuntime();
      await vi.advanceTimersByTimeAsync(16_000);
      expect(mockDbExecute).toHaveBeenCalledTimes(2);
    } finally {
      stopCodingOrchestrationRecoveryRuntime();
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});
