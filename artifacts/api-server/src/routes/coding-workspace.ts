import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, notLike, sql } from "drizzle-orm";
import {
  db,
  aiCodeChangesTable,
  aiCodingRunsTable,
  aiCodingTasksTable,
} from "@workspace/db";
import {
  CreateCodingTaskBody,
  CreateCodingTaskResponse,
  GetCodingTaskParams,
  GetCodingTaskResponse,
  ListCodingTasksResponse,
  StartCodingRunResponse,
  UpdateCodingTaskBody,
  UpdateCodingTaskParams,
  UpdateCodingTaskResponse,
} from "@workspace/api-zod";
import { startCodingOrchestration } from "../services/codingOrchestratorService.js";
import { ensureGcpCodingWorkerStarted } from "../services/gcpCodingWorkerLifecycleService.js";
import { logger } from "../lib/logger.js";
import { approvePlanAndStartCoding } from "../services/codingAgentService.js";
import {
  approveAndValidateLocalPatch,
  LocalPatchApprovalError,
} from "../services/localCodingPatchApprovalService.js";
import {
  approveCommitAndCreatePullRequest,
  LocalCommitApprovalError,
} from "../services/localCodingCommitApprovalService.js";
import {
  approveAndMergePullRequest,
  LocalPullRequestGateError,
  startPullRequestVerification,
} from "../services/localCodingPullRequestGateService.js";
import {
  LocalCodingSandboxGateError,
  startSandboxVerification,
} from "../services/localCodingSandboxGateService.js";
import {
  getCodingGitHubDiscoveryMode,
  listAccessibleCodingRepositories,
  listCodingRepositoryBranches,
} from "../services/localCodingGitHubDiscoveryService.js";
import { GitHubPublisherError } from "../services/localCodingGitHubPublisherService.js";
import {
  LocalDeterministicRecoveryError,
  startDeterministicLocalRecovery,
} from "../services/localCodingDeterministicRecoveryService.js";
import {
  approveAiHandoff,
  assertApprovedAiHandoffFresh,
  LocalAiHandoffError,
  revokeAiHandoff,
  startAiHandoffPreparation,
} from "../services/localCodingAiHandoffService.js";
import { enqueueCodingAiExecution } from "../services/localCodingAiQueueRuntimeService.js";
import {
  approveAndValidateAiPatch,
  LocalAiPatchApprovalError,
} from "../services/localCodingAiPatchApprovalService.js";
import { reconcileStaleMultiWorkerRuns } from "../services/localCodingMultiWorkerRecoveryService.js";
import { reconcileStaleCodingRuns } from "../services/localCodingRunRecoveryService.js";
import { withCodingWorkspaceReadRetry } from "../services/localCodingWorkspaceReadService.js";
import { codingTaskPresentationStatus } from "../services/codingTaskPresentationService.js";
import { getAutonomousCodingTaskStatus } from "../services/localCodingAutonomousRepairService.js";
import { reportCodingTaskTerminalTransition } from "../services/codingTaskTerminalReportingService.js";
import { getWorkerCapacity } from "../services/workerClusterService.js";
import { getGcpWorkspaceCostUsage } from "../services/gcpWorkspaceBillingService.js";
import { getAiProviderBillingSnapshot } from "../services/aiProviderBillingService.js";
import {
  getProviderSecretAdminStatus,
  upsertProviderSecretAdminValue,
} from "../services/providerSecretAdminService.js";
import {
  deriveCodingWorkspaceOperationalState,
  isCodingRelevantWorker,
  isHealthyCodingWorker,
} from "../services/codingWorkspaceOperationalStateService.js";

const router = Router();

const ProviderSecretAdminRequest = z.object({
  key: z.string().trim().min(1).max(128),
  value: z.string().min(1).max(16_384),
}).strict();

