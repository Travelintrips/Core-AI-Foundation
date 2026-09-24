import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
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
import { logAudit } from "./aiAuditService.js";
import { isSensitiveRepositoryPath } from "./localCodingEngineService.js";
import {
  createGitHubApiClient,
  GitHubPublisherError,
  parseGitHubRepository,
  publishVerifiedPatchToGitHub,
  rollbackPublishedPullRequest,
  type GitHubApiClient,
  type GitHubPublishFile,
  type GitHubPublishResult,
} from "./localCodingGitHubPublisherService.js";
import { verifyChangedFilesStatically } from "./localCodingVerificationService.js";
import { prepareRepositoryWorkspace } from "./repositoryAnalyzerService.js";

const execFileAsync = promisify(execFile);

const MAX_PATCH_BYTES = 400_000;
const MAX_CHANGED_FILES = 40;
const MAX_FILE_BYTES = 512_000;
const MAX_TOTAL_FILE_BYTES = 1_500_000;
const GIT_TIMEOUT_MS = 30_000;

export class LocalCommitApprovalError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_HEAD"
      | "INVALID_PATCH"
      | "VERIFICATION_FAILED"
      | "GITHUB_AUTH"
      | "INVALID_REPOSITORY"
      | "PUBLISH_FAILED",
  ) {
    super(message);
    this.name = "LocalCommitApprovalError";
  }
}

interface LocalCommitContext {
  task: AiCodingTask;
  orchestratorRun: AiCodingRun;
  orchestratorPayload: Record<string, unknown>;
  patch: string;
  patchSha256: string;
  baseHeadSha: string;
  changedFiles: string[];
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
    throw new LocalCommitApprovalError(
      "Unsafe commit path: " + value,
      "INVALID_PATCH",
    );
  }
  return normalized;
}

function sameFiles(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function parsePatchFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split("\n")) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (!match) continue;
    if (match[1] !== match[2]) {
      throw new LocalCommitApprovalError(
        "Commit approval does not support renamed files.",
        "INVALID_PATCH",
      );
    }
    files.add(safeRepoPath(match[1]));
  }
  return [...files].sort();
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

