import { and, desc, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  aiCodingBridgeCommandsTable,
  aiCodingRunsTable,
  aiCodingTasksTable,
  aiJobsTable,
  db,
  withTransientDatabaseRetry,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { logAudit } from "./aiAuditService.js";
import { appendCodingBridgeResponse, getCodingBridgeAvailability } from "./localCodingControlBridgeService.js";
import { approvePlanAndStartCoding } from "./codingAgentService.js";
import {
  approveCodingTaskGraph,
  getLatestCodingTaskGraph,
} from "./localCodingTaskGraphService.js";
import { dispatchReadyCodingWorkstreams } from "./localCodingMultiWorkerExecutionService.js";
import {
  approveWorkstreamAiCandidatePatch,
  approveWorkstreamAiExecutionHandoff,
  enqueueWorkstreamAiExecution,
  manualAiPatchReviewReason,
  materializeApprovedWorkstreamAiCandidate,
  prepareWorkstreamAiExecutionHandoff,
} from "./localCodingWorkstreamAiExecutionService.js";
import {
  completeReviewedCodingWorkstream,
  retryFailedCodingWorkstream,
} from "./localCodingMultiWorkerOrchestratorService.js";
import { approveAndValidateLocalPatch } from "./localCodingPatchApprovalService.js";
import { startSandboxVerification } from "./localCodingSandboxGateService.js";
import { startDeterministicLocalRecovery } from "./localCodingDeterministicRecoveryService.js";
import {
  approveAiHandoff,
  assertApprovedAiHandoffFresh,
  startAiHandoffPreparation,
} from "./localCodingAiHandoffService.js";
import { enqueueCodingAiExecution } from "./localCodingAiQueueRuntimeService.js";
import { approveAndValidateAiPatch } from "./localCodingAiPatchApprovalService.js";
import { approveCommitAndCreatePullRequest } from "./localCodingCommitApprovalService.js";
import {
  autoMergeVerifiedPullRequest,
  startPullRequestVerification,
} from "./localCodingPullRequestGateService.js";
import { ensureCodingControlBridgeTables } from "./codingControlBridgeSchemaService.js";
import { finalizeCodingTaskGraphIntegration } from "./localCodingMultiWorkerIntegrationFinalizerService.js";
import { purgeExpiredCodingTestTasks, reconcileStaleCodingRuns } from "./localCodingRunRecoveryService.js";
import { isRetryableRepositoryCloneResourceError } from "./repositoryAnalyzerService.js";

const DEFAULT_INTERVAL_MS = 8_000;
const MIN_INTERVAL_MS = 2_000;
const MAX_INTERVAL_MS = 60_000;
const DEFAULT_MAX_CYCLES = 40;
const MAX_TASKS_PER_TICK = 8;
export const TEMPORAL_CODING_ORCHESTRATOR_CLIENT_ID = "gcp-temporal-coding-orchestrator";

type AutonomousStatus =
  | "ACTIVE"
  | "WAITING"
  | "APPROVAL_REQUIRED"
  | "COMPLETED"
  | "BLOCKED"
  | "FAILED"
  | "DISABLED";

type AutonomousRow = {
  task_id: string;
  enabled: boolean;
  status: AutonomousStatus;
  cycle_count: number;
  max_cycles: number;
  last_action: string | null;
  last_error: string | null;
};

let timer: NodeJS.Timeout | null = null;
let tickRunning = false;
let lastTestTaskRetentionSweepAt = 0;
const TEST_TASK_RETENTION_SWEEP_INTERVAL_MS = 60 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function envTrue(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function pollInterval(): number {
  const parsed = Number(process.env["AI_CODING_AUTONOMOUS_POLL_MS"]);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.floor(parsed)));
}

async function setState(
  taskId: string,
  status: AutonomousStatus,
  action: string,
  error?: string | null,
): Promise<void> {
  await db.execute(sql`
    UPDATE ai_platform.ai_coding_autonomous_tasks
    SET status = ${status},
        last_action = ${action},
        last_error = ${error ?? null},
        last_cycle_at = NOW(),
        completed_at = CASE WHEN ${status} = 'COMPLETED' THEN NOW() ELSE completed_at END,
        updated_at = NOW()
    WHERE task_id = ${taskId}::uuid
      AND enabled = TRUE
      AND status <> 'DISABLED'
  `);
}

class AutonomousCycleStopped extends Error {
  constructor(
    readonly status: AutonomousStatus,
    readonly action: string,
  ) {
    super(action);
  }
}

async function reserveActionCycle(taskId: string): Promise<void> {
  // Reserve only a mutation attempt, atomically and before invoking it. Polls,
  // race deferrals and terminal observations do not spend the repair budget.
  const result = await db.execute(sql`
    UPDATE ai_platform.ai_coding_autonomous_tasks
    SET cycle_count = cycle_count + 1, last_cycle_at = NOW(), updated_at = NOW()
    WHERE task_id = ${taskId}::uuid
      AND enabled = TRUE
      AND status IN ('ACTIVE', 'WAITING')
      AND cycle_count < max_cycles
    RETURNING task_id
  `);
  if (result.rows?.length) return;

  const current = await getAutonomousCodingTaskStatus(taskId) as AutonomousRow | null;
  if (!current || !current.enabled || current.status === "DISABLED") {
    throw new AutonomousCycleStopped("DISABLED", "NOOP");
  }
  if (!["ACTIVE", "WAITING"].includes(current.status)) {
    throw new AutonomousCycleStopped(current.status, current.last_action ?? "NOOP");
  }
  await setState(taskId, "BLOCKED", "MAX_CYCLES_REACHED", "Autonomous repair cycle limit reached.");
  await report(
    taskId,
    "BLOCKER",
    "AI Core menghentikan autonomous repair karena batas siklus tercapai.",
    { cycleCount: current.cycle_count, maxCycles: current.max_cycles },
  );
  throw new AutonomousCycleStopped("BLOCKED", "MAX_CYCLES_REACHED");
}

