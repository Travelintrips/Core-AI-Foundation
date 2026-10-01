import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  taskRead: vi.fn(),
  authorityRead: vi.fn(),
  authorityDelete: vi.fn(),
  acquire: vi.fn(),
  renew: vi.fn(),
  assert: vi.fn(),
  resolveModel: vi.fn(),
  invoke: vi.fn(),
  latestGraph: vi.fn(),
  persist: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const select = {
    from: () => select,
    where: () => select,
    limit: mocks.taskRead,
  };
  return {
    ...actual,
    db: { select: () => select, transaction: mocks.transaction },
  };
});

vi.mock("../localCodingPlannerAuthorityService.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../localCodingPlannerAuthorityService.js")
  >()),
  acquirePlannerAuthority: mocks.acquire,
  renewPlannerAuthority: mocks.renew,
  assertPlannerAuthority: mocks.assert,
}));
vi.mock("../aiAuditService.js", () => ({ logAudit: mocks.audit }));
vi.mock("../localCodingAiPreferredModelService.js", () => ({
  resolvePreferredCodingModel: mocks.resolveModel,
  resolveConfiguredCodingFallbackModel: vi.fn(),
}));
vi.mock("../localCodingAiProductionModelService.js", () => ({
  resolveAlternativeCloudCodingModels: vi.fn(),
}));
vi.mock("../localCodingAiExecutionGateService.js", () => ({
  createConstrainedCodingProviderAdapter: vi.fn(),
}));
vi.mock("../localCodingOllamaWorkerProviderService.js", () => ({
  createScheduledOllamaProviderAdapter: vi.fn(),
}));
vi.mock("../localCodingAiModelAdapterService.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../localCodingAiModelAdapterService.js")
  >()),
  createConstrainedModelInvocationAdapter: () => ({ invoke: mocks.invoke }),
}));
vi.mock("../localCodingTaskGraphService.js", () => ({
  getLatestCodingTaskGraph: mocks.latestGraph,
  persistCodingTaskGraph: mocks.persist,
}));
vi.mock("../aiEventBusService.js", () => ({ publishSafe: vi.fn() }));

import { generateAndPersistCodingMultiTaskPlan } from "../localCodingAutomatedMultiTaskPlannerService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const GRAPH_ID = "22222222-2222-4222-8222-222222222222";
const FILE = "artifacts/api-server/src/services/example.ts";
const analysis = {
  summary: "Bounded repository analysis.",
  contextPackage: { headSha: "a".repeat(40), affectedFiles: [FILE] },
};
const plan = {
  version: 1,
  taskId: TASK_ID,
  objective: "Implement a bounded change.",
  workstreams: [
    {
      id: "WS-001",
      title: "Implementation",
      role: "backend",
      instruction: "Implement the bounded change.",
      dependencies: [],
      ownershipPaths: [FILE],
      acceptanceCriteria: ["Verification passes."],
      verificationProfiles: ["unit_tests"],
      priority: 50,
    },
  ],
};
type Lease = {
  holderId: string;
  leaseToken: string;
  fencingGeneration: number;
};
let lease: Lease | null;

function transientError() {
  return new Error("Failed query: release planner authority", {
    cause: Object.assign(new Error("connection reset"), { code: "08006" }),
  });
}

function failFirstReleaseWindow() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    mocks.transaction.mockRejectedValueOnce(transientError());
  }
}

