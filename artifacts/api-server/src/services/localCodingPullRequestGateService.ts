import { and, desc, eq } from "drizzle-orm";
import {
  aiCodingRunsTable,
  aiCodingTasksTable,
  db,
  type AiCodingRun,
  type AiCodingTask,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import {
  createGitHubApiClient,
  GitHubPublisherError,
  parseGitHubRepository,
  type GitHubApiClient,
} from "./localCodingGitHubPublisherService.js";
import {
  mergeVerifiedPullRequest,
  verifyPublishedPullRequest,
  type PullRequestVerificationInput,
  type PullRequestVerificationResult,
} from "./localCodingGitHubPullRequestService.js";

export class LocalPullRequestGateError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "GITHUB_AUTH"
      | "INVALID_CONTEXT"
      | "CHECKS_PENDING"
      | "CHECKS_FAILED"
      | "STALE_PR"
      | "MERGE_FAILED",
  ) {
    super(message);
    this.name = "LocalPullRequestGateError";
  }
}

interface PullRequestGateContext {
  task: AiCodingTask;
  orchestratorRun: AiCodingRun;
  orchestratorPayload: Record<string, unknown>;
  verificationInput: PullRequestVerificationInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function validSha(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value)
    ? value.toLowerCase()
    : "";
}

async function loadPullRequestContext(
  taskId: string,
  expectedAction: "REVIEW_PR" | "APPROVE_MERGE",
): Promise<PullRequestGateContext> {
  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId));

  if (!task) {
    throw new LocalPullRequestGateError("Coding task not found", "NOT_FOUND");
  }
  if (task.status !== "PR_CREATED") {
    throw new LocalPullRequestGateError(
      "Coding task is not awaiting pull request review",
      "NOT_READY",
    );
  }

  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));

  if (runs.some((run) => run.status === "RUNNING")) {
    throw new LocalPullRequestGateError(
      "Coding task already has an active run",
      "NOT_READY",
    );
  }

  const orchestratorRun = runs.find(
    (run) =>
      run.agentName === "Coding Orchestrator" &&
      run.status === "COMPLETED" &&
      typeof run.logs === "string" &&
      run.logs.length > 0,
  );
  if (!orchestratorRun?.logs) {
    throw new LocalPullRequestGateError(
      "Completed Coding Orchestrator payload was not found",
      "INVALID_CONTEXT",
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(orchestratorRun.logs) as Record<string, unknown>;
  } catch {
    throw new LocalPullRequestGateError(
      "Coding Orchestrator payload is invalid",
      "INVALID_CONTEXT",
    );
  }

  const orchestration = isRecord(payload.orchestration) ? payload.orchestration : null;
  const localCommitApproval = isRecord(payload.localCommitApproval)
    ? payload.localCommitApproval
    : null;
  const localPatchApproval = isRecord(payload.localPatchApproval)
    ? payload.localPatchApproval
    : null;
  const prVerification = isRecord(payload.prVerification)
    ? payload.prVerification
    : null;

  if (orchestration?.nextAction !== expectedAction) {
    throw new LocalPullRequestGateError(
      `Coding task is not at the ${expectedAction} gate`,
      "NOT_READY",
    );
  }

  if (
    localCommitApproval?.status !== "PUBLISHED" ||
    localCommitApproval.commitCreated !== true ||
    localCommitApproval.pushed !== true ||
    localCommitApproval.autoMerged === true
  ) {
    throw new LocalPullRequestGateError(
      "Coding task does not contain a valid published pull request",
      "INVALID_CONTEXT",
    );
  }

  const pullRequestNumber = integerValue(localCommitApproval.pullRequestNumber);
  const baseBranch =
    typeof localCommitApproval.baseBranch === "string"
      ? localCommitApproval.baseBranch
      : "";
  const baseHeadSha = validSha(localCommitApproval.baseHeadSha);
  const commitSha = validSha(localCommitApproval.commitSha);
  const taskCommitSha = validSha(task.commitSha);
  const changedFiles = stringArray(localPatchApproval?.changedFiles);

  if (
    !pullRequestNumber ||
    !baseBranch ||
    !baseHeadSha ||
    !commitSha ||
    commitSha !== taskCommitSha ||
    changedFiles.length === 0
  ) {
    throw new LocalPullRequestGateError(
      "Published pull request metadata is incomplete or inconsistent",
      "INVALID_CONTEXT",
    );
  }

  if (expectedAction === "APPROVE_MERGE") {
    if (
      prVerification?.status !== "PASSED" ||
      prVerification.gateStatus !== "PR_VERIFIED" ||
      validSha(prVerification.headSha) !== commitSha ||
      validSha(prVerification.baseSha) !== baseHeadSha
    ) {
      throw new LocalPullRequestGateError(
        "Pull request has not passed the explicit verification gate",
        "NOT_READY",
      );
    }
  }

  try {
    parseGitHubRepository(task.repository);
  } catch (error) {
    throw new LocalPullRequestGateError(
      error instanceof Error ? error.message : String(error),
      "INVALID_CONTEXT",
    );
  }

  return {
    task,
    orchestratorRun,
    orchestratorPayload: payload,
    verificationInput: {
      repository: task.repository,
      pullRequestNumber,
      baseBranch,
      expectedBaseSha: baseHeadSha,
      expectedHeadSha: commitSha,
      expectedFiles: [...new Set(changedFiles)].sort(),
    },
  };
}

