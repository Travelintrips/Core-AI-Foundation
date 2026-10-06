import { and, eq, inArray, sql } from "drizzle-orm";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  aiCodingRunsTable,
  aiCodingTasksTable,
  aiJobsTable,
  aiOrchestratorSessionsTable,
  db,
  withTransientDatabaseRetry,
  type AiCodingRun,
  type AiCodingTask,
  type AiJob,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  enableAutonomousCodingTask,
  getAutonomousCodingTaskStatus,
} from "./localCodingAutonomousRepairService.js";
import { logAudit } from "./aiAuditService.js";
import { executeAI, type ExecutionOutput } from "./aiExecutionService.js";
import { getFallbackModels, routeToModel } from "./aiModelRouter.js";
import { enqueue } from "./queueManagerService.js";
import {
  executeRepositoryAnalyzerJobOnDemand,
  failStaleRepositoryAnalyzerRuns,
} from "./repositoryAnalyzerService.js";
import { generateAndPersistCodingMultiTaskPlan } from "./localCodingAutomatedMultiTaskPlannerService.js";
import { reportCodingTaskTerminalTransition } from "./codingTaskTerminalReportingService.js";

type CodingStageId =
  | "repository_analyzer"
  | "planner"
  | "coding"
  | "testing"
  | "review";

type CodingStageStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "BLOCKED"
  | "FAILED";

interface CodingStage {
  id: CodingStageId;
  label: string;
  status: CodingStageStatus;
  startedAt?: string;
  completedAt?: string;
  detail?: string;
}

export interface CodingImplementationPlan {
  summary: string;
  objectives: string[];
  filesToInspect: string[];
  implementationSteps: string[];
  verificationSteps: string[];
  risks: string[];
  approvalRequired: boolean;
}

interface PlannerMetadata {
  modelUsed: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  parsedAsJson: boolean;
}

interface CodingOrchestrationInput {
  task: AiCodingTask;
  run: AiCodingRun;
}

const ORCHESTRATION_RECOVERY_POLL_MS = 8_000;
const REPOSITORY_ANALYZER_CLAIM_FAILOVER_MS = 15_000;
const WAIT_REPOSITORY_ANALYZER_SLOT = "WAIT_REPOSITORY_ANALYZER_SLOT";
let orchestrationRecoveryTimer: NodeJS.Timeout | null = null;
let orchestrationRecoveryRunning = false;

const PLANNER_SYSTEM_PROMPT = [
  "You are the Planning Agent inside a software-engineering orchestrator.",
  "Create a safe implementation plan from the repository analysis and user instruction.",
  "Do not claim to have edited files. Do not execute code. Do not invent repository files.",
  "Return JSON only with keys: summary, objectives, filesToInspect, implementationSteps, verificationSteps, risks.",
  "All list values must be arrays of strings.",
].join(" ");

function nowIso(): string {
  return new Date().toISOString();
}

function initStages(): CodingStage[] {
  return [
    { id: "repository_analyzer", label: "Repository Analyzer", status: "PENDING" },
    {
      id: "planner",
      label: "Local Deterministic Planner",
      status: "PENDING",
      detail: "Matches only explicit safe local edit recipes; no AI/LLM.",
    },
    {
      id: "coding",
      label: "Local Coding Executor",
      status: "PENDING",
      detail: "Produces a review-only patch in an isolated temporary clone when a deterministic recipe matches.",
    },
    {
      id: "testing",
      label: "Local Verification",
      status: "BLOCKED",
      detail: "Repository scripts remain fail-closed until the workspace is explicitly trusted.",
    },
    {
      id: "review",
      label: "Review",
      status: "BLOCKED",
      detail: "Review is required before a local patch can be applied to a repository branch.",
    },
  ];
}

