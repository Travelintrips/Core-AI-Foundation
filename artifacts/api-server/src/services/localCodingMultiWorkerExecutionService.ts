import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  aiCodingRunsTable,
  aiCodingTaskGraphsTable,
  aiCodingTasksTable,
  aiCodingWorkstreamDependenciesTable,
  aiCodingWorkstreamsTable,
  aiJobsTable,
  db,
  type AiCodingWorkstream,
  type AiJob,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { computePriorityScore } from "./priorityEngine.js";
import {
  completeRepositoryAnalyzerRun,
  executeRepositoryAnalyzerJob,
  failRepositoryAnalyzerRun,
} from "./repositoryAnalyzerService.js";
import {
  claimReadyCodingWorkstreams,
  heartbeatCodingWorkstreamClaim,
  LocalCodingMultiWorkerError,
  markCodingWorkstreamReviewRequired,
  selectClaimableCodingWorkstreams,
  startCodingWorkstreamClaim,
  type CodingWorkstreamClaim,
} from "./localCodingMultiWorkerOrchestratorService.js";

export const CODING_WORKSTREAM_JOB_TYPE = "coding_workstream_execution";
export const CODING_WORKSTREAM_CAPABILITY = "coding_workstream";

const DEFAULT_HEARTBEAT_MS = 30_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/i;

export interface DispatchCodingWorkstreamsOptions {
  workerPoolId?: string;
  maxParallel?: number;
  leaseSeconds?: number;
  baseSha: string;
}

export interface CodingWorkstreamDispatch {
  workstreamId: string;
  workstreamKey: string;
  childTaskId: string;
  childRunId: string;
  jobId: number;
  jobCode: string;
  branchName: string;
  leaseExpiresAt: string;
}

export interface CodingWorkstreamDispatchResult {
  graphId: string;
  graphStatus: string;
  dispatched: CodingWorkstreamDispatch[];
  manualReview: Array<{
    workstreamId: string;
    workstreamKey: string;
  }>;
}

interface WorkstreamJobPayload {
  graphId: string;
  workstreamId: string;
  workstreamKey: string;
  leaseToken: string;
  codingTaskId: string;
  codingRunId: string;
  repository: string;
  branch: string;
  title: string;
  description: string;
  ownershipPaths: string[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function validateBaseSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_RE.test(normalized)) {
    throw new LocalCodingMultiWorkerError(
      "baseSha must be a 40-character Git SHA.",
      "INVALID_INPUT",
    );
  }
  return normalized;
}

function ownershipDescription(workstream: AiCodingWorkstream): string {
  const ownership = stringArray(workstream.ownershipPaths);
  const acceptance = stringArray(workstream.acceptanceCriteria);
  const verification = stringArray(workstream.verificationProfiles);
  return [
    workstream.instruction,
    "",
    "Multi-worker ownership boundary:",
    ...ownership.map((item) => "- " + item),
    "",
    "Do not modify files outside the ownership boundary above.",
    "Do not merge, push, or bypass review/sandbox/commit gates.",
    ...(acceptance.length > 0
      ? ["", "Acceptance criteria:", ...acceptance.map((item) => "- " + item)]
      : []),
    ...(verification.length > 0
      ? ["", "Verification profiles:", ...verification.map((item) => "- " + item)]
      : []),
  ].join("\n");
}

function globToRegExp(pattern: string): RegExp {
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
  return new RegExp(out + "$");
}

export function codingWorkstreamOwnsFile(
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
    return globToRegExp(pattern).test(normalized);
  });
}

function localChangedFiles(result: Record<string, unknown>): string[] {
  const localExecution =
    result.localExecution &&
    typeof result.localExecution === "object" &&
    !Array.isArray(result.localExecution)
      ? (result.localExecution as Record<string, unknown>)
      : null;
  return localExecution ? stringArray(localExecution.changedFiles) : [];
}

function contextBaseSha(result: Record<string, unknown>): string | null {
  const context =
    result.contextPackage &&
    typeof result.contextPackage === "object" &&
    !Array.isArray(result.contextPackage)
      ? (result.contextPackage as Record<string, unknown>)
      : null;
  const headSha = context?.headSha;
  return typeof headSha === "string" && SHA_RE.test(headSha)
    ? headSha.toLowerCase()
    : null;
}

