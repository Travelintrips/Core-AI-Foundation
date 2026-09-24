import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, relative, resolve, sep } from "node:fs/promises";
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
import {
  isSensitiveRepositoryPath,
  type GitCommitContext,
  type ImportReference,
  type LocalCodingContextPackage,
  type LocalSymbol,
} from "./localCodingEngineService.js";
import type { LocalFailureContext } from "./localCodingFailureDiagnosticService.js";
import type { LocalFailureRecoveryContext } from "./localCodingFailureRecoveryService.js";
import { prepareRepositoryWorkspace } from "./repositoryAnalyzerService.js";

const execFileAsync = promisify(execFile);

const MAX_ALLOWED_FILES = 12;
const MAX_SNIPPETS = 10;
const MAX_SNIPPET_CHARS = 4_000;
const MAX_PATCH_EXCERPT_CHARS = 24_000;
const MAX_FAILURE_CONTEXTS = 6;
const MAX_DIAGNOSTICS = 32;
const MAX_SYMBOLS = 40;
const MAX_DEPENDENCIES = 80;
const MAX_TESTS = 24;
const MAX_COMMITS = 6;
const MAX_INSTRUCTION_CHARS = 5_000;

export class LocalAiHandoffError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_HEAD"
      | "INVALID_CONTEXT"
      | "APPROVAL_FAILED",
  ) {
    super(message);
    this.name = "LocalAiHandoffError";
  }
}

export interface AiHandoffSnippet {
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  reason: "diagnostic" | "symbol" | "focus";
}

export interface AiHandoffPackage {
  version: 1;
  task: {
    id: string;
    projectName: string;
    instruction: string;
  };
  repository: {
    repository: string;
    branch: string;
    baseHeadSha: string;
  };
  reason: string;
  allowedFiles: string[];
  diagnostics: Array<{
    command: string;
    kind: string;
    file?: string;
    line?: number;
    column?: number;
    code?: string;
    symbol?: string;
    message: string;
  }>;
  snippets: AiHandoffSnippet[];
  symbols: LocalSymbol[];
  dependencies: ImportReference[];
  relatedTests: string[];
  recentCommits: GitCommitContext[];
  verificationCommands: string[];
  currentPatch: {
    sha256: string;
    excerpt: string;
    truncated: boolean;
  };
  policy: {
    readOnlyContext: true;
    repositoryAccess: false;
    networkAccess: false;
    shellAccess: false;
    secretAccess: false;
    sourceWrite: false;
    commitPushMerge: false;
    modelInvoked: false;
    requiresExplicitApprovalBeforeModel: true;
    allowedFilesOnly: true;
  };
}

interface HandoffContext {
  task: AiCodingTask;
  orchestratorRun: AiCodingRun;
  orchestratorPayload: Record<string, unknown>;
  contextPackage: LocalCodingContextPackage;
  recoveryContext: LocalFailureRecoveryContext;
  failureContexts: LocalFailureContext[];
  localRecovery: Record<string, unknown>;
  currentPatch: string;
  currentPatchSha256: string;
  baseHeadSha: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validSha(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value)
    ? value.toLowerCase()
    : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeRepoPath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    isSensitiveRepositoryPath(normalized)
  ) {
    return null;
  }
  return normalized;
}