async function commandIdForTask(taskId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: aiCodingBridgeCommandsTable.id })
    .from(aiCodingBridgeCommandsTable)
    .where(eq(aiCodingBridgeCommandsTable.taskId, taskId))
    .orderBy(desc(aiCodingBridgeCommandsTable.createdAt))
    .limit(1);
  return row?.id ?? null;
}

async function report(
  taskId: string,
  kind: "PROGRESS" | "CHECKPOINT" | "BLOCKER" | "COMPLETED" | "FAILED",
  message: string,
  checkpoint: Record<string, unknown> = {},
): Promise<void> {
  const commandId = await commandIdForTask(taskId);
  if (!commandId) return;
  await appendCodingBridgeResponse({
    commandId,
    taskId,
    kind,
    message,
    checkpoint,
  }).catch(() => undefined);
}

async function loadTaskState(taskId: string) {
  const [task] = await withTransientDatabaseRetry(
    () => db
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId)),
    { attempts: 3, baseDelayMs: 250 },
  );
  if (!task) throw new Error("CODING_TASK_NOT_FOUND");

  const runs = await withTransientDatabaseRetry(
    () => db
      .select()
      .from(aiCodingRunsTable)
      .where(eq(aiCodingRunsTable.taskId, taskId))
      .orderBy(desc(aiCodingRunsTable.startedAt)),
    { attempts: 3, baseDelayMs: 250 },
  );

  const activeRun = runs.find((run) => run.status === "RUNNING") ?? null;
  const orchestrator = runs.find(
    (run) =>
      run.agentName === "Coding Orchestrator" &&
      run.status === "COMPLETED" &&
      Boolean(run.logs),
  ) ?? null;
  const payload = orchestrator ? parseJson(orchestrator.logs) : {};
  const orchestration = isRecord(payload.orchestration) ? payload.orchestration : {};
  const nextAction =
    typeof orchestration.nextAction === "string" ? orchestration.nextAction : null;

  const [activeAiJob] = ["AI_HANDOFF_APPROVED", "AI_EXECUTION_RUNNING"].includes(nextAction ?? "")
    ? await withTransientDatabaseRetry(
        () => db.select({ id: aiJobsTable.id })
          .from(aiJobsTable)
          .where(and(
            eq(aiJobsTable.jobType, "coding_ai_execution"),
            inArray(aiJobsTable.status, ["queued", "waiting", "running", "retrying"]),
            sql`${aiJobsTable.payloadJson}->>'taskId' = ${taskId}`,
          ))
          .limit(1),
        { attempts: 3, baseDelayMs: 250 },
      )
    : [];

  return { task, runs, activeRun, activeAiJob, orchestrator, payload, nextAction };
}

function contextHeadSha(payload: Record<string, unknown>): string | null {
  const context = isRecord(payload.contextPackage) ? payload.contextPackage : null;
  const head = typeof context?.headSha === "string" ? context.headSha.toLowerCase() : "";
  return /^[0-9a-f]{40}$/.test(head) ? head : null;
}

function workstreamAiRequired(result: Record<string, unknown> | null): boolean {
  if (!result) return false;
  const plan = isRecord(result.localExecutionPlan) ? result.localExecutionPlan : null;
  return plan?.status === "AI_REQUIRED";
}

function retryableRepositoryAnalyzerFailure(
  state: Awaited<ReturnType<typeof loadTaskState>>,
): string | null {
  if (state.task.status !== "FAILED") return null;
  const latestOrchestrator = state.runs.find(
    (run) => run.agentName === "Coding Orchestrator" && run.status === "FAILED",
  );
  const error = normalizeRunError(latestOrchestrator?.errorMessage);
  if (!error) return null;
  return isRetryableRepositoryCloneResourceError(error) ? error : null;
}

async function restartRepositoryAnalysisAfterTransientFailure(
  taskId: string,
): Promise<void> {
  const { task, run } = await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId))
      .for("update");
    if (!task) throw new Error("CODING_TASK_NOT_FOUND");

    const [activeRun] = await tx
      .select({ id: aiCodingRunsTable.id })
      .from(aiCodingRunsTable)
      .where(
        and(
          eq(aiCodingRunsTable.taskId, taskId),
          eq(aiCodingRunsTable.status, "RUNNING"),
        ),
      )
      .limit(1);
    if (activeRun) {
      throw new Error("Coding task already has an active run");
    }

    const [run] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId,
        agentName: "Coding Orchestrator",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();
    if (!run) throw new Error("Failed to create Coding Orchestrator retry run");

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "ANALYZING",
        resultSummary: "Retrying Repository Analyzer after transient host resource pressure.",
      })
      .where(eq(aiCodingTasksTable.id, taskId));

    return { task, run };
  });

  const { startCodingOrchestration } = await import("./codingOrchestratorService.js");
  await startCodingOrchestration({ task, run });
}

export function hasLiveCodingWorkstreamClaim(
  workstreams: Array<{ status: string; leaseExpiresAt: Date | string | null }>,
  now = new Date(),
): boolean {
  const nowMs = now.getTime();
  return workstreams.some((item) => {
    if (!["CLAIMED", "RUNNING"].includes(item.status)) return false;
    if (!item.leaseExpiresAt) return true;
    const expiresAt = new Date(item.leaseExpiresAt).getTime();
    return !Number.isFinite(expiresAt) || expiresAt > nowMs;
  });
}

const REPEATED_AI_PROPOSAL_FAILURE_LIMIT = 3;
const DETERMINISTIC_AI_PROPOSAL_FAILURE =
  /^AI proposal failed Proposal Contract V1 validation after bounded schema repair:/i;