function parseJobPayload(job: AiJob): WorkstreamJobPayload {
  const payload =
    job.payloadJson && typeof job.payloadJson === "object"
      ? (job.payloadJson as Record<string, unknown>)
      : {};

  const requiredUuid = (key: string): string => {
    const value = typeof payload[key] === "string" ? String(payload[key]).trim() : "";
    if (!UUID_RE.test(value)) {
      throw new LocalCodingMultiWorkerError(
        `Workstream job payload '${key}' must be a UUID.`,
        "INVALID_INPUT",
      );
    }
    return value;
  };
  const requiredString = (key: string): string => {
    const value = typeof payload[key] === "string" ? String(payload[key]).trim() : "";
    if (!value) {
      throw new LocalCodingMultiWorkerError(
        `Workstream job payload '${key}' is required.`,
        "INVALID_INPUT",
      );
    }
    return value;
  };

  const ownershipPaths = stringArray(payload.ownershipPaths);
  if (ownershipPaths.length === 0) {
    throw new LocalCodingMultiWorkerError(
      "Automatic coding workstream execution requires ownershipPaths.",
      "INVALID_INPUT",
    );
  }

  return {
    graphId: requiredUuid("graphId"),
    workstreamId: requiredUuid("workstreamId"),
    workstreamKey: requiredString("workstreamKey"),
    leaseToken: requiredString("leaseToken"),
    codingTaskId: requiredUuid("codingTaskId"),
    codingRunId: requiredUuid("codingRunId"),
    repository: requiredString("repository"),
    branch: requiredString("branch"),
    title: requiredString("title"),
    description: requiredString("description"),
    ownershipPaths,
  };
}

async function markManualReviewWorkstreams(graphId: string): Promise<
  Array<{ workstreamId: string; workstreamKey: string }>
> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.id, graphId))
      .for("update");
    if (!graph) {
      throw new LocalCodingMultiWorkerError(
        "Coding task graph not found.",
        "NOT_FOUND",
      );
    }
    if (!["APPROVED", "RUNNING"].includes(graph.status)) {
      throw new LocalCodingMultiWorkerError(
        "Coding task graph must be APPROVED before dispatch.",
        "NOT_READY",
        { status: graph.status },
      );
    }

    const [workstreams, dependencies] = await Promise.all([
      tx
        .select()
        .from(aiCodingWorkstreamsTable)
        .where(eq(aiCodingWorkstreamsTable.graphId, graphId)),
      tx
        .select({
          workstreamId: aiCodingWorkstreamDependenciesTable.workstreamId,
          dependsOnWorkstreamId:
            aiCodingWorkstreamDependenciesTable.dependsOnWorkstreamId,
        })
        .from(aiCodingWorkstreamDependenciesTable)
        .where(eq(aiCodingWorkstreamDependenciesTable.graphId, graphId)),
    ]);

    const claimable = selectClaimableCodingWorkstreams(
      workstreams,
      dependencies,
      now,
    ).filter((item) => stringArray(item.ownershipPaths).length === 0);

    const marked: Array<{ workstreamId: string; workstreamKey: string }> = [];
    for (const item of claimable) {
      const [updated] = await tx
        .update(aiCodingWorkstreamsTable)
        .set({
          status: "REVIEW_REQUIRED",
          errorMessage:
            "No automatic ownership paths were assigned; explicit integration review is required.",
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: now,
        })
        .where(
          and(
            eq(aiCodingWorkstreamsTable.id, item.id),
            inArray(aiCodingWorkstreamsTable.status, [
              "PENDING",
              "READY",
              "CLAIMED",
              "RUNNING",
            ]),
          ),
        )
        .returning();
      if (updated) {
        marked.push({
          workstreamId: updated.id,
          workstreamKey: updated.workstreamKey,
        });
      }
    }
    return marked;
  });
}