function redactText(value: string): string {
  return value
    .replace(
      /((?:api[_-]?key|access[_-]?token|secret|password|private[_-]?key|authorization)\s*[:=]\s*)\S+/gi,
      "$1[REDACTED]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/gi, "[REDACTED_CREDENTIAL_URL]")
    .replace(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[REDACTED_TOKEN]");
}

function patchExcerpt(value: string): { excerpt: string; truncated: boolean } {
  const sanitized = redactText(
    value
      .split("\n")
      .map((line) => {
        const body = line.replace(/^[ +\-]/, "");
        if (
          /(?:api[_-]?key|access[_-]?token|secret|password|private[_-]?key|authorization)\s*[:=]/i.test(body)
        ) {
          const prefix = /^[ +\-]/.test(line) ? line[0] : "";
          return `${prefix}[REDACTED_SENSITIVE_DIFF_LINE]`;
        }
        return line;
      })
      .join("\n"),
  );
  return {
    excerpt: sanitized.slice(0, MAX_PATCH_EXCERPT_CHARS),
    truncated: sanitized.length > MAX_PATCH_EXCERPT_CHARS,
  };
}

function packageHash(value: AiHandoffPackage): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    timeout: 20_000,
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

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

function lineWindowForFile(
  file: string,
  failures: LocalFailureContext[],
  symbols: LocalSymbol[],
): { line: number; reason: AiHandoffSnippet["reason"] } {
  for (const failure of failures) {
    for (const diagnostic of failure.diagnostics) {
      if (diagnostic.file === file && diagnostic.line) {
        return { line: diagnostic.line, reason: "diagnostic" };
      }
    }
  }
  const symbol = symbols.find((item) => item.file === file && item.line > 0);
  if (symbol) return { line: symbol.line, reason: "symbol" };
  return { line: 1, reason: "focus" };
}

async function readSnippet(
  root: string,
  file: string,
  targetLine: number,
  reason: AiHandoffSnippet["reason"],
): Promise<AiHandoffSnippet | null> {
  const safe = normalizeRepoPath(file);
  if (!safe) return null;

  const absoluteRoot = resolve(root);
  const resolvedRoot = await realpath(absoluteRoot).catch(() => null);
  if (!resolvedRoot) return null;

  const candidate = resolve(absoluteRoot, safe);
  if (!isInsideRoot(absoluteRoot, candidate)) return null;

  const info = await lstat(candidate).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > 512_000) return null;

  const resolvedFile = await realpath(candidate).catch(() => null);
  if (!resolvedFile || !isInsideRoot(resolvedRoot, resolvedFile)) return null;

  const content = await readFile(resolvedFile, "utf8").catch(() => null);
  if (content === null) return null;

  const lines = content.split(/\r?\n/);
  const center = Math.min(Math.max(targetLine, 1), Math.max(lines.length, 1));
  const start = Math.max(1, center - 14);
  const end = Math.min(lines.length, center + 14);
  const selected = lines.slice(start - 1, end).join("\n");
  const sanitized = redactText(selected).slice(0, MAX_SNIPPET_CHARS);

  return {
    file: safe,
    startLine: start,
    endLine: Math.min(end, start + sanitized.split("\n").length - 1),
    content: sanitized,
    reason,
  };
}

function compactDiagnostics(
  failures: LocalFailureContext[],
): AiHandoffPackage["diagnostics"] {
  const diagnostics: AiHandoffPackage["diagnostics"] = [];
  for (const failure of failures.slice(0, MAX_FAILURE_CONTEXTS)) {
    for (const item of failure.diagnostics.slice(0, MAX_DIAGNOSTICS)) {
      const file = item.file ? normalizeRepoPath(item.file) : null;
      diagnostics.push({
        command: failure.command,
        kind: item.kind,
        ...(file ? { file } : {}),
        ...(item.line ? { line: item.line } : {}),
        ...(item.column ? { column: item.column } : {}),
        ...(item.code ? { code: item.code.slice(0, 80) } : {}),
        ...(item.symbol ? { symbol: item.symbol.slice(0, 160) } : {}),
        message: redactText(item.message).slice(0, 700),
      });
      if (diagnostics.length >= MAX_DIAGNOSTICS) return diagnostics;
    }
  }
  return diagnostics;
}

export function buildAiHandoffPackage(input: {
  task: Pick<AiCodingTask, "id" | "projectName" | "instruction" | "repository" | "branch">;
  baseHeadSha: string;
  reason: string;
  recoveryContext: LocalFailureRecoveryContext;
  failureContexts: LocalFailureContext[];
  snippets: AiHandoffSnippet[];
  currentPatch: string;
}): AiHandoffPackage {
  const allowedFiles = [
    ...new Set(
      input.recoveryContext.focusFiles
        .map(normalizeRepoPath)
        .filter((item): item is string => Boolean(item)),
    ),
  ].slice(0, MAX_ALLOWED_FILES);

  const allowed = new Set(allowedFiles);
  const symbols = input.recoveryContext.focusSymbols
    .filter((item) => allowed.has(item.file))
    .slice(0, MAX_SYMBOLS);
  const dependencies = input.recoveryContext.dependencies
    .filter((item) => {
      const from = normalizeRepoPath(item.file);
      const to = item.resolvedFile ? normalizeRepoPath(item.resolvedFile) : null;
      return Boolean((from && allowed.has(from)) || (to && allowed.has(to)));
    })
    .slice(0, MAX_DEPENDENCIES);
  const relatedTests = [
    ...new Set(
      input.recoveryContext.relatedTests
        .map(normalizeRepoPath)
        .filter((item): item is string => Boolean(item)),
    ),
  ].slice(0, MAX_TESTS);

  return {
    version: 1,
    task: {
      id: input.task.id,
      projectName: input.task.projectName.slice(0, 500),
      instruction: redactText(input.task.instruction).slice(0, MAX_INSTRUCTION_CHARS),
    },
    repository: {
      repository: input.task.repository,
      branch: input.task.branch,
      baseHeadSha: input.baseHeadSha,
    },
    reason: redactText(input.reason).slice(0, 1200),
    allowedFiles,
    diagnostics: compactDiagnostics(input.failureContexts),
    snippets: input.snippets
      .filter((item) => allowed.has(item.file))
      .slice(0, MAX_SNIPPETS),
    symbols,
    dependencies,
    relatedTests,
    recentCommits: input.recoveryContext.recentCommits.slice(0, MAX_COMMITS),
    verificationCommands: input.recoveryContext.verificationCommands.slice(0, 6),
    currentPatch: {
      sha256: createHash("sha256").update(input.currentPatch, "utf8").digest("hex"),
      ...patchExcerpt(input.currentPatch),
    },
    policy: {
      readOnlyContext: true,
      repositoryAccess: false,
      networkAccess: false,
      shellAccess: false,
      secretAccess: false,
      sourceWrite: false,
      commitPushMerge: false,
      modelInvoked: false,
      requiresExplicitApprovalBeforeModel: true,
      allowedFilesOnly: true,
    },
  };
}

function parseFailureContexts(value: unknown): LocalFailureContext[] {
  return Array.isArray(value)
    ? value.filter((item): item is LocalFailureContext => isRecord(item)).slice(0, MAX_FAILURE_CONTEXTS)
    : [];
}

async function latestAiRequiredContext(taskId: string): Promise<HandoffContext> {
  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId));

  if (!task) throw new LocalAiHandoffError("Coding task not found", "NOT_FOUND");
  if (task.status !== "READY_REVIEW" || task.commitSha) {
    throw new LocalAiHandoffError(
      "Coding task is not awaiting AI handoff preparation",
      "NOT_READY",
    );
  }

  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));

  if (runs.some((run) => run.status === "RUNNING")) {
    throw new LocalAiHandoffError("Coding task already has an active run", "NOT_READY");
  }

  const orchestratorRun = runs.find(
    (run) =>
      run.agentName === "Coding Orchestrator" &&
      run.status === "COMPLETED" &&
      typeof run.logs === "string" &&
      run.logs.length > 0,
  );
  if (!orchestratorRun?.logs) {
    throw new LocalAiHandoffError(
      "Completed Coding Orchestrator payload was not found",
      "INVALID_CONTEXT",
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(orchestratorRun.logs) as Record<string, unknown>;
  } catch {
    throw new LocalAiHandoffError("Coding Orchestrator payload is invalid", "INVALID_CONTEXT");
  }

  const orchestration = isRecord(payload.orchestration) ? payload.orchestration : null;
  const contextPackage = isRecord(payload.contextPackage)
    ? payload.contextPackage as unknown as LocalCodingContextPackage
    : null;
  const recoveryContext = isRecord(payload.failureRecoveryContext)
    ? payload.failureRecoveryContext as unknown as LocalFailureRecoveryContext
    : null;
  const localRecovery = isRecord(payload.localRecovery) ? payload.localRecovery : null;
  const localExecution = isRecord(payload.localExecution) ? payload.localExecution : null;
  const sandbox = isRecord(payload.sandboxVerification) ? payload.sandboxVerification : null;

  if (orchestration?.nextAction !== "AI_REQUIRED") {
    throw new LocalAiHandoffError(
      "Coding task is not at the AI_REQUIRED gate",
      "NOT_READY",
    );
  }
  if (!localRecovery || localRecovery.status !== "AI_REQUIRED" || localRecovery.aiInvoked === true) {
    throw new LocalAiHandoffError(
      "Deterministic recovery has not cleanly stopped at AI_REQUIRED",
      "NOT_READY",
    );
  }
  if (!contextPackage || !recoveryContext) {
    throw new LocalAiHandoffError(
      "AI handoff is missing bounded local context",
      "INVALID_CONTEXT",
    );
  }

  const baseHeadSha = validSha(contextPackage.headSha);
  if (!baseHeadSha) {
    throw new LocalAiHandoffError("AI handoff base HEAD is invalid", "INVALID_CONTEXT");
  }

  const currentPatch = typeof localExecution?.patch === "string" ? localExecution.patch : "";
  if (
    !currentPatch ||
    currentPatch.includes("GIT binary patch") ||
    /(?:^|\n)Binary files /.test(currentPatch)
  ) {
    throw new LocalAiHandoffError(
      "AI handoff requires a bounded textual failing patch",
      "INVALID_CONTEXT",
    );
  }

  const failureContexts = parseFailureContexts(sandbox?.failureContexts);
  if (failureContexts.length === 0) {
    throw new LocalAiHandoffError(
      "AI handoff requires structured sanitized failure diagnostics",
      "INVALID_CONTEXT",
    );
  }

  return {
    task,
    orchestratorRun,
    orchestratorPayload: payload,
    contextPackage,
    recoveryContext,
    failureContexts,
    localRecovery,
    currentPatch,
    currentPatchSha256: createHash("sha256").update(currentPatch, "utf8").digest("hex"),
    baseHeadSha,
  };
}

