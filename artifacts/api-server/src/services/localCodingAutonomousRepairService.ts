import { desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  aiCodingBridgeCommandsTable,
  aiCodingRunsTable,
  aiCodingTasksTable,
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
  manualAiPatchReviewReason,
  enqueueWorkstreamAiExecution,
  materializeApprovedWorkstreamAiCandidate,
  prepareWorkstreamAiExecutionHandoff,
} from "./localCodingWorkstreamAiExecutionService.js";
import { completeReviewedCodingWorkstream } from "./localCodingMultiWorkerOrchestratorService.js";
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
import { startPullRequestVerification } from "./localCodingPullRequestGateService.js";
import { requestCodingCriticalApproval } from "./codingCriticalApprovalService.js";
import { ensureCodingControlBridgeTables } from "./codingControlBridgeSchemaService.js";
import { finalizeCodingTaskGraphIntegration } from "./localCodingMultiWorkerIntegrationFinalizerService.js";
import { purgeExpiredCodingTestTasks, reconcileStaleCodingRuns } from "./localCodingRunRecoveryService.js";

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
        cycle_count = cycle_count + 1,
        completed_at = CASE WHEN ${status} = 'COMPLETED' THEN NOW() ELSE completed_at END,
        updated_at = NOW()
    WHERE task_id = ${taskId}::uuid
  `);
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
  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId));
  if (!task) throw new Error("CODING_TASK_NOT_FOUND");

  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));

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

  return { task, runs, activeRun, orchestrator, payload, nextAction };
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

async function processTaskGraph(
  taskId: string,
  payload: Record<string, unknown>,
): Promise<{ handled: boolean; action?: string; waiting?: boolean; blocker?: string }> {
  const snapshot = await getLatestCodingTaskGraph(taskId);
  if (!snapshot) return { handled: false };

  if (snapshot.graph.status === "PREPARED") {
    await approveCodingTaskGraph(taskId, snapshot.graph.id);
    return { handled: true, action: "AUTO_APPROVE_TASK_GRAPH" };
  }

  const failed = snapshot.workstreams.find((item) => item.status === "FAILED");
  if (failed) {
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

      const prepared = await prepareWorkstreamAiExecutionHandoff(review.id);
      const lease = await approveWorkstreamAiExecutionHandoff(
        review.id,
        prepared.handoffId,
      );
      await enqueueWorkstreamAiExecution(review.id, {
        expectedPackageHash: lease.packageHash,
        requestedBy: "autonomous-repair-loop",
      });
      return {
        handled: true,
        action: `AUTO_RUN_WORKSTREAM_AI:${review.key}`,
        waiting: true,
      };
    }

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

async function requestMergeApproval(
  taskId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const commit = isRecord(payload.localCommitApproval)
    ? payload.localCommitApproval
    : {};
  const verification = isRecord(payload.prVerification)
    ? payload.prVerification
    : {};

  const pullRequestNumber =
    typeof commit.pullRequestNumber === "number"
      ? commit.pullRequestNumber
      : typeof verification.pullRequestNumber === "number"
        ? verification.pullRequestNumber
        : null;
  const pullRequestUrl =
    typeof commit.pullRequestUrl === "string"
      ? commit.pullRequestUrl
      : typeof verification.pullRequestUrl === "string"
        ? verification.pullRequestUrl
        : null;

  await requestCodingCriticalApproval({
    taskId,
    actionType: "MERGE_PR",
    summary: pullRequestNumber
      ? `PR #${pullRequestNumber} sudah lolos verification dan menunggu persetujuan merge.`
      : "Pull request sudah lolos verification dan menunggu persetujuan merge.",
    metadata: {
      pullRequestNumber,
      pullRequestUrl,
      headSha:
        typeof verification.headSha === "string" ? verification.headSha : null,
      baseSha:
        typeof verification.baseSha === "string" ? verification.baseSha : null,
    },
  });
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
  if (["COMPLETED", "BLOCKED", "FAILED"].includes(row.status)) {
    return { taskId, status: row.status, action: row.last_action ?? "NOOP" };
  }
  if (row.cycle_count >= row.max_cycles) {
    await setState(taskId, "BLOCKED", "MAX_CYCLES_REACHED", "Autonomous repair cycle limit reached.");
    await report(
      taskId,
      "BLOCKER",
      "AI Core menghentikan autonomous repair karena batas siklus tercapai.",
      { cycleCount: row.cycle_count, maxCycles: row.max_cycles },
    );
    return { taskId, status: "BLOCKED", action: "MAX_CYCLES_REACHED" };
  }

  try {
    const state = await loadTaskState(taskId);

    if (state.task.status === "COMPLETED" || state.nextAction === "DONE") {
      await setState(taskId, "COMPLETED", "COMPLETE");
      await report(
        taskId,
        "COMPLETED",
        state.task.resultSummary || "Coding task selesai.",
        { status: state.task.status },
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

    const graphAction = await processTaskGraph(taskId, state.payload);
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
        await approvePlanAndStartCoding(taskId);
        await setState(taskId, "WAITING", "AUTO_APPROVE_PLAN");
        return { taskId, status: "WAITING", action: "AUTO_APPROVE_PLAN" };

      case "REVIEW_LOCAL_PATCH":
        await approveAndValidateLocalPatch(taskId);
        await setState(taskId, "WAITING", "AUTO_APPROVE_LOCAL_PATCH");
        return { taskId, status: "WAITING", action: "AUTO_APPROVE_LOCAL_PATCH" };

      case "RUN_SANDBOX_VERIFICATION":
        await startSandboxVerification(taskId);
        await setState(taskId, "WAITING", "AUTO_SANDBOX_VERIFY");
        return { taskId, status: "WAITING", action: "AUTO_SANDBOX_VERIFY" };

      case "LOCAL_RECOVERY_REQUIRED":
        await startDeterministicLocalRecovery(taskId);
        await setState(taskId, "WAITING", "AUTO_LOCAL_RECOVERY");
        return { taskId, status: "WAITING", action: "AUTO_LOCAL_RECOVERY" };

      case "AI_REQUIRED":
        await startAiHandoffPreparation(taskId);
        await setState(taskId, "WAITING", "AUTO_PREPARE_AI_HANDOFF");
        return { taskId, status: "WAITING", action: "AUTO_PREPARE_AI_HANDOFF" };

      case "APPROVE_AI_HANDOFF":
        await approveAiHandoff(taskId);
        await setState(taskId, "ACTIVE", "AUTO_APPROVE_AI_HANDOFF");
        return { taskId, status: "ACTIVE", action: "AUTO_APPROVE_AI_HANDOFF" };

      case "AI_HANDOFF_APPROVED": {
        const lease = await assertApprovedAiHandoffFresh(taskId);
        await enqueueCodingAiExecution(taskId, {
          requestedBy: "autonomous-repair-loop",
          expectedPackageHash: lease.packageHash,
        });
        await setState(taskId, "WAITING", "AUTO_RUN_CONSTRAINED_AI");
        return { taskId, status: "WAITING", action: "AUTO_RUN_CONSTRAINED_AI" };
      }

      case "REVIEW_AI_PATCH":
        await approveAndValidateAiPatch(taskId);
        await setState(taskId, "WAITING", "AUTO_APPROVE_AI_PATCH");
        return { taskId, status: "WAITING", action: "AUTO_APPROVE_AI_PATCH" };

      case "APPROVE_COMMIT":
        await approveCommitAndCreatePullRequest(taskId);
        await setState(taskId, "WAITING", "AUTO_CREATE_PR");
        return { taskId, status: "WAITING", action: "AUTO_CREATE_PR" };

      case "REVIEW_PR":
        await startPullRequestVerification(taskId);
        await setState(taskId, "WAITING", "AUTO_VERIFY_PR");
        return { taskId, status: "WAITING", action: "AUTO_VERIFY_PR" };

      case "APPROVE_MERGE":
        await requestMergeApproval(taskId, state.payload);
        await setState(taskId, "APPROVAL_REQUIRED", "WAIT_WA_MERGE_APPROVAL");
        await report(
          taskId,
          "CHECKPOINT",
          "PR sudah lolos CI. AI Core berhenti di critical gate dan menunggu approval merge melalui WhatsApp.",
          { nextAction: "APPROVE_MERGE" },
        );
        return {
          taskId,
          status: "APPROVAL_REQUIRED",
          action: "WAIT_WA_MERGE_APPROVAL",
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
    const message = error instanceof Error ? error.message : String(error);
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
): Promise<void> {
  await ensureCodingControlBridgeTables();
  const bounded = Math.max(5, Math.min(100, Math.floor(maxCycles)));
  await withTransientDatabaseRetry(() => db.execute(sql`
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
  `), { attempts: 3, baseDelayMs: 250 });
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


async function recoverOrphanedReadyReviewTasks(): Promise<void> {
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
        ["FAILED", "BLOCKED", "DISABLED"].includes(String(row.status ?? "")) &&
        cycleCount < maxCycles
      ) {
        await db.execute(sql`
          UPDATE ai_platform.ai_coding_autonomous_tasks
          SET enabled = TRUE,
              status = 'ACTIVE',
              last_error = NULL,
              last_action = 'RECOVER_READY_REVIEW',
              updated_at = NOW()
          WHERE task_id = ${candidate.id}::uuid
        `);

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
  await ensureCodingControlBridgeTables();
  await recoverOrphanedReadyReviewTasks().catch((error) => {
    logger.warn({ err: error }, "[coding-autonomous] orphan recovery failed");
  });
  const interval = pollInterval();
  timer = setInterval(() => void autonomousTick(), interval);
  timer.unref();
  logger.info({ interval }, "[coding-autonomous] Runtime started");
  void autonomousTick();
}

export function stopAutonomousCodingRuntime(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