async function createChildExecutionForClaim(
  claim: CodingWorkstreamClaim,
): Promise<CodingWorkstreamDispatch> {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [workstream] = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, claim.workstreamId))
      .for("update");

    if (
      !workstream ||
      workstream.status !== "CLAIMED" ||
      workstream.leaseToken !== claim.leaseToken ||
      !workstream.leaseExpiresAt ||
      workstream.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw new LocalCodingMultiWorkerError(
        "Workstream lease was lost before child execution could be created.",
        "LEASE_LOST",
      );
    }
    if (workstream.childTaskId || workstream.childRunId || workstream.jobId) {
      throw new LocalCodingMultiWorkerError(
        "Claim already has a child execution binding.",
        "CLAIM_FAILED",
        { workstreamId: workstream.id },
      );
    }

    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.id, workstream.graphId));
    if (!graph) {
      throw new LocalCodingMultiWorkerError(
        "Coding task graph disappeared before dispatch.",
        "NOT_FOUND",
      );
    }

    const [parentTask] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, graph.taskId));
    if (!parentTask) {
      throw new LocalCodingMultiWorkerError(
        "Parent coding task disappeared before dispatch.",
        "NOT_FOUND",
      );
    }

    const childTaskNumber =
      "MW-" +
      parentTask.taskNumber +
      "-V" +
      String(graph.version) +
      "-" +
      workstream.workstreamKey +
      "-A" +
      String(claim.attempt);
    const description = ownershipDescription(workstream);

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
        "Failed to create child coding task.",
        "CLAIM_FAILED",
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
        "Failed to create child coding run.",
        "CLAIM_FAILED",
      );
    }

    const priorityScore = computePriorityScore({
      basePriority: workstream.priority,
      createdAt: now,
      retryCount: 0,
    });
    const jobCode = "JOB-" + randomUUID().slice(0, 8).toUpperCase();
    const [job] = await tx
      .insert(aiJobsTable)
      .values({
        jobCode,
        jobType: CODING_WORKSTREAM_JOB_TYPE,
        requiredCapability: CODING_WORKSTREAM_CAPABILITY,
        payloadJson: {
          graphId: graph.id,
          workstreamId: workstream.id,
          workstreamKey: workstream.workstreamKey,
          leaseToken: claim.leaseToken,
          codingTaskId: childTask.id,
          codingRunId: childRun.id,
          repository: parentTask.repository,
          branch: parentTask.branch,
          title: childTask.projectName,
          description,
          ownershipPaths: stringArray(workstream.ownershipPaths),
        },
        priority: workstream.priority,
        priorityScore: String(priorityScore),
        maxRetry: 0,
        retryStrategy: "manual",
        status: "queued",
        retryCount: 0,
      })
      .returning();
    if (!job) {
      throw new LocalCodingMultiWorkerError(
        "Failed to create workstream queue job.",
        "CLAIM_FAILED",
      );
    }

    const [bound] = await tx
      .update(aiCodingWorkstreamsTable)
      .set({
        childTaskId: childTask.id,
        childRunId: childRun.id,
        jobId: job.id,
      })
      .where(
        and(
          eq(aiCodingWorkstreamsTable.id, workstream.id),
          eq(aiCodingWorkstreamsTable.leaseToken, claim.leaseToken),
          eq(aiCodingWorkstreamsTable.status, "CLAIMED"),
        ),
      )
      .returning();

    if (!bound) {
      throw new LocalCodingMultiWorkerError(
        "Workstream child execution binding was lost.",
        "LEASE_LOST",
      );
    }

    return {
      workstreamId: bound.id,
      workstreamKey: bound.workstreamKey,
      childTaskId: childTask.id,
      childRunId: childRun.id,
      jobId: job.id,
      jobCode: job.jobCode,
      branchName: claim.branchName,
      leaseExpiresAt: claim.leaseExpiresAt.toISOString(),
    };
  });
}

export async function dispatchReadyCodingWorkstreams(
  graphId: string,
  options: DispatchCodingWorkstreamsOptions,
): Promise<CodingWorkstreamDispatchResult> {
  const baseSha = validateBaseSha(options.baseSha);
  const workerPoolId =
    options.workerPoolId?.trim() || "coding-workstream-pool";
  const manualReview = await markManualReviewWorkstreams(graphId);

  const claims = await claimReadyCodingWorkstreams(
    graphId,
    workerPoolId,
    {
      maxClaims: options.maxParallel,
      leaseSeconds: options.leaseSeconds,
      baseSha,
      requireOwnershipPaths: true,
    },
  );

  const dispatched: CodingWorkstreamDispatch[] = [];
  for (const claim of claims) {
    try {
      const binding = await createChildExecutionForClaim(claim);
      dispatched.push(binding);
      await logAudit(
        "coding-multi-worker",
        "workstream_job_created",
        claim.workstreamId,
        "coding_workstream",
        "success",
        {
          graphId,
          jobId: binding.jobId,
          childTaskId: binding.childTaskId,
          childRunId: binding.childRunId,
          branchName: binding.branchName,
          attempt: claim.attempt,
        },
      ).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recoverFailedCodingWorkstreamJob(
        {
          graphId,
          workstreamId: claim.workstreamId,
          leaseToken: claim.leaseToken,
        },
        message,
      ).catch(() => undefined);
    }
  }

  const [graph] = await db
    .select()
    .from(aiCodingTaskGraphsTable)
    .where(eq(aiCodingTaskGraphsTable.id, graphId));

  return {
    graphId,
    graphStatus: graph?.status ?? "RUNNING",
    dispatched,
    manualReview,
  };
}