function createTaskNumber(): string {
  return `CWS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

router.get("/ai/coding/provider-secrets", async (_req, res): Promise<void> => {
  try {
    const status = await getProviderSecretAdminStatus();
    res.setHeader("Cache-Control", "no-store");
    res.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Secure Secret Admin unavailable.";
    logger.warn({ message }, "[coding-workspace] provider secret status failed");
    res.status(503).json({ error: message });
  }
});

router.post("/ai/coding/provider-secrets", async (req, res): Promise<void> => {
  const parsed = ProviderSecretAdminRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid Secure Secret Admin request." });
    return;
  }

  try {
    const result = await upsertProviderSecretAdminValue(parsed.data);
    logger.info(
      { key: result.key, created: result.created },
      "[coding-workspace] provider secret/config updated",
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      key: result.key,
      created: result.created,
      versionName: result.versionName,
      secretValuesExposed: false,
      restartRequired: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Secure Secret Admin update failed.";
    logger.warn(
      { key: parsed.data.key, message },
      "[coding-workspace] provider secret/config update failed",
    );
    res.status(502).json({ error: message });
  }
});

router.get("/ai/coding/github/repositories", async (req, res): Promise<void> => {
  const query = typeof req.query["q"] === "string" ? req.query["q"] : undefined;
  try {
    const repositories = await listAccessibleCodingRepositories({ query });
    res.json({
      repositories,
      connectionMode: getCodingGitHubDiscoveryMode(),
      privateRepositoriesAvailable:
        getCodingGitHubDiscoveryMode() === "authenticated",
    });
  } catch (error) {
    if (error instanceof GitHubPublisherError) {
      if (error.kind === "AUTH_REQUIRED") {
        res.status(503).json({
          error:
            "GitHub repository discovery is unavailable because AI_CODING_GITHUB_TOKEN is not configured or authorized.",
        });
        return;
      }
      res.status(error.status === 403 ? 403 : 502).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get(
  "/ai/coding/github/repositories/:owner/:repo/branches",
  async (req, res): Promise<void> => {
    const owner = typeof req.params.owner === "string" ? req.params.owner.trim() : "";
    const repo = typeof req.params.repo === "string" ? req.params.repo.trim() : "";
    const query = typeof req.query["q"] === "string" ? req.query["q"] : undefined;

    if (
      !/^[A-Za-z0-9_.-]+$/.test(owner) ||
      !/^[A-Za-z0-9_.-]+$/.test(repo)
    ) {
      res.status(400).json({ error: "Invalid GitHub repository coordinates." });
      return;
    }

    try {
      const branches = await listCodingRepositoryBranches(
        `${owner}/${repo}`,
        { query },
      );
      res.json({
        branches,
        connectionMode: getCodingGitHubDiscoveryMode(),
      });
    } catch (error) {
      if (error instanceof GitHubPublisherError) {
        if (error.kind === "AUTH_REQUIRED") {
          res.status(503).json({
            error:
              "GitHub branch discovery is unavailable because AI_CODING_GITHUB_TOKEN is not configured or authorized.",
          });
          return;
        }
        res.status(error.status === 403 ? 403 : 502).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

router.get("/ai/coding/tasks", async (_req, res): Promise<void> => {
  // Listing tasks is a read path and must stay responsive even when recovery
  // work is slow or contending on production locks. Reconciliation is
  // best-effort maintenance; run it without blocking the HTTP response.
  void Promise.all([
    reconcileStaleMultiWorkerRuns().catch((error) => {
      logger.warn(
        { err: error },
        "[coding-workspace] stale multi-worker reconciliation failed",
      );
    }),
    reconcileStaleCodingRuns().catch((error) => {
      logger.warn(
        { err: error },
        "[coding-workspace] stale coding-run reconciliation failed",
      );
    }),
  ]).catch(() => undefined);

  const tasks = await db
    .select()
    .from(aiCodingTasksTable)
    .where(notLike(aiCodingTasksTable.taskNumber, "MW-%"))
    .orderBy(desc(aiCodingTasksTable.createdAt));

  const autonomousPresentation = await db.execute(sql`
    SELECT t.id AS task_id,
           a.status AS autonomous_status,
           EXISTS (
             SELECT 1
             FROM ai_platform.ai_coding_runs AS r
             WHERE r.task_id = t.id
               AND r.status = 'RUNNING'
           ) AS has_active_run
    FROM ai_platform.ai_coding_tasks AS t
    LEFT JOIN ai_platform.ai_coding_autonomous_tasks AS a
      ON a.task_id = t.id
     AND a.enabled = TRUE
     AND a.status IN ('ACTIVE', 'WAITING', 'COMPLETED', 'FAILED', 'BLOCKED')
    WHERE t.task_number NOT LIKE 'MW-%'
  `);

  const presentationByTask = new Map(
    (autonomousPresentation.rows ?? []).map((row) => {
      const item = row as {
        task_id?: string;
        autonomous_status?: string;
        has_active_run?: boolean;
      };
      return [
        item.task_id ?? "",
        {
          autonomousStatus: item.autonomous_status ?? null,
          hasActiveRun: item.has_active_run === true,
        },
      ] as const;
    }),
  );

  const presentedTasks = tasks.map((task) => {
    const presentation = presentationByTask.get(task.id);
    const status = codingTaskPresentationStatus({
      taskStatus: task.status,
      autonomousStatus: presentation?.autonomousStatus,
      hasActiveRun: presentation?.hasActiveRun ?? false,
    });
    return status === task.status ? task : { ...task, status };
  });

  res.json(ListCodingTasksResponse.parse(presentedTasks));
});

router.get("/ai/coding/gcp-usage", async (req, res): Promise<void> => {
  const range = req.query["range"] === "monthly" ? "monthly" : "daily";
  try {
    res.json(await getGcpWorkspaceCostUsage(range));
  } catch (error) {
    logger.warn({ err: error }, "[coding-workspace] GCP billing usage query failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "GCP billing usage unavailable" });
  }
});

router.get("/ai/coding/provider-billing", async (_req, res): Promise<void> => {
  try {
    res.json(await getAiProviderBillingSnapshot());
  } catch (error) {
    logger.warn({ err: error }, "[coding-workspace] AI provider billing query failed");
    res.status(502).json({
      error: error instanceof Error ? error.message : "AI provider billing unavailable",
    });
  }
});

router.get("/ai/coding/monitor", async (_req, res): Promise<void> => {
  const [jobSnapshot, taskSnapshot, operationalRows, workers] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE status IN ('queued', 'waiting', 'retrying')
            AND job_type IN (
              'coding_repository_analyzer',
              'coding_ai_execution',
              'coding_workstream_execution',
              'coding_workstream_ai_execution',
              'coding_multi_task_planner'
            )
        )::int AS waiting_queued,
        COUNT(*) FILTER (
          WHERE status = 'running'
            AND job_type IN ('coding_ai_execution', 'coding_workstream_ai_execution')
        )::int AS coding_model_running
      FROM ai_platform.ai_jobs
    `),
    db.execute(sql`
      WITH task_state AS (
        SELECT
          t.id,
          t.status,
          a.status AS autonomous_status,
          EXISTS (
            SELECT 1
            FROM ai_platform.ai_coding_runs r
            WHERE r.task_id = t.id
              AND r.status = 'RUNNING'
          ) AS has_active_run
        FROM ai_platform.ai_coding_tasks t
        LEFT JOIN ai_platform.ai_coding_autonomous_tasks a
          ON a.task_id = t.id
         AND a.enabled = TRUE
      )
      SELECT
        COUNT(*) FILTER (
          WHERE status IN ('PENDING', 'ANALYZING', 'CODING', 'TESTING', 'COMMITTING')
             OR has_active_run
             OR autonomous_status IN ('ACTIVE', 'WAITING')
        )::int AS jobs_active,
        COUNT(*) FILTER (
          WHERE has_active_run = FALSE
            AND (
              autonomous_status = 'FAILED'
              OR (
                status = 'FAILED'
                AND (
                  autonomous_status IS NULL
                  OR autonomous_status IN ('APPROVAL_REQUIRED', 'DISABLED')
                )
              )
            )
        )::int AS failed_blocked,
        COUNT(*) FILTER (
          WHERE has_active_run = FALSE
            AND (
              (
                status = 'READY_REVIEW'
                AND (
                  autonomous_status IS NULL
                  OR autonomous_status IN ('APPROVAL_REQUIRED', 'DISABLED', 'BLOCKED')
                )
              )
              OR (
                status = 'FAILED'
                AND autonomous_status = 'BLOCKED'
              )
            )
        )::int AS true_ready_review
      FROM task_state
    `),
    db.execute(sql`
      WITH parent_tasks AS (
        SELECT
          t.id AS task_id,
          t.status AS task_status,
          a.status AS autonomous_status,
          EXISTS (
            SELECT 1
            FROM ai_platform.ai_coding_runs r
            WHERE r.task_id = t.id
              AND r.status = 'RUNNING'
          ) AS has_active_run
        FROM ai_platform.ai_coding_tasks t
        LEFT JOIN ai_platform.ai_coding_autonomous_tasks a
          ON a.task_id = t.id
         AND a.enabled = TRUE
        WHERE t.task_number NOT LIKE 'MW-%'
      ),
      direct_jobs AS (
        SELECT
          j.id,
          NULLIF(j.payload_json->>'codingTaskId', '')::uuid AS task_id,
          j.status AS job_status,
          j.required_capability
        FROM ai_platform.ai_jobs j
        WHERE j.status IN ('queued', 'waiting', 'retrying', 'running')
          AND j.job_type IN (
            'coding_repository_analyzer',
            'coding_ai_execution',
            'coding_workstream_execution',
            'coding_workstream_ai_execution',
            'coding_multi_task_planner'
          )
          AND NULLIF(j.payload_json->>'codingTaskId', '') IS NOT NULL
      ),
      workstream_jobs AS (
        SELECT
          j.id,
          g.task_id,
          j.status AS job_status,
          j.required_capability
        FROM ai_platform.ai_jobs j
        JOIN ai_platform.ai_coding_workstreams w
          ON w.id::text = j.payload_json->>'workstreamId'
        JOIN ai_platform.ai_coding_task_graphs g
          ON g.id = w.graph_id
        WHERE j.status IN ('queued', 'waiting', 'retrying', 'running')
          AND j.job_type IN ('coding_workstream_execution', 'coding_workstream_ai_execution')
      ),
      latest_jobs AS (
        SELECT DISTINCT ON (task_id)
          task_id,
          job_status,
          required_capability
        FROM (
          SELECT * FROM direct_jobs
          UNION ALL
          SELECT * FROM workstream_jobs
        ) jobs
        WHERE task_id IS NOT NULL
        ORDER BY task_id, id DESC
      )
      SELECT
        p.task_id,
        p.task_status,
        p.autonomous_status,
        p.has_active_run,
        l.job_status,
        l.required_capability
      FROM parent_tasks p
      LEFT JOIN latest_jobs l ON l.task_id = p.task_id
    `),
    getWorkerCapacity(),
  ]);

  const jobRow = (jobSnapshot.rows?.[0] ?? {}) as Record<string, unknown>;
  const taskRow = (taskSnapshot.rows?.[0] ?? {}) as Record<string, unknown>;
  const now = Date.now();
  const heartbeatFreshMs = 90_000;
  const workerDetails = workers.map((worker) => {
    const heartbeatAgeMs = Math.max(
      0,
      now - new Date(worker.lastHeartbeat).getTime(),
    );
    const heartbeatFresh =
      Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs <= heartbeatFreshMs;
    const active = isHealthyCodingWorker({
      leaseValid: worker.leaseValid,
      heartbeatFresh,
      status: worker.status,
    });
    const available = active && worker.availableSlots > 0;
    const legacyPlaceholder = /^worker-(alpha|beta|gamma)$/i.test(worker.workerName);
    const codingRelevant = isCodingRelevantWorker(worker.capabilities);
    return {
      ...worker,
      heartbeatFresh,
      heartbeatAgeMs,
      active,
      available,
      legacyPlaceholder,
      codingRelevant,
      busyOrUnavailable: !available,
    };
  });
  const operationalWorkerDetails = workerDetails.filter(
    (worker) => !worker.legacyPlaceholder && worker.codingRelevant,
  );
  const retiredLegacyWorkers = workerDetails.filter(
    (worker) => worker.legacyPlaceholder,
  ).length;

  const taskStates: Record<string, string> = {};
  for (const raw of operationalRows.rows ?? []) {
    const row = raw as Record<string, unknown>;
    const taskId = typeof row["task_id"] === "string" ? row["task_id"] : "";
    if (!taskId) continue;
    const autonomousStatus =
      typeof row["autonomous_status"] === "string"
        ? row["autonomous_status"]
        : null;
    const hasActiveRun = row["has_active_run"] === true;
    const presentationStatus = codingTaskPresentationStatus({
      taskStatus: String(row["task_status"] ?? ""),
      autonomousStatus,
      hasActiveRun,
    });
    const requiredCapability =
      typeof row["required_capability"] === "string"
        ? row["required_capability"]
        : null;

    const capableWorkers = requiredCapability
      ? operationalWorkerDetails.filter((worker) =>
          worker.capabilities.includes(requiredCapability),
        )
      : operationalWorkerDetails;
    const healthyCapableWorkers = capableWorkers.filter(
      (worker) => worker.active,
    ).length;
    const availableCapableWorkers = capableWorkers.filter(
      (worker) => worker.available,
    ).length;

    const operationalState = deriveCodingWorkspaceOperationalState({
      presentationStatus,
      autonomousStatus,
      hasActiveRun,
      jobStatus:
        typeof row["job_status"] === "string" ? row["job_status"] : null,
      requiredCapability,
      healthyCapableWorkers,
      availableCapableWorkers,
    });
    if (operationalState) taskStates[taskId] = operationalState;
  }

  const operationalCounts = Object.values(taskStates).reduce(
    (counts, state) => {
      if (state === "ANALYZING_RUNNING") counts.analyzingRunning += 1;
      if (state === "WAITING_FOR_WORKER") counts.waitingForWorker += 1;
      if (state === "QUEUED") counts.queued += 1;
      if (state === "WAITING_FOR_CAPACITY") counts.waitingForCapacity += 1;
      return counts;
    },
    {
      analyzingRunning: 0,
      waitingForWorker: 0,
      queued: 0,
      waitingForCapacity: 0,
    },
  );

  res.json({
    refreshedAt: new Date().toISOString(),
    taskStates,
    jobs: {
      active: Number(taskRow["jobs_active"] ?? 0),
      waitingQueued: Number(jobRow["waiting_queued"] ?? 0),
      codingModelRunning: Number(jobRow["coding_model_running"] ?? 0),
      failedBlocked: Number(taskRow["failed_blocked"] ?? 0),
      trueReadyReview: Number(taskRow["true_ready_review"] ?? 0),
      ...operationalCounts,
    },
    workers: {
      active: operationalWorkerDetails.filter((worker) => worker.active).length,
      available: operationalWorkerDetails.filter((worker) => worker.available).length,
      busyUnavailable: operationalWorkerDetails.filter(
        (worker) => worker.busyOrUnavailable,
      ).length,
      retiredLegacy: retiredLegacyWorkers,
      details: operationalWorkerDetails,
    },
  });
});