async function latestCommitContext(taskId: string): Promise<LocalCommitContext> {
  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId));

  if (!task) {
    throw new LocalCommitApprovalError("Coding task not found", "NOT_FOUND");
  }
  if (task.status !== "READY_REVIEW" || task.commitSha) {
    throw new LocalCommitApprovalError(
      "Coding task is not awaiting commit approval",
      "NOT_READY",
    );
  }

  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));

  if (runs.some((run) => run.status === "RUNNING")) {
    throw new LocalCommitApprovalError(
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
    throw new LocalCommitApprovalError(
      "Completed Coding Orchestrator payload was not found",
      "NOT_READY",
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(orchestratorRun.logs) as Record<string, unknown>;
  } catch {
    throw new LocalCommitApprovalError(
      "Coding Orchestrator payload is invalid",
      "INVALID_PATCH",
    );
  }

  const orchestration = isRecord(payload.orchestration) ? payload.orchestration : null;
  const localPatchApproval = isRecord(payload.localPatchApproval)
    ? payload.localPatchApproval
    : null;
  const localExecution = isRecord(payload.localExecution) ? payload.localExecution : null;

  if (orchestration?.nextAction !== "APPROVE_COMMIT") {
    throw new LocalCommitApprovalError(
      "Coding task is not at the APPROVE_COMMIT gate",
      "NOT_READY",
    );
  }
  if (
    localPatchApproval?.gateStatus !== "PATCH_VALIDATED" ||
    localPatchApproval.commitCreated === true ||
    localPatchApproval.pushed === true
  ) {
    throw new LocalCommitApprovalError(
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
    throw new LocalCommitApprovalError(
      "Validated local patch is missing or contains unsupported content",
      "INVALID_PATCH",
    );
  }

  const patchSha256 =
    typeof localPatchApproval.patchSha256 === "string"
      ? localPatchApproval.patchSha256.toLowerCase()
      : "";
  const actualPatchSha256 = createHash("sha256").update(patch, "utf8").digest("hex");
  if (!/^[0-9a-f]{64}$/.test(patchSha256) || actualPatchSha256 !== patchSha256) {
    throw new LocalCommitApprovalError(
      "Validated local patch digest no longer matches the review payload",
      "INVALID_PATCH",
    );
  }

  const baseHeadSha =
    typeof localPatchApproval.baseHeadSha === "string"
      ? localPatchApproval.baseHeadSha.toLowerCase()
      : "";
  if (!/^[0-9a-f]{40}$/.test(baseHeadSha)) {
    throw new LocalCommitApprovalError(
      "Validated local patch is missing a valid base HEAD SHA",
      "INVALID_PATCH",
    );
  }

  const changedFiles = stringArray(localPatchApproval.changedFiles).map(safeRepoPath);
  if (changedFiles.length === 0 || changedFiles.length > MAX_CHANGED_FILES) {
    throw new LocalCommitApprovalError(
      "Validated local patch changed-file list is empty or too large",
      "INVALID_PATCH",
    );
  }
  if (!sameFiles(changedFiles, parsePatchFiles(patch))) {
    throw new LocalCommitApprovalError(
      "Validated patch headers no longer match the approved changed-file list",
      "INVALID_PATCH",
    );
  }

  try {
    parseGitHubRepository(task.repository);
  } catch (error) {
    throw new LocalCommitApprovalError(
      error instanceof Error ? error.message : String(error),
      "INVALID_REPOSITORY",
    );
  }

  return {
    task,
    orchestratorRun,
    orchestratorPayload: payload,
    patch,
    patchSha256,
    baseHeadSha,
    changedFiles: [...new Set(changedFiles)].sort(),
  };
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(".." + sep));
}

async function readPublishFiles(
  root: string,
  changedFiles: string[],
): Promise<GitHubPublishFile[]> {
  const absoluteRoot = resolve(root);
  const resolvedRoot = await realpath(absoluteRoot);
  let totalBytes = 0;
  const files: GitHubPublishFile[] = [];

  for (const file of changedFiles) {
    const normalized = safeRepoPath(file);
    const candidate = resolve(absoluteRoot, normalized);
    if (!isInsideRoot(absoluteRoot, candidate)) {
      throw new LocalCommitApprovalError(
        "Commit path escapes repository root: " + normalized,
        "INVALID_PATCH",
      );
    }

    const info = await lstat(candidate).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) {
      throw new LocalCommitApprovalError(
        "Commit path must remain an existing regular file: " + normalized,
        "INVALID_PATCH",
      );
    }
    if (info.size > MAX_FILE_BYTES) {
      throw new LocalCommitApprovalError(
        "Commit file exceeds " + MAX_FILE_BYTES + " bytes: " + normalized,
        "INVALID_PATCH",
      );
    }

    const resolvedFile = await realpath(candidate);
    if (!isInsideRoot(resolvedRoot, resolvedFile)) {
      throw new LocalCommitApprovalError(
        "Commit file resolves outside repository root: " + normalized,
        "INVALID_PATCH",
      );
    }

    const fileContent = await readFile(resolvedFile, "utf8");
    totalBytes += Buffer.byteLength(fileContent, "utf8");
    if (totalBytes > MAX_TOTAL_FILE_BYTES) {
      throw new LocalCommitApprovalError(
        "Commit file contents exceed " + MAX_TOTAL_FILE_BYTES + " bytes",
        "INVALID_PATCH",
      );
    }
    files.push({ path: normalized, content: fileContent });
  }

  return files;
}

function withCommitPublication(
  payload: Record<string, unknown>,
  publication: GitHubPublishResult,
): Record<string, unknown> {
  const orchestration = isRecord(payload.orchestration) ? payload.orchestration : {};
  return {
    ...payload,
    localCommitApproval: {
      status: "PUBLISHED",
      branch: publication.branch,
      baseBranch: publication.baseBranch,
      baseHeadSha: publication.baseSha,
      commitSha: publication.commitSha,
      pullRequestNumber: publication.pullRequestNumber,
      pullRequestUrl: publication.pullRequestUrl,
      commitCreated: true,
      pushed: true,
      autoMerged: false,
      publishedAt: new Date().toISOString(),
    },
    orchestration: {
      ...orchestration,
      status: "PR_CREATED",
      nextAction: "REVIEW_PR",
    },
  };
}