export async function executeCodingWorkstreamJob(
  job: AiJob,
): Promise<Record<string, unknown>> {
  const payload = parseJobPayload(job);
  await startCodingWorkstreamClaim(
    payload.workstreamId,
    payload.leaseToken,
  );

  let leaseLost: Error | null = null;
  const heartbeatTimer = setInterval(() => {
    void heartbeatCodingWorkstreamClaim(
      payload.workstreamId,
      payload.leaseToken,
    ).catch((error: unknown) => {
      leaseLost =
        error instanceof Error ? error : new Error(String(error));
    });
  }, DEFAULT_HEARTBEAT_MS);
  heartbeatTimer.unref?.();

  try {
    const result = await executeRepositoryAnalyzerJob(job);
    if (leaseLost) throw leaseLost;

    const changedFiles = localChangedFiles(result);
    const outside = changedFiles.filter(
      (file) => !codingWorkstreamOwnsFile(file, payload.ownershipPaths),
    );
    if (outside.length > 0) {
      throw new LocalCodingMultiWorkerError(
        "Workstream patch changed files outside its ownership boundary.",
        "INVALID_INPUT",
        {
          workstreamId: payload.workstreamId,
          outsideOwnership: outside,
          ownershipPaths: payload.ownershipPaths,
        },
      );
    }

    await heartbeatCodingWorkstreamClaim(
      payload.workstreamId,
      payload.leaseToken,
    );

    await markCodingWorkstreamReviewRequired(
      payload.workstreamId,
      payload.leaseToken,
      {
        baseSha: contextBaseSha(result),
        resultJson: result,
      },
    );

    await completeRepositoryAnalyzerRun(result);

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
    await recoverFailedCodingWorkstreamJob(
      {
        ...job.payloadJson as Record<string, unknown>,
        jobId: job.id,
      },
      message,
    ).catch(() => undefined);
    throw error;
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export async function recoverFailedCodingWorkstreamJob(
  payload: Record<string, unknown>,
  errorMessage: string,
): Promise<void> {
  const workstreamId =
    typeof payload.workstreamId === "string" &&
    UUID_RE.test(payload.workstreamId)
      ? payload.workstreamId
      : null;
  const codingTaskId =
    typeof payload.codingTaskId === "string" &&
    UUID_RE.test(payload.codingTaskId)
      ? payload.codingTaskId
      : null;
  const codingRunId =
    typeof payload.codingRunId === "string" &&
    UUID_RE.test(payload.codingRunId)
      ? payload.codingRunId
      : null;
  const jobId =
    typeof payload.jobId === "number" && Number.isInteger(payload.jobId)
      ? payload.jobId
      : null;
  const leaseToken =
    typeof payload.leaseToken === "string" ? payload.leaseToken : null;
  const message = errorMessage.trim().slice(0, 2_000);
  const now = new Date();

  if (codingTaskId && codingRunId) {
    await failRepositoryAnalyzerRun(
      { codingTaskId, codingRunId },
      message || "Coding workstream execution failed.",
    ).catch(() => undefined);
  }

  if (!workstreamId) return;

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, workstreamId))
      .for("update");

    if (!current) return;

    const sameExecution =
      (jobId == null || current.jobId === jobId) &&
      (leaseToken == null || current.leaseToken === leaseToken);
    if (!sameExecution) {
      // A newer claim/job owns the row. Never let a stale worker clobber it.
      return;
    }

    await tx
      .update(aiCodingWorkstreamsTable)
      .set({
        status: "FAILED",
        errorMessage: message || "Coding workstream execution failed.",
        completedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
      })
      .where(eq(aiCodingWorkstreamsTable.id, workstreamId));

    await tx
      .update(aiCodingTaskGraphsTable)
      .set({ status: "FAILED" })
      .where(eq(aiCodingTaskGraphsTable.id, current.graphId));
  });
}