function compactVerification(result: PullRequestVerificationResult): Record<string, unknown> {
  return {
    status: result.status,
    gateStatus: result.status === "PASSED" ? "PR_VERIFIED" : "PR_NOT_VERIFIED",
    reason: result.reason,
    pullRequestNumber: result.pullRequestNumber,
    pullRequestUrl: result.pullRequestUrl,
    baseBranch: result.baseBranch,
    baseSha: result.baseSha,
    headSha: result.headSha,
    changedFiles: result.changedFiles,
    checks: result.checks.map((check) => ({
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
    })),
    combinedStatus: result.combinedStatus,
    mergeable: result.mergeable,
    mergeableState: result.mergeableState,
    draft: result.draft,
    verifiedAt: new Date().toISOString(),
  };
}

async function markReviewRunFailed(
  context: PullRequestGateContext,
  run: AiCodingRun,
  error: Error,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(aiCodingRunsTable)
      .set({
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error.message.slice(0, 2000),
        logs: JSON.stringify({
          executionStatus: "FAILED",
          error: error.message.slice(0, 1200),
          nextAction: "REVIEW_PR",
        }, null, 2),
      })
      .where(eq(aiCodingRunsTable.id, run.id));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "PR_CREATED",
        resultSummary:
          "Pull request verification failed: " +
          error.message.slice(0, 500) +
          " Merge remains locked.",
      })
      .where(eq(aiCodingTasksTable.id, context.task.id));
  }).catch(() => undefined);
}

async function executePullRequestVerification(
  context: PullRequestGateContext,
  run: AiCodingRun,
  client: GitHubApiClient,
): Promise<void> {
  try {
    const verification = await verifyPublishedPullRequest(
      context.verificationInput,
      client,
    );
    const completedAt = new Date();
    const orchestration = isRecord(context.orchestratorPayload.orchestration)
      ? context.orchestratorPayload.orchestration
      : {};
    const nextAction = verification.status === "PASSED" ? "APPROVE_MERGE" : "REVIEW_PR";
    const payload = {
      ...context.orchestratorPayload,
      prVerification: compactVerification(verification),
      orchestration: {
        ...orchestration,
        status: "PR_CREATED",
        nextAction,
      },
    };

    await db.transaction(async (tx) => {
      await tx
        .update(aiCodingRunsTable)
        .set({
          status: verification.status === "FAILED" || verification.status === "STALE"
            ? "FAILED"
            : "COMPLETED",
          finishedAt: completedAt,
          errorMessage:
            verification.status === "FAILED" || verification.status === "STALE"
              ? verification.reason.slice(0, 2000)
              : null,
          logs: JSON.stringify({
            executionStatus:
              verification.status === "PASSED"
                ? "COMPLETED"
                : verification.status,
            prStatus: verification.status,
            reason: verification.reason,
            checks: verification.checks,
            baseSha: verification.baseSha,
            headSha: verification.headSha,
            nextAction,
          }, null, 2),
        })
        .where(eq(aiCodingRunsTable.id, run.id));

      await tx
        .update(aiCodingRunsTable)
        .set({ logs: JSON.stringify(payload, null, 2) })
        .where(eq(aiCodingRunsTable.id, context.orchestratorRun.id));

      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "PR_CREATED",
          resultSummary:
            verification.status === "PASSED"
              ? `Pull request #${verification.pullRequestNumber} passed integrity and CI verification. Ready for explicit merge approval.`
              : `Pull request #${verification.pullRequestNumber} is ${verification.status.toLowerCase()}: ${verification.reason} Merge remains locked.`,
        })
        .where(eq(aiCodingTasksTable.id, context.task.id));
    });

    await logAudit(
      "coding-orchestrator",
      verification.status === "PASSED"
        ? "pull_request_verification_passed"
        : "pull_request_verification_not_ready",
      context.task.id,
      "coding_task",
      verification.status === "PASSED" ? "success" : "failure",
      {
        codingRunId: run.id,
        pullRequestNumber: verification.pullRequestNumber,
        status: verification.status,
        headSha: verification.headSha,
        baseSha: verification.baseSha,
        checks: verification.checks.map((check) => ({
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
        })),
      },
    );
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    await markReviewRunFailed(context, run, normalized);
    await logAudit(
      "coding-orchestrator",
      "pull_request_verification_failed",
      context.task.id,
      "coding_task",
      "failure",
      {
        codingRunId: run.id,
        error: normalized.message.slice(0, 700),
      },
    ).catch(() => undefined);
  }
}