describe("automated planner authority cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    lease = null;
    mocks.taskRead.mockResolvedValue([
      {
        id: TASK_ID,
        repository: "Travelintrips/Core-AI-Foundation",
        branch: "main",
        instruction: "Implement a bounded change.",
      },
    ]);
    mocks.acquire.mockImplementation(async (input: { holderId: string }) => {
      lease = {
        holderId: input.holderId,
        leaseToken: "lease-token",
        fencingGeneration: 7,
      };
      return { ...lease };
    });
    mocks.authorityRead.mockImplementation(async () => (lease ? [lease] : []));
    mocks.authorityDelete.mockImplementation(async () => {
      lease = null;
    });
    const select = {
      from: () => select,
      where: () => select,
      for: mocks.authorityRead,
    };
    const tx = {
      select: () => select,
      delete: () => ({ where: mocks.authorityDelete }),
    };
    mocks.transaction.mockImplementation(
      async (work: (value: typeof tx) => Promise<unknown>) => work(tx),
    );
    mocks.assert.mockResolvedValue(undefined);
    mocks.renew.mockResolvedValue(undefined);
    mocks.latestGraph.mockResolvedValue(null);
    mocks.audit.mockResolvedValue(undefined);
    mocks.resolveModel.mockResolvedValue({
      ok: true,
      route: "PRIMARY",
      selection: {
        provider: { slug: "openai" },
        model: { modelId: "test-model" },
        timeoutMs: 1_000,
        maxOutputTokens: 4_096,
      },
    });
    mocks.invoke.mockResolvedValue({
      output: { type: "structured", value: plan },
      metadata: {
        provider: "openai",
        model: "test-model",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        latencyMs: 10,
      },
    });
    mocks.persist.mockResolvedValue({
      created: true,
      graph: {
        id: GRAPH_ID,
        version: 1,
        planHash: "f".repeat(64),
        status: "PREPARED",
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases a persisted plan's lease when DB recovery outlasts transaction retries", async () => {
    failFirstReleaseWindow();
    const result = expect(
      generateAndPersistCodingMultiTaskPlan(TASK_ID, analysis),
    ).resolves.toMatchObject({ graphId: GRAPH_ID, graphStatus: "PREPARED" });
    await vi.runAllTimersAsync();
    await result;
    expect(mocks.transaction).toHaveBeenCalledTimes(5);
    expect(mocks.authorityDelete).toHaveBeenCalledOnce();
    expect(lease).toBeNull();
  });

  it("releases a failed planner's lease and preserves its original error", async () => {
    failFirstReleaseWindow();
    mocks.resolveModel.mockResolvedValue({
      ok: false,
      reason: "UNAVAILABLE",
      message: "No planner model.",
    });
    const result = expect(
      generateAndPersistCodingMultiTaskPlan(TASK_ID, analysis),
    ).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
      message: "No planner model.",
    });
    await vi.runAllTimersAsync();
    await result;
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(lease).toBeNull();
  });

  it("handles a delete committed before its connection failure without deleting twice", async () => {
    mocks.authorityDelete.mockImplementationOnce(async () => {
      lease = null;
      throw transientError();
    });
    const result = expect(
      generateAndPersistCodingMultiTaskPlan(TASK_ID, analysis),
    ).resolves.toMatchObject({ graphId: GRAPH_ID });
    await vi.runAllTimersAsync();
    await result;
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.authorityDelete).toHaveBeenCalledOnce();
    expect(lease).toBeNull();
  });

  it.each(["holder", "token", "generation"])(
    "stops cleanup if the %s changes during DB recovery",
    async (changed) => {
      failFirstReleaseWindow();
      mocks.authorityRead.mockImplementationOnce(async () => {
        lease = {
          holderId: changed === "holder" ? "new-holder" : lease!.holderId,
          leaseToken: changed === "token" ? "new-token" : lease!.leaseToken,
          fencingGeneration: changed === "generation" ? 8 : 7,
        };
        return [lease];
      });
      const result = expect(
        generateAndPersistCodingMultiTaskPlan(TASK_ID, analysis),
      ).resolves.toMatchObject({ graphId: GRAPH_ID });
      await vi.runAllTimersAsync();
      await result;
      expect(mocks.transaction).toHaveBeenCalledTimes(5);
      expect(mocks.authorityDelete).not.toHaveBeenCalled();
      expect(lease).not.toBeNull();
    },
  );

  it.each([true, false])(
    "bounds persistent failures and preserves the planner result (persisted=%s)",
    async (persisted) => {
      mocks.transaction.mockRejectedValue(transientError());
      mocks.audit.mockRejectedValue(new Error("Audit DB is unavailable too."));
      if (!persisted) {
        mocks.resolveModel.mockResolvedValue({
          ok: false,
          reason: "UNAVAILABLE",
          message: "No planner model.",
        });
      }
      const invocation = generateAndPersistCodingMultiTaskPlan(
        TASK_ID,
        analysis,
      );
      const result = persisted
        ? expect(invocation).resolves.toMatchObject({ graphId: GRAPH_ID })
        : expect(invocation).rejects.toMatchObject({
            code: "MODEL_UNAVAILABLE",
          });
      await vi.runAllTimersAsync();
      await result;
      expect(mocks.transaction).toHaveBeenCalledTimes(12);
      expect(mocks.authorityDelete).not.toHaveBeenCalled();
      expect(mocks.audit).toHaveBeenCalledWith(
        "automated-multi-task-planner",
        "authority_cleanup_failed",
        TASK_ID,
        "coding_task",
        "failure",
        expect.objectContaining({
          scope: `coding-task:${TASK_ID}`,
          cleanupAttempts: 3,
        }),
      );
    },
  );

  it("does not retry a permanent database error", async () => {
    const error = Object.assign(new Error("permission denied"), {
      code: "42501",
    });
    mocks.transaction.mockRejectedValue(error);
    const result = expect(
      generateAndPersistCodingMultiTaskPlan(TASK_ID, analysis),
    ).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await result;
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.authorityDelete).not.toHaveBeenCalled();
  });
});
