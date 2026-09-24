import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import {
  aiCodeChangesTable,
  aiCodingRunsTable,
  aiCodingTasksTable,
  db,
  type AiCodingRun,
  type AiCodingTask,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { logAudit } from "./aiAuditService.js";
import {
  executeLocalCodingPlan,
  type LocalCodingExecutionPlan,
  type LocalCodingExecutionResult,
} from "./localCodingExecutorService.js";
import type { LocalCodingContextPackage } from "./localCodingEngineService.js";

const execFileAsync = promisify(execFile);
const CLONE_TIMEOUT_MS = 120_000;

interface LocalPatchApprovalContext {
  task: AiCodingTask;
  orchestratorRun: AiCodingRun;
  plan: LocalCodingExecutionPlan;
  contextPackage: LocalCodingContextPackage;
  orchestratorPayload: Record<string, unknown>;
}

function normalizeRemoteRepository(repository: string): string {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return `https://github.com/${repository}.git`;
  }
  const parsed = new URL(repository);
  if (parsed.protocol !== "https:" || !["github.com", "gitlab.com"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Local patch approval only accepts HTTPS GitHub or GitLab repositories");
  }
  return parsed.toString();
}

function assertBranch(branch: string): string {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) {
    throw new Error("Repository branch contains unsupported characters");
  }
  return branch;
}

async function cloneRepository(repository: string, branch: string): Promise<string> {
  const workspace = join(tmpdir(), `local-patch-approval-${crypto.randomUUID()}`);
  await mkdir(workspace, { recursive: true });
  try {
    await execFileAsync(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--no-tags",
        "--single-branch",
        "--branch",
        assertBranch(branch),
        normalizeRemoteRepository(repository),
        workspace,
      ],
      {
        timeout: CLONE_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          LANG: "C",
          LC_ALL: "C",
        },
      },
    );
    return workspace;
  } catch (error) {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asLocalPlan(value: unknown): LocalCodingExecutionPlan | null {
  if (!isRecord(value) || value.status !== "EXECUTABLE" || !Array.isArray(value.operations)) return null;
  return value as unknown as LocalCodingExecutionPlan;
}

function asContextPackage(value: unknown): LocalCodingContextPackage | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.repository !== "string" ||
    typeof value.branch !== "string" ||
    typeof value.headSha !== "string" ||
    !Array.isArray(value.verificationCommands)
  ) {
    return null;
  }
  return value as unknown as LocalCodingContextPackage;
}

async function loadApprovalContext(taskId: string): Promise<LocalPatchApprovalContext> {
  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId));
  if (!task) throw new Error("Coding task not found");
  if (task.status !== "READY_REVIEW") {
    throw new Error("Coding task is not awaiting local patch approval");
  }

  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));

  const orchestratorRun = runs.find(
    (run) => run.agentName === "Coding Orchestrator" && run.status === "COMPLETED" && run.logs,
  );
  if (!orchestratorRun?.logs) {
    throw new Error("Completed Coding Orchestrator local patch was not found");
  }

  const payload = parseObject(orchestratorRun.logs);
  const orchestration = isRecord(payload.orchestration) ? payload.orchestration : null;
  if (orchestration?.nextAction !== "REVIEW_LOCAL_PATCH") {
    throw new Error("Coding task is not at REVIEW_LOCAL_PATCH gate");
  }

  const plan = asLocalPlan(payload.localExecutionPlan);
  const contextPackage = asContextPackage(payload.contextPackage);
  const localExecution = isRecord(payload.localExecution) ? payload.localExecution : null;
  if (!plan || !contextPackage || localExecution?.status !== "APPLIED") {
    throw new Error("Local patch approval payload is incomplete");
  }

  return {
    task,
    orchestratorRun,
    plan,
    contextPackage,
    orchestratorPayload: payload,
  };
}

function setOrchestratorNextAction(
  payload: Record<string, unknown>,
  result: LocalCodingExecutionResult,
): Record<string, unknown> {
  const orchestration = isRecord(payload.orchestration) ? payload.orchestration : {};
  const stages = Array.isArray(orchestration.stages)
    ? orchestration.stages.map((stage) => {
        if (!isRecord(stage)) return stage;
        if (stage.id !== "testing" && stage.id !== "review") return stage;
        const now = new Date().toISOString();
        if (stage.id === "testing") {
          return {
            ...stage,
            status: "COMPLETED",
            completedAt: now,
            detail: result.scriptsExecuted
              ? "Approved local patch passed static and allowlisted repository verification."
              : "Approved local patch passed static verification.",
          };
        }
        return {
          ...stage,
          status: "COMPLETED",
          completedAt: now,
          detail: "Deterministic local patch is verified and ready for explicit commit approval.",
        };
      })
    : [];

  return {
    ...payload,
    localPatchApproval: {
      status: result.status,
      reason: result.reason,
      changedFiles: result.changedFiles,
      patch: result.patch,
      verification: result.verification,
      verificationAttempts: result.verificationAttempts ?? [],
      autoFixes: result.autoFixes ?? [],
      scriptsExecuted: result.scriptsExecuted === true,
      warnings: result.warnings,
      approvedAt: new Date().toISOString(),
      commitCreated: false,
      pushed: false,
    },
    orchestration: {
      ...orchestration,
      status: "READY_REVIEW",
      stages,
      nextAction: "APPROVE_COMMIT",
    },
  };
}

