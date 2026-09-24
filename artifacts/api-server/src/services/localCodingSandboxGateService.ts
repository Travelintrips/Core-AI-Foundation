import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { promisify } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import {
  aiCodingRunsTable,
  aiCodingTasksTable,
  db,
  type AiCodingRun,
  type AiCodingTask,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { isSensitiveRepositoryPath } from "./localCodingEngineService.js";
import { runSandboxedRepositoryVerification } from "./localCodingSandboxService.js";
import { verifyChangedFilesStatically } from "./localCodingVerificationService.js";
import { prepareRepositoryWorkspace } from "./repositoryAnalyzerService.js";

const execFileAsync = promisify(execFile);

const MAX_PATCH_BYTES = 400_000;
const MAX_CHANGED_FILES = 40;
const GIT_TIMEOUT_MS = 30_000;

export class LocalCodingSandboxGateError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_HEAD"
      | "INVALID_PATCH"
      | "VERIFICATION_FAILED"
      | "SANDBOX_BLOCKED",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LocalCodingSandboxGateError";
  }
}

interface SandboxGateContext {
  task: AiCodingTask;
  orchestratorRun: AiCodingRun;
  orchestratorPayload: Record<string, unknown>;
  patch: string;
  patchSha256: string;
  baseHeadSha: string;
  changedFiles: string[];
  verificationCommands: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeRepoPath(value: string): string {
  const normalized = normalize(value).replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    isSensitiveRepositoryPath(normalized)
  ) {
    throw new LocalCodingSandboxGateError(
      `Unsafe sandbox verification path: ${value}`,
      "INVALID_PATCH",
    );
  }
  return normalized;
}

function parsePatchFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split("\n")) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (!match) continue;
    if (match[1] !== match[2]) {
      throw new LocalCodingSandboxGateError(
        "Sandbox verification does not support renamed files.",
        "INVALID_PATCH",
      );
    }
    files.add(safeRepoPath(match[1]));
  }
  return [...files].sort();
}

function sameFiles(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LANG: "C",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return stdout.trim();
}