function normalizeRunError(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function repeatedDeterministicAiProposalFailure(
  runs: Array<{
    agentName?: string | null;
    status?: string | null;
    errorMessage?: string | null;
  }>,
): { count: number; error: string } | null {
  const aiExecutionRuns = runs.filter(
    (run) => run.agentName === "AI Execution Gate",
  );
  const latest = aiExecutionRuns[0];
  const latestError = normalizeRunError(latest?.errorMessage);

  if (
    latest?.status !== "FAILED" ||
    !DETERMINISTIC_AI_PROPOSAL_FAILURE.test(latestError)
  ) {
    return null;
  }

  let count = 0;
  for (const run of aiExecutionRuns) {
    const error = normalizeRunError(run.errorMessage);
    if (
      run.status !== "FAILED" ||
      error !== latestError ||
      !DETERMINISTIC_AI_PROPOSAL_FAILURE.test(error)
    ) {
      break;
    }
    count += 1;
  }

  return count >= REPEATED_AI_PROPOSAL_FAILURE_LIMIT
    ? { count, error: latestError }
    : null;
}

const REPEATED_PROVIDER_BAD_REQUEST_LIMIT = 2;
const NON_RETRYABLE_PROVIDER_BAD_REQUEST =
  /^Constrained model provider failed with PROVIDER_BAD_REQUEST\b/i;

export function repeatedNonRetryableAiProviderFailure(
  runs: Array<{
    agentName?: string | null;
    status?: string | null;
    errorMessage?: string | null;
  }>,
): { count: number; error: string } | null {
  const aiExecutionRuns = runs.filter(
    (run) => run.agentName === "AI Execution Gate",
  );
  const latest = aiExecutionRuns[0];
  const latestError = normalizeRunError(latest?.errorMessage);

  if (
    latest?.status !== "FAILED" ||
    !NON_RETRYABLE_PROVIDER_BAD_REQUEST.test(latestError)
  ) {
    return null;
  }

  let count = 0;
  for (const run of aiExecutionRuns) {
    const error = normalizeRunError(run.errorMessage);
    if (
      run.status !== "FAILED" ||
      error !== latestError ||
      !NON_RETRYABLE_PROVIDER_BAD_REQUEST.test(error)
    ) {
      break;
    }
    count += 1;
  }

  return count >= REPEATED_PROVIDER_BAD_REQUEST_LIMIT
    ? { count, error: latestError }
    : null;
}

async function processTaskGraph(
  taskId: string,
  payload: Record<string, unknown>,
  reserveCycle: () => Promise<void>,
): Promise<{ handled: boolean; action?: string; waiting?: boolean; blocker?: string }> {
  const snapshot = await getLatestCodingTaskGraph(taskId);
  if (!snapshot) return { handled: false };

  if (snapshot.graph.status === "PREPARED") {
    await reserveCycle();
    await approveCodingTaskGraph(taskId, snapshot.graph.id);
    return { handled: true, action: "AUTO_APPROVE_TASK_GRAPH" };
  }

  const failed = snapshot.workstreams.find((item) => item.status === "FAILED");
  if (failed) {
    const failure = failed.errorMessage ?? "";
    const missingSyntheticRemoteBranch =
      /Repository clone failed:/i.test(failure) &&
      /Remote branch ai-core\/[^\\s]+ not found in upstream origin/i.test(failure);

    if (missingSyntheticRemoteBranch && failed.attemptCount < 4) {
      await reserveCycle();
      await retryFailedCodingWorkstream(failed.id);
      return {
        handled: true,
        action: `AUTO_RECOVER_MISSING_SYNTHETIC_BRANCH:${failed.key}`,
      };
    }

    return {
      handled: true,
      blocker:
        `Workstream ${failed.key} gagal: ${failed.errorMessage ?? "unknown error"}`,
    };
  }

  const review = snapshot.workstreams.find((item) => item.status === "REVIEW_REQUIRED");
  if (review) {
    const result = review.resultJson;
    const execution =
      result && isRecord(result.workstreamAiExecution)
        ? result.workstreamAiExecution
        : null;

    if (workstreamAiRequired(result)) {
      if (
        execution?.status === "CANDIDATE_READY" &&
        execution.reviewStatus === "PENDING"
      ) {
        const changedFiles = Array.isArray(execution.changedFiles)
          ? execution.changedFiles.filter(
              (item): item is string => typeof item === "string",
            )
          : [];
        const warnings = Array.isArray(execution.warnings)
          ? execution.warnings.filter(
              (item): item is string => typeof item === "string",
            )
          : [];
        const manualReviewReason = manualAiPatchReviewReason(
          changedFiles,
          warnings,
        );

        if (manualReviewReason) {
          return {
            handled: true,
            blocker:
              `Workstream ${review.key} membutuhkan review manual: ${manualReviewReason}`,
          };
        }

        await reserveCycle();
        await approveWorkstreamAiCandidatePatch(review.id);
        await materializeApprovedWorkstreamAiCandidate(review.id);
        await completeReviewedCodingWorkstream(review.id, {
          completeChildTask: true,
          childTaskResultSummary:
            "Safe constrained AI candidate was recovered and completed automatically by the autonomous repair loop.",
        });
        return {
          handled: true,
          action: `AUTO_APPROVE_MATERIALIZE_WORKSTREAM:${review.key}`,
        };
      }

      if (
        execution?.status === "CANDIDATE_READY" &&
        execution.reviewStatus === "APPROVED"
      ) {
        await reserveCycle();
        await materializeApprovedWorkstreamAiCandidate(review.id);
        await completeReviewedCodingWorkstream(review.id, {
          completeChildTask: true,
          childTaskResultSummary:
            "Approved constrained AI candidate was materialized and completed by the autonomous repair loop.",
        });
        return {
          handled: true,
          action: `AUTO_MATERIALIZE_WORKSTREAM:${review.key}`,
        };
      }

      await reserveCycle();
      const prepared = await prepareWorkstreamAiExecutionHandoff(review.id);
      const approved = await approveWorkstreamAiExecutionHandoff(
        review.id,
        prepared.handoffId,
      );
      await enqueueWorkstreamAiExecution(review.id, {
        expectedPackageHash: approved.packageHash,
        requestedBy: "autonomous-repair-loop",
      });

      return {
        handled: true,
        action: `AUTO_APPROVE_RUN_WORKSTREAM_AI:${review.key}`,
        waiting: true,
      };
    }

    await reserveCycle();
    await completeReviewedCodingWorkstream(review.id);
    return {
      handled: true,
      action: `AUTO_COMPLETE_DETERMINISTIC_WORKSTREAM:${review.key}`,
    };
  }

  if (snapshot.graph.status === "COMPLETED") {
    const existingFinalizer = isRecord(payload.integrationFinalizer)
      ? payload.integrationFinalizer
      : null;
    if (
      existingFinalizer &&
      typeof existingFinalizer.pullRequestNumber === "number" &&
      existingFinalizer.nextAction === "REVIEW_PR"
    ) {
      return { handled: false };
    }

    await reserveCycle();
    const finalized = await finalizeCodingTaskGraphIntegration(taskId);
    return {
      handled: true,
      action: `AUTO_PUBLISH_INTEGRATION_PR:#${finalized.pullRequestNumber}`,
      waiting: true,
    };
  }

  if (["APPROVED", "RUNNING"].includes(snapshot.graph.status)) {
    if (hasLiveCodingWorkstreamClaim(snapshot.workstreams)) {
      return {
        handled: true,
        action: "WAIT_WORKSTREAM_EXECUTION",
        waiting: true,
      };
    }

    const completedKeys = new Set(snapshot.workstreams
      .filter((item) => item.status === "COMPLETED")
      .map((item) => item.key));
    if (!snapshot.workstreams.some((item) =>
      ["PENDING", "READY", "CLAIMED", "RUNNING"].includes(item.status) &&
      item.dependencies.every((dependency) => completedKeys.has(dependency))
    )) {
      return { handled: true, action: "WAIT_TASK_GRAPH", waiting: true };
    }

    const baseSha =
      contextHeadSha(payload) ??
      snapshot.workstreams
        .map((item) => item.baseSha)
        .find((value): value is string => Boolean(value && /^[0-9a-f]{40}$/i.test(value))) ??
      null;

    if (!baseSha) {
      return {
        handled: true,
        blocker: "Task graph tidak memiliki base SHA yang valid untuk dispatch.",
      };
    }

    await reserveCycle();
    const dispatch = await dispatchReadyCodingWorkstreams(snapshot.graph.id, {
      baseSha,
      maxParallel: 8,
      workerPoolId: "autonomous-repair-loop",
    });

    if (dispatch.dispatched.length > 0) {
      return {
        handled: true,
        action: `AUTO_DISPATCH_WORKSTREAMS:${dispatch.dispatched.length}`,
        waiting: true,
      };
    }

    return {
      handled: true,
      action: "WAIT_TASK_GRAPH",
      waiting: true,
    };
  }

  return { handled: false };
}

export async function runAutonomousCodingCycle(taskId: string): Promise<{
  taskId: string;
  status: AutonomousStatus;
  action: string;
}> {
  await ensureCodingControlBridgeTables();

  const rowResult = await db.execute(sql`
    SELECT task_id, enabled, status, cycle_count, max_cycles, last_action, last_error
    FROM ai_platform.ai_coding_autonomous_tasks
    WHERE task_id = ${taskId}::uuid
    LIMIT 1
  `);
  const row = rowResult.rows?.[0] as AutonomousRow | undefined;
  if (!row || !row.enabled || row.status === "DISABLED") {
    return { taskId, status: "DISABLED", action: "NOOP" };
  }
  if (["COMPLETED", "BLOCKED", "FAILED", "APPROVAL_REQUIRED"].includes(row.status)) {
    return { taskId, status: row.status, action: row.last_action ?? "NOOP" };
  }

  try {
    const state = await loadTaskState(taskId);

    if (state.task.status === "COMPLETED" || state.nextAction === "DONE") {
      if (state.task.status !== "COMPLETED") {
        await db
          .update(aiCodingTasksTable)
          .set({
            status: "COMPLETED",
            resultSummary: state.task.resultSummary || "Coding task selesai dan seluruh verification gate telah lulus.",
          })
          .where(eq(aiCodingTasksTable.id, taskId));
      }
      await setState(taskId, "COMPLETED", "COMPLETE");
      await report(
        taskId,
        "COMPLETED",
        state.task.resultSummary || "Coding task selesai.",
        { status: "COMPLETED" },
      );
      return { taskId, status: "COMPLETED", action: "COMPLETE" };
    }

    if (state.activeRun) {
      await setState(taskId, "WAITING", `WAIT_ACTIVE_RUN:${state.activeRun.agentName}`);
      return {
        taskId,
        status: "WAITING",
        action: `WAIT_ACTIVE_RUN:${state.activeRun.agentName}`,
      };
    }

    if (state.activeAiJob) {
      const action = `WAIT_AI_EXECUTION_JOB:${state.activeAiJob.id}`;
      await setState(taskId, "WAITING", action);
      return { taskId, status: "WAITING", action };
    }

    const repositoryAnalyzerFailure = retryableRepositoryAnalyzerFailure(state);
    if (repositoryAnalyzerFailure) {
      await reserveActionCycle(taskId);
      await restartRepositoryAnalysisAfterTransientFailure(taskId);
      await setState(taskId, "WAITING", "RETRY_REPOSITORY_ANALYZER_RESOURCE_PRESSURE", null);
      await logAudit(
        "coding-autonomous",
        "repository_analyzer_transient_failure_retried",
        taskId,
        "coding_task",
        "success",
        { error: repositoryAnalyzerFailure.slice(0, 1000) },
      ).catch(() => undefined);
      return {
        taskId,
        status: "WAITING",
        action: "RETRY_REPOSITORY_ANALYZER_RESOURCE_PRESSURE",
      };
    }

    const repeatedProposalFailure =
      state.task.status === "READY_REVIEW"
        ? repeatedDeterministicAiProposalFailure(state.runs)
        : null;
    if (repeatedProposalFailure) {
      const message =
        `Constrained AI proposal failed identically ${repeatedProposalFailure.count} times: ` +
        repeatedProposalFailure.error;
      await setState(taskId, "BLOCKED", "REPEATED_AI_PROPOSAL_FAILURE", message);
      await report(taskId, "BLOCKER", message, {
        source: "autonomous-repair-loop",
        repeatedFailures: repeatedProposalFailure.count,
      });
      await logAudit(
        "coding-autonomous",
        "repeated_ai_proposal_failure_blocked",
        taskId,
        "coding_task",
        "failure",
        {
          repeatedFailures: repeatedProposalFailure.count,
          error: repeatedProposalFailure.error.slice(0, 1000),
        },
      ).catch(() => undefined);
      return {
        taskId,
        status: "BLOCKED",
        action: "REPEATED_AI_PROPOSAL_FAILURE",
      };
    }

    const repeatedProviderFailure =
      state.task.status === "READY_REVIEW"
        ? repeatedNonRetryableAiProviderFailure(state.runs)
        : null;
    if (repeatedProviderFailure) {
      const message =
        `Constrained AI provider rejected the same non-retryable request ${repeatedProviderFailure.count} times: ` +
        repeatedProviderFailure.error;
      await setState(taskId, "BLOCKED", "REPEATED_PROVIDER_BAD_REQUEST", message);
      await report(taskId, "BLOCKER", message, {
        source: "autonomous-repair-loop",
        repeatedFailures: repeatedProviderFailure.count,
      });
      await logAudit(
        "coding-autonomous",
        "repeated_provider_bad_request_blocked",
        taskId,
        "coding_task",
        "failure",
        {
          repeatedFailures: repeatedProviderFailure.count,
          error: repeatedProviderFailure.error.slice(0, 1000),
        },
      ).catch(() => undefined);
      return {
        taskId,
        status: "BLOCKED",
        action: "REPEATED_PROVIDER_BAD_REQUEST",
      };
    }

    const reserveCycle = () => reserveActionCycle(taskId);
    const graphAction = await processTaskGraph(taskId, state.payload, reserveCycle);
    if (graphAction.handled) {
      if (graphAction.blocker) {
        await setState(taskId, "BLOCKED", "TASK_GRAPH_BLOCKER", graphAction.blocker);
        await report(taskId, "BLOCKER", graphAction.blocker, {
          source: "autonomous-repair-loop",
        });
        return { taskId, status: "BLOCKED", action: "TASK_GRAPH_BLOCKER" };
      }
      const action = graphAction.action ?? "TASK_GRAPH_PROGRESS";
      await setState(taskId, graphAction.waiting ? "WAITING" : "ACTIVE", action);
      return {
        taskId,
        status: graphAction.waiting ? "WAITING" : "ACTIVE",
        action,
      };
    }

    switch (state.nextAction) {
      case "APPROVE_PLAN":
        await reserveCycle();
        await approvePlanAndStartCoding(taskId);
        await setState(taskId, "WAITING", "AUTO_APPROVE_PLAN");
        return { taskId, status: "WAITING", action: "AUTO_APPROVE_PLAN" };

      case "REVIEW_LOCAL_PATCH":
        await reserveCycle();
        await approveAndValidateLocalPatch(taskId);
        await setState(taskId, "WAITING", "AUTO_APPROVE_LOCAL_PATCH");
        return { taskId, status: "WAITING", action: "AUTO_APPROVE_LOCAL_PATCH" };

      case "RUN_SANDBOX_VERIFICATION":
        await reserveCycle();
        await startSandboxVerification(taskId);
        await setState(taskId, "WAITING", "AUTO_SANDBOX_VERIFY");
        return { taskId, status: "WAITING", action: "AUTO_SANDBOX_VERIFY" };

      case "LOCAL_RECOVERY_REQUIRED":
        await reserveCycle();
        await startDeterministicLocalRecovery(taskId);
        await setState(taskId, "WAITING", "AUTO_LOCAL_RECOVERY");
        return { taskId, status: "WAITING", action: "AUTO_LOCAL_RECOVERY" };

      case "AI_REQUIRED":
        await reserveCycle();
        await startAiHandoffPreparation(taskId);
        await setState(taskId, "WAITING", "AUTO_PREPARE_AI_HANDOFF");
        return { taskId, status: "WAITING", action: "AUTO_PREPARE_AI_HANDOFF" };

      case "APPROVE_AI_HANDOFF":
        await reserveCycle();
        await approveAiHandoff(taskId);
        await setState(taskId, "ACTIVE", "AUTO_APPROVE_AI_HANDOFF");
        return { taskId, status: "ACTIVE", action: "AUTO_APPROVE_AI_HANDOFF" };

      case "AI_HANDOFF_APPROVED": {
        await reserveCycle();
        const lease = await assertApprovedAiHandoffFresh(taskId);
        await enqueueCodingAiExecution(taskId, {
          requestedBy: "autonomous-repair-loop",
          expectedPackageHash: lease.packageHash,
        });
        await setState(taskId, "WAITING", "AUTO_RUN_CONSTRAINED_AI");
        return { taskId, status: "WAITING", action: "AUTO_RUN_CONSTRAINED_AI" };
      }

      case "REVIEW_AI_PATCH":
        await reserveCycle();
        await approveAndValidateAiPatch(taskId);
        await setState(taskId, "WAITING", "AUTO_APPROVE_AI_PATCH");
        return { taskId, status: "WAITING", action: "AUTO_APPROVE_AI_PATCH" };

      case "APPROVE_COMMIT":
        await reserveCycle();
        await approveCommitAndCreatePullRequest(taskId);
        await setState(taskId, "WAITING", "AUTO_CREATE_PR");
        return { taskId, status: "WAITING", action: "AUTO_CREATE_PR" };

      case "REVIEW_PR":
        await reserveCycle();
        await startPullRequestVerification(taskId);
        await setState(taskId, "WAITING", "AUTO_VERIFY_PR");
        return { taskId, status: "WAITING", action: "AUTO_VERIFY_PR" };

      case "APPROVE_MERGE":
        await reserveCycle();
        await autoMergeVerifiedPullRequest(taskId);
        await setState(taskId, "WAITING", "AUTO_MERGE_VERIFIED_PR");
        return {
          taskId,
          status: "WAITING",
          action: "AUTO_MERGE_VERIFIED_PR",
        };

      default: {
        const message =
          `Autonomous loop tidak memiliki action aman untuk nextAction=${state.nextAction ?? "null"}.`;
        await setState(taskId, "BLOCKED", "UNSUPPORTED_NEXT_ACTION", message);
        await report(taskId, "BLOCKER", message, {
          nextAction: state.nextAction,
          taskStatus: state.task.status,
        });
        return { taskId, status: "BLOCKED", action: "UNSUPPORTED_NEXT_ACTION" };
      }
    }
  } catch (error) {
    if (error instanceof AutonomousCycleStopped) {
      return { taskId, status: error.status, action: error.action };
    }
    const message = error instanceof Error ? error.message : String(error);
    const state = await loadTaskState(taskId).catch(() => null);

    if (
      /Coding task already has an active run/i.test(message) &&
      state
    ) {
      const stillActive = state.activeRun;
      const action = stillActive
        ? `WAIT_ACTIVE_RUN:${stillActive.agentName}`
        : "RETRY_AFTER_ACTIVE_RUN_RACE";
      const status: AutonomousStatus = stillActive ? "WAITING" : "ACTIVE";
      await setState(taskId, status, action, null);
      await logAudit(
        "coding-autonomous",
        "active_run_race_deferred",
        taskId,
        "coding_task",
        "success",
        {
          activeRunId: stillActive?.id ?? null,
          agentName: stillActive?.agentName ?? null,
          raceAlreadyCleared: !stillActive,
          nextAction: state.nextAction,
        },
      ).catch(() => undefined);
      return { taskId, status, action };
    }

    const workstreamAiClaimRace =
      /Only a REVIEW_REQUIRED workstream can enter the constrained AI phase|Workstream AI-phase claim lost a concurrent update/i.test(
        message,
      );

    if (workstreamAiClaimRace) {
      const graph = await getLatestCodingTaskGraph(taskId).catch(() => null);
      if (graph) {
        const liveClaim = hasLiveCodingWorkstreamClaim(graph.workstreams);
        const action = liveClaim
          ? "WAIT_WORKSTREAM_EXECUTION"
          : "CONTINUE_WORKSTREAM_AI_RACE";
        const status: AutonomousStatus = liveClaim ? "WAITING" : "ACTIVE";

        await setState(taskId, status, action, null).catch(() => undefined);
        await logAudit(
          "coding-autonomous",
          "workstream_ai_claim_race_deferred",
          taskId,
          "coding_task",
          "success",
          {
            action,
            graphId: graph.graph.id,
            graphStatus: graph.graph.status,
            workstreamStatuses: graph.workstreams.map((item) => ({
              key: item.key,
              status: item.status,
            })),
          },
        ).catch(() => undefined);

        return { taskId, status, action };
      }
    }

    const candidateApprovalAdvanced =
      /AI candidate patch is not eligible for explicit approval/i.test(message);

    if (candidateApprovalAdvanced) {
      const graph = await getLatestCodingTaskGraph(taskId).catch(() => null);
      const review = graph?.workstreams.find((item) => item.status === "REVIEW_REQUIRED");
      const execution =
        review?.resultJson && isRecord(review.resultJson.workstreamAiExecution)
          ? review.resultJson.workstreamAiExecution
          : null;
      const alreadyAdvanced =
        execution?.status === "CANDIDATE_READY" &&
        (execution.reviewStatus === "APPROVED" ||
          execution.nextAction === "REVIEW_WORKSTREAM" ||
          execution.commitCreated === true ||
          execution.pushed === true);

      if (alreadyAdvanced) {
        const action = "CONTINUE_AFTER_AI_PATCH_APPROVAL_RACE";
        await setState(taskId, "ACTIVE", action, null);
        await logAudit(
          "coding-autonomous",
          "ai_patch_approval_race_advanced",
          taskId,
          "coding_task",
          "success",
          {
            workstreamId: review?.id ?? null,
            reviewStatus: execution?.reviewStatus ?? null,
            nextAction: execution?.nextAction ?? null,
            commitCreated: execution?.commitCreated ?? null,
            pushed: execution?.pushed ?? null,
          },
        ).catch(() => undefined);
        return { taskId, status: "ACTIVE", action };
      }
    }

    const handoffApprovalAdvanced =
      /Coding task is not at the APPROVE_AI_HANDOFF gate/i.test(message) &&
      state?.task.status === "READY_REVIEW" &&
      state.nextAction === "AI_HANDOFF_APPROVED";

    if (handoffApprovalAdvanced) {
      await setState(taskId, "ACTIVE", "CONTINUE_AI_HANDOFF_APPROVED", null);
      await logAudit(
        "coding-autonomous",
        "handoff_approval_race_advanced",
        taskId,
        "coding_task",
        "success",
        { nextAction: state.nextAction },
      ).catch(() => undefined);
      return {
        taskId,
        status: "ACTIVE",
        action: "CONTINUE_AI_HANDOFF_APPROVED",
      };
    }

    const handoffExecutionGateRegressed =
      /Coding task is not at the AI_HANDOFF_APPROVED gate/i.test(message) &&
      state?.task.status === "READY_REVIEW" &&
      ["AI_REQUIRED", "APPROVE_AI_HANDOFF"].includes(state.nextAction ?? "");

    if (handoffExecutionGateRegressed) {
      const action = "RECOVER_AI_HANDOFF_GATE_REGRESSION";
      await setState(taskId, "ACTIVE", action, null);
      await logAudit(
        "coding-autonomous",
        "handoff_execution_gate_regression_deferred",
        taskId,
        "coding_task",
        "success",
        { nextAction: state.nextAction },
      ).catch(() => undefined);
      return { taskId, status: "ACTIVE", action };
    }

    const transientDatabaseFailure =
      /timeout exceeded when trying to connect|Failed query:/i.test(message) &&
      !/CODING_TASK_NOT_FOUND/i.test(message);

    if (transientDatabaseFailure) {
      await setState(
        taskId,
        "WAITING",
        "RETRY_TRANSIENT_DATABASE",
        message.slice(0, 2000),
      ).catch(() => undefined);
      await logAudit(
        "coding-autonomous",
        "transient_database_retry_scheduled",
        taskId,
        "coding_task",
        "success",
        { error: message.slice(0, 1000) },
      ).catch(() => undefined);
      return {
        taskId,
        status: "WAITING",
        action: "RETRY_TRANSIENT_DATABASE",
      };
    }

    const freshHandoffRequired =
      state?.task.status === "READY_REVIEW" &&
      state.nextAction === "AI_REQUIRED" &&
      /one-shot model privilege was consumed|fresh AI handoff is required|Proposal Contract V1 validation/i.test(message);

    if (freshHandoffRequired) {
      await setState(
        taskId,
        "ACTIVE",
        "RECOVER_FRESH_AI_HANDOFF",
        message.slice(0, 2000),
      );
      await report(
        taskId,
        "CHECKPOINT",
        "Constrained AI proposal gagal setelah privilege dikonsumsi. AI Core akan membuat fresh AI handoff pada siklus berikutnya.",
        { source: "autonomous-repair-loop", nextAction: "AI_REQUIRED" },
      );
      await logAudit(
        "coding-autonomous",
        "fresh_ai_handoff_recovery_scheduled",
        taskId,
        "coding_task",
        "success",
        { error: message.slice(0, 1000) },
      ).catch(() => undefined);
      return { taskId, status: "ACTIVE", action: "RECOVER_FRESH_AI_HANDOFF" };
    }

    await setState(taskId, "FAILED", "AUTONOMOUS_CYCLE_FAILED", message.slice(0, 2000));
    await report(
      taskId,
      "FAILED",
      `Autonomous repair berhenti karena error: ${message.slice(0, 1200)}`,
      { source: "autonomous-repair-loop" },
    );
    await logAudit(
      "coding-autonomous",
      "autonomous_cycle_failed",
      taskId,
      "coding_task",
      "failure",
      { error: message.slice(0, 1000) },
    ).catch(() => undefined);
    throw error;
  }
}

export async function enableAutonomousCodingTask(
  taskId: string,
  maxCycles = DEFAULT_MAX_CYCLES,
  options: { forceDisabled?: boolean } = {},
): Promise<void> {
  await ensureCodingControlBridgeTables();
  const bounded = Math.max(5, Math.min(100, Math.floor(maxCycles)));
  const forceDisabled = options.forceDisabled === true;

  const query = forceDisabled
    ? sql`
        INSERT INTO ai_platform.ai_coding_autonomous_tasks (
          task_id, enabled, status, max_cycles, updated_at
        )
        VALUES (${taskId}::uuid, TRUE, 'ACTIVE', ${bounded}, NOW())
        ON CONFLICT (task_id) DO UPDATE
        SET enabled = TRUE,
            status = CASE
              WHEN ai_platform.ai_coding_autonomous_tasks.status = 'COMPLETED'
                THEN 'COMPLETED'
              ELSE 'ACTIVE'
            END,
            max_cycles = LEAST(
              ai_platform.ai_coding_autonomous_tasks.max_cycles,
              EXCLUDED.max_cycles
            ),
            last_error = NULL,
            updated_at = NOW()
      `
    : sql`
        INSERT INTO ai_platform.ai_coding_autonomous_tasks (
          task_id, enabled, status, max_cycles, updated_at
        )
        VALUES (${taskId}::uuid, TRUE, 'ACTIVE', ${bounded}, NOW())
        ON CONFLICT (task_id) DO UPDATE
        SET enabled = TRUE,
            status = CASE
              WHEN ai_platform.ai_coding_autonomous_tasks.status = 'COMPLETED'
                THEN 'COMPLETED'
              ELSE 'ACTIVE'
            END,
            max_cycles = LEAST(
              ai_platform.ai_coding_autonomous_tasks.max_cycles,
              EXCLUDED.max_cycles
            ),
            last_error = NULL,
            updated_at = NOW()
        WHERE ai_platform.ai_coding_autonomous_tasks.status <> 'DISABLED'
      `;

  await withTransientDatabaseRetry(
    () => db.execute(query),
    { attempts: 3, baseDelayMs: 250 },
  );
}

export async function disableAutonomousCodingTask(taskId: string): Promise<void> {
  await ensureCodingControlBridgeTables();
  await db.execute(sql`
    INSERT INTO ai_platform.ai_coding_autonomous_tasks (
      task_id, enabled, status, max_cycles, updated_at
    )
    VALUES (${taskId}::uuid, FALSE, 'DISABLED', ${DEFAULT_MAX_CYCLES}, NOW())
    ON CONFLICT (task_id) DO UPDATE
    SET enabled = FALSE,
        status = 'DISABLED',
        updated_at = NOW()
  `);
}

export async function getAutonomousCodingTaskStatus(taskId: string) {
  await ensureCodingControlBridgeTables();
  const result = await db.execute(sql`
    SELECT *
    FROM ai_platform.ai_coding_autonomous_tasks
    WHERE task_id = ${taskId}::uuid
    LIMIT 1
  `);
  return result.rows?.[0] ?? null;
}

export async function listActiveAutonomousCodingTasks(limit = MAX_TASKS_PER_TICK) {
  await ensureCodingControlBridgeTables();
  const bounded = Math.max(1, Math.min(50, Math.floor(limit)));
  const result = await withTransientDatabaseRetry(() => db.execute(sql`
    SELECT task_id, enabled, status, cycle_count, max_cycles, last_action, last_error, updated_at
    FROM ai_platform.ai_coding_autonomous_tasks
    WHERE enabled = TRUE
      AND status IN ('ACTIVE','WAITING')
    ORDER BY updated_at ASC
    LIMIT ${bounded}
  `), { attempts: 3, baseDelayMs: 250 });
  return result.rows ?? [];
}

async function temporalOrchestratorActive(): Promise<boolean> {
  const availability = await getCodingBridgeAvailability(
    TEMPORAL_CODING_ORCHESTRATOR_CLIENT_ID,
  ).catch(() => null);
  return availability?.state === "ACTIVE";
}


export async function recoverOrphanedReadyReviewTasks(): Promise<void> {
  const candidates = await db
    .select({ id: aiCodingTasksTable.id })
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.status, "READY_REVIEW"))
    .orderBy(desc(aiCodingTasksTable.updatedAt))
    .limit(20);

  const recoverable = new Set([
    "AI_REQUIRED",
    "APPROVE_TASK_GRAPH",
    "APPROVE_AI_HANDOFF",
    "AI_HANDOFF_APPROVED",
    "REVIEW_AI_PATCH",
  ]);

  for (const candidate of candidates) {
    const state = await loadTaskState(candidate.id).catch(() => null);
    if (!state || !state.nextAction || !recoverable.has(state.nextAction)) continue;

    const existing = await db.execute(sql`
      SELECT task_id, enabled, status, cycle_count, max_cycles
      FROM ai_platform.ai_coding_autonomous_tasks
      WHERE task_id = ${candidate.id}::uuid
      LIMIT 1
    `);
    const row = existing.rows?.[0] as
      | { status?: string; cycle_count?: number; max_cycles?: number }
      | undefined;

    if (row) {
      const cycleCount = Number(row.cycle_count ?? 0);
      const maxCycles = Number(row.max_cycles ?? DEFAULT_MAX_CYCLES);
      if (
        ["FAILED", "BLOCKED"].includes(String(row.status ?? "")) &&
        cycleCount < maxCycles
      ) {
        const reactivated = await db.execute(sql`
          UPDATE ai_platform.ai_coding_autonomous_tasks
          SET enabled = TRUE,
              status = 'ACTIVE',
              last_error = NULL,
              last_action = 'RECOVER_READY_REVIEW',
              updated_at = NOW()
          WHERE task_id = ${candidate.id}::uuid
            AND status IN ('FAILED', 'BLOCKED')
            AND cycle_count < max_cycles
          RETURNING task_id
        `);
        // A concurrent stop or exhausted budget overrides the earlier read.
        if (!reactivated.rows?.length) continue;

        logger.info(
          { taskId: candidate.id, nextAction: state.nextAction, previousStatus: row.status },
          "[coding-autonomous] reactivated recoverable READY_REVIEW task",
        );
      }
      continue;
    }

    await db.execute(sql`
      INSERT INTO ai_platform.ai_coding_autonomous_tasks (
        task_id, enabled, status, max_cycles, updated_at
      )
      VALUES (${candidate.id}::uuid, TRUE, 'ACTIVE', ${DEFAULT_MAX_CYCLES}, NOW())
      ON CONFLICT (task_id) DO NOTHING
    `);

    logger.info(
      { taskId: candidate.id, nextAction: state.nextAction },
      "[coding-autonomous] recovered orphaned READY_REVIEW task",
    );
  }
}

