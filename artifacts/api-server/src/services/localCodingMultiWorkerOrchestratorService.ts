import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  aiCodingRunsTable,
  aiCodingTaskGraphsTable,
  aiCodingTasksTable,
  aiCodingWorkstreamDependenciesTable,
  aiCodingWorkstreamsTable,
  db,
  type AiCodingTaskGraph,
  type AiCodingWorkstream,
  type AiJob,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { enqueue } from "./queueManagerService.js";
import {
  completeRepositoryAnalyzerRun,
  executeRepositoryAnalyzerJob,
  failRepositoryAnalyzerRun,
} from "./repositoryAnalyzerService.js";

export const CODING_WORKSTREAM_JOB_TYPE = "coding_workstream_execution";
export const CODING_WORKSTREAM_CAPABILITY = "coding_workstream";
export const DEFAULT_MULTI_WORKER_CONCURRENCY = 4;
export const MAX_MULTI_WORKER_CONCURRENCY = 8;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class LocalCodingMultiWorkerError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "NOT_READY"
      | "INVALID_PAYLOAD"
      | "OWNERSHIP_VIOLATION"
      | "DISPATCH_FAILED",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LocalCodingMultiWorkerError";
  }
}

interface WorkstreamJobPayload {
  graphId: string;
  workstreamId: string;
  workstreamKey: string;
  codingTaskId: string;
  codingRunId: string;
  repository: string;
  branch: string;
  title: string;
  description: string;
  ownershipPaths: string[];
}

interface ClaimedWorkstream {
  graph: AiCodingTaskGraph;
  workstream: AiCodingWorkstream;
  childTaskId: string;
  childRunId: string;
  repository: string;
  baseBranch: string;
  title: string;
  description: string;
  ownershipPaths: string[];
}

export interface MultiWorkerScheduleResult {
  graphId: string;
  graphStatus: string;
  dispatched: Array<{
    workstreamId: string;
    workstreamKey: string;
    childTaskId: string;
    childRunId: string;
    jobId: number;
    branchName: string | null;
  }>;
  manualReview: Array<{
    workstreamId: string;
    workstreamKey: string;
  }>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function boundedConcurrency(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return DEFAULT_MULTI_WORKER_CONCURRENCY;
  }
  return Math.max(1, Math.min(MAX_MULTI_WORKER_CONCURRENCY, Math.floor(value)));
}

function sanitizeBranchPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/..+/g, ".")
    .slice(0, 48) || "task";
}

export function buildCodingWorkstreamBranchName(
  taskNumber: string,
  graphVersion: number,
  workstreamKey: string,
): string {
  return (
    "ai-workstream/" +
    sanitizeBranchPart(taskNumber) +
    "/v" +
    String(graphVersion) +
    "-" +
    sanitizeBranchPart(workstreamKey)
  );
}

function buildWorkstreamInstruction(
  workstream: AiCodingWorkstream,
  ownershipPaths: string[],
): string {
  const acceptance = stringArray(workstream.acceptanceCriteria);
  const verification = stringArray(workstream.verificationProfiles);
  return [
    workstream.instruction,
    "",
    "Multi-worker ownership boundary:",
    ...ownershipPaths.map((path) => "- " + path),
    "",
    "Do not modify files outside the ownership boundary above.",
    "Do not merge, push, or bypass the existing review and sandbox gates.",
    "",
    "Acceptance criteria:",
    ...acceptance.map((item) => "- " + item),
    ...(verification.length > 0
      ? ["", "Verification profiles:", ...verification.map((item) => "- " + item)]
      : []),
  ].join("\n");
}