export async function startPullRequestVerification(
  taskId: string,
): Promise<AiCodingRun> {
  const context = await loadPullRequestContext(taskId, "REVIEW_PR");
  const token = process.env["AI_CODING_GITHUB_TOKEN"]?.trim() ?? "";
  if (!token) {
    throw new LocalPullRequestGateError(
      "AI_CODING_GITHUB_TOKEN is not configured; pull request verification remains fail-closed.",
      "GITHUB_AUTH",
    );
  }
  const client = createGitHubApiClient(token);

  const [run] = await db.transaction(async (tx) => {
    const [lockedTask] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId))
      .for("update");
    if (!lockedTask) {
      throw new LocalPullRequestGateError("Coding task not found", "NOT_FOUND");
    }
    if (lockedTask.status !== "PR_CREATED") {
      throw new LocalPullRequestGateError(
        "Coding task is not awaiting pull request verification",
        "NOT_READY",
      );
    }

    const [activeRun] = await tx
      .select({ id: aiCodingRunsTable.id })
      .from(aiCodingRunsTable)
      .where(and(eq(aiCodingRunsTable.taskId, taskId), eq(aiCodingRunsTable.status, "RUNNING")))
      .limit(1);
    if (activeRun) {
      throw new LocalPullRequestGateError(
        "Coding task already has an active run",
        "NOT_READY",
      );
    }

    const [created] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId,
        agentName: "Pull Request Verification",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();

    await tx
      .update(aiCodingTasksTable)
      .set({
        resultSummary:
          "Pull request verification started. Merge remains locked until integrity and CI checks pass.",
      })
      .where(eq(aiCodingTasksTable.id, taskId));

    return [created];
  });

  await logAudit(
    "coding-orchestrator",
    "pull_request_verification_started",
    taskId,
    "coding_task",
    "success",
    {
      codingRunId: run.id,
      pullRequestNumber: context.verificationInput.pullRequestNumber,
      headSha: context.verificationInput.expectedHeadSha,
      baseSha: context.verificationInput.expectedBaseSha,
    },
  );

  void executePullRequestVerification(context, run, client);
  return run;
}