async function autonomousTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const recovery = await reconcileStaleCodingRuns().catch((error) => {
      logger.warn({ err: error }, "[coding-autonomous] stale coding-run reconciliation failed");
      return null;
    });
    if (recovery && (recovery.recoveredRuns > 0 || recovery.recoveredTasks > 0)) {
      logger.warn({ recovery }, "[coding-autonomous] recovered stale coding-run lifecycle");
    }

    const nowMs = Date.now();
    if (nowMs - lastTestTaskRetentionSweepAt >= TEST_TASK_RETENTION_SWEEP_INTERVAL_MS) {
      lastTestTaskRetentionSweepAt = nowMs;
      const retention = await purgeExpiredCodingTestTasks().catch((error) => {
        logger.warn({ err: error }, "[coding-autonomous] coding test-task retention sweep failed");
        return null;
      });
      if (retention && retention.purgedTasks > 0) {
        logger.info({ retention }, "[coding-autonomous] purged expired coding smoke/canary tasks");
      }
    }

    if (await temporalOrchestratorActive()) {
      logger.debug("[coding-autonomous] Temporal orchestrator lease active; local tick skipped");
      return;
    }

    const rows = await withTransientDatabaseRetry(() => db.execute(sql`
      SELECT task_id
      FROM ai_platform.ai_coding_autonomous_tasks
      WHERE enabled = TRUE
        AND status IN ('ACTIVE','WAITING')
      ORDER BY updated_at ASC
      LIMIT ${MAX_TASKS_PER_TICK}
    `), { attempts: 3, baseDelayMs: 250 });

    for (const item of rows.rows ?? []) {
      const taskId = String((item as Record<string, unknown>)["task_id"] ?? "");
      if (!taskId) continue;
      await runAutonomousCodingCycle(taskId).catch((error) => {
        logger.warn({ err: error, taskId }, "[coding-autonomous] cycle failed");
      });
    }
  } finally {
    tickRunning = false;
  }
}