async function createSnippets(
  workspacePath: string,
  context: HandoffContext,
): Promise<AiHandoffSnippet[]> {
  const allowedFiles = [
    ...new Set(
      context.recoveryContext.focusFiles
        .map(normalizeRepoPath)
        .filter((item): item is string => Boolean(item)),
    ),
  ].slice(0, MAX_ALLOWED_FILES);

  const snippets: AiHandoffSnippet[] = [];
  for (const file of allowedFiles) {
    const window = lineWindowForFile(
      file,
      context.failureContexts,
      context.recoveryContext.focusSymbols,
    );
    const snippet = await readSnippet(
      workspacePath,
      file,
      window.line,
      window.reason,
    );
    if (snippet) snippets.push(snippet);
    if (snippets.length >= MAX_SNIPPETS) break;
  }
  return snippets;
}

async function executePrepareHandoff(
  context: HandoffContext,
  run: AiCodingRun,
): Promise<void> {
  let workspacePath: string | null = null;
  try {
    const workspace = await prepareRepositoryWorkspace(
      context.task.repository,
      context.task.branch,
    );
    if (!workspace.cleanup) {
      throw new LocalAiHandoffError(
        "AI handoff preparation only runs against an isolated remote clone",
        "INVALID_CONTEXT",
      );
    }
    workspacePath = workspace.path;

    const actualHead = (await git(workspacePath, ["rev-parse", "HEAD"])).toLowerCase();
    if (actualHead !== context.baseHeadSha) {
      throw new LocalAiHandoffError(
        `Repository HEAD changed from ${context.baseHeadSha} to ${actualHead}; rerun Local Coding Engine before AI handoff`,
        "STALE_HEAD",
      );
    }

    const snippets = await createSnippets(workspacePath, context);
    const pkg = buildAiHandoffPackage({
      task: context.task,
      baseHeadSha: context.baseHeadSha,
      reason:
        typeof context.localRecovery.reason === "string"
          ? context.localRecovery.reason
          : "Deterministic local recovery exhausted.",
      recoveryContext: context.recoveryContext,
      failureContexts: context.failureContexts,
      snippets,
      currentPatch: context.currentPatch,
    });
    const hash = packageHash(pkg);
    const completedAt = new Date();
    const orchestration = isRecord(context.orchestratorPayload.orchestration)
      ? context.orchestratorPayload.orchestration
      : {};
    const payload = {
      ...context.orchestratorPayload,
      aiHandoff: {
        status: "PREPARED",
        gateStatus: "AWAITING_EXPLICIT_APPROVAL",
        packageHash: hash,
        package: pkg,
        preparedAt: completedAt.toISOString(),
        approvedAt: null,
        modelInvoked: false,
      },
      orchestration: {
        ...orchestration,
        status: "READY_REVIEW",
        nextAction: "APPROVE_AI_HANDOFF",
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
            handoffStatus: "PREPARED",
            packageHash: hash,
            allowedFiles: pkg.allowedFiles,
            snippets: pkg.snippets.length,
            diagnostics: pkg.diagnostics.length,
            modelInvoked: false,
            nextAction: "APPROVE_AI_HANDOFF",
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
          status: "READY_REVIEW",
          resultSummary:
            `Bounded AI handoff package prepared for ${pkg.allowedFiles.length} allowed file(s). No model was invoked. Explicit handoff approval is required.`,
        })
        .where(eq(aiCodingTasksTable.id, context.task.id));
    });

    await logAudit(
      "coding-orchestrator",
      "ai_handoff_prepared",
      context.task.id,
      "coding_task",
      "success",
      {
        codingRunId: run.id,
        packageHash: hash,
        allowedFiles: pkg.allowedFiles.length,
        snippets: pkg.snippets.length,
        diagnostics: pkg.diagnostics.length,
        modelInvoked: false,
      },
    );
  } catch (error) {
    const normalized =
      error instanceof LocalAiHandoffError
        ? error
        : new LocalAiHandoffError(
            error instanceof Error ? error.message : String(error),
            "INVALID_CONTEXT",
          );

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
            modelInvoked: false,
            nextAction: "AI_REQUIRED",
          }, null, 2),
        })
        .where(eq(aiCodingRunsTable.id, run.id));

      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "READY_REVIEW",
          resultSummary:
            "AI handoff preparation failed safely: " +
            normalized.message.slice(0, 500) +
            " No model was invoked.",
        })
        .where(eq(aiCodingTasksTable.id, context.task.id));
    }).catch(() => undefined);

    await logAudit(
      "coding-orchestrator",
      "ai_handoff_prepare_failed",
      context.task.id,
      "coding_task",
      "failure",
      {
        codingRunId: run.id,
        kind: normalized.kind,
        error: normalized.message.slice(0, 700),
        modelInvoked: false,
      },
    ).catch(() => undefined);
  } finally {
    if (workspacePath) {
      await workspacePath && import("node:fs/promises").then(({ rm }) =>
        rm(workspacePath!, { recursive: true, force: true }).catch(() => undefined)
      );
    }
  }
}