function parseWorkstreamPayload(job: AiJob): WorkstreamJobPayload {
  const payload =
    job.payloadJson && typeof job.payloadJson === "object"
      ? (job.payloadJson as Record<string, unknown>)
      : {};

  const requiredUuid = (key: string): string => {
    const value = typeof payload[key] === "string" ? String(payload[key]).trim() : "";
    if (!UUID_RE.test(value)) {
      throw new LocalCodingMultiWorkerError(
        `Workstream job payload '${key}' must be a UUID.`,
        "INVALID_PAYLOAD",
      );
    }
    return value;
  };
  const requiredString = (key: string): string => {
    const value = typeof payload[key] === "string" ? String(payload[key]).trim() : "";
    if (!value) {
      throw new LocalCodingMultiWorkerError(
        `Workstream job payload '${key}' is required.`,
        "INVALID_PAYLOAD",
      );
    }
    return value;
  };

  const ownershipPaths = stringArray(payload.ownershipPaths);
  if (ownershipPaths.length === 0) {
    throw new LocalCodingMultiWorkerError(
      "Automatic workstream execution requires at least one ownership path.",
      "INVALID_PAYLOAD",
    );
  }

  return {
    graphId: requiredUuid("graphId"),
    workstreamId: requiredUuid("workstreamId"),
    workstreamKey: requiredString("workstreamKey"),
    codingTaskId: requiredUuid("codingTaskId"),
    codingRunId: requiredUuid("codingRunId"),
    repository: requiredString("repository"),
    branch: requiredString("branch"),
    title: requiredString("title"),
    description: requiredString("description"),
    ownershipPaths,
  };
}

function globPatternToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        out += ".*";
        index += 1;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    out += /[\\^$+?.()|{}\[\]]/.test(char) ? "\\" + char : char;
  }
  out += "$";
  return new RegExp(out);
}

export function workstreamOwnsFile(
  filePath: string,
  ownershipPaths: string[],
): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return false;
  }

  return ownershipPaths.some((raw) => {
    const pattern = raw.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!pattern) return false;
    if (!/[?*]/.test(pattern)) {
      return normalized === pattern || normalized.startsWith(pattern + "/");
    }
    return globPatternToRegExp(pattern).test(normalized);
  });
}

function localExecutionChangedFiles(result: Record<string, unknown>): string[] {
  const localExecution =
    result.localExecution &&
    typeof result.localExecution === "object" &&
    !Array.isArray(result.localExecution)
      ? (result.localExecution as Record<string, unknown>)
      : null;
  return localExecution ? stringArray(localExecution.changedFiles) : [];
}

function contextHeadSha(result: Record<string, unknown>): string | null {
  const context =
    result.contextPackage &&
    typeof result.contextPackage === "object" &&
    !Array.isArray(result.contextPackage)
      ? (result.contextPackage as Record<string, unknown>)
      : null;
  const headSha = context?.headSha;
  return typeof headSha === "string" && /^[0-9a-f]{40}$/i.test(headSha)
    ? headSha.toLowerCase()
    : null;
}

async function markDispatchFailure(
  claim: ClaimedWorkstream,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(aiCodingWorkstreamsTable)
      .set({
        status: "FAILED",
        errorMessage: message.slice(0, 2000),
        completedAt: now,
      })
      .where(eq(aiCodingWorkstreamsTable.id, claim.workstream.id));

    await tx
      .update(aiCodingRunsTable)
      .set({
        status: "FAILED",
        finishedAt: now,
        errorMessage: message.slice(0, 2000),
      })
      .where(eq(aiCodingRunsTable.id, claim.childRunId));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "FAILED",
        resultSummary: `Multi-worker dispatch failed: ${message.slice(0, 500)}`,
      })
      .where(eq(aiCodingTasksTable.id, claim.childTaskId));
  });
}

