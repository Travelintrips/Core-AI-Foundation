import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { logger } from "../lib/logger.js";
import { and, eq, sql } from "drizzle-orm";
import {
  aiCodingRunsTable,
  aiCodingTasksTable,
  aiJobsTable,
  db,
  type AiJob,
} from "@workspace/db";
import {
  buildLocalCodingContextPackage,
  type LocalCodingContextPackage,
} from "./localCodingEngineService.js";
import {
  executeLocalCodingPlan,
  planLocalCodingExecution,
  type LocalCodingExecutionPlan,
  type LocalCodingExecutionResult,
} from "./localCodingExecutorService.js";

const execFileAsync = promisify(execFile);
const CODING_ANALYZER_JOB_TYPE = "coding_repository_analyzer";
const MAX_FILES = 120;
const MAX_READ_BYTES = 400_000;
const MAX_FILE_BYTES = 80_000;
const CLONE_TIMEOUT_MS = 120_000;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);
const RELEVANT_FILE_NAMES = new Set([
  "cargo.toml",
  "dockerfile",
  "go.mod",
  "package.json",
  "pyproject.toml",
  "readme",
  "readme.md",
  "requirements.txt",
  "tsconfig.json",
]);
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".json",
  ".md",
  ".py",
  ".rs",
  ".sql",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
]);

export interface RepositoryAnalyzerResult {
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
  taskContext: {
    title: string;
    description: string;
  };
  contextPackage: LocalCodingContextPackage;
  localExecutionPlan: LocalCodingExecutionPlan;
  localExecution: LocalCodingExecutionResult | null;
}

interface AnalyzerInput {
  codingTaskId: string;
  codingRunId: string;
  repository: string;
  branch: string;
  title: string;
  description: string;
}

interface RepositoryWorkspace {
  path: string;
  cleanup: boolean;
}

function getPayload(job: AiJob): Record<string, unknown> {
  return (job.payloadJson ?? {}) as Record<string, unknown>;
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Repository Analyzer payload is missing '${key}'`);
  }
  return value.trim();
}

function normalizeRemoteRepository(repository: string): string {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return `https://github.com/${repository.replace(/\/+$/, "")}.git`;
  }

  let parsed: URL;
  try {
    parsed = new URL(repository);
  } catch {
    throw new Error(
      "Repository target must be a local directory, owner/repo, or an HTTPS GitHub/GitLab URL",
    );
  }

  if (
    parsed.protocol !== "https:" ||
    !["github.com", "gitlab.com"].includes(parsed.hostname.toLowerCase())
  ) {
    throw new Error("Repository Analyzer only accepts HTTPS GitHub or GitLab targets");
  }
  return parsed.toString();
}

