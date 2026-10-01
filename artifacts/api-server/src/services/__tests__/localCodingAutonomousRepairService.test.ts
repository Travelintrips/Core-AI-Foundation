import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mockDbExecute = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: { execute: mockDbExecute, select: mockDbSelect },
  withTransientDatabaseRetry: vi.fn(async (operation: () => Promise<unknown>) => operation()),
  aiCodingBridgeCommandsTable: { table: "commands" },
  aiCodingRunsTable: { table: "runs" },
  aiCodingTasksTable: { table: "tasks" },
  aiJobsTable: { table: "jobs" },
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
vi.mock("../localCodingRunRecoveryService.js", () => ({
  reconcileStaleCodingRuns: vi.fn(async () => ({ inspected: 0, recoveredRuns: 0, recoveredTasks: 0 })),
  purgeExpiredCodingTestTasks: vi.fn(async () => ({ inspected: 0, purgedTasks: 0 })),
}));

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

describe("autonomous coding explicit stop", () => {
  it("persists DISABLED even when the autonomous row does not exist yet", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("INSERT INTO ai_platform.ai_coding_autonomous_tasks");
    expect(source).toContain("VALUES (${taskId}::uuid, FALSE, 'DISABLED'");
    expect(source).toContain("ON CONFLICT (task_id) DO UPDATE");
    expect(source).toContain("status = 'DISABLED'");
  });

  it("prevents the coding orchestrator from auto-reenabling an explicitly disabled task", () => {
    const source = readFileSync(
      new URL("../codingOrchestratorService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("getAutonomousCodingTaskStatus");
    expect(source).toContain('=== "DISABLED"');
    expect(source).toContain("Autonomous enable skipped because the task was explicitly disabled");
  });

  it("never reactivates DISABLED tasks during READY_REVIEW recovery", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('["FAILED", "BLOCKED"].includes(String(row.status ?? ""))');
    expect(source).not.toContain('["FAILED", "BLOCKED", "DISABLED"]');
  });

  it("preserves DISABLED across internal enable calls unless explicitly forced", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("options: { forceDisabled?: boolean } = {}");
    expect(source).toContain("WHERE ai_platform.ai_coding_autonomous_tasks.status <> 'DISABLED'");
  });

  it("prevents an in-flight cycle from overwriting an explicit stop", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("AND enabled = TRUE");
    expect(source).toContain("AND status <> 'DISABLED'");
  });

  it("allows only the explicit autonomous start route to force a disabled task active", () => {
    const route = readFileSync(
      new URL("../../routes/coding-control-bridge.ts", import.meta.url),
      "utf8",
    );

    expect(route).toContain("forceDisabled:true");
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


describe("autonomous active-run race recovery", () => {
  it("treats an active-run handoff race as WAITING instead of terminal FAILED", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("/Coding task already has an active run/i.test(message)");
    expect(source).toContain('const action = `WAIT_ACTIVE_RUN:${state.activeRun.agentName}`');
    expect(source).toContain('await setState(taskId, "WAITING", action, null)');
    expect(source).toContain('"active_run_race_deferred"');
  });
});


describe("autonomous workstream AI claim race recovery", () => {
  it("defers stale REVIEW_REQUIRED snapshots instead of terminal failure", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Only a REVIEW_REQUIRED workstream can enter the constrained AI phase");
    expect(source).toContain("Workstream AI-phase claim lost a concurrent update");
    expect(source).toContain('"workstream_ai_claim_race_deferred"');
    expect(source).toContain('"WAIT_WORKSTREAM_EXECUTION"');
    expect(source).toContain('"CONTINUE_WORKSTREAM_AI_RACE"');
  });
});


describe("autonomous AI handoff approval race recovery", () => {
  it("continues when another cycle already advanced the handoff gate", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("/Coding task is not at the APPROVE_AI_HANDOFF gate/i.test(message)");
    expect(source).toContain('state.nextAction === "AI_HANDOFF_APPROVED"');
    expect(source).toContain('"CONTINUE_AI_HANDOFF_APPROVED"');
    expect(source).toContain('"handoff_approval_race_advanced"');
  });
});


describe("autonomous approved-handoff gate regression recovery", () => {
  it("recovers a stale approved-handoff assertion instead of terminal FAILED", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("/Coding task is not at the AI_HANDOFF_APPROVED gate/i.test(message)");
    expect(source).toContain('"RECOVER_AI_HANDOFF_GATE_REGRESSION"');
    expect(source).toContain('"handoff_execution_gate_regression_deferred"');
    expect(source).toContain('["AI_REQUIRED", "APPROVE_AI_HANDOFF"].includes(state.nextAction ?? "")');
  });
});