async function claimReadyWorkstreams(
  taskId: string,
  maxParallel: number,
): Promise<{
  graph: AiCodingTaskGraph;
  claims: ClaimedWorkstream[];
  manualReview: AiCodingWorkstream[];
}> {
  const concurrency = boundedConcurrency(maxParallel);

  return db.transaction(async (tx) => {
    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.taskId, taskId))
      .orderBy(desc(aiCodingTaskGraphsTable.version))
      .limit(1)
      .for("update");

    if (!graph) {
      throw new LocalCodingMultiWorkerError(
        "No coding task graph exists for this task.",
        "NOT_FOUND",
      );
    }
    if (!["APPROVED", "RUNNING"].includes(graph.status)) {
      throw new LocalCodingMultiWorkerError(
        "Multi-worker execution requires an explicitly APPROVED task graph.",
        "NOT_READY",
        { graphId: graph.id, status: graph.status },
      );
    }

    const [parentTask] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId));
    if (!parentTask) {
      throw new LocalCodingMultiWorkerError(
        "Parent coding task was not found.",
        "NOT_FOUND",
      );
    }

    const [workstreams, dependencies] = await Promise.all([
      tx
        .select()
        .from(aiCodingWorkstreamsTable)
        .where(eq(aiCodingWorkstreamsTable.graphId, graph.id)),
      tx
        .select()
        .from(aiCodingWorkstreamDependenciesTable)
        .where(eq(aiCodingWorkstreamDependenciesTable.graphId, graph.id)),
    ]);

    const keyById = new Map(
      workstreams.map((item) => [item.id, item.workstreamKey]),
    );
    const dependenciesByKey = new Map<string, string[]>();
    for (const dependency of dependencies) {
      const key = keyById.get(dependency.workstreamId);
      const dependsOn = keyById.get(dependency.dependsOnWorkstreamId);
      if (!key || !dependsOn) continue;
      const list = dependenciesByKey.get(key) ?? [];
      list.push(dependsOn);
      dependenciesByKey.set(key, list);
    }

    const completed = new Set(
      workstreams
        .filter((item) => item.status === "COMPLETED")
        .map((item) => item.workstreamKey),
    );
    const active = workstreams.filter((item) =>
      ["CLAIMED", "RUNNING"].includes(item.status),
    ).length;
    const capacity = Math.max(0, concurrency - active);

    const ready = workstreams
      .filter((item) => {
        if (!["PENDING", "READY"].includes(item.status)) return false;
        const deps = dependenciesByKey.get(item.workstreamKey) ?? [];
        return deps.every((dependency) => completed.has(dependency));
      })
      .sort((left, right) => {
        if (right.priority !== left.priority) return right.priority - left.priority;
        return left.workstreamKey.localeCompare(right.workstreamKey);
      });

    const manualReview: AiCodingWorkstream[] = [];
    const automatic: AiCodingWorkstream[] = [];
    for (const workstream of ready) {
      if (stringArray(workstream.ownershipPaths).length === 0) {
        manualReview.push(workstream);
      } else {
        automatic.push(workstream);
      }
    }

    const now = new Date();
    for (const workstream of manualReview) {
      await tx
        .update(aiCodingWorkstreamsTable)
        .set({
          status: "REVIEW_REQUIRED",
          errorMessage:
            "This dependency-ready workstream has no automatic ownership paths and requires explicit integration review.",
        })
        .where(
          and(
            eq(aiCodingWorkstreamsTable.id, workstream.id),
            inArray(aiCodingWorkstreamsTable.status, ["PENDING", "READY"]),
          ),
        );
    }

    const claims: ClaimedWorkstream[] = [];
    for (const workstream of automatic.slice(0, capacity)) {
      const childTaskNumber =
        "MW-" +
        parentTask.taskNumber +
        "-V" +
        String(graph.version) +
        "-" +
        workstream.workstreamKey;
      const branchName = buildCodingWorkstreamBranchName(
        parentTask.taskNumber,
        graph.version,
        workstream.workstreamKey,
      );
      const ownershipPaths = stringArray(workstream.ownershipPaths);
      const description = buildWorkstreamInstruction(
        workstream,
        ownershipPaths,
      );

      const [childTask] = await tx
        .insert(aiCodingTasksTable)
        .values({
          taskNumber: childTaskNumber,
          projectName:
            parentTask.projectName +
            " / " +
            workstream.workstreamKey +
            " " +
            workstream.title,
          repository: parentTask.repository,
          branch: parentTask.branch,
          instruction: description,
          status: "ANALYZING",
          priority: workstream.priority,
        })
        .returning();

      if (!childTask) {
        throw new LocalCodingMultiWorkerError(
          "Failed to create child coding task for workstream.",
          "DISPATCH_FAILED",
          { workstreamId: workstream.id },
        );
      }

      const [childRun] = await tx
        .insert(aiCodingRunsTable)
        .values({
          taskId: childTask.id,
          agentName: "Multi-Worker " + workstream.workstreamKey,
          status: "RUNNING",
          startedAt: now,
        })
        .returning();

      if (!childRun) {
        throw new LocalCodingMultiWorkerError(
          "Failed to create child coding run for workstream.",
          "DISPATCH_FAILED",
          { workstreamId: workstream.id },
        );
      }

      const [claimed] = await tx
        .update(aiCodingWorkstreamsTable)
        .set({
          status: "CLAIMED",
          branchName,
          childTaskId: childTask.id,
          childRunId: childRun.id,
          claimedAt: now,
          attemptCount: sql`${aiCodingWorkstreamsTable.attemptCount} + 1`,
          errorMessage: null,
        })
        .where(
          and(
            eq(aiCodingWorkstreamsTable.id, workstream.id),
            inArray(aiCodingWorkstreamsTable.status, ["PENDING", "READY"]),
          ),
        )
        .returning();

      if (!claimed) {
        throw new LocalCodingMultiWorkerError(
          "Workstream claim lost a concurrency race.",
          "DISPATCH_FAILED",
          { workstreamId: workstream.id },
        );
      }

      claims.push({
        graph,
        workstream: claimed,
        childTaskId: childTask.id,
        childRunId: childRun.id,
        repository: parentTask.repository,
        baseBranch: parentTask.branch,
        title: childTask.projectName,
        description,
        ownershipPaths,
      });
    }

    if (graph.status === "APPROVED" && (claims.length > 0 || manualReview.length > 0)) {
      const [updatedGraph] = await tx
        .update(aiCodingTaskGraphsTable)
        .set({
          status: "RUNNING",
          startedAt: graph.startedAt ?? now,
        })
        .where(eq(aiCodingTaskGraphsTable.id, graph.id))
        .returning();
      if (updatedGraph) {
        return { graph: updatedGraph, claims, manualReview };
      }
    }

    return { graph, claims, manualReview };
  });
}