export async function startAiHandoffPreparation(
  taskId: string,
): Promise<AiCodingRun> {
  const context = await latestAiRequiredContext(taskId);

  const [run] = await db.transaction(async (tx) => {
    const [lockedTask] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId))
      .for("update");
    if (!lockedTask) throw new LocalAiHandoffError("Coding task not found", "NOT_FOUND");
    if (lockedTask.status !== "READY_REVIEW" || lockedTask.commitSha) {
      throw new LocalAiHandoffError(
        "Coding task is not awaiting AI handoff preparation",
        "NOT_READY",
      );
    }

    const [activeRun] = await tx
      .select({ id: aiCodingRunsTable.id })
      .from(aiCodingRunsTable)
      .where(and(eq(aiCodingRunsTable.taskId, taskId), eq(aiCodingRunsTable.status, "RUNNING")))
      .limit(1);
    if (activeRun) {
      throw new LocalAiHandoffError("Coding task already has an active run", "NOT_READY");
    }

    const [created] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId,
        agentName: "AI Handoff Gate",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();

    await tx
      .update(aiCodingTasksTable)
      .set({
        resultSummary:
          "Preparing bounded read-only AI handoff context. No model/LLM is being invoked.",
      })
      .where(eq(aiCodingTasksTable.id, taskId));

    return [created];
  });

  await logAudit(
    "coding-orchestrator",
    "ai_handoff_prepare_started",
    taskId,
    "coding_task",
    "success",
    {
      codingRunId: run.id,
      baseHeadSha: context.baseHeadSha,
      currentPatchSha256: context.currentPatchSha256,
      modelInvoked: false,
    },
  );

  void executePrepareHandoff(context, run);
  return run;
}