router.post("/ai/coding/tasks", async (req, res): Promise<void> => {
  const parsed = CreateCodingTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [task] = await db
    .insert(aiCodingTasksTable)
    .values({
      taskNumber: createTaskNumber(),
      projectName: parsed.data.projectName,
      repository: parsed.data.repository,
      branch: parsed.data.branch,
      instruction: parsed.data.instruction,
      priority: parsed.data.priority,
      status: "PENDING",
    })
    .returning();

  res.status(201).json(CreateCodingTaskResponse.parse(task));
});

router.get("/ai/coding/tasks/:id/runs/:runId/status", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse({ id: req.params.id });
  const runId = typeof req.params.runId === "string" ? req.params.runId.trim() : "";
  if (!params.success || !/^[0-9a-fA-F-]{36}$/.test(runId)) {
    res.status(400).json({ error: "Invalid coding task or run id" });
    return;
  }

  const [run] = await withCodingWorkspaceReadRetry(
    () =>
      db
        .select({
          id: aiCodingRunsTable.id,
          taskId: aiCodingRunsTable.taskId,
          agentName: aiCodingRunsTable.agentName,
          status: aiCodingRunsTable.status,
          startedAt: aiCodingRunsTable.startedAt,
          finishedAt: aiCodingRunsTable.finishedAt,
          errorMessage: aiCodingRunsTable.errorMessage,
        })
        .from(aiCodingRunsTable)
        .where(
          and(
            eq(aiCodingRunsTable.id, runId),
            eq(aiCodingRunsTable.taskId, params.data.id),
          ),
        )
        .limit(1),
    { attempts: 5, delayMs: 200 },
  );

  if (!run) {
    res.status(404).json({ error: "Coding run not found" });
    return;
  }

  res.json(run);
});