export async function scheduleReadyCodingWorkstreams(
  taskId: string,
  maxParallel = DEFAULT_MULTI_WORKER_CONCURRENCY,
): Promise<MultiWorkerScheduleResult> {
  const claimed = await claimReadyWorkstreams(
    taskId,
    boundedConcurrency(maxParallel),
  );
  const dispatched: MultiWorkerScheduleResult["dispatched"] = [];

  for (const claim of claimed.claims) {
    try {
      const job = await enqueue({
        jobType: CODING_WORKSTREAM_JOB_TYPE,
        requiredCapability: CODING_WORKSTREAM_CAPABILITY,
        priority: claim.workstream.priority,
        maxRetry: 0,
        retryStrategy: "manual",
        payloadJson: {
          graphId: claim.graph.id,
          workstreamId: claim.workstream.id,
          workstreamKey: claim.workstream.workstreamKey,
          codingTaskId: claim.childTaskId,
          codingRunId: claim.childRunId,
          repository: claim.repository,
          branch: claim.baseBranch,
          title: claim.title,
          description: claim.description,
          ownershipPaths: claim.ownershipPaths,
        },
      });

      const [running] = await db
        .update(aiCodingWorkstreamsTable)
        .set({
          status: "RUNNING",
          jobId: job.id,
          startedAt: new Date(),
          workerId: null,
        })
        .where(
          and(
            eq(aiCodingWorkstreamsTable.id, claim.workstream.id),
            eq(aiCodingWorkstreamsTable.status, "CLAIMED"),
          ),
        )
        .returning();

      if (!running) {
        throw new Error("Workstream state changed before queue job binding.");
      }

      dispatched.push({
        workstreamId: running.id,
        workstreamKey: running.workstreamKey,
        childTaskId: claim.childTaskId,
        childRunId: claim.childRunId,
        jobId: job.id,
        branchName: running.branchName,
      });

      await logAudit(
        "coding-multi-worker",
        "workstream_dispatched",
        running.id,
        "coding_workstream",
        "success",
        {
          graphId: claim.graph.id,
          workstreamKey: running.workstreamKey,
          childTaskId: claim.childTaskId,
          childRunId: claim.childRunId,
          jobId: job.id,
          ownershipPaths: claim.ownershipPaths,
        },
      ).catch(() => undefined);
    } catch (error) {
      await markDispatchFailure(claim, error);
    }
  }

  return {
    graphId: claimed.graph.id,
    graphStatus: claimed.graph.status,
    dispatched,
    manualReview: claimed.manualReview.map((item) => ({
      workstreamId: item.id,
      workstreamKey: item.workstreamKey,
    })),
  };
}