function updateStage(
  stages: CodingStage[],
  id: CodingStageId,
  status: CodingStageStatus,
  detail?: string,
): CodingStage[] {
  return stages.map((stage) => {
    if (stage.id !== id) return stage;
    const timestamp = nowIso();
    return {
      ...stage,
      status,
      ...(status === "RUNNING" && !stage.startedAt ? { startedAt: timestamp } : {}),
      ...(["COMPLETED", "FAILED"].includes(status) ? { completedAt: timestamp } : {}),
      ...(detail ? { detail } : {}),
    };
  });
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const ADVANCED_AI_ACTIONS_AFTER_AI_REQUIRED = new Set([
  "APPROVE_TASK_GRAPH",
  "APPROVE_AI_HANDOFF",
  "AI_HANDOFF_APPROVED",
  "AI_EXECUTION_RUNNING",
  "REVIEW_AI_PATCH",
  "APPROVE_COMMIT",
  "REVIEW_PR",
  "APPROVE_MERGE",
  "DONE",
]);

export function shouldPreserveAdvancedAiGate(
  proposedNextAction: string,
  persistedLogs: string | null | undefined,
): boolean {
  if (proposedNextAction !== "AI_REQUIRED" || !persistedLogs) return false;

  try {
    const payload = JSON.parse(persistedLogs) as Record<string, unknown>;
    const orchestration =
      payload.orchestration &&
      typeof payload.orchestration === "object" &&
      !Array.isArray(payload.orchestration)
        ? payload.orchestration as Record<string, unknown>
        : null;
    const persistedNextAction =
      typeof orchestration?.nextAction === "string"
        ? orchestration.nextAction
        : null;

    if (
      persistedNextAction &&
      ADVANCED_AI_ACTIONS_AFTER_AI_REQUIRED.has(persistedNextAction)
    ) {
      return true;
    }

    const aiHandoff =
      payload.aiHandoff &&
      typeof payload.aiHandoff === "object" &&
      !Array.isArray(payload.aiHandoff)
        ? payload.aiHandoff as Record<string, unknown>
        : null;
    return (
      aiHandoff?.status === "PREPARED" ||
      aiHandoff?.status === "APPROVED"
    );
  } catch {
    return false;
  }
}

function extractJsonObject(content: string): Record<string, unknown> | null {
  const cleaned = content
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalizePlan(
  rawContent: string,
  analysis: Record<string, unknown>,
): { plan: CodingImplementationPlan; parsedAsJson: boolean } {
  const parsed = extractJsonObject(rawContent);
  const recommendedChanges = stringArray(analysis.recommendedChanges);
  const relevantFiles = stringArray(analysis.relevantFiles);
  const analysisSummary =
    typeof analysis.summary === "string"
      ? analysis.summary
      : "Repository analysis completed.";

  if (!parsed) {
    return {
      parsedAsJson: false,
      plan: {
        summary: rawContent.trim() || analysisSummary,
        objectives: recommendedChanges.length > 0
          ? recommendedChanges
          : ["Review the repository analysis and implement the requested change safely."],
        filesToInspect: relevantFiles,
        implementationSteps: recommendedChanges,
        verificationSteps: [
          "Run repository typecheck or compile validation.",
          "Run the relevant automated test suite.",
          "Review the resulting diff before commit or deployment.",
        ],
        risks: [
          "Planner response was not strict JSON; implementation requires human review before write access.",
        ],
        approvalRequired: true,
      },
    };
  }

  return {
    parsedAsJson: true,
    plan: {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : analysisSummary,
      objectives: stringArray(parsed.objectives),
      filesToInspect: stringArray(parsed.filesToInspect),
      implementationSteps: stringArray(parsed.implementationSteps),
      verificationSteps: stringArray(parsed.verificationSteps),
      risks: stringArray(parsed.risks),
      approvalRequired: true,
    },
  };
}

async function executePlanner(
  task: AiCodingTask,
  analysis: Record<string, unknown>,
): Promise<{ plan: CodingImplementationPlan; metadata: PlannerMetadata }> {
  const compactAnalysis = {
    summary: analysis.summary,
    relevantFiles: analysis.relevantFiles,
    findings: analysis.findings,
    recommendedChanges: analysis.recommendedChanges,
  };

  const prompt = [
    "Create an implementation plan for this coding task.",
    `Repository: ${task.repository}`,
    `Branch: ${task.branch}`,
    `Instruction: ${task.instruction}`,
    "Repository analysis:",
    stringify(compactAnalysis),
  ].join("\n\n");

  const routed = await routeToModel(
    `code implementation plan repository ${task.repository}: ${task.instruction}`,
  );
  const supportsCodingText = (candidate: {
    model: { capabilities?: string[] | null };
    provider: { slug: string };
  }) => {
    const capabilities = candidate.model.capabilities ?? [];
    return (
      candidate.provider.slug !== "replicate" &&
      (capabilities.includes("code") || capabilities.includes("text"))
    );
  };

  if (!routed || !supportsCodingText(routed)) {
    throw new Error("Planning Agent could not find an active text/code model with a configured provider key");
  }

  const candidates = [
    routed,
    ...(await getFallbackModels(routed.model.id)).filter(supportsCodingText),
  ];

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const output: ExecutionOutput = await executeAI({
        prompt,
        systemPrompt: PLANNER_SYSTEM_PROMPT,
        model: candidate.model,
        provider: candidate.provider,
        temperature: 0.2,
        maxTokens: 1800,
        observability: {
          agentName: "Coding Planning Agent",
          requestType: "code",
          createdBy: "coding-orchestrator",
        },
      });
      const normalized = normalizePlan(output.content, analysis);
      return {
        plan: normalized.plan,
        metadata: {
          modelUsed: candidate.model.modelId,
          provider: candidate.provider.slug,
          promptTokens: output.promptTokens,
          completionTokens: output.completionTokens,
          totalTokens: output.tokensUsed,
          latencyMs: output.latencyMs,
          parsedAsJson: normalized.parsedAsJson,
        },
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Planning Agent failed across all available models: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function isManualStopRequested(taskId: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM ai_platform.ai_coding_autonomous_tasks
        WHERE task_id = ${taskId}::uuid
          AND enabled = FALSE
          AND status = 'DISABLED'
          AND last_action = 'MANUAL_STOP'
      ) AS stopped
    `);
    return (result.rows?.[0] as { stopped?: boolean } | undefined)?.stopped === true;
  } catch (error) {
    logger.warn(
      { error, taskId },
      "[coding-orchestrator] Manual-stop guard lookup failed; continuing existing fail-closed lifecycle",
    );
    return false;
  }
}

async function persistSnapshot(
  runId: string,
  taskId: string,
  payload: Record<string, unknown>,
  taskStatus: string,
  summary?: string,
): Promise<void> {
  if (await isManualStopRequested(taskId)) return;

  await db.transaction(async (tx) => {
    const manualStopFence = sql`NOT EXISTS (
      SELECT 1
      FROM ai_platform.ai_coding_autonomous_tasks
      WHERE task_id = ${taskId}::uuid
        AND enabled = FALSE
        AND status = 'DISABLED'
        AND last_action = 'MANUAL_STOP'
    )`;

    await tx
      .update(aiCodingRunsTable)
      .set({ logs: stringify(payload) })
      .where(and(eq(aiCodingRunsTable.id, runId), manualStopFence));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: taskStatus,
        ...(summary !== undefined ? { resultSummary: summary } : {}),
      })
      .where(and(eq(aiCodingTasksTable.id, taskId), manualStopFence));
  });
}

async function completeLocalAnalysis(
  input: CodingOrchestrationInput,
  sessionId: string,
  stages: CodingStage[],
  analysis: Record<string, unknown>,
  aiEscalation?: Awaited<ReturnType<typeof generateAndPersistCodingMultiTaskPlan>>,
): Promise<void> {
  const completedAt = new Date();
  const analysisSummary =
    typeof analysis.summary === "string" ? analysis.summary : "Local repository analysis completed.";
  const localPlan =
    analysis.localExecutionPlan && typeof analysis.localExecutionPlan === "object"
      ? (analysis.localExecutionPlan as Record<string, unknown>)
      : null;
  const localExecution =
    analysis.localExecution && typeof analysis.localExecution === "object"
      ? (analysis.localExecution as Record<string, unknown>)
      : null;
  const changeReservation =
    analysis.changeReservation && typeof analysis.changeReservation === "object"
      ? (analysis.changeReservation as Record<string, unknown>)
      : null;
  const activeConflict = changeReservation?.status === "CONFLICT";
  const nextAction =
    activeConflict
      ? "REVIEW_CONFLICT"
      : localExecution?.status === "APPLIED"
        ? "REVIEW_LOCAL_PATCH"
      : aiEscalation
        ? "APPROVE_TASK_GRAPH"
        : localPlan?.status === "AI_REQUIRED"
          ? "AI_REQUIRED"
          : "REVIEW_LOCAL_CONTEXT";
  const summary =
    nextAction === "REVIEW_CONFLICT"
      ? `${analysisSummary} Coding stopped before worker execution because the predicted change set overlaps an active task. QC can sequence, revise, or rebase the conflicting task; no AI/LLM worker was invoked.`
      : nextAction === "REVIEW_LOCAL_PATCH"
        ? `${analysisSummary} A deterministic local patch is ready for review; repository scripts were not executed. No AI/LLM was invoked.`
        : nextAction === "APPROVE_TASK_GRAPH"
        ? `${analysisSummary} The deterministic executor declined to guess, so the bounded AI planner generated a PREPARED task graph. The autonomous controller will approve and dispatch the graph automatically when policy checks pass; no patch, commit, push, or merge was performed yet.`
        : nextAction === "AI_REQUIRED"
          ? `${analysisSummary} The deterministic executor declined to guess; AI reasoning is required for the remaining semantic work. No AI/LLM was invoked.`
          : `${analysisSummary} Local context is ready for review. No AI/LLM was invoked.`;

  const result: Record<string, unknown> = {
    ...analysis,
    executionStatus: "COMPLETED",
    summary,
    orchestration: {
      sessionId,
      status: "READY_REVIEW",
      stages,
      nextAction,
      ...(aiEscalation
        ? {
            taskGraph: {
              graphId: aiEscalation.graphId,
              graphVersion: aiEscalation.graphVersion,
              planHash: aiEscalation.planHash,
              graphStatus: aiEscalation.graphStatus,
              nextAction: aiEscalation.nextAction,
              model: aiEscalation.model,
            },
          }
        : {}),
    },
  };

  if (await isManualStopRequested(input.task.id)) return;

  let preservedAdvancedAiGate = false;
  await db.transaction(async (tx) => {
    const manualStopFence = sql`NOT EXISTS (
      SELECT 1
      FROM ai_platform.ai_coding_autonomous_tasks
      WHERE task_id = ${input.task.id}::uuid
        AND enabled = FALSE
        AND status = 'DISABLED'
        AND last_action = 'MANUAL_STOP'
    )`;

    const [persistedRun] = await tx
      .select({ logs: aiCodingRunsTable.logs })
      .from(aiCodingRunsTable)
      .where(eq(aiCodingRunsTable.id, input.run.id))
      .for("update");

    preservedAdvancedAiGate = shouldPreserveAdvancedAiGate(
      nextAction,
      persistedRun?.logs,
    );

    if (!preservedAdvancedAiGate) {
      await tx
        .update(aiCodingRunsTable)
        .set({
          status: "COMPLETED",
          finishedAt: completedAt,
          logs: stringify(result),
          errorMessage: null,
        })
        .where(and(eq(aiCodingRunsTable.id, input.run.id), manualStopFence));

      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "READY_REVIEW",
          resultSummary: summary,
        })
        .where(and(eq(aiCodingTasksTable.id, input.task.id), manualStopFence));
    }

    await tx
      .update(aiOrchestratorSessionsTable)
      .set({
        totalTokens: aiEscalation?.model.totalTokens ?? 0,
        totalRequests: aiEscalation ? 1 : 0,
        lastModelUsed: aiEscalation?.model.model ?? null,
      })
      .where(eq(aiOrchestratorSessionsTable.sessionId, sessionId));
  });

  if (preservedAdvancedAiGate) {
    await logAudit(
      "coding-orchestrator",
      "local_analysis_gate_regression_prevented",
      input.task.id,
      "coding_task",
      "success",
      {
        sessionId,
        codingRunId: input.run.id,
        proposedNextAction: nextAction,
      },
    );
    return;
  }

  await logAudit(
    "coding-orchestrator",
    nextAction === "REVIEW_LOCAL_PATCH"
      ? "local_patch_ready_review"
      : nextAction === "APPROVE_TASK_GRAPH"
        ? "local_execution_ai_required_escalated"
        : nextAction === "AI_REQUIRED"
          ? "local_execution_ai_required"
          : "local_analysis_ready_review",
    input.task.id,
    "coding_task",
    "success",
    {
      sessionId,
      codingRunId: input.run.id,
      aiInvoked: Boolean(aiEscalation),
      nextAction,
      ...(aiEscalation
        ? {
            graphId: aiEscalation.graphId,
            graphVersion: aiEscalation.graphVersion,
            graphStatus: aiEscalation.graphStatus,
            plannerProvider: aiEscalation.model.provider,
            plannerModel: aiEscalation.model.model,
          }
        : {}),
    },
  );
}

async function failOrchestration(
  input: CodingOrchestrationInput,
  sessionId: string,
  stages: CodingStage[],
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const finishedAt = new Date();
  const result = {
    codingTaskId: input.task.id,
    codingRunId: input.run.id,
    executionStatus: "FAILED",
    error: message,
    orchestration: {
      sessionId,
      status: "FAILED",
      stages,
    },
  };

  await db.transaction(async (tx) => {
    await tx
      .update(aiCodingRunsTable)
      .set({
        status: "FAILED",
        finishedAt,
        logs: stringify(result),
        errorMessage: message.slice(0, 2000),
      })
      .where(eq(aiCodingRunsTable.id, input.run.id));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "FAILED",
        resultSummary: `Coding Orchestrator failed: ${message.slice(0, 500)}`,
      })
      .where(eq(aiCodingTasksTable.id, input.task.id));
  });

  await logAudit(
    "coding-orchestrator",
    "pipeline_failed",
    input.task.id,
    "coding_task",
    "failure",
    { sessionId, codingRunId: input.run.id, error: message.slice(0, 500) },
  );

  logger.error(
    { err: error, taskId: input.task.id, codingRunId: input.run.id, sessionId },
    "[coding-orchestrator] Pipeline failed",
  );
}

export async function continueCodingOrchestration(
  input: CodingOrchestrationInput,
  sessionId: string,
  queuedJob: AiJob,
  initialStages: CodingStage[],
): Promise<void> {
  let stages = initialStages;
  try {
    if (await isManualStopRequested(input.task.id)) {
      logger.info(
        { taskId: input.task.id, codingRunId: input.run.id },
        "[coding-orchestrator] Manual stop detected before continuation; skipping analyzer execution",
      );
      return;
    }
    stages = updateStage(stages, "repository_analyzer", "RUNNING");
    await persistSnapshot(
      input.run.id,
      input.task.id,
      {
        codingTaskId: input.task.id,
        codingRunId: input.run.id,
        executionStatus: "RUNNING",
        summary: "Coding Orchestrator is running the Local Coding Engine.",
        orchestration: { sessionId, status: "RUNNING", stages },
      },
      "ANALYZING",
    );

    const analysis = await executeRepositoryAnalyzerJobOnDemand(
      queuedJob,
      { finalizeCodingRun: false },
    );

    if (await isManualStopRequested(input.task.id)) {
      logger.info(
        { taskId: input.task.id, codingRunId: input.run.id, jobId: queuedJob.id },
        "[coding-orchestrator] Manual stop detected after analyzer execution; discarding late result",
      );
      return;
    }

    if (!analysis) {
      // Another executor may have won the claim between a watchdog status check
      // and the on-demand compare-and-set. Do not fail the coding task while
      // that executor legitimately owns the analyzer job.
      const [currentJob] = await withTransientDatabaseRetry(
        () => db
          .select()
          .from(aiJobsTable)
          .where(eq(aiJobsTable.id, queuedJob.id))
          .limit(1),
        { attempts: 3, baseDelayMs: 150 },
      );
      if (currentJob && currentJob.status !== "queued") {
        logger.info(
          {
            jobId: queuedJob.id,
            jobStatus: currentJob.status,
            taskId: input.task.id,
            codingRunId: input.run.id,
          },
          "[coding-orchestrator] Repository Analyzer claim is owned by another executor",
        );
        return;
      }
      throw new Error("Repository Analyzer job was not claimed by the Coding Orchestrator");
    }

    stages = updateStage(
      stages,
      "repository_analyzer",
      "COMPLETED",
      "Local search, AST/symbols, dependency graph, git context, tests, and context packaging completed.",
    );

    const localPlan =
      analysis.localExecutionPlan && typeof analysis.localExecutionPlan === "object"
        ? (analysis.localExecutionPlan as Record<string, unknown>)
        : null;
    const localExecution =
      analysis.localExecution && typeof analysis.localExecution === "object"
        ? (analysis.localExecution as Record<string, unknown>)
        : null;
    const changeReservation =
      analysis.changeReservation && typeof analysis.changeReservation === "object"
        ? (analysis.changeReservation as Record<string, unknown>)
        : null;

    if (changeReservation?.status === "CONFLICT") {
      stages = updateStage(
        stages,
        "planner",
        "BLOCKED",
        "Active file reservation conflict detected before planning/worker dispatch.",
      );
      stages = updateStage(
        stages,
        "coding",
        "BLOCKED",
        "No coding worker was dispatched because another active task owns part of the predicted change set.",
      );
      stages = updateStage(
        stages,
        "review",
        "RUNNING",
        "QC should sequence, revise, or rebase the conflicting task before retry.",
      );
      await completeLocalAnalysis(input, sessionId, stages, analysis);
      await reportCodingTaskTerminalTransition({
        taskId: input.task.id,
        status: "BLOCKED",
        message:
          "AI Core menghentikan coding sementara karena file target sedang dipakai task lain. " +
          "Tidak ada worker/AI yang dijalankan. Task perlu dijadwalkan ulang, direvisi, atau direbase setelah konflik selesai.",
        source: "coding-orchestrator-active-change-conflict",
      }).catch((error) => {
        logger.warn(
          { error, taskId: input.task.id, codingRunId: input.run.id },
          "[coding-orchestrator] Failed to report active-change BLOCKED event",
        );
      });
      await logAudit(
        "coding-orchestrator",
        "active_change_conflict_waiting_for_qc",
        input.task.id,
        "coding_task",
        "success",
        {
          sessionId,
          codingRunId: input.run.id,
          conflicts: Array.isArray(changeReservation.conflicts)
            ? changeReservation.conflicts
            : [],
          workerDispatched: false,
        },
      );
      return;
    }

    if (localPlan?.status === "EXECUTABLE") {
      stages = updateStage(
        stages,
        "planner",
        "COMPLETED",
        typeof localPlan.reason === "string"
          ? localPlan.reason
          : "Deterministic local edit plan produced without AI/LLM.",
      );
      if (localExecution?.status === "APPLIED") {
        stages = updateStage(
          stages,
          "coding",
          "COMPLETED",
          "Review-only patch produced in the isolated temporary clone; no repository script was executed.",
        );
      } else {
        stages = updateStage(
          stages,
          "coding",
          "BLOCKED",
          typeof localExecution?.reason === "string"
            ? localExecution.reason
            : "Deterministic plan exists but no isolated local patch was produced.",
        );
      }
    } else {
      stages = updateStage(
        stages,
        "planner",
        "BLOCKED",
        typeof localPlan?.reason === "string"
          ? localPlan.reason
          : "No deterministic local edit recipe matched this semantic task.",
      );
      stages = updateStage(
        stages,
        "coding",
        "BLOCKED",
        "Local executor made no changes; semantic reasoning is required before file writes.",
      );
    }

    // Persist the completed bounded repository analysis before invoking the
    // automated multi-task planner. The planner deliberately reads only a
    // COMPLETED Coding Orchestrator/Repository Analyzer run, so invoking it
    // while this run is still RUNNING creates a circular ANALYSIS_REQUIRED
    // failure even though repository_analyzer has already completed.
    if (localPlan?.status === "AI_REQUIRED") {
      await completeLocalAnalysis(input, sessionId, stages, analysis);
    }

    let aiEscalation: Awaited<ReturnType<typeof generateAndPersistCodingMultiTaskPlan>> | undefined;
    if (localPlan?.status === "AI_REQUIRED") {
      try {
        aiEscalation = await generateAndPersistCodingMultiTaskPlan(input.task.id, analysis);
      } catch (plannerError) {
        // Repository analysis is already a valid durable artifact at this point.
        // A planner/provider/authority failure must never regress that completed
        // run to FAILED: subsequent bounded retries need the persisted context.
        logger.warn(
          {
            err: plannerError,
            taskId: input.task.id,
            codingRunId: input.run.id,
            sessionId,
          },
          "[coding-orchestrator] Planner escalation deferred; preserving completed repository analysis",
        );
        await logAudit(
          "coding-orchestrator",
          "ai_planner_escalation_deferred",
          input.task.id,
          "coding_task",
          "failure",
          {
            sessionId,
            codingRunId: input.run.id,
            error: plannerError instanceof Error
              ? plannerError.message.slice(0, 500)
              : String(plannerError).slice(0, 500),
            repositoryAnalysisPreserved: true,
          },
        );
      }
    }

    await completeLocalAnalysis(input, sessionId, stages, analysis, aiEscalation);

    if (localPlan?.status === "AI_REQUIRED") {
      let autonomousState:
        | Awaited<ReturnType<typeof getAutonomousCodingTaskStatus>>
        | null;
      let autonomousStateReadable = true;

      try {
        autonomousState = await getAutonomousCodingTaskStatus(input.task.id);
      } catch (error) {
        autonomousStateReadable = false;
        autonomousState = null;
        logger.warn(
          { err: error, taskId: input.task.id },
          "[coding-orchestrator] Autonomous state unreadable; fail-closed auto-enable deferred",
        );
        await logAudit(
          "coding-orchestrator",
          "autonomous_enable_deferred_state_unreadable",
          input.task.id,
          "coding_task",
          "failure",
          {
            error: error instanceof Error
              ? error.message.slice(0, 1000)
              : String(error).slice(0, 1000),
          },
        ).catch(() => undefined);
      }

      const explicitlyDisabled =
        String(autonomousState?.["status"] ?? "").toUpperCase() === "DISABLED";

      if (autonomousStateReadable && !explicitlyDisabled) {
        await enableAutonomousCodingTask(input.task.id, 40);
      } else if (explicitlyDisabled) {
        logger.info(
          { taskId: input.task.id },
          "[coding-orchestrator] Autonomous enable skipped because the task was explicitly disabled",
        );
      }
    }

    logger.info(
      {
        taskId: input.task.id,
        codingRunId: input.run.id,
        sessionId,
        nextAction: aiEscalation ? "APPROVE_TASK_GRAPH" : undefined,
        graphId: aiEscalation?.graphId,
      },
      aiEscalation
        ? "[coding-orchestrator] AI_REQUIRED escalated to a PREPARED task graph"
        : "[coding-orchestrator] Local Coding Engine ready for review without AI/LLM",
    );
  } catch (error) {
    if (await isManualStopRequested(input.task.id)) {
      logger.info(
        { taskId: input.task.id, codingRunId: input.run.id },
        "[coding-orchestrator] Ignoring late orchestration error after manual stop",
      );
      return;
    }

    const runningStage = stages.find((stage) => stage.status === "RUNNING");
    if (runningStage) {
      stages = updateStage(
        stages,
        runningStage.id,
        "FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
    await failOrchestration(input, sessionId, stages, error);
  }
}

function scheduleRepositoryAnalyzerClaimFailover(
  input: CodingOrchestrationInput,
  sessionId: string,
  queuedJob: AiJob,
  stages: CodingStage[],
): void {
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const [currentJob] = await withTransientDatabaseRetry(
          () => db
            .select()
            .from(aiJobsTable)
            .where(eq(aiJobsTable.id, queuedJob.id))
            .limit(1),
          { attempts: 3, baseDelayMs: 150 },
        );

        // The dedicated child/remote worker claimed or completed the job in
        // time. The watchdog is intentionally a no-op in the healthy path.
        if (!currentJob || currentJob.status !== "queued") return;

        logger.warn(
          {
            jobId: currentJob.id,
            taskId: input.task.id,
            codingRunId: input.run.id,
            failoverAfterMs: REPOSITORY_ANALYZER_CLAIM_FAILOVER_MS,
          },
          "[coding-orchestrator] Repository Analyzer was not claimed; failing over to bounded in-process execution",
        );

        await logAudit(
          "coding-orchestrator",
          "repository_analyzer_claim_failover",
          input.task.id,
          "coding_task",
          "success",
          {
            sessionId,
            codingRunId: input.run.id,
            jobId: currentJob.id,
            failoverAfterMs: REPOSITORY_ANALYZER_CLAIM_FAILOVER_MS,
          },
        ).catch(() => undefined);

        // executeRepositoryAnalyzerJobOnDemand performs the authoritative
        // queued -> running compare-and-set. If another executor races this
        // watchdog, continueCodingOrchestration re-checks ownership and exits
        // without poisoning the task.
        await continueCodingOrchestration(
          input,
          sessionId,
          currentJob,
          stages,
        );
      } catch (error) {
        logger.error(
          {
            err: error,
            jobId: queuedJob.id,
            taskId: input.task.id,
            codingRunId: input.run.id,
          },
          "[coding-orchestrator] Repository Analyzer claim failover failed",
        );
      }
    })();
  }, REPOSITORY_ANALYZER_CLAIM_FAILOVER_MS);
  timer.unref();
}

/**
 * Starts a bounded Coding Orchestrator run.
 *
 * The production global dispatcher remains fail-closed. The orchestrator only
 * executes work created by this explicit Run Agent request. The local analyzer
 * may also produce a deterministic review-only patch inside its isolated clone.
 * Semantic tasks are marked AI_REQUIRED rather than guessed. AI_REQUIRED is
 * escalated through the bounded multi-task planner into a PREPARED task graph.
 * The autonomous controller approves safe prepared graphs and advances worker/model
 * execution automatically; policy/security failures remain fail-closed. Repository
 * scripts and direct repository writes remain fail-closed.
 */
export async function startCodingOrchestration(
  input: CodingOrchestrationInput,
): Promise<{ sessionId: string }> {
  const sessionId = `coding-${input.run.id}`;
  const stages = initStages();

  // Recover an analyzer run that has been RUNNING beyond the bounded analyzer
  // lifetime before checking the host-wide single-flight lock. Without this,
  // a crashed child process can leave both the run and queue row looking live
  // forever, causing every later orchestration to fail with "Analyzer is busy".
  //
  // The analyzer's existing recovery routine only touches Repository Analyzer
  // runs older than its stale threshold, so genuinely active work is preserved.
  await failStaleRepositoryAnalyzerRuns().catch((error) => {
    logger.warn(
      { err: error },
      "[coding-orchestrator] Stale analyzer run recovery failed",
    );
  });

  // A previous process can die after creating/claiming an analyzer job while
  // its linked coding run has already been failed/recovered. Such an orphaned
  // queue row must never hold the host-wide single-flight lock forever.
  //
  // Reconcile only jobs whose payload-linked run is no longer RUNNING. A live
  // analyzer remains untouched and still enforces the concurrency=1 boundary.
  try {
    const recovered = await db.execute(sql`
      UPDATE ai_platform.ai_jobs AS j
      SET status = 'failed',
          completed_at = COALESCE(j.completed_at, NOW()),
          error_message = COALESCE(
            j.error_message,
            'Orphaned Repository Analyzer job recovered before a new orchestration start'
          ),
          updated_at = NOW()
      WHERE j.job_type = 'coding_repository_analyzer'
        AND j.status IN ('queued', 'running', 'retrying')
        AND NOT EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_runs AS r
          WHERE r.id::text = j.payload_json->>'codingRunId'
            AND r.status = 'RUNNING'
        )
      RETURNING j.id
    `);
    const recoveredRows =
      (recovered as unknown as { rows?: Array<{ id: number }> }).rows ?? [];
    if (recoveredRows.length > 0) {
      logger.warn(
        { jobIds: recoveredRows.map((row) => row.id) },
        "[coding-orchestrator] Recovered orphaned analyzer single-flight rows",
      );
    }
  } catch (error) {
    // Reconciliation is defensive. Do not mask the authoritative busy check
    // below if the cleanup query itself encounters a transient DB failure.
    logger.warn(
      { err: error },
      "[coding-orchestrator] Analyzer orphan reconciliation failed",
    );
  }

  // Repository analysis is intentionally single-flight on this host. A second
  // analyzer would compete for the same CPU/memory/DB resources and can starve
  // the public API. Keep the durable job queue clean instead of spawning
  // parallel analyzer child processes.
  const [activeAnalyzer] = await withTransientDatabaseRetry(
    () => db
      .select({ id: aiJobsTable.id })
      .from(aiJobsTable)
      .where(
        and(
          eq(aiJobsTable.jobType, "coding_repository_analyzer"),
          inArray(aiJobsTable.status, ["queued", "running", "retrying"]),
        ),
      )
      .limit(1),
    { attempts: 4, baseDelayMs: 250 },
  );

  if (activeAnalyzer) {
    // A healthy single-flight analyzer is normal backpressure, not a task
    // failure. Keep this orchestration retryable instead of poisoning the
    // coding run merely because another analyzer owns the only slot.
    const detail =
      `Repository Analyzer is busy with job ${activeAnalyzer.id}; waiting for the single-flight slot`;
    // Persist a resumable checkpoint before returning. This task may have
    // autonomous execution explicitly disabled, so its retry must not depend
    // on the autonomous loop or a Temporal lease.
    await db.update(aiCodingRunsTable)
      .set({ logs: stringify({
        codingTaskId: input.task.id,
        codingRunId: input.run.id,
        executionStatus: "WAITING",
        summary: detail,
        orchestration: {
          sessionId, status: "WAITING", stages,
          nextAction: WAIT_REPOSITORY_ANALYZER_SLOT,
          activeAnalyzerJobId: activeAnalyzer.id,
        },
      }) })
      .where(and(eq(aiCodingRunsTable.id, input.run.id), eq(aiCodingRunsTable.status, "RUNNING")));
    logger.info(
      { activeAnalyzerJobId: activeAnalyzer.id, taskId: input.task.id, codingRunId: input.run.id },
      "[coding-orchestrator] Analyzer slot busy; deferring orchestration without failing the task",
    );
    await logAudit(
      "coding-orchestrator",
      "repository_analyzer_deferred",
      input.task.id,
      "coding_task",
      "success",
      { sessionId, codingRunId: input.run.id, activeAnalyzerJobId: activeAnalyzer.id },
    ).catch(() => undefined);
    return { sessionId };
  }

  let queuedJob: AiJob | null = null;
  try {
    let lastSessionError: unknown = null;
    let sessionReady = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await db
          .insert(aiOrchestratorSessionsTable)
          .values({
            sessionId,
            agentId: "coding-orchestrator",
            totalTokens: 0,
            totalRequests: 0,
            lastModelUsed: null,
          })
          .onConflictDoNothing({ target: aiOrchestratorSessionsTable.sessionId });
        sessionReady = true;
        lastSessionError = null;
        break;
      } catch (error) {
        lastSessionError = error;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
    }
    if (!sessionReady) {
      throw lastSessionError ?? new Error("Coding Orchestrator session bootstrap failed");
    }

    await logAudit(
      "coding-orchestrator",
      "pipeline_started",
      input.task.id,
      "coding_task",
      "success",
      { sessionId, codingRunId: input.run.id },
    );

    let lastEnqueueError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        queuedJob = await enqueue({
          jobType: "coding_repository_analyzer",
          // Stable idempotency makes bounded retry safe even if Postgres accepted
          // the first insert but the client lost the acknowledgement.
          idempotencyKey: `coding-repository-analyzer:${input.run.id}`,
          // Reserve this analyzer job for the explicit in-process orchestrator path.
          // Dispatcher text workers intentionally do not advertise this capability,
          // preventing them from stealing the queued row before on-demand claim.
          requiredCapability: "coding_repository_analyzer_on_demand",
          priority: input.task.priority,
          maxRetry: 0,
          retryStrategy: "manual",
          payloadJson: {
            codingTaskId: input.task.id,
            codingRunId: input.run.id,
            orchestratorSessionId: sessionId,
            repository: input.task.repository,
            branch: input.task.branch,
            expectedBaseSha: input.task.instruction.match(/\bbase-sha:([0-9a-f]{40})\b/i)?.[1]?.toLowerCase(),
            title: input.task.projectName,
            description: input.task.instruction,
          },
        });
        lastEnqueueError = null;
        break;
      } catch (error) {
        lastEnqueueError = error;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
    }
    if (!queuedJob) {
      throw lastEnqueueError ?? new Error("Coding Orchestrator queue enqueue failed");
    }
  } catch (error) {
    const failedStages = updateStage(
      stages,
      "repository_analyzer",
      "FAILED",
      error instanceof Error ? error.message : String(error),
    );
    await failOrchestration(input, sessionId, failedStages, error);
    throw error;
  }

  // A dedicated analyzer is preferred, but availability must not depend on a
  // child/remote worker silently dying before it claims the durable row. A
  // short watchdog provides bounded in-process failover only when the job is
  // still unclaimed; healthy dedicated execution remains unchanged.
  scheduleRepositoryAnalyzerClaimFailover(input, sessionId, queuedJob, stages);

  // In remote mode the API remains enqueue-first. The watchdog above is only a
  // bounded safety net when the separately supervised CPU worker is unavailable.
  const analyzerMode = process.env.REPOSITORY_ANALYZER_EXECUTION_MODE?.trim().toLowerCase();
  if (analyzerMode === "remote") {
    logger.info(
      { jobId: queuedJob.id, taskId: input.task.id, codingRunId: input.run.id },
      "[coding-orchestrator] Repository Analyzer queued for remote worker",
    );
    return { sessionId };
  }

  // Backward-compatible local mode keeps existing deployments safe until the
  // remote worker has been deployed and production explicitly opts in.
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const workerEntry = join(currentDir, "repository-analyzer-worker.mjs");
  const child = spawn(process.execPath, [workerEntry, String(queuedJob.id)], {
    env: process.env,
    stdio: "ignore",
    detached: false,
  });
  child.unref();
  child.once("error", (error) => {
    const spawnCode =
      typeof (error as NodeJS.ErrnoException).code === "string"
        ? (error as NodeJS.ErrnoException).code
        : "";
    const resourcePressure =
      spawnCode === "EAGAIN" ||
      /resource temporarily unavailable|cannot fork/i.test(error.message);

    if (resourcePressure) {
      logger.warn(
        { err: error, jobId: queuedJob?.id, taskId: input.task.id, codingRunId: input.run.id },
        "[coding-orchestrator] Dedicated Repository Analyzer spawn hit host process pressure; failing over in-process",
      );
      void continueCodingOrchestration(
        input,
        sessionId,
        queuedJob!,
        stages,
      ).catch((fallbackError) => {
        logger.error(
          {
            err: fallbackError,
            jobId: queuedJob?.id,
            taskId: input.task.id,
            codingRunId: input.run.id,
          },
          "[coding-orchestrator] In-process Repository Analyzer spawn failover failed",
        );
      });
      return;
    }

    logger.error(
      { err: error, jobId: queuedJob?.id, taskId: input.task.id, codingRunId: input.run.id },
      "[coding-orchestrator] Failed to launch dedicated Repository Analyzer process",
    );
    void failOrchestration(
      input,
      sessionId,
      updateStage(stages, "repository_analyzer", "FAILED", error.message),
      error,
    );
  });

  return { sessionId };
}

export async function reconcileTerminalRepositoryAnalyzerOrchestrations(): Promise<number> {
  const result = await db.execute(sql`
    WITH terminal_jobs AS (
      SELECT DISTINCT ON (r.id)
        r.id AS run_id,
        r.task_id,
        j.id AS job_id,
        j.status AS job_status,
        COALESCE(
          NULLIF(j.error_message, ''),
          'Repository Analyzer job ended without an error message'
        ) AS job_error
      FROM ai_platform.ai_coding_runs AS r
      JOIN ai_platform.ai_coding_tasks AS t
        ON t.id = r.task_id
      JOIN ai_platform.ai_jobs AS j
        ON j.job_type = 'coding_repository_analyzer'
       AND j.payload_json->>'codingRunId' = r.id::text
      WHERE r.agent_name IN ('Coding Orchestrator', 'Incident Auto-Repair')
        AND r.status = 'RUNNING'
        AND t.status = 'ANALYZING'
        AND j.status IN ('failed', 'cancelled')
      ORDER BY r.id, j.id DESC
    ),
    failed_runs AS (
      UPDATE ai_platform.ai_coding_runs AS r
      SET status = 'FAILED',
          finished_at = NOW(),
          error_message = LEFT(
            'Repository Analyzer job ' || terminal_jobs.job_id::text ||
            ' ended as ' || terminal_jobs.job_status || ': ' ||
            terminal_jobs.job_error,
            2000
          ),
          logs = json_build_object(
            'codingTaskId', terminal_jobs.task_id,
            'codingRunId', terminal_jobs.run_id,
            'executionStatus', 'FAILED',
            'error',
              'Repository Analyzer job ' || terminal_jobs.job_id::text ||
              ' ended as ' || terminal_jobs.job_status || ': ' ||
              terminal_jobs.job_error,
            'orchestration', json_build_object(
              'status', 'FAILED',
              'nextAction', 'RETRY_REPOSITORY_ANALYSIS',
              'recoveredTerminalAnalyzerJobId', terminal_jobs.job_id
            )
          )::text
      FROM terminal_jobs
      WHERE r.id = terminal_jobs.run_id
        AND r.status = 'RUNNING'
      RETURNING r.task_id
    )
    UPDATE ai_platform.ai_coding_tasks AS t
    SET status = 'FAILED',
        result_summary = LEFT(
          'Repository Analyzer failed: ' || terminal_jobs.job_error,
          500
        ),
        updated_at = NOW()
    FROM terminal_jobs
    WHERE t.id = terminal_jobs.task_id
      AND EXISTS (
        SELECT 1
        FROM failed_runs
        WHERE failed_runs.task_id = t.id
      )
    RETURNING t.id
  `);

  const rows =
    (result as unknown as { rows?: Array<{ id: string }> }).rows ?? [];
  return rows.length;
}

export async function resumeDeferredCodingOrchestrations(): Promise<number> {
  // Also recover legacy deferrals, which returned without logs or an analyzer
  // job. A grace period avoids competing with a fresh start still bootstrapping
  // its session. Any linked job excludes the run, even after analysis completes:
  // a slow planner must never trigger a second repository analysis.
  const result = await db.execute(sql`
    SELECT r.id AS run_id, r.task_id
    FROM ai_platform.ai_coding_runs AS r
    JOIN ai_platform.ai_coding_tasks AS t ON t.id = r.task_id
    WHERE r.agent_name IN ('Coding Orchestrator', 'Incident Auto-Repair')
      AND r.status = 'RUNNING'
      AND t.status = 'ANALYZING'
      AND (
        r.logs LIKE '%WAIT_REPOSITORY_ANALYZER_SLOT%'
        OR (r.logs IS NULL AND r.started_at < NOW() - INTERVAL '30 seconds')
      )
      AND NOT EXISTS (
        SELECT 1 FROM ai_platform.ai_jobs AS j
        WHERE j.job_type = 'coding_repository_analyzer'
          AND j.payload_json->>'codingRunId' = r.id::text
      )
    ORDER BY r.started_at ASC, r.id ASC
    LIMIT 1
  `);
  const row = result.rows?.[0] as { run_id: string; task_id: string } | undefined;
  if (!row) return 0;

  const [task] = await db.select().from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, row.task_id)).limit(1);
  const [run] = await db.select().from(aiCodingRunsTable)
    .where(and(eq(aiCodingRunsTable.id, row.run_id), eq(aiCodingRunsTable.taskId, row.task_id))).limit(1);
  if (!task || !run || task.status !== "ANALYZING" || run.status !== "RUNNING") return 0;

  await startCodingOrchestration({ task, run });
  return 1;
}

async function recoverDeferredOrchestrations(): Promise<void> {
  if (orchestrationRecoveryRunning) return;
  orchestrationRecoveryRunning = true;
  try {
    try {
      const recovered = await reconcileTerminalRepositoryAnalyzerOrchestrations();
      if (recovered > 0) {
        logger.warn(
          { recovered },
          "[coding-orchestrator] Recovered RUNNING orchestrators whose analyzer job was already terminal",
        );
      }
    } catch (error) {
      logger.warn(
        { err: error },
        "[coding-orchestrator] Terminal analyzer reconciliation will retry",
      );
    }

    try {
      await resumeDeferredCodingOrchestrations();
    } catch (error) {
      logger.warn(
        { err: error },
        "[coding-orchestrator] Deferred analysis recovery will retry",
      );
    }
  } finally {
    orchestrationRecoveryRunning = false;
  }
}

export function startCodingOrchestrationRecoveryRuntime(): void {
  if (orchestrationRecoveryTimer) return;
  orchestrationRecoveryTimer = setInterval(() => void recoverDeferredOrchestrations(), ORCHESTRATION_RECOVERY_POLL_MS);
  orchestrationRecoveryTimer.unref();
  void recoverDeferredOrchestrations();
}

export function stopCodingOrchestrationRecoveryRuntime(): void {
  if (orchestrationRecoveryTimer) clearInterval(orchestrationRecoveryTimer);
  orchestrationRecoveryTimer = null;
}