router.get("/ai/coding/tasks/:id", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await Promise.all([
    reconcileStaleMultiWorkerRuns({ taskId: params.data.id }).catch(() => undefined),
    reconcileStaleCodingRuns({ taskId: params.data.id }).catch(() => undefined),
  ]);

  const [task] = await withCodingWorkspaceReadRetry(() =>
    db
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, params.data.id)),
  );

  if (!task) {
    res.status(404).json({ error: "Coding task not found" });
    return;
  }

  const [runs, changes, autonomous] = await Promise.all([
    withCodingWorkspaceReadRetry(() =>
      db
        .select()
        .from(aiCodingRunsTable)
        .where(eq(aiCodingRunsTable.taskId, task.id))
        .orderBy(desc(aiCodingRunsTable.startedAt)),
    ),
    withCodingWorkspaceReadRetry(() =>
      db
        .select()
        .from(aiCodeChangesTable)
        .where(eq(aiCodeChangesTable.taskId, task.id))
        .orderBy(desc(aiCodeChangesTable.createdAt)),
    ),
    getAutonomousCodingTaskStatus(task.id).catch(() => null),
  ]);

  const presentedStatus = codingTaskPresentationStatus({
    taskStatus: task.status,
    autonomousStatus:
      autonomous && typeof (autonomous as { status?: unknown }).status === "string"
        ? String((autonomous as { status?: unknown }).status)
        : null,
    hasActiveRun: runs.some((run) => run.status === "RUNNING"),
  });
  const presentedTask =
    presentedStatus === task.status
      ? task
      : { ...task, status: presentedStatus };

  res.json(GetCodingTaskResponse.parse({ task: presentedTask, runs, changes }));
});

