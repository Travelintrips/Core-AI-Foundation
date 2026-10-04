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
  withTransientDatabaseRetry,
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
const DEFAULT_ANALYZER_QUEUE_CLAIM_TIMEOUT_MS = 60_000;
const MIN_ANALYZER_QUEUE_CLAIM_TIMEOUT_MS = 10_000;
const MAX_ANALYZER_QUEUE_CLAIM_TIMEOUT_MS = 5 * 60_000;

export function getRepositoryAnalyzerQueueClaimTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number.parseInt(
    env["REPOSITORY_ANALYZER_QUEUE_CLAIM_TIMEOUT_MS"] ?? "",
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ANALYZER_QUEUE_CLAIM_TIMEOUT_MS;
  }
  return Math.max(
    MIN_ANALYZER_QUEUE_CLAIM_TIMEOUT_MS,
    Math.min(MAX_ANALYZER_QUEUE_CLAIM_TIMEOUT_MS, parsed),
  );
}

const MAX_FILES = 120;
const MAX_READ_BYTES = 400_000;
const MAX_FILE_BYTES = 80_000;
const CLONE_TIMEOUT_MS = 120_000;
const PRIMARY_CLONE_DEPTH = 1;
const FALLBACK_CLONE_DEPTH = 1;
let cloneQueueTail: Promise<void> = Promise.resolve();
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
  isolatedBranchName?: string;
  expectedBaseSha?: string;
  title: string;
  description: string;
}

export interface RepositoryWorkspace {
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

function appendGitConfig(
  target: NodeJS.ProcessEnv,
  key: string,
  value: string,
): void {
  const count = Number.parseInt(target["GIT_CONFIG_COUNT"] ?? "0", 10);
  const index = Number.isFinite(count) && count >= 0 ? count : 0;
  target[`GIT_CONFIG_KEY_${index}`] = key;
  target[`GIT_CONFIG_VALUE_${index}`] = value;
  target["GIT_CONFIG_COUNT"] = String(index + 1);
}

export function buildRepositoryCloneEnvironment(
  remote: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const cloneEnv: NodeJS.ProcessEnv = {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
  };

  // Hostinger's managed runtime has a tight process/thread budget. Git's
  // index-pack/checkout defaults may spawn multiple worker threads, so keep
  // the clone phase deliberately single-threaded and memory conservative.
  appendGitConfig(cloneEnv, "pack.threads", "1");
  appendGitConfig(cloneEnv, "index.threads", "1");
  appendGitConfig(cloneEnv, "checkout.workers", "1");
  appendGitConfig(cloneEnv, "fetch.parallel", "1");
  appendGitConfig(cloneEnv, "core.preloadIndex", "false");
  appendGitConfig(cloneEnv, "core.deltaBaseCacheLimit", "16m");

  let parsed: URL | null = null;
  try {
    parsed = new URL(remote);
  } catch {
    return cloneEnv;
  }

  if (parsed.hostname.toLowerCase() !== "github.com") {
    return cloneEnv;
  }

  const token =
    env["AI_CODING_GITHUB_TOKEN"]?.trim() ||
    env["GITHUB_TOKEN"]?.trim() ||
    env["GH_TOKEN"]?.trim();
  if (!token) {
    return cloneEnv;
  }

  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  appendGitConfig(cloneEnv, "http.extraHeader", `AUTHORIZATION: basic ${basic}`);
  return cloneEnv;
}

export function isRetryableRepositoryCloneResourceError(detail: string): boolean {
  if (
    /unable to create thread|resource temporarily unavailable|spawn git eagain|\beagain\b|invalid index-pack output|index-pack.*failed|timeout exceeded when trying to connect|connection (?:timed out|reset|refused)|could not resolve host|temporary failure in name resolution|gnutls recv error|tls connection was non-properly terminated|http\/2 stream .* was not closed cleanly|remote end hung up unexpectedly|early eof/i.test(
      detail,
    )
  ) {
    return true;
  }

  const cloneStartedWithoutDiagnostic =
    /Command failed: git clone/i.test(detail) &&
    /Cloning into /i.test(detail) &&
    !/fatal:|authentication failed|repository not found|could not read Username|remote branch .* not found/i.test(detail);
  return cloneStartedWithoutDiagnostic;
}

export function buildRepositoryCloneArgs(
  remote: string,
  branch: string,
  workspace: string,
  depth: number,
): string[] {
  return [
    "clone",
    "--depth",
    String(depth),
    "--no-tags",
    "--single-branch",
    "--branch",
    branch,
    remote,
    workspace,
  ];
}

async function withRepositoryCloneSlot<T>(run: () => Promise<T>): Promise<T> {
  const previous = cloneQueueTail;
  let release!: () => void;
  cloneQueueTail = new Promise<void>((resolveQueue) => {
    release = resolveQueue;
  });

  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
  }
}