async function executeExplicitMerge(
  context: PullRequestGateContext,
  run: AiCodingRun,
  client: GitHubApiClient,
): Promise<void> {
  try {
    const merged = await mergeVerifiedPullRequest(
      context.verificationInput,
      client,
    );
    const completedAt = new Date();
    const orchestration = isRecord(context.orchestratorPayload.orchestration)
      ? context.orchestratorPayload.orchestration
      : {};
    const payload = {
      ...context.orchestratorPayload,
      localMergeApproval: {
        status: "MERGED",
        pullRequestNumber: merged.pullRequestNumber,
        pullRequestUrl: merged.pullRequestUrl,
        sourceCommitSha: merged.sourceCommitSha,
        baseHeadSha: merged.baseSha,
        mergeCommitSha: merged.mergeCommitSha,
        explicitApproval: true,
        autoMerged: false,
        mergedAt: completedAt.toISOString(),
      },
      orchestration: {
        ...orchestration,
        status: "COMPLETED",
        nextAction: "DONE",
      },
    };

    await db.transaction(async (tx) => {
      await tx
        .update(aiCodingRunsTable)
        .set({
          status: "COMPLETED",
          finishedAt: completedAt,
          errorMessage: null,
          logs: JSON.stringify({
            executionStatus: "COMPLETED",
            pullRequestNumber: merged.pullRequestNumber,
            sourceCommitSha: merged.sourceCommitSha,
            mergeCommitSha: merged.mergeCommitSha,
            explicitApproval: true,
            autoMerged: false,
            nextAction: "DONE",
          }, null, 2),
        })
        .where(eq(aiCodingRunsTable.id, run.id));

      await tx
        .update(aiCodingRunsTable)
        .set({ logs: JSON.stringify(payload, null, 2) })
        .where(eq(aiCodingRunsTable.id, context.orchestratorRun.id));

      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "COMPLETED",
          resultSummary:
            `Pull request #${merged.pullRequestNumber} merged after explicit approval. Merge commit ${merged.mergeCommitSha.slice(0, 12)}. No automatic merge was used.`,
        })
        .where(eq(aiCodingTasksTable.id, context.task.id));
    });

    await logAudit(
      "coding-orchestrator",
      "pull_request_explicitly_merged",
      context.task.id,
      "coding_task",
      "success",
      {
        codingRunId: run.id,
        pullRequestNumber: merged.pullRequestNumber,
        sourceCommitSha: merged.sourceCommitSha,
        mergeCommitSha: merged.mergeCommitSha,
        explicitApproval: true,
        autoMerged: false,
      },
    );
  } catch (error) {
    const normalized =
      error instanceof GitHubPublisherError
        ? new LocalPullRequestGateError(
            error.message,
            error.kind === "AUTH_REQUIRED"
              ? "GITHUB_AUTH"
              : error.kind === "STALE_HEAD"
                ? "STALE_PR"
                : "MERGE_FAILED",
          )
        : error instanceof LocalPullRequestGateError
          ? error
          : new LocalPullRequestGateError(
              error instanceof Error ? error.message : String(error),
              "MERGE_FAILED",
            );

    const orchestration = isRecord(context.orchestratorPayload.orchestration)
      ? context.orchestratorPayload.orchestration
      : {};
    const payload = {
      ...context.orchestratorPayload,
      orchestration: {
        ...orchestration,
        status: "PR_CREATED",
        nextAction: "REVIEW_PR",
      },
    };

    await db.transaction(async (tx) => {
      await tx
        .update(aiCodingRunsTable)
        .set({
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: normalized.message.slice(0, 2000),
          logs: JSON.stringify({
            executionStatus: "FAILED",
            kind: normalized.kind,
            error: normalized.message.slice(0, 1200),
            nextAction: "REVIEW_PR",
          }, null, 2),
        })
        .where(eq(aiCodingRunsTable.id, run.id));

      await tx
        .update(aiCodingRunsTable)
        .set({ logs: JSON.stringify(payload, null, 2) })
        .where(eq(aiCodingRunsTable.id, context.orchestratorRun.id));

      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "PR_CREATED",
          resultSummary:
            "Explicit merge failed: " +
            normalized.message.slice(0, 500) +
            " Pull request must be verified again before another merge attempt.",
        })
        .where(eq(aiCodingTasksTable.id, context.task.id));
    }).catch(() => undefined);

    await logAudit(
      "coding-orchestrator",
      "pull_request_merge_failed",
      context.task.id,
      "coding_task",
      "failure",
      {
        codingRunId: run.id,
        kind: normalized.kind,
        error: normalized.message.slice(0, 700),
      },
    ).catch(() => undefined);
  }
}

export async function approveAndMergePullRequest(
  taskId: string,
): Promise<AiCodingRun> {
  const context = await loadPullRequestContext(taskId, "APPROVE_MERGE");
  const token = process.env["AI_CODING_GITHUB_TOKEN"]?.trim() ?? "";
  if (!token) {
    throw new LocalPullRequestGateError(
      "AI_CODING_GITHUB_TOKEN is not configured; merge remains fail-closed.",
      "GITHUB_AUTH",
    );
  }
  const client = createGitHubApiClient(token);

  const [run] = await db.transaction(async (tx) => {
    const [lockedTask] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId))
      .for("update");
    if (!lockedTask) {
      throw new LocalPullRequestGateError("Coding task not found", "NOT_FOUND");
    }
    if (lockedTask.status !== "PR_CREATED") {
      throw new LocalPullRequestGateError(
        "Coding task is not awaiting explicit merge approval",
        "NOT_READY",
      );
    }

    const [activeRun] = await tx
      .select({ id: aiCodingRunsTable.id })
      .from(aiCodingRunsTable)
      .where(and(eq(aiCodingRunsTable.taskId, taskId), eq(aiCodingRunsTable.status, "RUNNING")))
      .limit(1);
    if (activeRun) {
      throw new LocalPullRequestGateError(
        "Coding task already has an active run",
        "NOT_READY",
      );
    }

    const [created] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId,
        agentName: "Pull Request Merge Gate",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();

    await tx
      .update(aiCodingTasksTable)
      .set({
        resultSummary:
          "Explicit merge approval accepted. GitHub PR integrity and CI will be re-verified before merge.",
      })
      .where(eq(aiCodingTasksTable.id, taskId));

    return [created];
  });

  await logAudit(
    "coding-orchestrator",
    "pull_request_merge_approval_started",
    taskId,
    "coding_task",
    "success",
    {
      codingRunId: run.id,
      pullRequestNumber: context.verificationInput.pullRequestNumber,
      headSha: context.verificationInput.expectedHeadSha,
      baseSha: context.verificationInput.expectedBaseSha,
    },
  );

  void executeExplicitMerge(context, run, client);
  return run;
}