async function latestSandboxContext(taskId: string): Promise<SandboxGateContext> {
  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId));

  if (!task) {
    throw new LocalCodingSandboxGateError("Coding task not found", "NOT_FOUND");
  }
  if (task.status !== "READY_REVIEW" || task.commitSha) {
    throw new LocalCodingSandboxGateError(
      "Coding task is not awaiting sandbox verification",
      "NOT_READY",
    );
  }

  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));

  if (runs.some((run) => run.status === "RUNNING")) {
    throw new LocalCodingSandboxGateError(
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
    throw new LocalCodingSandboxGateError(
      "Completed Coding Orchestrator payload was not found",
      "NOT_READY",
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(orchestratorRun.logs) as Record<string, unknown>;
  } catch {
    throw new LocalCodingSandboxGateError(
      "Coding Orchestrator payload is invalid",
      "INVALID_PATCH",
    );
  }

  const orchestration = isRecord(payload.orchestration) ? payload.orchestration : null;
  const localPatchApproval = isRecord(payload.localPatchApproval)
    ? payload.localPatchApproval
    : null;
  const localExecution = isRecord(payload.localExecution) ? payload.localExecution : null;
  const localExecutionPlan = isRecord(payload.localExecutionPlan)
    ? payload.localExecutionPlan
    : null;
  const contextPackage = isRecord(payload.contextPackage) ? payload.contextPackage : null;

  if (orchestration?.nextAction !== "RUN_SANDBOX_VERIFICATION") {
    throw new LocalCodingSandboxGateError(
      "Coding task is not at the RUN_SANDBOX_VERIFICATION gate",
      "NOT_READY",
    );
  }
  if (
    localPatchApproval?.gateStatus !== "PATCH_VALIDATED" ||
    localPatchApproval.commitCreated === true ||
    localPatchApproval.pushed === true
  ) {
    throw new LocalCodingSandboxGateError(
      "Local patch has not passed the explicit validation gate",
      "NOT_READY",
    );
  }

  const patch = typeof localExecution?.patch === "string" ? localExecution.patch : "";
  if (
    !patch ||
    Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES ||
    patch.includes("[REDACTED_SENSITIVE_DIFF_LINE]") ||
    patch.includes("GIT binary patch") ||
    /(?:^|\n)Binary files /.test(patch) ||
    /(?:^|\n)(?:---|\+\+\+) \/dev\/null/.test(patch)
  ) {
    throw new LocalCodingSandboxGateError(
      "Validated local patch is missing or contains unsupported content",
      "INVALID_PATCH",
    );
  }

  const patchSha256 =
    typeof localPatchApproval.patchSha256 === "string"
      ? localPatchApproval.patchSha256.toLowerCase()
      : "";
  const actualPatchSha256 = createHash("sha256").update(patch, "utf8").digest("hex");
  if (!/^[0-9a-f]{64}$/.test(patchSha256) || patchSha256 !== actualPatchSha256) {
    throw new LocalCodingSandboxGateError(
      "Validated local patch digest no longer matches the review payload",
      "INVALID_PATCH",
    );
  }

  const baseHeadSha =
    typeof localPatchApproval.baseHeadSha === "string"
      ? localPatchApproval.baseHeadSha.toLowerCase()
      : "";
  if (!/^[0-9a-f]{40}$/.test(baseHeadSha)) {
    throw new LocalCodingSandboxGateError(
      "Validated local patch is missing a valid base HEAD SHA",
      "INVALID_PATCH",
    );
  }

  const changedFiles = stringArray(localPatchApproval.changedFiles).map(safeRepoPath);
  if (changedFiles.length === 0 || changedFiles.length > MAX_CHANGED_FILES) {
    throw new LocalCodingSandboxGateError(
      "Validated local patch changed-file list is empty or too large",
      "INVALID_PATCH",
    );
  }
  if (!sameFiles(changedFiles, parsePatchFiles(patch))) {
    throw new LocalCodingSandboxGateError(
      "Validated patch headers no longer match the approved changed-file list",
      "INVALID_PATCH",
    );
  }

  const verificationCommands = [
    ...new Set(
      stringArray(localExecutionPlan?.verificationCommands).length > 0
        ? stringArray(localExecutionPlan?.verificationCommands)
        : stringArray(contextPackage?.verificationCommands),
    ),
  ].slice(0, 6);

  return {
    task,
    orchestratorRun,
    orchestratorPayload: payload,
    patch,
    patchSha256,
    baseHeadSha,
    changedFiles: [...new Set(changedFiles)].sort(),
    verificationCommands,
  };
}

function compactCommands(
  commands: Array<{
    command: string;
    status: string;
    exitCode: number | null;
    durationMs: number;
  }>,
): Array<Record<string, unknown>> {
  return commands.map((command) => ({
    command: command.command,
    status: command.status,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
  }));
}

async function markSandboxGateFailed(
  context: SandboxGateContext,
  run: AiCodingRun,
  error: LocalCodingSandboxGateError,
): Promise<void> {
  const currentOrchestration = isRecord(context.orchestratorPayload.orchestration)
    ? context.orchestratorPayload.orchestration
    : {};
  const failedPayload = {
    ...context.orchestratorPayload,
    sandboxVerification: {
      status: error.kind === "SANDBOX_BLOCKED" ? "BLOCKED" : "FAILED",
      gateStatus: "SANDBOX_NOT_VERIFIED",
      reason: error.message.slice(0, 1200),
      patchSha256: context.patchSha256,
      baseHeadSha: context.baseHeadSha,
      verifiedAt: new Date().toISOString(),
      ...(error.details ?? {}),
    },
    orchestration: {
      ...currentOrchestration,
      status: "READY_REVIEW",
      nextAction: "RUN_SANDBOX_VERIFICATION",
    },
  };

  await db.transaction(async (tx) => {
    await tx
      .update(aiCodingRunsTable)
      .set({
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: error.message.slice(0, 2000),
        logs: JSON.stringify({
          executionStatus: "FAILED",
          gateStatus: "SANDBOX_NOT_VERIFIED",
          kind: error.kind,
          error: error.message.slice(0, 1200),
          nextAction: "RUN_SANDBOX_VERIFICATION",
        }, null, 2),
      })
      .where(eq(aiCodingRunsTable.id, run.id));

    await tx
      .update(aiCodingRunsTable)
      .set({ logs: JSON.stringify(failedPayload, null, 2) })
      .where(eq(aiCodingRunsTable.id, context.orchestratorRun.id));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "READY_REVIEW",
        resultSummary:
          "Sandbox verification did not pass: " +
          error.message.slice(0, 500) +
          " Commit approval remains locked.",
      })
      .where(eq(aiCodingTasksTable.id, context.task.id));
  }).catch(() => undefined);
}