export async function startApprovedCodingTaskGraph(
  taskId: string,
  maxParallel = DEFAULT_MULTI_WORKER_CONCURRENCY,
): Promise<MultiWorkerScheduleResult> {
  return scheduleReadyCodingWorkstreams(taskId, maxParallel);
}

export async function executeCodingWorkstreamJob(
  job: AiJob,
): Promise<Record<string, unknown>> {
  const payload = parseWorkstreamPayload(job);
  try {
    const result = await executeRepositoryAnalyzerJob(job);
    const changedFiles = localExecutionChangedFiles(result);
    const outsideOwnership = changedFiles.filter(
      (file) => !workstreamOwnsFile(file, payload.ownershipPaths),
    );

    if (outsideOwnership.length > 0) {
      throw new LocalCodingMultiWorkerError(
        "Workstream local patch attempted to change files outside its ownership boundary.",
        "OWNERSHIP_VIOLATION",
        {
          workstreamId: payload.workstreamId,
          outsideOwnership,
          ownershipPaths: payload.ownershipPaths,
        },
      );
    }

    await completeRepositoryAnalyzerRun(result);
    const [updated] = await db
      .update(aiCodingWorkstreamsTable)
      .set({
        status: "REVIEW_REQUIRED",
        resultJson: result,
        baseSha: contextHeadSha(result),
        errorMessage: null,
      })
      .where(eq(aiCodingWorkstreamsTable.id, payload.workstreamId))
      .returning();

    if (!updated) {
      throw new LocalCodingMultiWorkerError(
        "Workstream disappeared before analyzer completion.",
        "NOT_FOUND",
      );
    }

    return {
      ...result,
      graphId: payload.graphId,
      workstreamId: payload.workstreamId,
      workstreamKey: payload.workstreamKey,
      ownershipValidated: true,
      nextAction: "REVIEW_WORKSTREAM",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failCodingWorkstreamExecution(
      job.payloadJson as Record<string, unknown>,
      message,
    ).catch(() => undefined);
    throw error;
  }
}

export async function failCodingWorkstreamExecution(
  payload: Record<string, unknown>,
  errorMessage: string,
): Promise<void> {
  const workstreamId =
    typeof payload.workstreamId === "string" ? payload.workstreamId : null;
  const message = errorMessage.slice(0, 2000);

  await failRepositoryAnalyzerRun(payload, message).catch(() => undefined);

  if (!workstreamId || !UUID_RE.test(workstreamId)) return;

  await db
    .update(aiCodingWorkstreamsTable)
    .set({
      status: "FAILED",
      errorMessage: message,
      completedAt: new Date(),
    })
    .where(eq(aiCodingWorkstreamsTable.id, workstreamId));
}

export async function reconcileCodingTaskGraph(
  taskId: string,
  maxParallel = DEFAULT_MULTI_WORKER_CONCURRENCY,
): Promise<MultiWorkerScheduleResult> {
  const snapshot = await db.transaction(async (tx) => {
    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.taskId, taskId))
      .orderBy(desc(aiCodingTaskGraphsTable.version))
      .limit(1)
      .for("update");

    if (!graph) {
      throw new LocalCodingMultiWorkerError(
        "No coding task graph exists for this task.",
        "NOT_FOUND",
      );
    }

    const workstreams = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.graphId, graph.id));

    const childTaskIds = workstreams
      .map((item) => item.childTaskId)
      .filter((value): value is string => Boolean(value));

    const childTasks =
      childTaskIds.length > 0
        ? await tx
            .select()
            .from(aiCodingTasksTable)
            .where(inArray(aiCodingTasksTable.id, childTaskIds))
        : [];
    const taskById = new Map(childTasks.map((item) => [item.id, item]));

    const now = new Date();
    for (const workstream of workstreams) {
      if (!workstream.childTaskId) continue;
      const child = taskById.get(workstream.childTaskId);
      if (!child) continue;

      if (child.status === "COMPLETED" && workstream.status !== "COMPLETED") {
        await tx
          .update(aiCodingWorkstreamsTable)
          .set({
            status: "COMPLETED",
            completedAt: now,
            errorMessage: null,
          })
          .where(eq(aiCodingWorkstreamsTable.id, workstream.id));
      } else if (child.status === "FAILED" && workstream.status !== "FAILED") {
        await tx
          .update(aiCodingWorkstreamsTable)
          .set({
            status: "FAILED",
            completedAt: now,
            errorMessage:
              child.resultSummary ?? "Child coding task failed.",
          })
          .where(eq(aiCodingWorkstreamsTable.id, workstream.id));
      } else if (
        ["READY_REVIEW", "PR_CREATED"].includes(child.status) &&
        !["COMPLETED", "FAILED"].includes(workstream.status)
      ) {
        await tx
          .update(aiCodingWorkstreamsTable)
          .set({ status: "REVIEW_REQUIRED" })
          .where(eq(aiCodingWorkstreamsTable.id, workstream.id));
      }
    }

    const refreshed = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.graphId, graph.id));

    if (refreshed.some((item) => item.status === "FAILED")) {
      const [failedGraph] = await tx
        .update(aiCodingTaskGraphsTable)
        .set({ status: "FAILED", completedAt: now })
        .where(eq(aiCodingTaskGraphsTable.id, graph.id))
        .returning();
      return { graph: failedGraph ?? graph, terminal: true };
    }

    if (
      refreshed.length > 0 &&
      refreshed.every((item) => item.status === "COMPLETED")
    ) {
      const [completedGraph] = await tx
        .update(aiCodingTaskGraphsTable)
        .set({ status: "COMPLETED", completedAt: now })
        .where(eq(aiCodingTaskGraphsTable.id, graph.id))
        .returning();
      return { graph: completedGraph ?? graph, terminal: true };
    }

    return { graph, terminal: false };
  });

  if (snapshot.terminal) {
    return {
      graphId: snapshot.graph.id,
      graphStatus: snapshot.graph.status,
      dispatched: [],
      manualReview: [],
    };
  }

  return scheduleReadyCodingWorkstreams(taskId, maxParallel);
}

export async function completeManualCodingWorkstream(
  taskId: string,
  workstreamId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.taskId, taskId))
      .orderBy(desc(aiCodingTaskGraphsTable.version))
      .limit(1)
      .for("update");

    if (!graph) {
      throw new LocalCodingMultiWorkerError(
        "No coding task graph exists for this task.",
        "NOT_FOUND",
      );
    }

    const [workstream] = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(
        and(
          eq(aiCodingWorkstreamsTable.id, workstreamId),
          eq(aiCodingWorkstreamsTable.graphId, graph.id),
        ),
      )
      .for("update");

    if (!workstream) {
      throw new LocalCodingMultiWorkerError(
        "Coding workstream was not found.",
        "NOT_FOUND",
      );
    }
    if (workstream.status !== "REVIEW_REQUIRED") {
      throw new LocalCodingMultiWorkerError(
        "Only REVIEW_REQUIRED workstreams can be explicitly completed.",
        "NOT_READY",
        { status: workstream.status },
      );
    }

    await tx
      .update(aiCodingWorkstreamsTable)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(aiCodingWorkstreamsTable.id, workstream.id));
  });
}
