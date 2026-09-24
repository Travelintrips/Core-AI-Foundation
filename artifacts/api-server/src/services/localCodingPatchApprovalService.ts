import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { promisify } from "node:util";
import { desc, eq } from "drizzle-orm";
import {
  aiCodeChangesTable,
  aiCodingRunsTable,
  aiCodingTasksTable,
  db,
  type AiCodingRun,
  type AiCodingTask,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { isSensitiveRepositoryPath } from "./localCodingEngineService.js";
import { verifyChangedFilesStatically } from "./localCodingVerificationService.js";
import { prepareRepositoryWorkspace } from "./repositoryAnalyzerService.js";

const execFileAsync = promisify(execFile);

const MAX_PATCH_BYTES = 400_000;
const MAX_CHANGED_FILES = 40;
const GIT_TIMEOUT_MS = 30_000;

export class LocalPatchApprovalError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_HEAD"
      | "INVALID_PATCH"
      | "VERIFICATION_FAILED",
  ) {
    super(message);
    this.name = "LocalPatchApprovalError";
  }
}

interface LocalPatchContext {
  task: AiCodingTask;
  orchestratorRun: AiCodingRun;
  patch: string;
  expectedHeadSha: string;
  changedFiles: string[];
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
    throw new LocalPatchApprovalError(
      `Unsafe local patch path: ${value}`,
      "INVALID_PATCH",
    );
  }
  return normalized;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parsePatchHeaders(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split("\n")) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (!match) continue;
    if (match[1] !== match[2]) {
      throw new LocalPatchApprovalError(
        "Renamed files are not supported by the deterministic local patch gate.",
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

async function git(
  root: string,
  args: string[],
  options: { maxBuffer?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? 2 * 1024 * 1024,
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

async function latestLocalPatchContext(taskId: string): Promise<LocalPatchContext> {
  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId));

  if (!task) {
    throw new LocalPatchApprovalError("Coding task not found", "NOT_FOUND");
  }
  if (task.status !== "READY_REVIEW") {
    throw new LocalPatchApprovalError(
      "Coding task is not awaiting local patch approval",
      "NOT_READY",
    );
  }

  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));

  const orchestratorRun = runs.find(
    (run) =>
      run.agentName === "Coding Orchestrator" &&
      run.status === "COMPLETED" &&
      typeof run.logs === "string" &&
      run.logs.length > 0,
  );
  if (!orchestratorRun?.logs) {
    throw new LocalPatchApprovalError(
      "Completed Coding Orchestrator local patch was not found",
      "NOT_READY",
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(orchestratorRun.logs) as Record<string, unknown>;
  } catch {
    throw new LocalPatchApprovalError(
      "Coding Orchestrator local patch payload is invalid",
      "INVALID_PATCH",
    );
  }

  const orchestration =
    payload.orchestration &&
    typeof payload.orchestration === "object" &&
    !Array.isArray(payload.orchestration)
      ? (payload.orchestration as Record<string, unknown>)
      : null;
  const localExecution =
    payload.localExecution &&
    typeof payload.localExecution === "object" &&
    !Array.isArray(payload.localExecution)
      ? (payload.localExecution as Record<string, unknown>)
      : null;
  const contextPackage =
    payload.contextPackage &&
    typeof payload.contextPackage === "object" &&
    !Array.isArray(payload.contextPackage)
      ? (payload.contextPackage as Record<string, unknown>)
      : null;

  if (orchestration?.nextAction !== "REVIEW_LOCAL_PATCH") {
    throw new LocalPatchApprovalError(
      "Coding task is not at the REVIEW_LOCAL_PATCH gate",
      "NOT_READY",
    );
  }
  if (localExecution?.status !== "APPLIED" || localExecution.rolledBack === true) {
    throw new LocalPatchApprovalError(
      "Local patch was not successfully produced",
      "NOT_READY",
    );
  }

  const patch = typeof localExecution.patch === "string" ? localExecution.patch : "";
  if (!patch || Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) {
    throw new LocalPatchApprovalError(
      "Local patch is empty or exceeds the approval size limit",
      "INVALID_PATCH",
    );
  }
  if (
    patch.includes("[REDACTED_SENSITIVE_DIFF_LINE]") ||
    patch.includes("GIT binary patch") ||
    /(?:^|\n)Binary files /.test(patch) ||
    /(?:^|\n)(?:---|\+\+\+) \/dev\/null/.test(patch)
  ) {
    throw new LocalPatchApprovalError(
      "Local patch contains redacted, binary, added, or deleted file content that cannot pass this gate",
      "INVALID_PATCH",
    );
  }

  const expectedHeadSha =
    typeof contextPackage?.headSha === "string" ? contextPackage.headSha : "";
  if (!/^[0-9a-f]{40}$/i.test(expectedHeadSha)) {
    throw new LocalPatchApprovalError(
      "Local patch is missing a valid analyzed HEAD SHA",
      "INVALID_PATCH",
    );
  }

  const changedFiles = stringArray(localExecution.changedFiles).map(safeRepoPath);
  if (changedFiles.length === 0 || changedFiles.length > MAX_CHANGED_FILES) {
    throw new LocalPatchApprovalError(
      "Local patch changed-file list is empty or exceeds the approval limit",
      "INVALID_PATCH",
    );
  }
  const patchFiles = parsePatchHeaders(patch);
  if (!sameFiles(changedFiles, patchFiles)) {
    throw new LocalPatchApprovalError(
      "Local patch headers do not match the recorded changed-file list",
      "INVALID_PATCH",
    );
  }

  return {
    task,
    orchestratorRun,
    patch,
    expectedHeadSha: expectedHeadSha.toLowerCase(),
    changedFiles: [...new Set(changedFiles)].sort(),
  };
}

async function markGateFailed(
  taskId: string,
  runId: string,
  error: LocalPatchApprovalError | Error,
): Promise<void> {
  const message = error.message.slice(0, 2000);
  await db.transaction(async (tx) => {
    await tx
      .update(aiCodingRunsTable)
      .set({
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: message,
        logs: JSON.stringify({
          executionStatus: "FAILED",
          gateStatus: "REJECTED",
          error: message,
          commitCreated: false,
          pushed: false,
        }, null, 2),
      })
      .where(eq(aiCodingRunsTable.id, runId));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "READY_REVIEW",
        resultSummary: `Local patch approval failed: ${message}`,
      })
      .where(eq(aiCodingTasksTable.id, taskId));
  });
}