async function executeSandboxGate(
  context: SandboxGateContext,
  run: AiCodingRun,
): Promise<void> {
  let workspacePath: string | null = null;
  let patchFile: string | null = null;

  try {
    const workspace = await prepareRepositoryWorkspace(
      context.task.repository,
      context.task.branch,
    );
    if (!workspace.cleanup) {
      throw new LocalCodingSandboxGateError(
        "Sandbox verification only runs against an isolated remote clone",
        "INVALID_PATCH",
      );
    }
    workspacePath = workspace.path;

    const actualHead = (await git(workspacePath, ["rev-parse", "HEAD"])).toLowerCase();
    if (actualHead !== context.baseHeadSha) {
      throw new LocalCodingSandboxGateError(
        `Repository HEAD changed from ${context.baseHeadSha} to ${actualHead}; rerun Local Coding Engine before sandbox verification`,
        "STALE_HEAD",
      );
    }

    patchFile = join(tmpdir(), `local-coding-sandbox-${randomUUID()}.diff`);
    await writeFile(patchFile, context.patch, "utf8");
    try {
      await git(workspacePath, ["apply", "--check", "--whitespace=error-all", patchFile]);
      await git(workspacePath, ["apply", "--whitespace=nowarn", patchFile]);
      await git(workspacePath, ["diff", "--check"]);
    } catch (error) {
      throw new LocalCodingSandboxGateError(
        "Validated patch no longer applies cleanly: " +
          (error instanceof Error ? error.message.slice(0, 700) : String(error)),
        "INVALID_PATCH",
      );
    }

    const appliedFiles = (await git(workspacePath, ["diff", "--name-only", "--"]))
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean)
      .map(safeRepoPath)
      .sort();
    if (!sameFiles(appliedFiles, context.changedFiles)) {
      throw new LocalCodingSandboxGateError(
        "Applied patch changed files outside the validated change set",
        "INVALID_PATCH",
      );
    }

    const staticIssues = await verifyChangedFilesStatically(
      workspacePath,
      context.changedFiles,
    );
    if (staticIssues.length > 0) {
      throw new LocalCodingSandboxGateError(
        (
          "Static verification rejected the sandbox candidate: " +
          (staticIssues[0]?.file ?? "unknown") + " " +
          (staticIssues[0]?.detail ?? "")
        ).trim(),
        "VERIFICATION_FAILED",
        {
          staticIssues: staticIssues.slice(0, 12),
        },
      );
    }

    const sandbox = await runSandboxedRepositoryVerification(
      workspacePath,
      context.verificationCommands,
    );
    if (sandbox.status === "BLOCKED") {
      throw new LocalCodingSandboxGateError(
        sandbox.warnings[0] ?? "Sandbox runtime is unavailable.",
        "SANDBOX_BLOCKED",
      );
    }
    if (sandbox.status !== "PASSED") {
      const failed = sandbox.commands.find((item) => item.status !== "PASSED")
        ?? (sandbox.dependencyBootstrap?.status !== "PASSED"
          ? sandbox.dependencyBootstrap
          : null);
      throw new LocalCodingSandboxGateError(
        failed
          ? `${failed.command} failed with ${failed.status}${failed.exitCode === null ? "" : ` (exit ${failed.exitCode})`}. Output was intentionally withheld from persistent logs.`
          : "Sandbox verification failed.",
        "VERIFICATION_FAILED",
        {
          failureContexts: sandbox.failureContexts,
          deterministicRetries: sandbox.deterministicRetries,
          commands: compactCommands(sandbox.commands),
        },
      );
    }

    const completedAt = new Date();
    const currentOrchestration = isRecord(context.orchestratorPayload.orchestration)
      ? context.orchestratorPayload.orchestration
      : {};
    const sandboxPayload = {
      ...context.orchestratorPayload,
      sandboxVerification: {
        status: "PASSED",
        gateStatus: "SANDBOX_VERIFIED",
        runtime: sandbox.runtime,
        image: sandbox.image,
        network: sandbox.network,
        patchSha256: context.patchSha256,
        baseHeadSha: context.baseHeadSha,
        verificationCommands: context.verificationCommands,
        commands: compactCommands(sandbox.commands),
        deterministicRetries: sandbox.deterministicRetries,
        failureContexts: [],
        dependencyBootstrap: sandbox.dependencyBootstrap
          ? {
              command: sandbox.dependencyBootstrap.command,
              status: sandbox.dependencyBootstrap.status,
              exitCode: sandbox.dependencyBootstrap.exitCode,
              durationMs: sandbox.dependencyBootstrap.durationMs,
            }
          : null,
        scriptsExecuted: sandbox.scriptsExecuted,
        warnings: sandbox.warnings,
        verifiedAt: completedAt.toISOString(),
      },
      orchestration: {
        ...currentOrchestration,
        status: "READY_REVIEW",
        nextAction: "APPROVE_COMMIT",
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
            gateStatus: "SANDBOX_VERIFIED",
            runtime: sandbox.runtime,
            image: sandbox.image,
            network: sandbox.network,
            commands: compactCommands(sandbox.commands),
            deterministicRetries: sandbox.deterministicRetries,
            failureContexts: [],
            dependencyBootstrap: sandbox.dependencyBootstrap
              ? {
                  status: sandbox.dependencyBootstrap.status,
                  durationMs: sandbox.dependencyBootstrap.durationMs,
                }
              : null,
            nextAction: "APPROVE_COMMIT",
          }, null, 2),
        })
        .where(eq(aiCodingRunsTable.id, run.id));

      await tx
        .update(aiCodingRunsTable)
        .set({ logs: JSON.stringify(sandboxPayload, null, 2) })
        .where(eq(aiCodingRunsTable.id, context.orchestratorRun.id));

      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "READY_REVIEW",
          resultSummary:
            context.verificationCommands.length > 0
              ? `Sandbox verification passed ${sandbox.commands.length} repository command(s) with network disabled. Ready for explicit commit approval.`
              : "No repository scripts were discovered. Static verification passed and the sandbox gate completed; ready for explicit commit approval.",
        })
        .where(eq(aiCodingTasksTable.id, context.task.id));
    });

    await logAudit(
      "coding-orchestrator",
      "sandbox_verification_passed",
      context.task.id,
      "coding_task",
      "success",
      {
        codingRunId: run.id,
        baseHeadSha: context.baseHeadSha,
        patchSha256: context.patchSha256,
        commands: sandbox.commands.map((item) => item.command),
        runtime: sandbox.runtime,
        network: sandbox.network,
      },
    );
  } catch (error) {
    const normalized =
      error instanceof LocalCodingSandboxGateError
        ? error
        : new LocalCodingSandboxGateError(
            error instanceof Error ? error.message : String(error),
            "VERIFICATION_FAILED",
          );
    await markSandboxGateFailed(context, run, normalized);
    await logAudit(
      "coding-orchestrator",
      "sandbox_verification_failed",
      context.task.id,
      "coding_task",
      "failure",
      {
        codingRunId: run.id,
        kind: normalized.kind,
        error: normalized.message.slice(0, 700),
      },
    ).catch(() => undefined);
  } finally {
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
    }
    if (patchFile) {
      await rm(patchFile, { force: true }).catch(() => undefined);
    }
  }
}

