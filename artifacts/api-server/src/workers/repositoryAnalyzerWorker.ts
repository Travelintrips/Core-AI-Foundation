import { and, eq } from "drizzle-orm";
import { aiCodingRunsTable, aiCodingTasksTable, aiJobsTable, db } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { continueCodingOrchestration } from "../services/codingOrchestratorService.js";

const POLL_INTERVAL_MS = Math.max(500, Number.parseInt(process.env.REPOSITORY_ANALYZER_POLL_MS ?? "2000", 10) || 2000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processJob(jobId: number): Promise<void> {
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

async function nextQueuedJobId(): Promise<number | null> {
  const [job] = await db
    .select({ id: aiJobsTable.id })
    .from(aiJobsTable)
    .where(and(
      eq(aiJobsTable.jobType, "coding_repository_analyzer"),
      eq(aiJobsTable.status, "queued"),
    ))
    .limit(1);
  return job?.id ?? null;
}

async function main(): Promise<void> {
  const rawJobId = process.argv[2];
  if (rawJobId) {
    const jobId = Number(rawJobId);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new Error("Repository Analyzer worker requires a valid queued job id");
    }
    await processJob(jobId);
    return;
  }

  logger.info(
    { pollIntervalMs: POLL_INTERVAL_MS },
    "[repository-analyzer-worker] Remote durable worker started",
  );

  for (;;) {
    const jobId = await nextQueuedJobId();
    if (!jobId) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    try {
      await processJob(jobId);
    } catch (error) {
      logger.error(
        { err: error, jobId },
        "[repository-analyzer-worker] Remote job failed; continuing poll loop",
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ err: error }, "[repository-analyzer-worker] Dedicated process failed");
    process.exit(1);
  });