export function getAutonomousRuntimeStatus() {
  return {
    configured: envTrue(process.env["AI_CODING_AUTONOMOUS_ENABLED"]),
    running: Boolean(timer),
    pollIntervalMs: pollInterval(),
    tickRunning,
    maxTasksPerTick: MAX_TASKS_PER_TICK,
    defaultMaxCycles: DEFAULT_MAX_CYCLES,
  };
}

export async function startAutonomousCodingRuntime(): Promise<void> {
  if (timer) return;
  if (!envTrue(process.env["AI_CODING_AUTONOMOUS_ENABLED"])) {
    logger.info("[coding-autonomous] Runtime disabled");
    return;
  }

  const interval = pollInterval();

  // Register the timer before startup DB work. Hostinger rolling deploys can
  // temporarily exhaust the Supabase session pool; a transient schema/init
  // failure must not leave the autonomous runtime permanently disabled until
  // the next deployment.
  timer = setInterval(() => void autonomousTick(), interval);
  timer.unref();

  try {
    await withTransientDatabaseRetry(
      () => ensureCodingControlBridgeTables(),
      { attempts: 5, baseDelayMs: 500 },
    );
  } catch (error) {
    logger.warn(
      { err: error },
      "[coding-autonomous] Startup schema ensure failed; periodic tick will retry",
    );
  }

  await recoverOrphanedReadyReviewTasks().catch((error) => {
    logger.warn({ err: error }, "[coding-autonomous] orphan recovery failed");
  });

  logger.info({ interval }, "[coding-autonomous] Runtime started");
  void autonomousTick();
}

export function stopAutonomousCodingRuntime(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