export async function startSandboxVerification(
  taskId: string,
): Promise<AiCodingRun> {
  const context = await latestSandboxContext(taskId);

  const [run] = await db.transaction(async (tx) => {
    const [lockedTask] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId))
      .for("update");
    if (!lockedTask) {
      throw new LocalCodingSandboxGateError("Coding task not found", "NOT_FOUND");
    }
    if (lockedTask.status !== "READY_REVIEW" || lockedTask.commitSha) {
      throw new LocalCodingSandboxGateError(
        "Coding task is not awaiting sandbox verification",
        "NOT_READY",
      );
    }

    const [activeRun] = await tx
      .select({ id: aiCodingRunsTable.id })
      .from(aiCodingRunsTable)
      .where(and(eq(aiCodingRunsTable.taskId, taskId), eq(aiCodingRunsTable.status, "RUNNING")))
      .limit(1);
    if (activeRun) {
      throw new LocalCodingSandboxGateError(
        "Coding task already has an active run",
        "NOT_READY",
      );
    }

    const [created] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId,
        agentName: "Sandbox Verification",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "TESTING",
        resultSummary:
          "Sandbox verification started in an isolated, network-disabled runtime. Commit approval remains locked until it passes.",
      })
      .where(eq(aiCodingTasksTable.id, taskId));

    return [created];
  });

  await logAudit(
    "coding-orchestrator",
    "sandbox_verification_started",
    taskId,
    "coding_task",
    "success",
    {
      codingRunId: run.id,
      baseHeadSha: context.baseHeadSha,
      verificationCommands: context.verificationCommands,
    },
  );

  void executeSandboxGate(context, run);
  return run;
}
