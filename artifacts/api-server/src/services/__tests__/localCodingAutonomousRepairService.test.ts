import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mockDbExecute = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: { execute: mockDbExecute, select: mockDbSelect, update: vi.fn() },
  withTransientDatabaseRetry: vi.fn(async (operation: () => Promise<unknown>) => operation()),
  aiCodingBridgeCommandsTable: { table: "commands" },
  aiCodingRunsTable: { table: "runs" },
  aiCodingTasksTable: { table: "tasks" },
  aiJobsTable: { table: "jobs" },
}));
vi.mock("../aiAuditService.js", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("../localCodingControlBridgeService.js", () => ({ appendCodingBridgeResponse: vi.fn() }));
vi.mock("../localCodingTaskGraphService.js", () => ({ approveCodingTaskGraph: vi.fn(), getLatestCodingTaskGraph: vi.fn() }));
vi.mock("../localCodingMultiWorkerExecutionService.js", () => ({
  dispatchReadyCodingWorkstreams: vi.fn(),
  requestCodingWorkstreamCapacity: vi.fn(async () => false),
}));
vi.mock("../ollamaWorkerRegistryService.js", () => ({
  getAvailableOllamaCodingSlots: vi.fn(async () => 1),
}));
vi.mock("../localCodingWorkstreamAiExecutionService.js", () => ({
  approveWorkstreamAiCandidatePatch: vi.fn(),
  approveWorkstreamAiExecutionHandoff: vi.fn(),
  enqueueWorkstreamAiExecution: vi.fn(),
  manualAiPatchReviewReason: vi.fn(() => null),
  materializeApprovedWorkstreamAiCandidate: vi.fn(),
  prepareWorkstreamAiExecutionHandoff: vi.fn(),
  resetApprovedWorkstreamAiCandidateForAutoRepair: vi.fn(async () => ({
    recoverable: true,
    shouldRetry: true,
    previousRepairAttempts: 0,
    nextRepairAttempt: 1,
    maxRepairAttempts: 3,
    reason: "SAFE_AUTOMATIC_REPAIR",
  })),
}));
vi.mock("../localCodingMultiWorkerOrchestratorService.js", () => ({
  completeReviewedCodingWorkstream: vi.fn(),
  MAX_CODING_WORKSTREAM_CLAIM_LIFETIME_MS: 15 * 60 * 1000,
  retryFailedCodingWorkstream: vi.fn(),
}));
vi.mock("../localCodingPatchApprovalService.js", () => ({ approveAndValidateLocalPatch: vi.fn() }));
vi.mock("../localCodingSandboxGateService.js", () => ({ startSandboxVerification: vi.fn() }));
vi.mock("../localCodingDeterministicRecoveryService.js", () => ({ startDeterministicLocalRecovery: vi.fn() }));
vi.mock("../localCodingAiHandoffService.js", () => ({
  approveAiHandoff: vi.fn(),
  assertApprovedAiHandoffFresh: vi.fn(),
  revokeAiHandoff: vi.fn(),
  startAiHandoffPreparation: vi.fn(),
}));
vi.mock("../localCodingAiQueueRuntimeService.js", () => ({ enqueueCodingAiExecution: vi.fn() }));
vi.mock("../localCodingPlannerQueueRuntimeService.js", () => ({ enqueueCodingMultiTaskPlanner: vi.fn(async () => ({ job: { jobCode: "PLAN-TEST" }, created: false })) }));
vi.mock("../localCodingAiPatchApprovalService.js", () => ({ approveAndValidateAiPatch: vi.fn() }));
vi.mock("../localCodingCommitApprovalService.js", () => ({ approveCommitAndCreatePullRequest: vi.fn() }));
vi.mock("../localCodingPullRequestGateService.js", () => ({
  autoMergeVerifiedPullRequest: vi.fn(),
  startPullRequestVerification: vi.fn(),
}));
vi.mock("../codingCriticalApprovalService.js", () => ({ requestCodingCriticalApproval: vi.fn() }));
vi.mock("../codingControlBridgeSchemaService.js", () => ({ ensureCodingControlBridgeTables: vi.fn() }));
vi.mock("../localCodingRunRecoveryService.js", () => ({
  reconcileStaleCodingRuns: vi.fn(async () => ({ inspected: 0, recoveredRuns: 0, recoveredTasks: 0 })),
  purgeExpiredCodingTestTasks: vi.fn(async () => ({ inspected: 0, purgedTasks: 0 })),
}));

describe("autonomous runtime self-heal policy", () => {
  it("attempts recovery only when configured, stopped, and outside cooldown", async () => {
    const { autonomousRuntimeSelfHealDecision } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      autonomousRuntimeSelfHealDecision({
        configured: false,
        running: false,
        nowMs: 100_000,
        lastAttemptAtMs: 0,
      }),
    ).toBe("NOT_CONFIGURED");
    expect(
      autonomousRuntimeSelfHealDecision({
        configured: true,
        running: true,
        nowMs: 100_000,
        lastAttemptAtMs: 0,
      }),
    ).toBe("ALREADY_RUNNING");
    expect(
      autonomousRuntimeSelfHealDecision({
        configured: true,
        running: false,
        nowMs: 110_000,
        lastAttemptAtMs: 100_000,
        cooldownMs: 30_000,
      }),
    ).toBe("COOLDOWN");
    expect(
      autonomousRuntimeSelfHealDecision({
        configured: true,
        running: false,
        nowMs: 131_000,
        lastAttemptAtMs: 100_000,
        cooldownMs: 30_000,
      }),
    ).toBe("ATTEMPT");
  });
});