export async function approveAiHandoff(
  taskId: string,
): Promise<AiCodingRun> {
  const context = await latestAiRequiredContext(taskId);
  const payload = context.orchestratorPayload;
  const orchestration = isRecord(payload.orchestration) ? payload.orchestration : null;
  const aiHandoff = isRecord(payload.aiHandoff) ? payload.aiHandoff : null;
  const pkg = aiHandoff?.package;

  if (orchestration?.nextAction !== "APPROVE_AI_HANDOFF") {
    throw new LocalAiHandoffError(
      "Coding task is not at the APPROVE_AI_HANDOFF gate",
      "NOT_READY",
    );
  }
  if (
    !aiHandoff ||
    aiHandoff.status !== "PREPARED" ||
    aiHandoff.gateStatus !== "AWAITING_EXPLICIT_APPROVAL" ||
    aiHandoff.modelInvoked === true ||
    !isRecord(pkg)
  ) {
    throw new LocalAiHandoffError(
      "Prepared AI handoff package is missing or invalid",
      "INVALID_CONTEXT",
    );
  }

  const typedPackage = pkg as unknown as AiHandoffPackage;
  const storedHash = typeof aiHandoff.packageHash === "string" ? aiHandoff.packageHash : "";
  const actualHash = packageHash(typedPackage);
  if (!/^[0-9a-f]{64}$/.test(storedHash) || storedHash !== actualHash) {
    throw new LocalAiHandoffError(
      "AI handoff package hash no longer matches the prepared context",
      "APPROVAL_FAILED",
    );
  }
  if (
    typedPackage.policy.modelInvoked !== false ||
    typedPackage.policy.sourceWrite !== false ||
    typedPackage.policy.repositoryAccess !== false ||
    typedPackage.policy.networkAccess !== false ||
    typedPackage.policy.secretAccess !== false ||
    typedPackage.policy.requiresExplicitApprovalBeforeModel !== true
  ) {
    throw new LocalAiHandoffError(
      "AI handoff policy flags are not fail-closed",
      "APPROVAL_FAILED",
    );
  }

  const workspace = await prepareRepositoryWorkspace(
    context.task.repository,
    context.task.branch,
  );
  if (!workspace.cleanup) {
    throw new LocalAiHandoffError(
      "AI handoff approval only verifies against an isolated remote clone",
      "APPROVAL_FAILED",
    );
  }

  try {
    const actualHead = (await git(workspace.path, ["rev-parse", "HEAD"])).toLowerCase();
    if (actualHead !== context.baseHeadSha) {
      throw new LocalAiHandoffError(
        `Repository HEAD changed from ${context.baseHeadSha} to ${actualHead}; prepare the AI handoff again`,
        "STALE_HEAD",
      );
    }
  } finally {
    const { rm } = await import("node:fs/promises");
    await rm(workspace.path, { recursive: true, force: true }).catch(() => undefined);
  }

  const completedAt = new Date();
  const [run] = await db.transaction(async (tx) => {
    const [lockedTask] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId))
      .for("update");
    if (!lockedTask) throw new LocalAiHandoffError("Coding task not found", "NOT_FOUND");

    const [activeRun] = await tx
      .select({ id: aiCodingRunsTable.id })
      .from(aiCodingRunsTable)
      .where(and(eq(aiCodingRunsTable.taskId, taskId), eq(aiCodingRunsTable.status, "RUNNING")))
      .limit(1);
    if (activeRun) {
      throw new LocalAiHandoffError("Coding task already has an active run", "NOT_READY");
    }

    const [created] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId,
        agentName: "AI Handoff Approval",
        status: "COMPLETED",
        startedAt: completedAt,
        finishedAt: completedAt,
        logs: JSON.stringify({
          executionStatus: "COMPLETED",
          handoffStatus: "APPROVED",
          packageHash: storedHash,
          modelInvoked: false,
          nextAction: "AI_HANDOFF_APPROVED",
        }, null, 2),
      })
      .returning();

    const approvedPayload = {
      ...payload,
      aiHandoff: {
        ...aiHandoff,
        status: "APPROVED",
        gateStatus: "EXPLICITLY_APPROVED",
        approvedAt: completedAt.toISOString(),
        modelInvoked: false,
      },
      orchestration: {
        ...(isRecord(payload.orchestration) ? payload.orchestration : {}),
        status: "READY_REVIEW",
        nextAction: "AI_HANDOFF_APPROVED",
      },
    };

    await tx
      .update(aiCodingRunsTable)
      .set({ logs: JSON.stringify(approvedPayload, null, 2) })
      .where(eq(aiCodingRunsTable.id, context.orchestratorRun.id));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "READY_REVIEW",
        resultSummary:
          "AI handoff package explicitly approved. No model was invoked; execution remains locked for a future constrained AI phase.",
      })
      .where(eq(aiCodingTasksTable.id, taskId));

    return [created];
  });

  await logAudit(
    "coding-orchestrator",
    "ai_handoff_explicitly_approved",
    taskId,
    "coding_task",
    "success",
    {
      codingRunId: run.id,
      packageHash: storedHash,
      allowedFiles: typedPackage.allowedFiles.length,
      modelInvoked: false,
      nextAction: "AI_HANDOFF_APPROVED",
    },
  );

  return run;
}
