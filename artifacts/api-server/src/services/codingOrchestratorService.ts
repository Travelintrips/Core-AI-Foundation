import { eq } from "drizzle-orm";
import {
  aiCodingRunsTable,
  aiCodingTasksTable,
  aiOrchestratorSessionsTable,
  db,
  type AiCodingRun,
  type AiCodingTask,
  type AiJob,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { logAudit } from "./aiAuditService.js";
import { executeAI, type ExecutionOutput } from "./aiExecutionService.js";
import { getFallbackModels, routeToModel } from "./aiModelRouter.js";
import { enqueue } from "./queueManagerService.js";
import { executeRepositoryAnalyzerJobOnDemand } from "./repositoryAnalyzerService.js";
import { generateAndPersistCodingMultiTaskPlan } from "./localCodingAutomatedMultiTaskPlannerService.js";

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

async function persistSnapshot(
  runId: string,
  taskId: string,
  payload: Record<string, unknown>,
  taskStatus: string,
  summary?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(aiCodingRunsTable)
      .set({ logs: stringify(payload) })
      .where(eq(aiCodingRunsTable.id, runId));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: taskStatus,
        ...(summary !== undefined ? { resultSummary: summary } : {}),
      })
      .where(eq(aiCodingTasksTable.id, taskId));
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
  const nextAction =
    localExecution?.status === "APPLIED"
      ? "REVIEW_LOCAL_PATCH"
      : aiEscalation
        ? "APPROVE_TASK_GRAPH"
        : localPlan?.status === "AI_REQUIRED"
          ? "AI_REQUIRED"
          : "REVIEW_LOCAL_CONTEXT";
  const summary =
    nextAction === "REVIEW_LOCAL_PATCH"
      ? `${analysisSummary} A deterministic local patch is ready for review; repository scripts were not executed. No AI/LLM was invoked.`
      : nextAction === "APPROVE_TASK_GRAPH"
        ? `${analysisSummary} The deterministic executor declined to guess, so the bounded AI planner generated a PREPARED task graph. Explicit task-graph approval is required before any worker or coding-model execution; no patch, commit, push, or merge was performed.`
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

  await db.transaction(async (tx) => {
    await tx
      .update(aiCodingRunsTable)
      .set({
        status: "COMPLETED",
        finishedAt: completedAt,
        logs: stringify(result),
        errorMessage: null,
      })
      .where(eq(aiCodingRunsTable.id, input.run.id));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "READY_REVIEW",
        resultSummary: summary,
      })
      .where(eq(aiCodingTasksTable.id, input.task.id));

    await tx
      .update(aiOrchestratorSessionsTable)
      .set({
        totalTokens: aiEscalation?.model.totalTokens ?? 0,
        totalRequests: aiEscalation ? 1 : 0,
        lastModelUsed: aiEscalation?.model.model ?? null,
      })
      .where(eq(aiOrchestratorSessionsTable.sessionId, sessionId));
  });

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

async function continueCodingOrchestration(
  input: CodingOrchestrationInput,
  sessionId: string,
  queuedJob: AiJob,
  initialStages: CodingStage[],
): Promise<void> {
  let stages = initialStages;
  try {
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
    if (!analysis) {
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

    const aiEscalation =
      localPlan?.status === "AI_REQUIRED"
        ? await generateAndPersistCodingMultiTaskPlan(input.task.id)
        : undefined;

    await completeLocalAnalysis(input, sessionId, stages, analysis, aiEscalation);

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

/**
 * Starts a bounded Coding Orchestrator run.
 *
 * The production global dispatcher remains fail-closed. The orchestrator only
 * executes work created by this explicit Run Agent request. The local analyzer
 * may also produce a deterministic review-only patch inside its isolated clone.
 * Semantic tasks are marked AI_REQUIRED rather than guessed. AI_REQUIRED is
 * escalated through the bounded multi-task planner into a PREPARED task graph;
 * explicit task-graph approval remains mandatory before worker/model coding
 * execution. Repository scripts and direct repository writes remain fail-closed.
 */
export async function startCodingOrchestration(
  input: CodingOrchestrationInput,
): Promise<{ sessionId: string }> {
  const sessionId = `coding-${input.run.id}`;
  const stages = initStages();

  await db.insert(aiOrchestratorSessionsTable).values({
    sessionId,
    agentId: "coding-orchestrator",
    totalTokens: 0,
    totalRequests: 0,
    lastModelUsed: null,
  });

  await logAudit(
    "coding-orchestrator",
    "pipeline_started",
    input.task.id,
    "coding_task",
    "success",
    { sessionId, codingRunId: input.run.id },
  );

  let queuedJob: AiJob;
  try {
    queuedJob = await enqueue({
      jobType: "coding_repository_analyzer",
      requiredCapability: "coding_repository_analyzer",
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

  void continueCodingOrchestration(input, sessionId, queuedJob, stages);
  return { sessionId };
}