async function cloneRepository(
  remote: string,
  branch: string,
  workspace: string,
  depth: number,
): Promise<void> {
  await execFileAsync(
    "git",
    buildRepositoryCloneArgs(remote, branch, workspace, depth),
    {
      timeout: CLONE_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      env: buildRepositoryCloneEnvironment(remote),
    },
  );
}

async function resolveWorkspaceHead(
  workspace: string,
  repository: string,
): Promise<string> {
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: workspace,
    timeout: 15_000,
    maxBuffer: 64 * 1024,
    env: buildRepositoryCloneEnvironment(repository),
  });
  const raw =
    typeof result === "string" || Buffer.isBuffer(result)
      ? result
      : (result as { stdout?: unknown } | null | undefined)?.stdout;
  const head = Buffer.isBuffer(raw)
    ? raw.toString("utf8").trim().toLowerCase()
    : raw instanceof Uint8Array
      ? Buffer.from(raw).toString("utf8").trim().toLowerCase()
      : typeof raw === "string"
        ? raw.trim().toLowerCase()
        : "";
  if (!/^[0-9a-f]{40}$/.test(head)) {
    throw new Error("Repository HEAD could not be resolved after clone");
  }
  return head;
}

export async function configureIsolatedRepositoryWorkspace(
  workspace: string,
  expectedBaseSha: string,
  isolatedBranchName: string,
): Promise<void> {
  const normalizedBaseSha = expectedBaseSha.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalizedBaseSha)) {
    throw new Error("Expected repository base SHA must be a 40-character Git SHA");
  }
  if (
    !/^[A-Za-z0-9._/-]+$/.test(isolatedBranchName) ||
    isolatedBranchName.startsWith("-")
  ) {
    throw new Error("Isolated repository branch contains unsupported characters");
  }

  const headResult = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: workspace,
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  });
  const rawHead =
    typeof headResult === "string" || Buffer.isBuffer(headResult)
      ? headResult
      : (headResult as { stdout?: unknown } | null | undefined)?.stdout;
  const actualHead = Buffer.isBuffer(rawHead)
    ? rawHead.toString("utf8").trim().toLowerCase()
    : rawHead instanceof Uint8Array
      ? Buffer.from(rawHead).toString("utf8").trim().toLowerCase()
      : typeof rawHead === "string"
        ? rawHead.trim().toLowerCase()
        : "";
  if (!actualHead) {
    throw new Error("Repository HEAD could not be resolved in isolated workspace");
  }

  // The remote branch may advance after the task was approved. Preserve the
  // approved execution boundary by checking out the exact approved commit when
  // it is still present in the cloned history instead of failing merely
  // because the branch tip moved.
  try {
    await execFileAsync(
      "git",
      ["cat-file", "-e", `${normalizedBaseSha}^{commit}`],
      {
        cwd: workspace,
        timeout: 15_000,
        maxBuffer: 64 * 1024,
      },
    );
  } catch {
    // Keep the common path fast with a depth-1 clone. If the approved commit
    // is no longer the branch tip, fetch only that exact commit instead of
    // cloning a wider history window for every coding job.
    try {
      await execFileAsync(
        "git",
        ["fetch", "--depth", "1", "origin", normalizedBaseSha],
        {
          cwd: workspace,
          timeout: CLONE_TIMEOUT_MS,
          maxBuffer: 64 * 1024,
        },
      );
      await execFileAsync(
        "git",
        ["cat-file", "-e", `${normalizedBaseSha}^{commit}`],
        {
          cwd: workspace,
          timeout: 15_000,
          maxBuffer: 64 * 1024,
        },
      );
    } catch {
      throw new Error(
        `Approved repository base SHA is unavailable in isolated workspace: expected ${normalizedBaseSha}, cloned HEAD ${actualHead}`,
      );
    }
  }

  await execFileAsync(
    "git",
    ["checkout", "-b", isolatedBranchName, normalizedBaseSha],
    {
      cwd: workspace,
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    },
  );
}