async function prepareRepositoryWorkspace(
  repository: string,
  branch: string,
): Promise<RepositoryWorkspace> {
  const looksLocal =
    isAbsolute(repository) ||
    repository.startsWith("./") ||
    repository.startsWith("../") ||
    repository === "." ||
    repository === "..";

  if (looksLocal) {
    const localPath = resolve(repository);
    const info = await stat(localPath).catch(() => null);
    if (!info?.isDirectory()) {
      throw new Error(`Local repository directory does not exist: ${repository}`);
    }
    return { path: localPath, cleanup: false };
  }

  const remote = normalizeRemoteRepository(repository);
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-")) {
    throw new Error("Repository branch contains unsupported characters");
  }

  const workspace = join(tmpdir(), `coding-analyzer-${crypto.randomUUID()}`);
  await mkdir(workspace, { recursive: true });

  try {
    await execFileAsync(
      "git",
      [
        "clone",
        "--depth",
        "50",
        "--no-tags",
        "--single-branch",
        "--branch",
        branch,
        remote,
        workspace,
      ],
      { timeout: CLONE_TIMEOUT_MS, maxBuffer: 64 * 1024 },
    );
    return { path: workspace, cleanup: true };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Repository clone failed: ${detail.slice(0, 500)}`);
  }
}

async function collectFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (files.length >= MAX_FILES) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
        await visit(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;

      const filePath = join(directory, entry.name);
      const relativePath = relative(root, filePath);
      const fileName = basename(entry.name).toLowerCase();
      const extension = extname(entry.name).toLowerCase();
      if (RELEVANT_FILE_NAMES.has(fileName) || TEXT_EXTENSIONS.has(extension)) {
        files.push(relativePath);
      }
    }
  };

  await visit(root);
  return files;
}

async function readInspectableFiles(
  root: string,
  files: string[],
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  let bytesRead = 0;

  for (const file of files) {
    if (bytesRead >= MAX_READ_BYTES) break;
    const filePath = join(root, file);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile() || info.size > MAX_FILE_BYTES) continue;

    const remaining = Math.min(MAX_FILE_BYTES, MAX_READ_BYTES - bytesRead);
    const content = await readFile(filePath, "utf8").catch(() => "");
    const clipped = content.slice(0, remaining);
    bytesRead += Buffer.byteLength(clipped, "utf8");
    contents.set(file, clipped);
  }

  return contents;
}

async function analyzeRepository(input: AnalyzerInput): Promise<RepositoryAnalyzerResult> {
  const workspace = await prepareRepositoryWorkspace(input.repository, input.branch);
  try {
    const contextPackage = await buildLocalCodingContextPackage({
      root: workspace.path,
      repository: input.repository,
      requestedBranch: input.branch,
      task: `${input.title}\n${input.description}`,
    });

    const localExecutionPlan = planLocalCodingExecution(
      `${input.title}\n${input.description}`,
      contextPackage,
    );
    const localExecution =
      workspace.cleanup && localExecutionPlan.status === "EXECUTABLE"
        ? await executeLocalCodingPlan(workspace.path, localExecutionPlan, {
            trustedWorkspace: true,
            expectedHeadSha: contextPackage.headSha,
            runVerification: false,
          })
        : null;

    const relevantFiles = contextPackage.relevantFiles.map((item) => item.path);
    const filesInspected = [...new Set([
      ...relevantFiles,
      ...contextPackage.affectedFiles,
      ...contextPackage.relatedTests,
    ])].slice(0, 200);
    const findings: RepositoryAnalyzerResult["findings"] = [
      {
        severity: "info",
        title: "Local repository index complete",
        detail:
          `Indexed ${contextPackage.index.filesIndexed} files and parsed ${contextPackage.index.sourceFilesParsed} ` +
          `TypeScript/JavaScript source files locally using ${contextPackage.index.searchBackend}.`,
      },
      {
        severity: "info",
        title: "Relevant context selected",
        detail:
          `Selected ${relevantFiles.length} ranked relevant files, ${contextPackage.affectedFiles.length} bounded ` +
          `affected files, and ${contextPackage.symbols.length} symbols without loading the whole repository into AI context.`,
        ...(relevantFiles[0] ? { file: relevantFiles[0] } : {}),
      },
      {
        severity: "info",
        title: "Git context captured",
        detail:
          `Branch ${contextPackage.branch}, HEAD ${contextPackage.headSha.slice(0, 12)}, ` +
          `${contextPackage.changedFiles.length} changed files, and ${contextPackage.recentCommits.length} recent relevant commits.`,
      },
      {
        severity: "info",
        title: "Tests and verification discovered",
        detail:
          `${contextPackage.relatedTests.length} related tests, ${contextPackage.testFrameworks.length} test framework(s), ` +
          `and ${contextPackage.verificationCommands.length} allowlisted verification command(s) are available.`,
      },
    ];

    if (localExecutionPlan.status === "EXECUTABLE") {
      if (localExecution?.status === "APPLIED") {
        findings.push({
          severity: "info",
          title: "Deterministic local patch produced",
          detail:
            `Local Coding Executor changed ${localExecution.changedFiles.length} file(s) in the temporary clone. ` +
            "Repository scripts were not executed and the patch is review-only.",
          ...(localExecution.changedFiles[0] ? { file: localExecution.changedFiles[0] } : {}),
        });
      } else if (!workspace.cleanup) {
        findings.push({
          severity: "warning",
          title: "Local execution requires isolated workspace",
          detail:
            "A deterministic edit plan was found, but the analyzer was pointed at a local checkout. " +
            "Automatic writes are disabled for non-temporary workspaces.",
        });
      } else if (localExecution) {
        findings.push({
          severity: "warning",
          title: "Local executor did not produce a patch",
          detail: localExecution.reason,
        });
      }
    } else {
      findings.push({
        severity: "info",
        title: "Semantic reasoning required",
        detail:
          "The Local Coding Executor found no safe deterministic edit recipe and made no file changes. " +
          "This task may be escalated to AI reasoning using the bounded context package.",
      });
    }

    if (relevantFiles.length === 0) {
      findings.push({
        severity: "warning",
        title: "No task-relevant source file ranked",
        detail: "Local indexing completed, but the task keywords did not produce a confident relevant-file match.",
      });
    }
    for (const warning of contextPackage.warnings.slice(0, 8)) {
      findings.push({ severity: "warning", title: "Local engine warning", detail: warning });
    }

    const recommendedChanges = [
      ...(localExecution?.status === "APPLIED"
        ? ["Review the deterministic local patch before applying it to the repository branch."]
        : localExecutionPlan.status === "AI_REQUIRED"
          ? ["Use AI reasoning only if needed; the deterministic executor refused to guess at semantic code changes."]
          : ["Review the ranked relevant files and bounded dependency neighborhood before code changes."]),
      ...(contextPackage.verificationCommands.length > 0
        ? [`Use only discovered allowlisted verification commands: ${contextPackage.verificationCommands.join(", ")}`]
        : ["No safe verification script was discovered; add or identify deterministic verification before code changes."]),
      ...(contextPackage.relatedTests.length === 0
        ? ["Add or identify tests covering the affected files before code changes."]
        : []),
    ];

    const executionSummary =
      localExecution?.status === "APPLIED"
        ? ` Local Coding Executor produced a review-only patch for ${localExecution.changedFiles.length} file(s).`
        : localExecutionPlan.status === "AI_REQUIRED"
          ? " Local Coding Executor classified the task as AI_REQUIRED and made no changes."
          : " Local Coding Executor did not modify the repository.";
    const summary =
      `Local Coding Engine indexed ${contextPackage.index.filesIndexed} files, selected ${relevantFiles.length} relevant ` +
      `files and ${contextPackage.affectedFiles.length} affected files on ${contextPackage.branch} at ` +
      `${contextPackage.headSha.slice(0, 12)}.${executionSummary} No AI/LLM was used.`;

    return {
      codingTaskId: input.codingTaskId,
      codingRunId: input.codingRunId,
      executionStatus: "COMPLETED",
      summary,
      sourceTarget: input.repository,
      branch: contextPackage.branch,
      filesInspected,
      relevantFiles,
      findings,
      recommendedChanges,
      taskContext: {
        title: input.title,
        description: input.description,
      },
      contextPackage,
      localExecutionPlan,
      localExecution,
    };
  } finally {
    if (workspace.cleanup) {
      await rm(workspace.path, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function executeRepositoryAnalyzerJob(job: AiJob): Promise<Record<string, unknown>> {
  const payload = getPayload(job);
  const input: AnalyzerInput = {
    codingTaskId: requiredString(payload, "codingTaskId"),
    codingRunId: requiredString(payload, "codingRunId"),
    repository: requiredString(payload, "repository"),
    branch: requiredString(payload, "branch"),
    title: requiredString(payload, "title"),
    description: requiredString(payload, "description"),
  };

  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, input.codingTaskId));
  if (!task) throw new Error(`Coding task ${input.codingTaskId} not found`);

  const result = await analyzeRepository(input);
  return result as unknown as Record<string, unknown>;
}

function serializeResult(result: Record<string, unknown>): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Execute exactly one queued Repository Analyzer job inside the API process.
 *
 * Production's global dispatcher remains fail-closed. Coding Workspace runs are
 * user-triggered and bounded, so this path claims only the job created by the
 * current Run Agent request and never drains unrelated queue work.
 */
export async function executeRepositoryAnalyzerJobOnDemand(
  job: AiJob,
  options: { finalizeCodingRun?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const finalizeCodingRun = options.finalizeCodingRun ?? true;
  if (job.jobType !== CODING_ANALYZER_JOB_TYPE) {
    logger.warn({ jobId: job.id, jobType: job.jobType }, "[coding-analyzer] Ignoring non-analyzer on-demand job");
    return null;
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

  // A future explicitly-enabled dispatcher may win the claim first. In that
  // case it owns completion; do not execute the same repository twice.
  if (!claimed) {
    logger.info({ jobId: job.id }, "[coding-analyzer] Job already claimed by another executor");
    return null;
  }

  try {
    const result = await executeRepositoryAnalyzerJob(claimed);

    // Legacy direct execution finalizes the Coding Workspace run here. The
    // Coding Orchestrator disables this so it can continue into Planner before
    // completing the user-facing run.
    if (finalizeCodingRun) {
      await completeRepositoryAnalyzerRun(result);
    }

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
      { jobId: claimed.id, codingRunId: result.codingRunId },
      "[coding-analyzer] On-demand analysis completed",
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = new Date();

    if (finalizeCodingRun) {
      await failRepositoryAnalyzerRun(
        (claimed.payloadJson ?? {}) as Record<string, unknown>,
        message,
      ).catch((persistError) => {
        logger.error(
          { err: persistError, jobId: claimed.id },
          "[coding-analyzer] Failed to persist analyzer failure",
        );
      });
    }

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
          "[coding-analyzer] Failed to persist failed job state",
        );
      });

    logger.error(
      { err: error, jobId: claimed.id },
      "[coding-analyzer] On-demand analysis failed",
    );

    if (!finalizeCodingRun) {
      throw error;
    }
    return null;
  }
}

/**
 * Fail abandoned RUNNING analyzer rows after a generous timeout. This repairs
 * legacy/orphan runs left behind when queue execution was not active and also
 * prevents a crashed process from disabling Run Agent forever.
 */
export async function failStaleRepositoryAnalyzerRuns(
  staleAfterMs = 15 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const staleRuns = await db
    .select({
      id: aiCodingRunsTable.id,
      taskId: aiCodingRunsTable.taskId,
    })
    .from(aiCodingRunsTable)
    .where(
      and(
        eq(aiCodingRunsTable.status, "RUNNING"),
        sql`${aiCodingRunsTable.startedAt} IS NOT NULL`,
        sql`${aiCodingRunsTable.startedAt} < ${cutoff}`,
      ),
    );

  for (const run of staleRuns) {
    await failRepositoryAnalyzerRun(
      { codingTaskId: run.taskId, codingRunId: run.id },
      "Repository Analyzer run was abandoned before completion and has been recovered.",
    );
  }

  return staleRuns.length;
}

export async function completeRepositoryAnalyzerRun(
  result: Record<string, unknown>,
): Promise<void> {
  const codingRunId = typeof result.codingRunId === "string" ? result.codingRunId : null;
  const codingTaskId = typeof result.codingTaskId === "string" ? result.codingTaskId : null;
  const summary = typeof result.summary === "string" ? result.summary : "Repository analysis completed.";
  if (!codingRunId || !codingTaskId) {
    throw new Error("Repository Analyzer result is missing codingRunId or codingTaskId");
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    const [updatedRun] = await tx
      .update(aiCodingRunsTable)
      .set({
        status: "COMPLETED",
        finishedAt: now,
        logs: serializeResult(result),
        errorMessage: null,
      })
      .where(and(eq(aiCodingRunsTable.id, codingRunId), eq(aiCodingRunsTable.status, "RUNNING")))
      .returning({ id: aiCodingRunsTable.id });

    if (!updatedRun) return;

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "READY_REVIEW",
        resultSummary: summary,
      })
      .where(eq(aiCodingTasksTable.id, codingTaskId));
  });
}

export async function failRepositoryAnalyzerRun(
  payload: Record<string, unknown>,
  errorMessage: string,
): Promise<void> {
  const codingRunId = typeof payload.codingRunId === "string" ? payload.codingRunId : null;
  const codingTaskId = typeof payload.codingTaskId === "string" ? payload.codingTaskId : null;
  if (!codingRunId || !codingTaskId) return;

  const now = new Date();
  const failure = {
    codingTaskId,
    codingRunId,
    executionStatus: "FAILED",
    error: errorMessage,
  };

  await db.transaction(async (tx) => {
    const [updatedRun] = await tx
      .update(aiCodingRunsTable)
      .set({
        status: "FAILED",
        finishedAt: now,
        logs: serializeResult(failure),
        errorMessage: errorMessage.slice(0, 2000),
      })
      .where(and(eq(aiCodingRunsTable.id, codingRunId), eq(aiCodingRunsTable.status, "RUNNING")))
      .returning({ id: aiCodingRunsTable.id });

    if (!updatedRun) return;

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "FAILED",
        resultSummary: `Repository Analyzer failed: ${errorMessage.slice(0, 500)}`,
      })
      .where(eq(aiCodingTasksTable.id, codingTaskId));
  });
}

export { CODING_ANALYZER_JOB_TYPE };