describe("autonomous QC scheduling policy", () => {
  it("lets dependency-ready safe siblings advance before a REVIEW_REQUIRED workstream", async () => {
    const { hasDependencyReadyNonReviewWorkstream } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      hasDependencyReadyNonReviewWorkstream([
        { status: "REVIEW_REQUIRED", key: "WS-001", dependencies: [] },
        { status: "READY", key: "WS-002", dependencies: [] },
      ]),
    ).toBe(true);

    expect(
      hasDependencyReadyNonReviewWorkstream([
        { status: "REVIEW_REQUIRED", key: "WS-001", dependencies: [] },
        { status: "PENDING", key: "WS-002", dependencies: ["WS-001"] },
      ]),
    ).toBe(false);
  });

  it("routes candidate warnings into bounded QC revision before human review", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("QC review requested revision:");
    expect(source).toContain("AUTO_QC_REVISION:");
    expect(source).toContain("bounded QC revisions were exhausted");
  });
});

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

  it("does not treat a hard-expired claim as live even when heartbeat kept the lease fresh", async () => {
    const { hasLiveCodingWorkstreamClaim } = await import("../localCodingAutonomousRepairService.js");
    const now = new Date("2026-10-05T09:30:00.000Z");

    expect(
      hasLiveCodingWorkstreamClaim(
        [{
          status: "RUNNING",
          claimedAt: "2026-10-05T09:00:00.000Z",
          leaseExpiresAt: "2026-10-05T09:35:00.000Z",
        }],
        now,
      ),
    ).toBe(false);
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

describe("workstream AI auto-advance race grace", () => {
  it("defers a fresh candidate so the producing job can finish auto-materialization", async () => {
    const { shouldDeferWorkstreamAiCandidateAutoAdvance } = await import(
      "../localCodingAutonomousRepairService.js"
    );
    const now = Date.parse("2026-10-05T07:30:00.000Z");

    expect(
      shouldDeferWorkstreamAiCandidateAutoAdvance(
        {
          status: "CANDIDATE_READY",
          reviewStatus: "PENDING",
          createdAt: "2026-10-05T07:29:30.000Z",
        },
        now,
      ),
    ).toBe(true);
  });

  it("lets autonomous fallback take over after the bounded grace expires", async () => {
    const { shouldDeferWorkstreamAiCandidateAutoAdvance } = await import(
      "../localCodingAutonomousRepairService.js"
    );
    const now = Date.parse("2026-10-05T07:30:31.000Z");

    expect(
      shouldDeferWorkstreamAiCandidateAutoAdvance(
        {
          status: "CANDIDATE_READY",
          reviewStatus: "APPROVED",
          createdAt: "2026-10-05T07:29:30.000Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("does not defer legacy candidates without a valid creation timestamp", async () => {
    const { shouldDeferWorkstreamAiCandidateAutoAdvance } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      shouldDeferWorkstreamAiCandidateAutoAdvance({
        status: "CANDIDATE_READY",
        reviewStatus: "PENDING",
      }),
    ).toBe(false);
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

  it("never reactivates DISABLED tasks during READY_REVIEW recovery", async () => {
    const { readyReviewAutonomousRecoveryDecision } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      readyReviewAutonomousRecoveryDecision({
        status: "DISABLED",
        cycleCount: 0,
        maxCycles: 40,
        lastAction: null,
        lastError: null,
      }),
    ).toEqual({
      reactivate: false,
      extendBudget: false,
      reason: "DISABLED_NOT_SAFE_TO_RECOVER",
    });

    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("AND status IN ('FAILED', 'BLOCKED')");
    expect(source).not.toContain("AND status IN ('FAILED', 'BLOCKED', 'DISABLED')");
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

describe("autonomous missing task graph recovery", () => {
  it("enqueues the bounded planner when no persisted task graph exists", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("enqueueCodingMultiTaskPlanner(taskId)");
    expect(source).toContain("AUTO_ENQUEUE_TASK_GRAPH_PLANNER");
    expect(source).toContain("WAIT_TASK_GRAPH_PLANNER");
  });
});

describe("autonomous task graph stall recovery", () => {
  it("recovers a missing graph from both WAIT_TASK_GRAPH and APPROVE_TASK_GRAPH", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('["WAIT_TASK_GRAPH", "APPROVE_TASK_GRAPH"].includes(state.nextAction ?? "")');
  });

  it("reconciles a graph left RUNNING after every workstream completed", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('snapshot.workstreams.every((item) => item.status === "COMPLETED")');
    expect(source).toContain('status: "COMPLETED", completedAt: new Date()');
    expect(source).toContain('"AUTO_RECONCILE_TASK_GRAPH_COMPLETED"');
  });

  it("does not wait forever behind terminal blocked or cancelled workstreams", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('["BLOCKED", "CANCELLED"].includes(item.status)');
  });
});

describe("autonomous coding cycle budget", () => {
  it("keeps internal re-enable bounded but lets explicit owner restart renew an exhausted budget", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("max_cycles = LEAST(");
    expect(source).toContain("ELSE GREATEST(");
    expect(source).toContain("status IN ('BLOCKED', 'FAILED', 'DISABLED')");
    expect(source).toContain("THEN 0");
    expect(source).toContain("EXCLUDED.max_cycles");
  });
});

describe("autonomous success completion policy", () => {
  it("auto-approves bounded workstream AI handoffs instead of requesting human approval", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("approveWorkstreamAiExecutionHandoff(");
    expect(source).toContain("enqueueWorkstreamAiExecution(review.id");
    expect(source).toContain("AUTO_APPROVE_RUN_WORKSTREAM_AI");
    expect(source).not.toContain("REQUEST_WORKSTREAM_AI_APPROVAL");
  });

  it("automatically merges a PR after verification reaches APPROVE_MERGE", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('case "APPROVE_MERGE":');
    expect(source).toContain("autoMergeVerifiedPullRequest(taskId)");
    expect(source).toContain("AUTO_MERGE_VERIFIED_PR");
    expect(source).not.toContain("WAIT_WA_MERGE_APPROVAL");
  });

  it("marks automatic merge metadata and final task status as COMPLETED", () => {
    const source = readFileSync(
      new URL("../localCodingPullRequestGateService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("autoMerged: automatic");
    expect(source).toContain('status: "COMPLETED"');
    expect(source).toContain('nextAction: "DONE"');
    expect(source).toContain("autoMergeVerifiedPullRequest");
    expect(source).not.toContain("requestCodingCriticalApproval({");
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
    expect(source).toContain('"RETRY_AFTER_ACTIVE_RUN_RACE"');
    expect(source).toContain('const status: AutonomousStatus = stillActive ? "WAITING" : "ACTIVE"');
    expect(source).toContain('raceAlreadyCleared: !stillActive');
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

describe("autonomous benign race cycle refund", () => {
  it("refunds reserved mutation budget when another actor already advanced the gate", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("async function refundReservedActionCycle");
    expect(source).toContain("cycle_count = GREATEST(cycle_count - 1, 0)");
    expect(source).toContain("await refundReservedActionCycle(taskId).catch(() => undefined)");
    expect(source).toContain('"workstream_ai_claim_race_deferred"');
    expect(source).toContain('"active_run_race_deferred"');
    expect(source).toContain('"ai_patch_approval_race_advanced"');
    expect(source).toContain('"handoff_approval_race_advanced"');
    expect(source).toContain('"handoff_execution_gate_regression_deferred"');
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

describe("autonomous stale AI handoff HEAD recovery", () => {
  it("revokes a stale handoff and retries from AI_REQUIRED instead of terminal FAILED", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("error instanceof LocalAiHandoffError");
    expect(source).toContain('error.kind === "STALE_HEAD"');
    expect(source).toContain('["APPROVE_AI_HANDOFF", "AI_HANDOFF_APPROVED"]');
    expect(source).toContain("await revokeAiHandoff(taskId)");
    expect(source).toContain('"RECOVER_STALE_AI_HANDOFF_HEAD"');
    expect(source).toContain('"RETRY_STALE_AI_HANDOFF_RECOVERY"');
    expect(source).toContain('"stale_ai_handoff_head_recovery_scheduled"');
  });
});

describe("autonomous stale AI handoff preparation recovery", () => {
  it("recognizes an async handoff preparation stale-HEAD failure", async () => {
    const { isStaleAiHandoffPreparationError } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      isStaleAiHandoffPreparationError(
        "Repository HEAD changed from aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa to bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; rerun Local Coding Engine before AI handoff",
      ),
    ).toBe(true);
    expect(
      isStaleAiHandoffPreparationError(
        "Repository HEAD changed from aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa to bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; prepare the AI handoff again",
      ),
    ).toBe(false);
    expect(
      isStaleAiHandoffPreparationError("Repository clone failed: resource temporarily unavailable"),
    ).toBe(false);
  });

  it("reruns repository analysis from latest HEAD instead of retrying the stale package", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("staleAiHandoffPreparationFailure(state)");
    expect(source).toContain('"RETRY_STALE_AI_HANDOFF_PREPARATION"');
    expect(source).toContain('"stale_ai_handoff_preparation_reanalysis_started"');
    expect(source).toContain("Repository HEAD changed during AI handoff preparation. Re-running Repository Analyzer from the latest HEAD.");
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

describe("autonomous recoverable operational failures", () => {
  it.each([
    "Constrained model provider failed with PROVIDER_UNAVAILABLE",
    "Ollama worker is unavailable",
    "No healthy worker capacity is available",
    "SSH connection timed out during banner exchange",
    "Connector timeout while calling Hostinger",
    "HTTP 504 Gateway Time-out",
    "Rate limit exceeded: HTTP 429",
    "insufficient_quota from provider",
    "Repository clone failed: No remote source branch is available to seed isolated workspace",
    "resource temporarily unavailable",
  ])("classifies transient operational failure as recoverable: %s", async (message) => {
    const { isRecoverableAutonomousOperationalFailure } = await import(
      "../localCodingAutonomousRepairService.js"
    );
    expect(isRecoverableAutonomousOperationalFailure(message)).toBe(true);
  });

  it.each([
    "TypeScript compile failed: TS2322 type mismatch",
    "Unit test assertion failed: expected true to equal false",
    "Proposal policy rejected: FORBIDDEN_GIT_ACTION",
    "CODING_TASK_NOT_FOUND",
  ])("does not hide deterministic or policy failures as recoverable: %s", async (message) => {
    const { isRecoverableAutonomousOperationalFailure } = await import(
      "../localCodingAutonomousRepairService.js"
    );
    expect(isRecoverableAutonomousOperationalFailure(message)).toBe(false);
  });

  it("reports recoverable operational failures as BLOCKER before terminal FAILED fallback", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );
    const recoverableIndex = source.indexOf('"RECOVERABLE_OPERATIONAL_FAILURE"');
    const terminalIndex = source.indexOf('"AUTONOMOUS_CYCLE_FAILED"', recoverableIndex);
    expect(recoverableIndex).toBeGreaterThan(0);
    expect(terminalIndex).toBeGreaterThan(recoverableIndex);
    expect(source.slice(recoverableIndex, terminalIndex)).toContain(
      'report(\n        taskId,\n        "BLOCKER"',
    );
    expect(source.slice(recoverableIndex, terminalIndex)).toContain(
      "fallbackRequired: true",
    );
  });
});

describe("autonomous repeated provider rejection", () => {
  it("blocks repeated identical non-retryable provider bad requests", async () => {
    const { repeatedNonRetryableAiProviderFailure } = await import(
      "../localCodingAutonomousRepairService.js"
    );
    const failedRun = {
      agentName: "AI Execution Gate",
      status: "FAILED",
      errorMessage: "Constrained model provider failed with PROVIDER_BAD_REQUEST",
    };

    expect(repeatedNonRetryableAiProviderFailure([failedRun])).toBeNull();
    expect(
      repeatedNonRetryableAiProviderFailure([
        failedRun,
        { ...failedRun },
      ]),
    ).toEqual({
      count: 2,
      error: "Constrained model provider failed with PROVIDER_BAD_REQUEST",
    });
  });

  it("does not treat other provider failures as deterministic bad requests", async () => {
    const { repeatedNonRetryableAiProviderFailure } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      repeatedNonRetryableAiProviderFailure([
        {
          agentName: "AI Execution Gate",
          status: "FAILED",
          errorMessage: "Constrained model provider failed with PROVIDER_UNAVAILABLE",
        },
        {
          agentName: "AI Execution Gate",
          status: "FAILED",
          errorMessage: "Constrained model provider failed with PROVIDER_UNAVAILABLE",
        },
      ]),
    ).toBeNull();
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

  it.each(["stopped", "budget exhausted", "recoverable"])("rechecks current recovery state before reactivation: %s", async (scenario) => {
    autonomous.status = "BLOCKED";
    autonomous.cycle_count = 9;
    mockDbExecute.mockImplementation(async (query: SQL) => {
      const normalized = dialect.sqlToQuery(query).sql.replace(/\s+/g, " ");
      if (normalized.includes("SELECT task_id, enabled, status, cycle_count, max_cycles")) {
        const snapshot = { ...autonomous };
        if (scenario === "stopped") {
          autonomous.enabled = false;
          autonomous.status = "DISABLED";
        } else if (scenario === "budget exhausted") {
          autonomous.cycle_count = 40;
        }
        return { rows: [snapshot] };
      }
      if (normalized.includes("last_action = 'RECOVER_READY_REVIEW'")) {
        const stateAllowsUpdate = !normalized.includes("AND status IN ('FAILED', 'BLOCKED')") ||
          ["FAILED", "BLOCKED"].includes(String(autonomous.status));
        const budgetAllowsUpdate = !normalized.includes("AND cycle_count < max_cycles") ||
          Number(autonomous.cycle_count) < Number(autonomous.max_cycles);
        if (!stateAllowsUpdate || !budgetAllowsUpdate) return { rows: [] };
        autonomous.enabled = true;
        autonomous.status = "ACTIVE";
        return { rows: [{ task_id: taskId }] };
      }
      return { rows: [{ ...autonomous }] };
    });

    const { recoverOrphanedReadyReviewTasks } = await import("../localCodingAutonomousRepairService.js");
    await recoverOrphanedReadyReviewTasks();
    expect(autonomous).toMatchObject(
      scenario === "stopped" ? { enabled: false, status: "DISABLED" } :
      scenario === "budget exhausted" ? { status: "BLOCKED", cycle_count: 40 } :
      { enabled: true, status: "ACTIVE" },
    );
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

  it("does not accept persisted COMPLETED while implementation gates are still pending", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('state.task.status === "COMPLETED" && state.nextAction !== "DONE"');
    expect(source).toContain('"RECOVER_FALSE_COMPLETION"');
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

  it("waits for Ollama capacity without spending the autonomous cycle budget", async () => {
    const { runAutonomousCodingCycle } = await import("../localCodingAutonomousRepairService.js");
    const { getLatestCodingTaskGraph } = await import("../localCodingTaskGraphService.js");
    const {
      dispatchReadyCodingWorkstreams,
      requestCodingWorkstreamCapacity,
    } = await import("../localCodingMultiWorkerExecutionService.js");
    const { getAvailableOllamaCodingSlots } = await import("../ollamaWorkerRegistryService.js");

    autonomous.cycle_count = 40;
    runs[0]!.logs = JSON.stringify({ orchestration: { nextAction: "WAIT_TASK_GRAPH" } });
    vi.mocked(getLatestCodingTaskGraph).mockResolvedValue({
      graph: { id: "graph-1", status: "RUNNING" },
      workstreams: [{
        key: "WS-001",
        status: "READY",
        dependencies: [],
        baseSha: "a".repeat(40),
      }],
    } as never);
    vi.mocked(getAvailableOllamaCodingSlots).mockResolvedValue(0);
    vi.mocked(requestCodingWorkstreamCapacity).mockResolvedValue(true);

    expect(await runAutonomousCodingCycle(taskId)).toMatchObject({
      status: "WAITING",
      action: "WAIT_OLLAMA_CAPACITY:START_REQUESTED",
    });
    expect(requestCodingWorkstreamCapacity).toHaveBeenCalledWith(0);
    expect(dispatchReadyCodingWorkstreams).not.toHaveBeenCalled();
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

  it("blocks instead of waiting forever when a dependency workstream is terminally blocked", async () => {
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
    expect(await runAutonomousCodingCycle(taskId)).toMatchObject({
      status: "BLOCKED",
      action: "TASK_GRAPH_BLOCKER",
    });
    expect(dispatchReadyCodingWorkstreams).not.toHaveBeenCalled();
    expect(autonomous.cycle_count).toBe(40);
  });
});


describe("autonomous concurrent materialization advance", () => {
  it("refunds the reserved cycle and continues when another actor already advanced materialization", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("if (repair.concurrentAdvance)");
    expect(source).toContain("await refundReservedActionCycle(taskId).catch(() => undefined)");
    expect(source).toContain("CONTINUE_AFTER_MATERIALIZATION_RACE:");
  });
});

describe("autonomous materialization auto-repair wiring", () => {
  it("routes recoverable stale materialization into bounded candidate regeneration", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("resetApprovedWorkstreamAiCandidateForAutoRepair");
    expect(source).toContain("AUTO_REPAIR_MATERIALIZATION:");
    expect(source).toContain("if (repair.shouldRetry)");
  });
});

describe("autonomous terminal task status", () => {
  it("requires explicit terminal evidence before persisting COMPLETED", async () => {
    const { hasVerifiedCompletionEvidence } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      hasVerifiedCompletionEvidence({
        nextAction: "DONE",
        taskCommitSha: null,
        instruction: "Implement the feature end-to-end",
        payload: {},
        runs: [],
      }),
    ).toBe(false);

    expect(
      hasVerifiedCompletionEvidence({
        nextAction: "DONE",
        taskCommitSha: "a".repeat(40),
        instruction: "Implement the feature end-to-end",
        payload: {},
        runs: [],
      }),
    ).toBe(true);

    expect(
      hasVerifiedCompletionEvidence({
        nextAction: "DONE",
        taskCommitSha: null,
        instruction: "Implement the feature end-to-end",
        payload: {
          localMergeApproval: {
            status: "MERGED",
            mergeCommitSha: "b".repeat(40),
          },
        },
        runs: [],
      }),
    ).toBe(true);
  });

  it("allows explicit verification-only tasks to finish without a source commit", async () => {
    const { hasVerifiedCompletionEvidence } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      hasVerifiedCompletionEvidence({
        nextAction: "DONE",
        taskCommitSha: null,
        instruction: "Jangan ubah file. Verifikasi lifecycle status dan jalankan test.",
        payload: {},
        runs: [{ agentName: "Test Agent", status: "COMPLETED" }],
      }),
    ).toBe(true);
  });

  it("keeps historical terminal rows from being replayed blindly", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("recoverFalseCompletedCodingTasks");
    expect(source).toContain('"RECOVER_FALSE_COMPLETION"');
    expect(source).toContain('state.nextAction === "DONE" && completionVerified');
    expect(source).toContain("COMPLETION_EVIDENCE_MISSING");
  });
});


describe("autonomous lifecycle source recovery", () => {
  it("reads nextAction from completed incident lifecycle runs, not only Coding Orchestrator", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    const start = source.indexOf("async function loadTaskState");
    const end = source.indexOf("function contextHeadSha", start);
    const loader = source.slice(start, end);
    expect(loader).toContain("candidateOrchestration?.nextAction");
    expect(loader).toContain('run.status !== "COMPLETED"');
    expect(loader).toContain("runs.find((run) => {");
  });
});

describe("autonomous reservation conflict recovery", () => {
  it("keeps REVIEW_CONFLICT nonterminal and automatically retries after reservations clear", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('case "REVIEW_CONFLICT"');
    expect(source).toContain("reserveCodingFileSet({");
    expect(source).toContain('probe.status !== "CONFLICT"');
    expect(source).toContain('"RETRY_RESERVATION_CONFLICT"');
    expect(source).toContain("restartRepositoryAnalysisAfterTransientFailure(");
    expect(source).toContain('"WAIT_RESERVATION_CONFLICT"');
    expect(source).toContain('report(taskId, "BLOCKER"');
    expect(source).toContain("automaticRetry: true");
    expect(source).toContain("recoverable: true");
  });
});

describe("autonomous repository analyzer resource-pressure recovery", () => {
  it("restarts failed analyzer work instead of falling through to unsupported nextAction", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("retryableRepositoryAnalyzerFailure(state)");
    expect(source).toContain("isRetryableRepositoryCloneResourceError(error)");
    expect(source).toContain("RETRY_REPOSITORY_ANALYZER_RESOURCE_PRESSURE");
    expect(source).toContain("restartRepositoryAnalysisAfterTransientFailure(taskId)");
    expect(source).toContain('status: "ANALYZING"');
  });
});

describe("autonomous deterministic workstream child completion", () => {
  it("closes the child task when deterministic review is completed", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    const marker = "AUTO_COMPLETE_DETERMINISTIC_WORKSTREAM";
    const markerIndex = source.indexOf(marker);
    expect(markerIndex).toBeGreaterThan(0);
    const window = source.slice(Math.max(0, markerIndex - 700), markerIndex + 250);
    expect(window).toContain("completeReviewedCodingWorkstream(review.id, {");
    expect(window).toContain("completeChildTask: true");
    expect(window).toContain("Deterministic reviewed workstream completed automatically");
  });
});

describe("READY_REVIEW conflict orphan recovery", () => {
  it("includes REVIEW_CONFLICT in periodic orphan recovery", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    const start = source.indexOf("const recoverable = new Set([");
    const end = source.indexOf("]);", start);
    const recoverable = source.slice(start, end);
    expect(recoverable).toContain('"REVIEW_CONFLICT"');
  });
});

describe("Temporal autonomous READY_REVIEW recovery", () => {
  it("runs the throttled recoverable-task sweep from the Temporal polling path", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    const listStart = source.indexOf("export async function listActiveAutonomousCodingTasks");
    const listEnd = source.indexOf("async function temporalOrchestratorActive", listStart);
    const listSource = source.slice(listStart, listEnd);
    expect(listSource).toContain("await maybeRecoverOrphanedReadyReviewTasks();");

    const helperStart = source.indexOf("async function maybeRecoverOrphanedReadyReviewTasks");
    const helperEnd = source.indexOf(
      "export async function recoverOrphanedReadyReviewTasks",
      helperStart,
    );
    const helperSource = source.slice(helperStart, helperEnd);
    expect(helperSource).toContain("READY_REVIEW_RECOVERY_INTERVAL_MS");
    expect(helperSource).toContain("lastReadyReviewRecoveryAt = nowMs");
    expect(helperSource).toContain("recoverOrphanedReadyReviewTasks()");
  });
});

describe("READY_REVIEW autonomous recovery policy", () => {
  it("reactivates safe technical blockers without bypassing policy blockers", async () => {
    const { readyReviewAutonomousRecoveryDecision } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      readyReviewAutonomousRecoveryDecision({
        status: "BLOCKED",
        cycleCount: 12,
        maxCycles: 40,
        lastAction: "TASK_GRAPH_BLOCKER",
        lastError: "Workstream WS-001 failed: AI proposal policy rejected: EXPIRED_HANDOFF",
      }),
    ).toEqual({
      reactivate: true,
      extendBudget: false,
      reason: "RECOVERABLE_TECHNICAL_BLOCKER",
    });

    expect(
      readyReviewAutonomousRecoveryDecision({
        status: "BLOCKED",
        cycleCount: 12,
        maxCycles: 40,
        lastAction: "RECOVERABLE_OPERATIONAL_FAILURE",
        lastError: "SSH connection timed out during banner exchange",
      }),
    ).toEqual({
      reactivate: true,
      extendBudget: false,
      reason: "RECOVERABLE_TECHNICAL_BLOCKER",
    });

    expect(
      readyReviewAutonomousRecoveryDecision({
        status: "BLOCKED",
        cycleCount: 12,
        maxCycles: 40,
        lastAction: "WAIT_RESERVATION_CONFLICT",
        lastError: "Active file reservation conflict is recoverable.",
      }),
    ).toEqual({
      reactivate: true,
      extendBudget: false,
      reason: "RECOVERABLE_TECHNICAL_BLOCKER",
    });

    expect(
      readyReviewAutonomousRecoveryDecision({
        status: "BLOCKED",
        cycleCount: 12,
        maxCycles: 40,
        lastAction: "UNSUPPORTED_NEXT_ACTION",
        lastError: "Autonomous loop tidak memiliki action aman untuk nextAction=REVIEW_CONFLICT.",
      }),
    ).toEqual({
      reactivate: true,
      extendBudget: false,
      reason: "RECOVERABLE_TECHNICAL_BLOCKER",
    });

    expect(
      readyReviewAutonomousRecoveryDecision({
        status: "BLOCKED",
        cycleCount: 12,
        maxCycles: 40,
        lastAction: "TASK_GRAPH_BLOCKER",
        lastError: "AI proposal policy rejected: FORBIDDEN_GIT_ACTION",
      }),
    ).toEqual({
      reactivate: false,
      extendBudget: false,
      reason: "POLICY_OR_MANUAL_REVIEW_BLOCKER",
    });
  });

  it("recovers disabled wait races but never explicit manual stops", async () => {
    const { readyReviewAutonomousRecoveryDecision } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      readyReviewAutonomousRecoveryDecision({
        status: "DISABLED",
        cycleCount: 0,
        maxCycles: 60,
        lastAction: "WAIT_ACTIVE_RUN:Coding Orchestrator",
        lastError: null,
      }),
    ).toEqual({
      reactivate: true,
      extendBudget: false,
      reason: "DISABLED_WAIT_RACE",
    });

    expect(
      readyReviewAutonomousRecoveryDecision({
        status: "DISABLED",
        cycleCount: 0,
        maxCycles: 60,
        lastAction: "MANUAL_STOP",
        lastError: null,
      }),
    ).toEqual({
      reactivate: false,
      extendBudget: false,
      reason: "MANUAL_STOP",
    });

    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("last_action = 'MANUAL_STOP'");
    expect(source).toContain("last_action LIKE 'WAIT_ACTIVE_RUN:%'");
    expect(source).toContain("RECOVER_READY_REVIEW_DISABLED_WAIT");
  });

  it("gives legacy max-cycle tasks only one bounded second budget", async () => {
    const { readyReviewAutonomousRecoveryDecision } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      readyReviewAutonomousRecoveryDecision({
        status: "BLOCKED",
        cycleCount: 40,
        maxCycles: 40,
        lastAction: "MAX_CYCLES_REACHED",
        lastError: "Autonomous repair cycle limit reached.",
      }),
    ).toEqual({
      reactivate: true,
      extendBudget: true,
      reason: "ONE_TIME_LEGACY_BUDGET_EXTENSION",
    });

    expect(
      readyReviewAutonomousRecoveryDecision({
        status: "BLOCKED",
        cycleCount: 80,
        maxCycles: 80,
        lastAction: "MAX_CYCLES_REACHED",
        lastError: "Autonomous repair cycle limit reached.",
      }).reactivate,
    ).toBe(false);
  });

  it("runs READY_REVIEW recovery periodically and processes oldest rows first", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("READY_REVIEW_RECOVERY_INTERVAL_MS = 60_000");
    expect(source).toContain(".orderBy(aiCodingTasksTable.updatedAt)");
    expect(source).toContain(".limit(50)");
    expect(source).toContain("periodic READY_REVIEW recovery failed");
  });
});

describe("autonomous failed-workstream recovery classification", () => {
  it("retries transient database failures but not policy failures", async () => {
    const { isTransientWorkstreamDatabaseFailure } = await import(
      "../localCodingAutonomousRepairService.js"
    );

    expect(
      isTransientWorkstreamDatabaseFailure(
        'Workstream AI phase "assert_authorization" failed: Failed query: select * from ai_platform.ai_coding_task_graphs',
      ),
    ).toBe(true);
    expect(
      isTransientWorkstreamDatabaseFailure(
        "timeout exceeded when trying to connect",
      ),
    ).toBe(true);
    expect(
      isTransientWorkstreamDatabaseFailure(
        "AI proposal policy rejected: FORBIDDEN_GIT_ACTION",
      ),
    ).toBe(false);
  });

  it("bounds transient workstream database retries before hard blocking", () => {
    const source = readFileSync(
      new URL("../localCodingAutonomousRepairService.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("AUTO_RECOVER_TRANSIENT_WORKSTREAM_DB");
    expect(source).toContain("failed.attemptCount < 4");
    expect(source).toContain("retryFailedCodingWorkstream(failed.id)");
  });
});