export function normalizeRemoteRepository(repository: string): string {
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

async function resolveBranchContainingCommit(
  remote: string,
  expectedBaseSha: string,
): Promise<string> {
  const normalized = expectedBaseSha.trim().toLowerCase();
  const candidates = ["main", "master"];
  for (const candidate of candidates) {
    try {
      const result = await execFileAsync(
        "git",
        ["ls-remote", "--heads", remote, `refs/heads/${candidate}`],
        {
          timeout: 20_000,
          maxBuffer: 64 * 1024,
          env: buildRepositoryCloneEnvironment(remote),
        },
      );
      const raw =
        typeof result === "string" || Buffer.isBuffer(result)
          ? result.toString()
          : String((result as { stdout?: unknown }).stdout ?? "");
      const head = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      if (head === normalized) return candidate;
      if (/^[0-9a-f]{40}$/.test(head)) return candidate;
    } catch {
      // Try the next conventional source branch.
    }
  }
  throw new Error(
    `No remote source branch is available to seed isolated workspace at ${normalized}`,
  );
}

export async function resolveRemoteBranchHead(
  repository: string,
  branch: string,
): Promise<string> {
  const remote = normalizeRemoteRepository(repository);
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-")) {
    throw new Error("Repository branch contains unsupported characters");
  }

  return withRepositoryCloneSlot(async () => {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await execFileAsync(
          "git",
          ["ls-remote", "--heads", remote, `refs/heads/${branch}`],
          {
            timeout: 20_000,
            maxBuffer: 64 * 1024,
            env: buildRepositoryCloneEnvironment(remote),
          },
        );
        const raw =
          typeof result === "string" || Buffer.isBuffer(result)
            ? result
            : (result as { stdout?: unknown } | null | undefined)?.stdout;
        const stdout = Buffer.isBuffer(raw)
          ? raw.toString("utf8")
          : raw instanceof Uint8Array
            ? Buffer.from(raw).toString("utf8")
            : typeof raw === "string"
              ? raw
              : "";
        const head = stdout.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        if (!/^[0-9a-f]{40}$/.test(head)) {
          throw new Error(
            `Repository branch HEAD could not be resolved for ${branch}`,
          );
        }
        return head;
      } catch (error) {
        lastError = error;
        const detail = error instanceof Error ? error.message : String(error);
        if (
          attempt >= 3 ||
          !isRetryableRepositoryCloneResourceError(detail)
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Repository branch HEAD verification failed");
  });
}

export async function prepareRepositoryWorkspace(
  repository: string,
  branch: string,
  options: {
    isolatedBranchName?: string;
    expectedBaseSha?: string;
  } = {},
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
    if (options.isolatedBranchName || options.expectedBaseSha) {
      throw new Error(
        "Isolated multi-worker execution requires a disposable cloned workspace, not a local repository directory",
      );
    }
    return { path: localPath, cleanup: false };
  }

  const remote = normalizeRemoteRepository(repository);
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-")) {
    throw new Error("Repository branch contains unsupported characters");
  }

  const isolatedBranchName = options.isolatedBranchName?.trim();
  if (
    isolatedBranchName &&
    (!/^[A-Za-z0-9._/-]+$/.test(isolatedBranchName) ||
      isolatedBranchName.startsWith("-"))
  ) {
    throw new Error("Isolated repository branch contains unsupported characters");
  }

  const expectedBaseSha = options.expectedBaseSha?.trim().toLowerCase();
  if (expectedBaseSha && !/^[0-9a-f]{40}$/.test(expectedBaseSha)) {
    throw new Error("Expected repository base SHA must be a 40-character Git SHA");
  }
  if (isolatedBranchName && !expectedBaseSha) {
    throw new Error("Isolated repository branch requires expectedBaseSha binding");
  }

  const workspace = join(tmpdir(), `coding-analyzer-${crypto.randomUUID()}`);
  await mkdir(workspace, { recursive: true });

  return withRepositoryCloneSlot(async () => {
    // A workstream branch is created locally from the approved base SHA and
    // is not guaranteed to exist remotely until a candidate is materialized.
    // Clone the requested branch when it exists; otherwise, for an isolated
    // execution that is cryptographically bound to expectedBaseSha, seed the
    // disposable workspace from the exact approved commit and create the
    // isolated branch locally.
    let cloneBranch = branch;
    try {
      if (isolatedBranchName && expectedBaseSha) {
        const requestedHead = await execFileAsync(
          "git",
          ["ls-remote", "--heads", remote, `refs/heads/${branch}`],
          {
            timeout: 20_000,
            maxBuffer: 64 * 1024,
            env: buildRepositoryCloneEnvironment(remote),
          },
        ).catch(() => ({ stdout: "" }));
        const stdout =
          typeof requestedHead === "string" || Buffer.isBuffer(requestedHead)
            ? requestedHead.toString()
            : String((requestedHead as { stdout?: unknown }).stdout ?? "");
        if (!stdout.trim()) {
          cloneBranch = await resolveBranchContainingCommit(
            remote,
            expectedBaseSha,
          );
        }
      }

      await cloneRepository(remote, cloneBranch, workspace, PRIMARY_CLONE_DEPTH);
      if (expectedBaseSha) {
        await configureIsolatedRepositoryWorkspace(
          workspace,
          expectedBaseSha,
          isolatedBranchName ?? `analysis-${expectedBaseSha.slice(0, 12)}`,
        );
      }
      return { path: workspace, cleanup: true };
    } catch (firstError) {
      const firstDetail =
        firstError instanceof Error ? firstError.message : String(firstError);

      if (!isRetryableRepositoryCloneResourceError(firstDetail)) {
        await rm(workspace, { recursive: true, force: true });
        throw new Error(
          `Repository clone failed: ${firstDetail.slice(0, 500)}`,
        );
      }

      logger.warn(
        {
          repository: remote,
          branch: cloneBranch,
          primaryDepth: PRIMARY_CLONE_DEPTH,
          fallbackDepth: FALLBACK_CLONE_DEPTH,
        },
        "[coding-analyzer] clone hit host resource pressure; entering bounded backoff retry",
      );

      let retryError: unknown = firstError;
      const retryDelaysMs = [1_000, 2_000, 4_000];
      for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
        await rm(workspace, { recursive: true, force: true });
        await mkdir(workspace, { recursive: true });
        await new Promise<void>((resolveDelay) =>
          setTimeout(resolveDelay, retryDelaysMs[attempt]),
        );

        try {
          await cloneRepository(
            remote,
            cloneBranch,
            workspace,
            FALLBACK_CLONE_DEPTH,
          );
          if (expectedBaseSha) {
            await configureIsolatedRepositoryWorkspace(
              workspace,
              expectedBaseSha,
              isolatedBranchName ?? `analysis-${expectedBaseSha.slice(0, 12)}`,
            );
          }
          return { path: workspace, cleanup: true };
        } catch (error) {
          retryError = error;
          const retryDetail =
            error instanceof Error ? error.message : String(error);
          if (!isRetryableRepositoryCloneResourceError(retryDetail)) {
            break;
          }
          logger.warn(
            {
              repository: remote,
              branch: cloneBranch,
              attempt: attempt + 1,
              nextDelayMs: retryDelaysMs[attempt + 1] ?? null,
            },
            "[coding-analyzer] transient clone retry failed under host resource pressure",
          );
        }
      }

      await rm(workspace, { recursive: true, force: true });
      const retryDetail =
        retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(
        `Repository clone failed after bounded low-resource retries: ${retryDetail.slice(0, 500)}`,
      );
    }
  });
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
  const workspace = await prepareRepositoryWorkspace(input.repository, input.branch, {
    isolatedBranchName: input.isolatedBranchName,
    expectedBaseSha: input.expectedBaseSha,
  });
  let phase = "resolve_workspace_head";
  try {
    const authoritativeWorkspaceHead = await resolveWorkspaceHead(
      workspace.path,
      input.repository,
    );

    phase = "build_local_context";
    const contextPackage = await buildLocalCodingContextPackage({
      root: workspace.path,
      repository: input.repository,
      requestedBranch: input.isolatedBranchName ?? input.branch,
      task: `${input.title}\n${input.description}`,
    });

    if (
      contextPackage.headSha !== "unknown" &&
      contextPackage.headSha !== authoritativeWorkspaceHead
    ) {
      throw new Error(
        `Repository context HEAD mismatch: workspace ${authoritativeWorkspaceHead}, context ${contextPackage.headSha}`,
      );
    }
    contextPackage.headSha = authoritativeWorkspaceHead;

    if (input.expectedBaseSha) {
      const expectedHeadSha = input.expectedBaseSha.trim().toLowerCase();
      if (authoritativeWorkspaceHead !== expectedHeadSha) {
        throw new Error(
          `Repository context HEAD mismatch: expected ${expectedHeadSha}, got ${authoritativeWorkspaceHead}`,
        );
      }
    }

    phase = "plan_local_execution";
    const localExecutionPlan = planLocalCodingExecution(
      `${input.title}\n${input.description}`,
      contextPackage,
    );
    phase = "execute_local_plan";
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(
      `Repository Analyzer phase '${phase}' failed: ${message}`,
      { cause: error },
    );
    if (error instanceof Error && error.stack) {
      wrapped.stack += "\nCaused by:\n" + error.stack;
    }
    throw wrapped;
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
    isolatedBranchName:
      typeof payload["isolatedBranchName"] === "string"
        ? String(payload["isolatedBranchName"]).trim()
        : undefined,
    expectedBaseSha:
      typeof payload["expectedBaseSha"] === "string"
        ? String(payload["expectedBaseSha"]).trim()
        : undefined,
    title: requiredString(payload, "title"),
    description: requiredString(payload, "description"),
  };

  const [task] = await withTransientDatabaseRetry(
    () => db
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, input.codingTaskId)),
    { attempts: 5, baseDelayMs: 250 },
  );
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
  queuedStaleAfterMs = getRepositoryAnalyzerQueueClaimTimeoutMs(),
): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const queuedCutoff = new Date(Date.now() - queuedStaleAfterMs);
  const staleRuns = await db
    .select({
      id: aiCodingRunsTable.id,
      taskId: aiCodingRunsTable.taskId,
    })
    .from(aiCodingRunsTable)
    .where(
      and(
        eq(aiCodingRunsTable.status, "RUNNING"),
        eq(aiCodingRunsTable.agentName, "Repository Analyzer"),
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

  // Orchestrated runs use the "Coding Orchestrator" agent name. A queued job
  // should be claimed almost immediately by either the dedicated child process
  // or the remote analyzer. If it is still queued after the short claim
  // timeout, the executor never actually started and the row must not hold the
  // host-wide single-flight slot for the full running-job lifetime.
  //
  // Running/retrying jobs keep the generous staleAfterMs budget because real
  // repository analysis can legitimately take much longer than queue claiming.
  const staleJobs = await db.execute(sql`
    SELECT j.id, j.status,
           j.payload_json->>'codingRunId' AS run_id,
           j.payload_json->>'codingTaskId' AS task_id
    FROM ai_platform.ai_jobs AS j
    JOIN ai_platform.ai_coding_runs AS r
      ON r.id::text = j.payload_json->>'codingRunId'
    WHERE j.job_type = 'coding_repository_analyzer'
      AND r.status = 'RUNNING'
      AND r.agent_name IN ('Coding Orchestrator', 'Incident Auto-Repair')
      AND (
        (j.status = 'queued' AND j.created_at < ${queuedCutoff})
        OR
        (
          j.status IN ('running', 'retrying')
          AND COALESCE(j.started_at, j.created_at) < ${cutoff}
        )
      )
  `);
  const rows = (staleJobs as unknown as {
    rows?: Array<{
      id: number;
      status: "queued" | "running" | "retrying";
      run_id: string;
      task_id: string;
    }>;
  }).rows ?? [];
  for (const job of rows) {
    const queueClaimTimedOut = job.status === "queued";
    const failureMessage = queueClaimTimedOut
      ? `Repository Analyzer job ${job.id} was not claimed within ${queuedStaleAfterMs}ms and was recovered.`
      : `Repository Analyzer job ${job.id} exceeded its bounded lifetime and was recovered.`;

    await failRepositoryAnalyzerRun(
      { codingRunId: job.run_id, codingTaskId: job.task_id },
      failureMessage,
    );
    await db.execute(sql`
      UPDATE ai_platform.ai_jobs
      SET status = 'failed', completed_at = COALESCE(completed_at, NOW()),
          error_message = COALESCE(
            error_message,
            ${queueClaimTimedOut
              ? "Repository Analyzer queue claim timeout"
              : "Stale Repository Analyzer job recovered"}
          ),
          updated_at = NOW()
      WHERE id = ${job.id}
        AND (
          (status = 'queued' AND created_at < ${queuedCutoff})
          OR
          (
            status IN ('running', 'retrying')
            AND COALESCE(started_at, created_at) < ${cutoff}
          )
        )
    `);
  }

  return staleRuns.length + rows.length;
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