class CodingTaskNotFoundError extends Error {}
class CodingRunAlreadyActiveError extends Error {
  constructor(
    message: string,
    readonly activeRunId?: string,
  ) {
    super(message);
    this.name = "CodingRunAlreadyActiveError";
  }
}

const DELETABLE_CODING_TASK_STATUSES = new Set(["PENDING", "FAILED", "READY_REVIEW", "COMPLETED"]);

router.delete("/ai/coding/tasks/:id", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await Promise.all([
    reconcileStaleMultiWorkerRuns({ taskId: params.data.id }).catch(() => undefined),
    reconcileStaleCodingRuns({ taskId: params.data.id }).catch(() => undefined),
  ]);

  try {
    const deleted = await db.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(aiCodingTasksTable)
        .where(eq(aiCodingTasksTable.id, params.data.id))
        .for("update");

      if (!task) {
        throw new CodingTaskNotFoundError("Coding task not found");
      }

      if (!DELETABLE_CODING_TASK_STATUSES.has(task.status)) {
        throw new CodingRunAlreadyActiveError(
          "Only pending, failed, ready-for-review, or completed coding tasks can be deleted",
        );
      }

      const [activeRun] = await tx
        .select({ id: aiCodingRunsTable.id })
        .from(aiCodingRunsTable)
        .where(
          and(
            eq(aiCodingRunsTable.taskId, task.id),
            eq(aiCodingRunsTable.status, "RUNNING"),
          ),
        )
        .limit(1);

      if (activeRun) {
        throw new CodingRunAlreadyActiveError(
          "Coding task has an active run and cannot be deleted",
        );
      }

      await tx
        .delete(aiCodingTasksTable)
        .where(eq(aiCodingTasksTable.id, task.id));

      return task;
    });

    res.status(200).json({
      id: deleted.id,
      taskNumber: deleted.taskNumber,
      deleted: true,
    });
  } catch (error) {
    if (error instanceof CodingTaskNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof CodingRunAlreadyActiveError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/run", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const { run, task } = await db.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(aiCodingTasksTable)
        .where(eq(aiCodingTasksTable.id, params.data.id))
        .for("update");

      if (!task) {
        throw new CodingTaskNotFoundError("Coding task not found");
      }

      const [activeRun] = await tx
        .select({ id: aiCodingRunsTable.id })
        .from(aiCodingRunsTable)
        .where(and(eq(aiCodingRunsTable.taskId, task.id), eq(aiCodingRunsTable.status, "RUNNING")))
        .limit(1);

      if (activeRun) {
        throw new CodingRunAlreadyActiveError("Coding task already has an active run", activeRun.id);
      }

      const [createdRun] = await tx
        .insert(aiCodingRunsTable)
        .values({
          taskId: task.id,
          agentName: "Coding Orchestrator",
          status: "RUNNING",
          startedAt: new Date(),
        })
        .returning();

      await tx
        .update(aiCodingTasksTable)
        .set({ status: "ANALYZING" })
        .where(eq(aiCodingTasksTable.id, task.id));

      return { run: createdRun, task };
    });

    void ensureGcpCodingWorkerStarted().catch((error) => {
      logger.warn({ err: error, taskId: task.id, runId: run.id }, "Failed to auto-start GCP coding worker");
    });

    // The durable run already exists at this point. Do not keep the HTTP
    // request open while the orchestrator performs DB bootstrap, queue setup,
    // orphan reconciliation and process launch. On Hostinger those bounded
    // startup operations can occasionally exceed the edge's ~30s request
    // timeout even though the server continues successfully in the background.
    //
    // Return the authoritative run immediately and continue orchestration
    // asynchronously. Any startup failure is persisted to the run/task so
    // polling clients observe a terminal FAILED state instead of an ambiguous
    // HTTP 503/000 retry loop.
    void startCodingOrchestration({ task, run }).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      const now = new Date();
      logger.error(
        { err: error, taskId: task.id, codingRunId: run.id },
        "[coding-workspace] Detached orchestrator startup failed",
      );

      await db.transaction(async (tx) => {
        const [updatedRun] = await tx
          .update(aiCodingRunsTable)
          .set({
            status: "FAILED",
            finishedAt: now,
            errorMessage: message.slice(0, 2000),
          })
          .where(and(eq(aiCodingRunsTable.id, run.id), eq(aiCodingRunsTable.status, "RUNNING")))
          .returning({ id: aiCodingRunsTable.id });

        if (!updatedRun) return;

        await tx
          .update(aiCodingTasksTable)
          .set({
            status: "FAILED",
            resultSummary: `Coding Orchestrator failed to start: ${message.slice(0, 500)}`,
          })
          .where(eq(aiCodingTasksTable.id, task.id));
      }).catch((persistError) => {
        logger.error(
          { err: persistError, taskId: task.id, codingRunId: run.id },
          "[coding-workspace] Failed to persist detached orchestrator startup failure",
        );
      });
    });

    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof CodingTaskNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof CodingRunAlreadyActiveError) {
      res.status(409).json({
        error: error.message,
        ...(error.activeRunId ? { activeRunId: error.activeRunId } : {}),
      });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/approve-plan", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await approvePlanAndStartCoding(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Coding task not found") {
      res.status(404).json({ error: message });
      return;
    }
    if (
      message.includes("not awaiting plan approval") ||
      message.includes("APPROVE_PLAN") ||
      message.includes("approval")
    ) {
      res.status(409).json({ error: message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/approve-local-patch", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await approveAndValidateLocalPatch(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalPatchApprovalError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/run-sandbox-verification", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await startSandboxVerification(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalCodingSandboxGateError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.kind === "SANDBOX_BLOCKED") {
        res.status(503).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/run-local-recovery", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await startDeterministicLocalRecovery(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalDeterministicRecoveryError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.kind === "SANDBOX_BLOCKED") {
        res.status(503).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/prepare-ai-handoff", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await startAiHandoffPreparation(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalAiHandoffError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/approve-ai-handoff", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await approveAiHandoff(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalAiHandoffError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/run-ai-execution", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const lease = await assertApprovedAiHandoffFresh(params.data.id);
    const job = await enqueueCodingAiExecution(params.data.id, {
      requestedBy: "coding-workspace",
      expectedPackageHash: lease.packageHash,
    });
    res.status(202).json({
      taskId: params.data.id,
      jobId: job.id,
      jobCode: job.jobCode,
      status: job.status,
      jobType: job.jobType,
      requiredCapability: job.requiredCapability,
    });
  } catch (error) {
    if (error instanceof LocalAiHandoffError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (
        error.kind === "NOT_READY" ||
        error.kind === "EXPIRED" ||
        error.kind === "REVOKED" ||
        error.kind === "STALE_HEAD"
      ) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/approve-ai-patch", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await approveAndValidateAiPatch(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalAiPatchApprovalError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/revoke-ai-handoff", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await revokeAiHandoff(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalAiHandoffError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (
        error.kind === "NOT_READY" ||
        error.kind === "STALE_HEAD" ||
        error.kind === "EXPIRED" ||
        error.kind === "REVOKED"
      ) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/approve-commit", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await approveCommitAndCreatePullRequest(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalCommitApprovalError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "STALE_HEAD") {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.kind === "GITHUB_AUTH") {
        res.status(503).json({ error: error.message });
        return;
      }
      if (error.kind === "PUBLISH_FAILED") {
        res.status(502).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/verify-pull-request", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await startPullRequestVerification(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalPullRequestGateError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.kind === "NOT_READY" || error.kind === "CHECKS_PENDING") {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.kind === "GITHUB_AUTH") {
        res.status(503).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/ai/coding/tasks/:id/approve-merge", async (req, res): Promise<void> => {
  const params = GetCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const run = await approveAndMergePullRequest(params.data.id);
    res.status(201).json(StartCodingRunResponse.parse(run));
  } catch (error) {
    if (error instanceof LocalPullRequestGateError) {
      if (error.kind === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (
        error.kind === "NOT_READY" ||
        error.kind === "CHECKS_PENDING" ||
        error.kind === "STALE_PR"
      ) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.kind === "GITHUB_AUTH") {
        res.status(503).json({ error: error.message });
        return;
      }
      if (error.kind === "MERGE_FAILED") {
        res.status(502).json({ error: error.message });
        return;
      }
      res.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.patch("/ai/coding/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateCodingTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCodingTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {
    status: parsed.data.status,
  };
  if (parsed.data.resultSummary !== undefined) updateData.resultSummary = parsed.data.resultSummary;
  if (parsed.data.commitSha !== undefined) updateData.commitSha = parsed.data.commitSha;

  const transition = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: aiCodingTasksTable.status })
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, params.data.id))
      .for("update");

    if (!current) return null;

    const [task] = await tx
      .update(aiCodingTasksTable)
      .set(updateData)
      .where(eq(aiCodingTasksTable.id, params.data.id))
      .returning();

    return task ? { task, previousStatus: current.status } : null;
  });

  if (!transition) {
    res.status(404).json({ error: "Coding task not found" });
    return;
  }

  const { task, previousStatus } = transition;
  if (
    previousStatus !== task.status &&
    (task.status === "COMPLETED" || task.status === "FAILED")
  ) {
    await reportCodingTaskTerminalTransition({
      taskId: task.id,
      status: task.status,
      message:
        task.resultSummary?.trim() ||
        (task.status === "COMPLETED"
          ? "Coding task selesai."
          : "Coding task gagal."),
      source: "coding-workspace-task-transition",
    }).catch((error) => {
      logger.warn(
        { err: error, taskId: task.id, status: task.status },
        "[coding-workspace] terminal lifecycle report failed",
      );
    });
  }

  res.json(UpdateCodingTaskResponse.parse(task));
});

export default router;