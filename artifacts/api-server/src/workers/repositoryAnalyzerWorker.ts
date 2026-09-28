import { and, eq } from "drizzle-orm";
import { aiCodingRunsTable, aiCodingTasksTable, aiJobsTable, db } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { continueCodingOrchestration } from "../services/codingOrchestratorService.js";

async function main(): Promise<void> {
  const rawJobId = process.argv[2];
  const jobId = Number(rawJobId);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error("Repository Analyzer worker requires a valid queued job id");
  }

  const [job] = await db.select().from(aiJobsTable).where(eq(aiJobsTable.id, jobId));
  if (!job || job.jobType !== "coding_repository_analyzer" || job.status !== "queued") {
    throw new Error(`Repository Analyzer job ${jobId} is not an available queued analyzer job`);
  }

  const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
  const taskId = typeof payload["codingTaskId"] === "string" ? payload["codingTaskId"] : null;
  const runId = typeof payload["codingRunId"] === "string" ? payload["codingRunId"] : null;
  const sessionId = typeof payload["orchestratorSessionId"] === "string"
    ? payload["orchestratorSessionId"]
    : null;
  if (!taskId || !runId || !sessionId) {
    throw new Error(`Repository Analyzer job ${jobId} is missing orchestration identifiers`);
  }

  const [[task], [run]] = await Promise.all([
    db.select().from(aiCodingTasksTable).where(eq(aiCodingTasksTable.id, taskId)),
    db.select().from(aiCodingRunsTable).where(
      and(eq(aiCodingRunsTable.id, runId), eq(aiCodingRunsTable.taskId, taskId)),
    ),
  ]);
  if (!task || !run) {
    throw new Error(`Repository Analyzer job ${jobId} references missing task/run state`);
  }

  const stages = [
    { id: "repository_analyzer" as const, label: "Repository Analyzer", status: "PENDING" as const },
    {
      id: "planner" as const,
      label: "Local Deterministic Planner",
      status: "PENDING" as const,
      detail: "Matches only explicit safe local edit recipes; no AI/LLM.",
    },
    {
      id: "coding" as const,
      label: "Local Coding Executor",
      status: "PENDING" as const,
      detail: "Produces a review-only patch in an isolated temporary clone when a deterministic recipe matches.",
    },
    {
      id: "testing" as const,
      label: "Local Verification",
      status: "BLOCKED" as const,
      detail: "Repository scripts remain fail-closed until the workspace is explicitly trusted.",
    },
    {
      id: "review" as const,
      label: "Review",
      status: "BLOCKED" as const,
      detail: "Review is required before a local patch can be applied to a repository branch.",
    },
  ];

  await continueCodingOrchestration({ task, run }, sessionId, job, stages);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ err: error }, "[repository-analyzer-worker] Dedicated process failed");
    process.exit(1);
  });