export async function approveAndValidateLocalPatch(taskId: string): Promise<AiCodingRun> {
  const context = await latestLocalPatchContext(taskId);

  const [run] = await db
    .insert(aiCodingRunsTable)
    .values({
      taskId,
      agentName: "Local Patch Gate",
      status: "RUNNING",
      startedAt: new Date(),
    })
    .returning();

  let workspacePath: string | null = null;
  let patchFile: string | null = null;

  try {
    const workspace = await prepareRepositoryWorkspace(
      context.task.repository,
      context.task.branch,
    );
    if (!workspace.cleanup) {
      throw new LocalPatchApprovalError(
        "Local patch approval only runs against an isolated remote clone",
        "INVALID_PATCH",
      );
    }
    workspacePath = workspace.path;

    const actualHead = (await git(workspacePath, ["rev-parse", "HEAD"])).toLowerCase();
    if (actualHead !== context.expectedHeadSha) {
      throw new LocalPatchApprovalError(
        `Repository HEAD changed from ${context.expectedHeadSha} to ${actualHead}; rerun Local Coding Engine before approval`,
        "STALE_HEAD",
      );
    }

    patchFile = join(tmpdir(), `local-coding-patch-${crypto.randomUUID()}.diff`);
    await writeFile(patchFile, context.patch, "utf8");

    try {
      await git(workspacePath, ["apply", "--check", "--whitespace=error-all", patchFile]);
      await git(workspacePath, ["apply", "--whitespace=nowarn", patchFile]);
      await git(workspacePath, ["diff", "--check"]);
    } catch (error) {
      throw new LocalPatchApprovalError(
        `Local patch no longer applies cleanly: ${error instanceof Error ? error.message.slice(0, 700) : String(error)}`,
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
      throw new LocalPatchApprovalError(
        "Applied patch changed files outside the approved deterministic change set",
        "INVALID_PATCH",
      );
    }

    const staticIssues = await verifyChangedFilesStatically(
      workspacePath,
      context.changedFiles,
    );
    if (staticIssues.length > 0) {
      throw new LocalPatchApprovalError(
        `Static verification rejected the applied patch: ${staticIssues[0]?.file ?? "unknown"} ${staticIssues[0]?.detail ?? ""}`.trim(),
        "VERIFICATION_FAILED",
      );
    }

    const patchSha256 = createHash("sha256")
      .update(context.patch, "utf8")
      .digest("hex");
    const completedAt = new Date();

    const [completedRun] = await db.transaction(async (tx) => {
      const [updatedRun] = await tx
        .update(aiCodingRunsTable)
        .set({
          status: "COMPLETED",
          finishedAt: completedAt,
          errorMessage: null,
          logs: JSON.stringify({
            executionStatus: "COMPLETED",
            gateStatus: "PATCH_VALIDATED",
            baseHeadSha: context.expectedHeadSha,
            patchSha256,
            changedFiles: context.changedFiles,
            staticVerification: "PASSED",
            nextAction: "ENABLE_GIT_WRITE_OR_EXPORT_PATCH",
            commitCreated: false,
            pushed: false,
          }, null, 2),
        })
        .where(eq(aiCodingRunsTable.id, run.id))
        .returning();

      for (const filePath of context.changedFiles) {
        await tx.insert(aiCodeChangesTable).values({
          taskId,
          filePath,
          changeType: "MODIFIED",
          commitSha: null,
        });
      }

      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "READY_REVIEW",
          resultSummary:
            `Deterministic patch revalidated against remote HEAD ${context.expectedHeadSha.slice(0, 12)}. ` +
            "Static verification passed; nothing was committed or pushed.",
        })
        .where(eq(aiCodingTasksTable.id, taskId));

      return [updatedRun];
    });

    await logAudit(
      "coding-orchestrator",
      "local_patch_validated",
      taskId,
      "coding_task",
      "success",
      {
        codingRunId: completedRun.id,
        orchestratorRunId: context.orchestratorRun.id,
        baseHeadSha: context.expectedHeadSha,
        changedFiles: context.changedFiles.length,
        commitCreated: false,
        pushed: false,
      },
    );

    return completedRun;
  } catch (error) {
    const normalized =
      error instanceof LocalPatchApprovalError
        ? error
        : new LocalPatchApprovalError(
            error instanceof Error ? error.message : String(error),
            "INVALID_PATCH",
          );
    await markGateFailed(taskId, run.id, normalized);
    await logAudit(
      "coding-orchestrator",
      "local_patch_validation_failed",
      taskId,
      "coding_task",
      "failure",
      {
        codingRunId: run.id,
        kind: normalized.kind,
        error: normalized.message.slice(0, 700),
      },
    );
    throw normalized;
  } finally {
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
    }
    if (patchFile) {
      await rm(patchFile, { force: true }).catch(() => undefined);
    }
  }
}