describe("autonomous transient database recovery", () => {
  it("retries state reads and defers transient database failures instead of terminal FAILED", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("withTransientDatabaseRetry(");
    expect(source).toContain("/timeout exceeded when trying to connect|Failed query:/i.test(message)");
    expect(source).toContain('"RETRY_TRANSIENT_DATABASE"');
    expect(source).toContain('"transient_database_retry_scheduled"');
  });
});

describe("autonomous action budget behavior", () => {
  const taskId = "11111111-1111-4111-8111-111111111111";
  const dialect = new PgDialect();
  let autonomous: Record<string, unknown>;
  let task: Record<string, unknown>;
  let runs: Record<string, unknown>[];
  let jobs: Record<string, unknown>[];

  beforeEach(async () => {
    vi.clearAllMocks();
    autonomous = {
      task_id: taskId, enabled: true, status: "ACTIVE", cycle_count: 39,
      max_cycles: 40, last_action: null, last_error: null,
    };
    task = { id: taskId, status: "READY_REVIEW", resultSummary: null };
    runs = [{
      id: "analysis", agentName: "Coding Orchestrator", status: "COMPLETED",
      logs: JSON.stringify({ orchestration: { nextAction: "AI_REQUIRED" } }),
    }];
    jobs = [];
    mockDbExecute.mockImplementation(async (query: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      if (text.includes("RETURNING task_id")) {
        if (!autonomous.enabled || !["ACTIVE", "WAITING"].includes(String(autonomous.status)) ||
            Number(autonomous.cycle_count) >= Number(autonomous.max_cycles)) return { rows: [] };
        autonomous.cycle_count = Number(autonomous.cycle_count) + 1;
        return { rows: [{ task_id: taskId }] };
      }
      if (text.includes("UPDATE ai_platform.ai_coding_autonomous_tasks")) {
        if (autonomous.enabled && autonomous.status !== "DISABLED") {
          autonomous.status = params[0];
          autonomous.last_action = params[1];
          autonomous.last_error = params[2];
        }
        return { rows: [] };
      }
      return { rows: [{ ...autonomous }] };
    });
    mockDbSelect.mockImplementation(() => {
      let table = "";
      const values = () => table === "tasks" ? [task] : table === "runs" ? runs : table === "jobs" ? jobs : [];
      const builder = {
        from: (input: { table: string }) => { table = input.table; return builder; },
        where: () => builder,
        orderBy: () => builder,
        limit: async () => values(),
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve(values()).then(resolve, reject),
      };
      return builder;
    });
    const graph = await import("../localCodingTaskGraphService.js");
    vi.mocked(graph.getLatestCodingTaskGraph).mockResolvedValue(null);
  });

  it("keeps polling an active execution at the exact limit without blocking or spending cycles", async () => {
    const { runAutonomousCodingCycle } = await import("../localCodingAutonomousRepairService.js");
    autonomous.cycle_count = 40;
    runs.unshift({ id: "execution", agentName: "AI Execution Gate", status: "RUNNING" });
    for (let poll = 0; poll < 20; poll += 1) {
      expect(await runAutonomousCodingCycle(taskId)).toMatchObject({
        status: "WAITING", action: "WAIT_ACTIVE_RUN:AI Execution Gate",
      });
    }
    expect(autonomous.cycle_count).toBe(40);
    expect(autonomous.last_error).toBeNull();
  });

  it("observes completion even when the action budget is exhausted", async () => {
    const { runAutonomousCodingCycle } = await import("../localCodingAutonomousRepairService.js");
    autonomous.cycle_count = 40;
    task.status = "COMPLETED";
    expect(await runAutonomousCodingCycle(taskId)).toMatchObject({ status: "COMPLETED" });
    expect(autonomous.cycle_count).toBe(40);
  });

  it("spends exactly one cycle before starting the last allowed handoff attempt", async () => {
    const { runAutonomousCodingCycle } = await import("../localCodingAutonomousRepairService.js");
    const { startAiHandoffPreparation } = await import("../localCodingAiHandoffService.js");
    vi.mocked(startAiHandoffPreparation).mockImplementationOnce(async () => {
      expect(autonomous.cycle_count).toBe(40);
      return {} as never;
    });
    expect(await runAutonomousCodingCycle(taskId)).toMatchObject({ action: "AUTO_PREPARE_AI_HANDOFF" });
    expect(startAiHandoffPreparation).toHaveBeenCalledTimes(1);
    expect(autonomous.cycle_count).toBe(40);
  });

  it("blocks a new action at the limit without incrementing to cycle 41", async () => {
    const { runAutonomousCodingCycle } = await import("../localCodingAutonomousRepairService.js");
    const { startAiHandoffPreparation } = await import("../localCodingAiHandoffService.js");
    autonomous.cycle_count = 40;
    expect(await runAutonomousCodingCycle(taskId)).toMatchObject({ status: "BLOCKED", action: "MAX_CYCLES_REACHED" });
    expect(startAiHandoffPreparation).not.toHaveBeenCalled();
    expect(autonomous.cycle_count).toBe(40);
  });

  it("waits for queued AI work without re-enqueueing or consuming the budget", async () => {
    const { runAutonomousCodingCycle } = await import("../localCodingAutonomousRepairService.js");
    const { enqueueCodingAiExecution } = await import("../localCodingAiQueueRuntimeService.js");
    autonomous.cycle_count = 40;
    runs[0]!.logs = JSON.stringify({ orchestration: { nextAction: "AI_HANDOFF_APPROVED" } });
    jobs = [{ id: 701 }];
    for (let poll = 0; poll < 3; poll += 1) {
      expect(await runAutonomousCodingCycle(taskId)).toMatchObject({ status: "WAITING", action: "WAIT_AI_EXECUTION_JOB:701" });
    }
    expect(enqueueCodingAiExecution).not.toHaveBeenCalled();
    expect(autonomous.cycle_count).toBe(40);
  });

  it("waits for live workstream claims without spending cycles", async () => {
    const { runAutonomousCodingCycle } = await import("../localCodingAutonomousRepairService.js");
    const { getLatestCodingTaskGraph } = await import("../localCodingTaskGraphService.js");
    autonomous.cycle_count = 40;
    vi.mocked(getLatestCodingTaskGraph).mockResolvedValue({
      graph: { status: "RUNNING" },
      workstreams: [{ status: "RUNNING", leaseExpiresAt: new Date(Date.now() + 60_000) }],
    } as never);
    expect(await runAutonomousCodingCycle(taskId)).toMatchObject({ action: "WAIT_WORKSTREAM_EXECUTION" });
    expect(autonomous.cycle_count).toBe(40);
  });

  it("does not start an action after an explicit stop wins the reservation race", async () => {
    const { runAutonomousCodingCycle } = await import("../localCodingAutonomousRepairService.js");
    const { startAiHandoffPreparation } = await import("../localCodingAiHandoffService.js");
    const original = mockDbExecute.getMockImplementation()!;
    mockDbExecute.mockImplementation(async (query: SQL) => {
      if (dialect.sqlToQuery(query).sql.includes("RETURNING task_id")) {
        autonomous.enabled = false;
        autonomous.status = "DISABLED";
      }
      return original(query);
    });
    expect(await runAutonomousCodingCycle(taskId)).toMatchObject({ status: "DISABLED", action: "NOOP" });
    expect(startAiHandoffPreparation).not.toHaveBeenCalled();
    expect(autonomous.cycle_count).toBe(39);
  });

  it("does not spend cycles when graph dependencies leave nothing ready to dispatch", async () => {
    const { runAutonomousCodingCycle } = await import("../localCodingAutonomousRepairService.js");
    const { getLatestCodingTaskGraph } = await import("../localCodingTaskGraphService.js");
    const { dispatchReadyCodingWorkstreams } = await import("../localCodingMultiWorkerExecutionService.js");
    autonomous.cycle_count = 40;
    vi.mocked(getLatestCodingTaskGraph).mockResolvedValue({
      graph: { status: "RUNNING" },
      workstreams: [
        { key: "source", status: "BLOCKED", dependencies: [] },
        { key: "dependent", status: "PENDING", dependencies: ["source"] },
      ],
    } as never);
    expect(await runAutonomousCodingCycle(taskId)).toMatchObject({ action: "WAIT_TASK_GRAPH" });
    expect(dispatchReadyCodingWorkstreams).not.toHaveBeenCalled();
    expect(autonomous.cycle_count).toBe(40);
  });
});
