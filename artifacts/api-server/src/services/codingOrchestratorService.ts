import { and, eq } from "drizzle-orm";
import {
  aiJobsTable,
  db,
  type AiJob,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  completeRepositoryAnalyzerRun,
  executeRepositoryAnalyzerJob,
  failRepositoryAnalyzerRun,
} from "./repositoryAnalyzerService.js";

export const CODING_ORCHESTRATOR_JOB_TYPE = "coding_orchestrator";

export type CodingOrchestratorStage =
  | "ANALYZE"
  | "PLAN"
  | "CODE"
  | "TEST"
  | "REVIEW";

export interface CodingOrchestratorPlanStage {
  stage: CodingOrchestratorStage;
  agent: string;
  status: "COMPLETED" | "READY" | "PENDING";
}

export interface CodingOrchestratorResult extends Record<string, unknown> {
  codingTaskId: string;
  codingRunId: string;
  executionStatus: "COMPLETED";
  summary: string;
  sourceTarget: string;
  branch: string;
  filesInspected: string[];
  relevantFiles: string[];
  findings: Array<{
    severity: "info" | "warning";
    title: string;
    detail: string;
    file?: string;
  }>;
  recommendedChanges: string[];
  orchestration: {
    version: "1.0";
    currentStage: "ANALYZE";
    nextStage: "PLAN";
    stages: CodingOrchestratorPlanStage[];
  };
}

function buildPlan(): CodingOrchestratorPlanStage[] {
  return [
    { stage: "ANALYZE", agent: "Repository Analyzer", status: "COMPLETED" },
    { stage: "PLAN", agent: "Planning Agent", status: "READY" },
    { stage: "CODE", agent: "Coding Agent", status: "PENDING" },
    { stage: "TEST", agent: "Test Agent", status: "PENDING" },
    { stage: "REVIEW", agent: "Review Agent", status: "PENDING" },
  ];
}

export async function executeCodingOrchestratorJob(
  job: AiJob,
): Promise<CodingOrchestratorResult> {
  const analyzer = await executeRepositoryAnalyzerJob(job);

  const codingTaskId =
    typeof analyzer.codingTaskId === "string" ? analyzer.codingTaskId : null;
  const codingRunId =
    typeof analyzer.codingRunId === "string" ? analyzer.codingRunId : null;
  const summary =
    typeof analyzer.summary === "string"
      ? analyzer.summary
      : "Repository analysis completed.";

  if (!codingTaskId || !codingRunId) {
    throw new Error("Coding Orchestrator analyzer result is missing task/run context");
  }

  return {
    ...analyzer,
    codingTaskId,
    codingRunId,
    executionStatus: "COMPLETED",
    summary,
    sourceTarget:
      typeof analyzer.sourceTarget === "string" ? analyzer.sourceTarget : "",
    branch: typeof analyzer.branch === "string" ? analyzer.branch : "",
    filesInspected: Array.isArray(analyzer.filesInspected)
      ? analyzer.filesInspected.filter((item): item is string => typeof item === "string")
      : [],
    relevantFiles: Array.isArray(analyzer.relevantFiles)
      ? analyzer.relevantFiles.filter((item): item is string => typeof item === "string")
      : [],
    findings: Array.isArray(analyzer.findings)
      ? analyzer.findings as CodingOrchestratorResult["findings"]
      : [],
    recommendedChanges: Array.isArray(analyzer.recommendedChanges)
      ? analyzer.recommendedChanges.filter((item): item is string => typeof item === "string")
      : [],
    orchestration: {
      version: "1.0",
      currentStage: "ANALYZE",
      nextStage: "PLAN",
      stages: buildPlan(),
    },
  };
}

export async function completeCodingOrchestratorRun(
  result: Record<string, unknown>,
): Promise<void> {
  await completeRepositoryAnalyzerRun(result);
}

export async function failCodingOrchestratorRun(
  payload: Record<string, unknown>,
  errorMessage: string,
): Promise<void> {
  await failRepositoryAnalyzerRun(payload, errorMessage);
}

export async function executeCodingOrchestratorJobOnDemand(
  job: AiJob,
): Promise<void> {
  if (job.jobType !== CODING_ORCHESTRATOR_JOB_TYPE) {
    logger.warn(
      { jobId: job.id, jobType: job.jobType },
      "[coding-orchestrator] Ignoring non-orchestrator on-demand job",
    );
    return;
  }

  const startedAt = new Date();
  const [claimed] = await db
    .update(aiJobsTable)
    .set({
      status: "running",
      startedAt,
      updatedAt: startedAt,
    })
    .where(and(eq(aiJobsTable.id, job.id), eq(aiJobsTable.status, "queued")))
    .returning();

  if (!claimed) {
    logger.info(
      { jobId: job.id },
      "[coding-orchestrator] Job already claimed by another executor",
    );
    return;
  }

  try {
    const result = await executeCodingOrchestratorJob(claimed);
    await completeCodingOrchestratorRun(result);

    const completedAt = new Date();
    await db
      .update(aiJobsTable)
      .set({
        status: "completed",
        resultJson: result,
        completedAt,
        actualDuration: completedAt.getTime() - startedAt.getTime(),
        errorMessage: null,
        updatedAt: completedAt,
      })
      .where(and(eq(aiJobsTable.id, claimed.id), eq(aiJobsTable.status, "running")));

    logger.info(
      {
        jobId: claimed.id,
        codingRunId: result.codingRunId,
        nextStage: result.orchestration.nextStage,
      },
      "[coding-orchestrator] Analyze stage completed",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = new Date();

    await failCodingOrchestratorRun(
      (claimed.payloadJson ?? {}) as Record<string, unknown>,
      message,
    ).catch((persistError) => {
      logger.error(
        { err: persistError, jobId: claimed.id },
        "[coding-orchestrator] Failed to persist orchestrator failure",
      );
    });

    await db
      .update(aiJobsTable)
      .set({
        status: "failed",
        completedAt,
        actualDuration: completedAt.getTime() - startedAt.getTime(),
        errorMessage: message.slice(0, 2000),
        updatedAt: completedAt,
      })
      .where(and(eq(aiJobsTable.id, claimed.id), eq(aiJobsTable.status, "running")))
      .catch((persistError) => {
        logger.error(
          { err: persistError, jobId: claimed.id },
          "[coding-orchestrator] Failed to persist failed job state",
        );
      });

    logger.error(
      { err: error, jobId: claimed.id },
      "[coding-orchestrator] Execution failed",
    );
  }
}