async function markApprovalFailure(
  context: LocalPatchApprovalContext,
  run: AiCodingRun,
  message: string,
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(aiCodingRunsTable)
      .set({
        status: "FAILED",
        finishedAt: now,
        errorMessage: message.slice(0, 2000),
        logs: JSON.stringify({
          executionStatus: "FAILED",
          error: message,
          nextAction: "REVIEW_LOCAL_PATCH",
          commitCreated: false,
          pushed: false,
        }, null, 2),
      })
      .where(eq(aiCodingRunsTable.id, run.id));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "READY_REVIEW",
        resultSummary: `Local patch approval failed: ${message.slice(0, 500)} Nothing was committed or pushed.`,
      })
      .where(eq(aiCodingTasksTable.id, context.task.id));
  });

  await logAudit(
    "coding-orchestrator",
    "local_patch_approval_failed",
    context.task.id,
    "coding_task",
    "failure",
    { codingRunId: run.id, error: message.slice(0, 500) },
  );
}

async function executeApproval(
  context: LocalPatchApprovalContext,
  run: AiCodingRun,
): Promise<void> {
  let workspace: string | null = null;
  try {
    workspace = await cloneRepository(context.task.repository, context.task.branch);
    const result = await executeLocalCodingPlan(workspace, context.plan, {
      trustedWorkspace: true,
      expectedHeadSha: context.contextPackage.headSha,
      runVerification: true,
      trustedVerificationScripts: true,
      maxVerificationAttempts: 2,
      verificationTimeoutMs: 180_000,
    });

    if (result.status !== "APPLIED") {
      throw new Error(result.reason);
    }

    const nextPayload = setOrchestratorNextAction(context.orchestratorPayload, result);
    const completedAt = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(aiCodingRunsTable)
        .set({
          status: "COMPLETED",
          finishedAt: completedAt,
          logs: JSON.stringify({
            executionStatus: "COMPLETED",
            summary: "Approved deterministic local patch passed revalidation.",
            localPatchApproval: nextPayload.localPatchApproval,
            nextAction: "APPROVE_COMMIT",
            commitCreated: false,
            pushed: false,
          }, null, 2),
          errorMessage: null,
        })
        .where(eq(aiCodingRunsTable.id, run.id));

      await tx
        .update(aiCodingRunsTable)
        .set({ logs: JSON.stringify(nextPayload, null, 2) })
        .where(eq(aiCodingRunsTable.id, context.orchestratorRun.id));

      for (const file of result.changedFiles) {
        await tx.insert(aiCodeChangesTable).values({
          taskId: context.task.id,
          filePath: file,
          changeType: "MODIFIED",
          commitSha: null,
        });
      }

      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "READY_REVIEW",
          resultSummary:
            `Approved local patch verified for ${result.changedFiles.length} file(s). Ready for explicit commit approval. Nothing was committed or pushed.`,
        })
        .where(eq(aiCodingTasksTable.id, context.task.id));
    });

    await logAudit(
      "coding-orchestrator",
      "local_patch_approved_verified",
      context.task.id,
      "coding_task",
      "success",
      {
        codingRunId: run.id,
        orchestratorRunId: context.orchestratorRun.id,
        changedFiles: result.changedFiles.length,
        scriptsExecuted: result.scriptsExecuted === true,
        nextAction: "APPROVE_COMMIT",
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markApprovalFailure(context, run, message);
    logger.error(
      { err: error, taskId: context.task.id, codingRunId: run.id },
      "[local-patch-approval] Verification failed",
    );
  } finally {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function approveLocalPatch(taskId: string): Promise<AiCodingRun> {
  const context = await loadApprovalContext(taskId);

  const [run] = await db.transaction(async (tx) => {
    const [lockedTask] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId))
      .for("update");
    if (!lockedTask) throw new Error("Coding task not found");
    if (lockedTask.status !== "READY_REVIEW") {
      throw new Error("Coding task is not awaiting local patch approval");
    }

    const [activeRun] = await tx
      .select({ id: aiCodingRunsTable.id })
      .from(aiCodingRunsTable)
      .where(and(eq(aiCodingRunsTable.taskId, taskId), eq(aiCodingRunsTable.status, "RUNNING")))
      .limit(1);
    if (activeRun) throw new Error("Coding task already has an active run");

    const [created] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId,
        agentName: "Local Patch Approval",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "TESTING",
        resultSummary: "Approved local patch is being re-applied and verified in an isolated workspace.",
      })
      .where(eq(aiCodingTasksTable.id, taskId));

    return [created];
  });

  await logAudit(
    "coding-orchestrator",
    "local_patch_approval_started",
    taskId,
    "coding_task",
    "success",
    {
      codingRunId: run.id,
      orchestratorRunId: context.orchestratorRun.id,
      expectedHeadSha: context.contextPackage.headSha,
    },
  );

  void executeApproval(context, run);
  return run;
}
