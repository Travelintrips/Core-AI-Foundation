import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import {
  aiCodingRunsTable,
  aiCodingTasksTable,
  db,
  type AiJob,
} from "@workspace/db";

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
        "1",
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
    const filesInspected = await collectFiles(workspace.path);
    const contents = await readInspectableFiles(workspace.path, filesInspected);
    const relevantFiles = filesInspected.filter((file) => {
      const name = basename(file).toLowerCase();
      return RELEVANT_FILE_NAMES.has(name) || file.split("/").length <= 2;
    });
    const findings: RepositoryAnalyzerResult["findings"] = [];
    const recommendedChanges: string[] = [];

    if (filesInspected.length === 0) {
      findings.push({
        severity: "warning",
        title: "No inspectable source files found",
        detail: "The repository did not contain supported text source or configuration files.",
      });
      recommendedChanges.push("Confirm the repository target and branch contain the expected source tree.");
    }

    const packageJson = contents.get("package.json");
    if (packageJson) {
      try {
        const parsed = JSON.parse(packageJson) as { scripts?: Record<string, unknown>; dependencies?: object };
        const scripts = parsed.scripts ?? {};
        if (!("test" in scripts) && !("check" in scripts && "lint" in scripts)) {
          findings.push({
            severity: "warning",
            title: "No obvious automated verification script",
            detail: "package.json does not expose a test, check, or lint script.",
            file: "package.json",
          });
          recommendedChanges.push("Add a repeatable test or validation command to the project scripts.");
        }
      } catch {
        findings.push({
          severity: "warning",
          title: "Invalid package manifest",
          detail: "package.json could not be parsed as JSON.",
          file: "package.json",
        });
      }
    }

    if (!filesInspected.some((file) => /^readme(?:\.[^/]+)?$/i.test(basename(file)))) {
      findings.push({
        severity: "info",
        title: "Repository documentation is not obvious",
        detail: "No README file was found in the inspected source tree.",
      });
      recommendedChanges.push("Document the requested change and local verification steps in a README.");
    }

    const sourceCount = filesInspected.filter((file) =>
      [".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rs", ".vue"].includes(extname(file).toLowerCase()),
    ).length;
    findings.push({
      severity: "info",
      title: "Repository inventory complete",
      detail: `Inspected ${filesInspected.length} supported files, including ${sourceCount} source files.`,
    });

    const summary =
      `Repository Analyzer inspected ${filesInspected.length} files on branch ` +
      `${input.branch} and identified ${findings.length} findings.`;

    return {
      codingTaskId: input.codingTaskId,
      codingRunId: input.codingRunId,
      executionStatus: "COMPLETED",
      summary,
      sourceTarget: input.repository,
      branch: input.branch,
      filesInspected,
      relevantFiles,
      findings,
      recommendedChanges,
      taskContext: {
        title: input.title,
        description: input.description,
      },
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