async function markCommitGateFailed(
  context: LocalCommitContext,
  run: AiCodingRun,
  error: LocalCommitApprovalError,
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
          error: error.message,
          nextAction: "APPROVE_COMMIT",
          commitCreated: false,
          pushed: false,
        }, null, 2),
      })
      .where(eq(aiCodingRunsTable.id, run.id));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "READY_REVIEW",
        resultSummary:
          "Commit approval failed: " + error.message.slice(0, 500) + " Nothing was merged.",
      })
      .where(eq(aiCodingTasksTable.id, context.task.id));
  }).catch(() => undefined);
}

async function executeCommitApproval(
  context: LocalCommitContext,
  run: AiCodingRun,
  client: GitHubApiClient,
): Promise<void> {
  let workspacePath: string | null = null;
  let patchFile: string | null = null;
  let publication: GitHubPublishResult | null = null;

  try {
    const workspace = await prepareRepositoryWorkspace(
      context.task.repository,
      context.task.branch,
    );
    if (!workspace.cleanup) {
      throw new LocalCommitApprovalError(
        "Commit approval only runs against an isolated remote clone",
        "INVALID_PATCH",
      );
    }
    workspacePath = workspace.path;

    const actualHead = (await git(workspacePath, ["rev-parse", "HEAD"])).toLowerCase();
    if (actualHead !== context.baseHeadSha) {
      throw new LocalCommitApprovalError(
        "Repository HEAD changed from " + context.baseHeadSha + " to " + actualHead +
          "; rerun Local Coding Engine before commit approval",
        "STALE_HEAD",
      );
    }

    patchFile = join(tmpdir(), "local-coding-commit-" + randomUUID() + ".diff");
    await writeFile(patchFile, context.patch, "utf8");
    try {
      await git(workspacePath, ["apply", "--check", "--whitespace=error-all", patchFile]);
      await git(workspacePath, ["apply", "--whitespace=nowarn", patchFile]);
      await git(workspacePath, ["diff", "--check"]);
    } catch (error) {
      throw new LocalCommitApprovalError(
        "Validated patch no longer applies cleanly: " +
          (error instanceof Error ? error.message.slice(0, 700) : String(error)),
        "INVALID_PATCH",
      );
    }

    const nameStatus = (await git(workspacePath, ["diff", "--name-status", "--"]))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const appliedFiles: string[] = [];
    for (const line of nameStatus) {
      const parts = line.split("\t");
      const status = parts[0];
      const rawPath = parts[1];
      if (status !== "M" || !rawPath) {
        throw new LocalCommitApprovalError(
          "Commit gate only publishes modifications to already-approved existing files",
          "INVALID_PATCH",
        );
      }
      appliedFiles.push(safeRepoPath(rawPath));
    }
    if (!sameFiles(appliedFiles, context.changedFiles)) {
      throw new LocalCommitApprovalError(
        "Applied patch changed files outside the validated change set",
        "INVALID_PATCH",
      );
    }

    const staticIssues = await verifyChangedFilesStatically(
      workspacePath,
      context.changedFiles,
    );
    if (staticIssues.length > 0) {
      throw new LocalCommitApprovalError(
        (
          "Static verification rejected the commit candidate: " +
          (staticIssues[0]?.file ?? "unknown") + " " +
          (staticIssues[0]?.detail ?? "")
        ).trim(),
        "VERIFICATION_FAILED",
      );
    }

    const files = await readPublishFiles(workspacePath, context.changedFiles);
    publication = await publishVerifiedPatchToGitHub(
      {
        repository: context.task.repository,
        baseBranch: context.task.branch,
        expectedBaseSha: context.baseHeadSha,
        taskNumber: context.task.taskNumber,
        taskId: context.task.id,
        projectName: context.task.projectName,
        patchSha256: context.patchSha256,
        files,
      },
      client,
    );

    const publishedPayload = withCommitPublication(
      context.orchestratorPayload,
      publication,
    );
    const completedAt = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(aiCodingRunsTable)
        .set({
          status: "COMPLETED",
          finishedAt: completedAt,
          errorMessage: null,
          logs: JSON.stringify({
            executionStatus: "COMPLETED",
            branch: publication!.branch,
            commitSha: publication!.commitSha,
            pullRequestNumber: publication!.pullRequestNumber,
            pullRequestUrl: publication!.pullRequestUrl,
            nextAction: "REVIEW_PR",
            commitCreated: true,
            pushed: true,
            autoMerged: false,
          }, null, 2),
        })
        .where(eq(aiCodingRunsTable.id, run.id));

      await tx
        .update(aiCodingRunsTable)
        .set({ logs: JSON.stringify(publishedPayload, null, 2) })
        .where(eq(aiCodingRunsTable.id, context.orchestratorRun.id));

      await tx
        .update(aiCodeChangesTable)
        .set({ commitSha: publication!.commitSha })
        .where(eq(aiCodeChangesTable.taskId, context.task.id));

      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "PR_CREATED",
          commitSha: publication!.commitSha,
          resultSummary:
            "Commit " + publication!.commitSha.slice(0, 12) +
            " published on " + publication!.branch +
            ". Pull request #" + publication!.pullRequestNumber +
            " is ready for review. Nothing was auto-merged.",
        })
        .where(eq(aiCodingTasksTable.id, context.task.id));
    });

    await logAudit(
      "coding-orchestrator",
      "local_commit_pr_created",
      context.task.id,
      "coding_task",
      "success",
      {
        codingRunId: run.id,
        branch: publication.branch,
        commitSha: publication.commitSha,
        pullRequestNumber: publication.pullRequestNumber,
        autoMerged: false,
      },
    );
  } catch (error) {
    if (publication) {
      await rollbackPublishedPullRequest(publication, client).catch(() => undefined);
    }
    const normalized =
      error instanceof LocalCommitApprovalError
        ? error
        : error instanceof GitHubPublisherError
          ? new LocalCommitApprovalError(
              error.message,
              error.kind === "AUTH_REQUIRED"
                ? "GITHUB_AUTH"
                : error.kind === "STALE_HEAD"
                  ? "STALE_HEAD"
                  : "PUBLISH_FAILED",
            )
          : new LocalCommitApprovalError(
              error instanceof Error ? error.message : String(error),
              "PUBLISH_FAILED",
            );
    await markCommitGateFailed(context, run, normalized);
    await logAudit(
      "coding-orchestrator",
      "local_commit_pr_failed",
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

export async function approveCommitAndCreatePullRequest(
  taskId: string,
): Promise<AiCodingRun> {
  const context = await latestCommitContext(taskId);
  const token = process.env["AI_CODING_GITHUB_TOKEN"]?.trim() ?? "";
  if (!token) {
    throw new LocalCommitApprovalError(
      "AI_CODING_GITHUB_TOKEN is not configured; commit and PR creation remain fail-closed.",
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
      throw new LocalCommitApprovalError("Coding task not found", "NOT_FOUND");
    }
    if (lockedTask.status !== "READY_REVIEW" || lockedTask.commitSha) {
      throw new LocalCommitApprovalError(
        "Coding task is not awaiting commit approval",
        "NOT_READY",
      );
    }

    const [activeRun] = await tx
      .select({ id: aiCodingRunsTable.id })
      .from(aiCodingRunsTable)
      .where(and(eq(aiCodingRunsTable.taskId, taskId), eq(aiCodingRunsTable.status, "RUNNING")))
      .limit(1);
    if (activeRun) {
      throw new LocalCommitApprovalError(
        "Coding task already has an active run",
        "NOT_READY",
      );
    }

    const [created] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId,
        agentName: "Local Commit Gate",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "COMMITTING",
        resultSummary:
          "Explicit commit approval accepted. Preparing a task branch and pull request; main will not be modified directly.",
      })
      .where(eq(aiCodingTasksTable.id, taskId));

    return [created];
  });

  await logAudit(
    "coding-orchestrator",
    "local_commit_approval_started",
    taskId,
    "coding_task",
    "success",
    {
      codingRunId: run.id,
      baseHeadSha: context.baseHeadSha,
      changedFiles: context.changedFiles.length,
      targetBranch: context.task.branch,
    },
  );

  void executeCommitApproval(context, run, client);
  return run;
}
