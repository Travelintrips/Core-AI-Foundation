import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { tmpdir } from "node:os";
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
  executeLocalCodingPlan,
  type LocalCodingExecutionPlan,
  type LocalEditOperation,
} from "./localCodingExecutorService.js";
import {
  isSensitiveRepositoryPath,
  type LocalCodingContextPackage,
} from "./localCodingEngineService.js";
import {
  enrichFailureContextsWithSymbols,
  type LocalFailureContext,
} from "./localCodingFailureDiagnosticService.js";
import {
  buildLocalFailureRecoveryContext,
  type LocalFailureRecoveryContext,
} from "./localCodingFailureRecoveryService.js";
import { runSandboxedRepositoryVerification } from "./localCodingSandboxService.js";
import { verifyChangedFilesStatically } from "./localCodingVerificationService.js";
import { prepareRepositoryWorkspace } from "./repositoryAnalyzerService.js";

const execFileAsync = promisify(execFile);

const MAX_RECOVERY_OPERATIONS = 8;
const MAX_RECOVERY_ATTEMPTS = 2;
const MAX_PATCH_BYTES = 160_000;
const MAX_CHANGED_FILES = 40;
const GIT_TIMEOUT_MS = 30_000;

export class LocalDeterministicRecoveryError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_HEAD"
      | "INVALID_CONTEXT"
      | "SANDBOX_BLOCKED"
      | "RECOVERY_FAILED",
  ) {
    super(message);
    this.name = "LocalDeterministicRecoveryError";
  }
}

export interface LocalDeterministicRecoveryPlan extends LocalCodingExecutionPlan {
  matchedDiagnostics: Array<{
    code: string;
    file: string;
    line: number;
    column: number;
    strategy: "compiler_identifier_suggestion" | "compiler_punctuation";
  }>;
  unsupportedDiagnostics: number;
}

interface RecoveryGateContext {
  task: AiCodingTask;
  orchestratorRun: AiCodingRun;
  orchestratorPayload: Record<string, unknown>;
  contextPackage: LocalCodingContextPackage;
  originalPatch: string;
  originalPatchSha256: string;
  baseHeadSha: string;
  approvedChangedFiles: string[];
  verificationCommands: string[];
  failureContexts: LocalFailureContext[];
  failureRecoveryContext: LocalFailureRecoveryContext;
}

interface RecoveryAttemptSummary {
  attempt: number;
  planStatus: string;
  operations: number;
  strategies: string[];
  sandboxStatus?: string;
  changedFiles?: string[];
  reason: string;
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
  const normalized = normalize(value.trim()).replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    isSensitiveRepositoryPath(normalized)
  ) {
    throw new LocalDeterministicRecoveryError(
      `Unsafe local recovery path: ${value}`,
      "INVALID_CONTEXT",
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
      throw new LocalDeterministicRecoveryError(
        "Recovery does not support renamed files.",
        "INVALID_CONTEXT",
      );
    }
    files.add(safeRepoPath(match[1]));
  }
  return [...files].sort();
}

function validSha(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value)
    ? value.toLowerCase()
    : "";
}

function asFailureContexts(value: unknown): LocalFailureContext[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is LocalFailureContext => isRecord(item))
    .slice(0, 6);
}

function asRecoveryContext(value: unknown): LocalFailureRecoveryContext | null {
  return isRecord(value) ? value as unknown as LocalFailureRecoveryContext : null;
}

function normalizeIdentifierSuggestion(
  message: string,
): { from: string; to: string } | null {
  const suggestion = /Did you mean\s+['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]\?/i.exec(message);
  if (!suggestion) return null;
  const source =
    /Cannot find name\s+['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]/i.exec(message) ??
    /Property\s+['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]\s+does not exist/i.exec(message);
  if (!source || source[1] === suggestion[1]) return null;
  return { from: source[1], to: suggestion[1] };
}

function punctuationSuggestion(message: string): ";" | "," | null {
  const match = /^['"]([;,])['"]\s+expected\.?$/i.exec(message.trim());
  return match ? match[1] as ";" | "," : null;
}

export function planDeterministicLocalRecovery(
  failureContexts: LocalFailureContext[],
  recoveryContext: LocalFailureRecoveryContext,
  verificationCommands: string[],
): LocalDeterministicRecoveryPlan {
  const focus = new Set(recoveryContext.focusFiles.map((file) => {
    try {
      return safeRepoPath(file);
    } catch {
      return "";
    }
  }).filter(Boolean));

  const operations: LocalEditOperation[] = [];
  const matchedDiagnostics: LocalDeterministicRecoveryPlan["matchedDiagnostics"] = [];
  let unsupportedDiagnostics = 0;
  const seen = new Set<string>();

  for (const failure of failureContexts.slice(0, 6)) {
    for (const item of failure.diagnostics.slice(0, 48)) {
      const file = item.file
        ? (() => {
            try {
              return safeRepoPath(item.file);
            } catch {
              return null;
            }
          })()
        : null;
      if (!file || !focus.has(file) || !item.line || !item.column || !item.code) {
        unsupportedDiagnostics += 1;
        continue;
      }

      const key = `${file}:${item.line}:${item.column}:${item.code}:${item.message}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (item.code === "TS2551" || item.code === "TS2552") {
        const suggestion = normalizeIdentifierSuggestion(item.message);
        if (suggestion) {
          operations.push({
            kind: "typescript_replace_identifier_at_position",
            path: file,
            line: item.line,
            column: item.column,
            from: suggestion.from,
            to: suggestion.to,
          });
          matchedDiagnostics.push({
            code: item.code,
            file,
            line: item.line,
            column: item.column,
            strategy: "compiler_identifier_suggestion",
          });
          continue;
        }
      }

      if (item.code === "TS1005") {
        const punctuation = punctuationSuggestion(item.message);
        if (punctuation) {
          operations.push({
            kind: "typescript_insert_punctuation_at_position",
            path: file,
            line: item.line,
            column: item.column,
            text: punctuation,
          });
          matchedDiagnostics.push({
            code: item.code,
            file,
            line: item.line,
            column: item.column,
            strategy: "compiler_punctuation",
          });
          continue;
        }
      }

      unsupportedDiagnostics += 1;
    }
  }

  if (operations.length === 0) {
    return {
      status: "AI_REQUIRED",
      reason:
        "No compiler-backed deterministic recovery operation matched the current failure diagnostics.",
      operations: [],
      verificationCommands: verificationCommands.slice(0, 6),
      targetFiles: [],
      warnings: [
        "Recovery refuses semantic guesses. Unsupported diagnostics require AI reasoning or human edits.",
      ],
      matchedDiagnostics: [],
      unsupportedDiagnostics,
    };
  }

  if (operations.length > MAX_RECOVERY_OPERATIONS) {
    return {
      status: "AI_REQUIRED",
      reason:
        `Recovery would require more than ${MAX_RECOVERY_OPERATIONS} deterministic operations.`,
      operations: [],
      verificationCommands: verificationCommands.slice(0, 6),
      targetFiles: [],
      warnings: ["Recovery operation count exceeded the bounded safety limit."],
      matchedDiagnostics: [],
      unsupportedDiagnostics,
    };
  }

  const targetFiles = [...new Set(operations.map((operation) => safeRepoPath(operation.path)))];
  return {
    status: "EXECUTABLE",
    reason:
      `Matched ${operations.length} compiler-backed deterministic recovery operation(s) across ${targetFiles.length} file(s).`,
    operations,
    verificationCommands: verificationCommands.slice(0, 6),
    targetFiles,
    warnings:
      unsupportedDiagnostics > 0
        ? [`${unsupportedDiagnostics} diagnostic(s) remain unsupported and must still pass sandbox verification.`]
        : [],
    matchedDiagnostics,
    unsupportedDiagnostics,
  };
}

async function git(root: string, args: string[], trim = true): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LANG: "C",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return trim ? stdout.trim() : stdout;
}

async function latestRecoveryContext(taskId: string): Promise<RecoveryGateContext> {
  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId));
  if (!task) {
    throw new LocalDeterministicRecoveryError("Coding task not found", "NOT_FOUND");
  }
  if (task.status !== "READY_REVIEW" || task.commitSha) {
    throw new LocalDeterministicRecoveryError(
      "Coding task is not awaiting local recovery",
      "NOT_READY",
    );
  }

  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));

  if (runs.some((run) => run.status === "RUNNING")) {
    throw new LocalDeterministicRecoveryError(
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
    throw new LocalDeterministicRecoveryError(
      "Completed Coding Orchestrator payload was not found",
      "INVALID_CONTEXT",
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(orchestratorRun.logs) as Record<string, unknown>;
  } catch {
    throw new LocalDeterministicRecoveryError(
      "Coding Orchestrator payload is invalid",
      "INVALID_CONTEXT",
    );
  }

  const orchestration = isRecord(payload.orchestration) ? payload.orchestration : null;
  const localExecution = isRecord(payload.localExecution) ? payload.localExecution : null;
  const localPatchApproval = isRecord(payload.localPatchApproval)
    ? payload.localPatchApproval
    : null;
  const sandboxVerification = isRecord(payload.sandboxVerification)
    ? payload.sandboxVerification
    : null;
  const contextPackage = isRecord(payload.contextPackage)
    ? payload.contextPackage as unknown as LocalCodingContextPackage
    : null;
  const recoveryContext =
    asRecoveryContext(payload.failureRecoveryContext) ??
    asRecoveryContext(sandboxVerification?.failureRecoveryContext);

  if (orchestration?.nextAction !== "LOCAL_RECOVERY_REQUIRED") {
    throw new LocalDeterministicRecoveryError(
      "Coding task is not at the LOCAL_RECOVERY_REQUIRED gate",
      "NOT_READY",
    );
  }
  if (!contextPackage || !validSha(contextPackage.headSha)) {
    throw new LocalDeterministicRecoveryError(
      "Local recovery is missing a valid analyzed context package",
      "INVALID_CONTEXT",
    );
  }
  if (
    localPatchApproval?.gateStatus !== "PATCH_VALIDATED" ||
    localPatchApproval.commitCreated === true ||
    localPatchApproval.pushed === true
  ) {
    throw new LocalDeterministicRecoveryError(
      "The failing patch is not the currently validated local patch",
      "INVALID_CONTEXT",
    );
  }
  if (
    sandboxVerification?.status !== "FAILED" ||
    sandboxVerification.gateStatus !== "SANDBOX_NOT_VERIFIED"
  ) {
    throw new LocalDeterministicRecoveryError(
      "Local recovery requires a failed sandbox verification result",
      "NOT_READY",
    );
  }
  if (!recoveryContext) {
    throw new LocalDeterministicRecoveryError(
      "Structured failure recovery context is missing",
      "INVALID_CONTEXT",
    );
  }

  const originalPatch =
    typeof localExecution?.patch === "string" ? localExecution.patch : "";
  if (
    !originalPatch ||
    Buffer.byteLength(originalPatch, "utf8") > MAX_PATCH_BYTES ||
    originalPatch.includes("[REDACTED_SENSITIVE_DIFF_LINE]") ||
    originalPatch.includes("GIT binary patch") ||
    /(?:^|\n)Binary files /.test(originalPatch) ||
    /(?:^|\n)(?:---|\+\+\+) \/dev\/null/.test(originalPatch)
  ) {
    throw new LocalDeterministicRecoveryError(
      "Validated failing patch is missing or unsupported for local recovery",
      "INVALID_CONTEXT",
    );
  }

  const originalPatchSha256 =
    typeof localPatchApproval.patchSha256 === "string"
      ? localPatchApproval.patchSha256.toLowerCase()
      : "";
  const actualSha = createHash("sha256").update(originalPatch, "utf8").digest("hex");
  if (originalPatchSha256 !== actualSha) {
    throw new LocalDeterministicRecoveryError(
      "Validated failing patch digest no longer matches the orchestration payload",
      "INVALID_CONTEXT",
    );
  }

  const baseHeadSha = validSha(localPatchApproval.baseHeadSha);
  if (!baseHeadSha || baseHeadSha !== validSha(contextPackage.headSha)) {
    throw new LocalDeterministicRecoveryError(
      "Recovery base HEAD does not match the analyzed context HEAD",
      "INVALID_CONTEXT",
    );
  }

  const approvedChangedFiles = stringArray(localPatchApproval.changedFiles).map(safeRepoPath);
  if (
    approvedChangedFiles.length === 0 ||
    approvedChangedFiles.length > MAX_CHANGED_FILES ||
    !sameFiles(approvedChangedFiles, parsePatchFiles(originalPatch))
  ) {
    throw new LocalDeterministicRecoveryError(
      "Validated failing patch file set is inconsistent",
      "INVALID_CONTEXT",
    );
  }

  const failureContexts = asFailureContexts(sandboxVerification.failureContexts);
  if (failureContexts.length === 0) {
    throw new LocalDeterministicRecoveryError(
      "Sandbox failure did not provide structured diagnostics for deterministic recovery",
      "INVALID_CONTEXT",
    );
  }

  const verificationCommands = [
    ...new Set(
      stringArray(contextPackage.verificationCommands).length > 0
        ? stringArray(contextPackage.verificationCommands)
        : stringArray(sandboxVerification.verificationCommands),
    ),
  ].slice(0, 6);

  return {
    task,
    orchestratorRun,
    orchestratorPayload: payload,
    contextPackage,
    originalPatch,
    originalPatchSha256,
    baseHeadSha,
    approvedChangedFiles: [...new Set(approvedChangedFiles)].sort(),
    verificationCommands,
    failureContexts,
    failureRecoveryContext: recoveryContext,
  };
}

async function persistAiRequired(
  context: RecoveryGateContext,
  run: AiCodingRun,
  attempts: RecoveryAttemptSummary[],
  reason: string,
  recoveryContext: LocalFailureRecoveryContext,
): Promise<void> {
  const completedAt = new Date();
  const orchestration = isRecord(context.orchestratorPayload.orchestration)
    ? context.orchestratorPayload.orchestration
    : {};
  const payload = {
    ...context.orchestratorPayload,
    failureRecoveryContext: {
      ...recoveryContext,
      status: "DETERMINISTIC_RECOVERY_EXHAUSTED",
      nextAction: "AI_REQUIRED",
    },
    localRecovery: {
      status: "AI_REQUIRED",
      reason,
      attempts,
      aiInvoked: false,
      commitCreated: false,
      pushed: false,
      completedAt: completedAt.toISOString(),
    },
    orchestration: {
      ...orchestration,
      status: "READY_REVIEW",
      nextAction: "AI_REQUIRED",
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
          recoveryStatus: "AI_REQUIRED",
          attempts,
          reason,
          aiInvoked: false,
          nextAction: "AI_REQUIRED",
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
          "Deterministic local recovery stopped without guessing: " +
          reason.slice(0, 500) +
          " AI reasoning is required for the remaining semantic failure.",
      })
      .where(eq(aiCodingTasksTable.id, context.task.id));
  });

  await logAudit(
    "coding-orchestrator",
    "local_recovery_ai_required",
    context.task.id,
    "coding_task",
    "success",
    {
      codingRunId: run.id,
      attempts: attempts.length,
      aiInvoked: false,
      reason: reason.slice(0, 700),
    },
  );
}

async function persistRecoveryPatch(
  context: RecoveryGateContext,
  run: AiCodingRun,
  attempts: RecoveryAttemptSummary[],
  patch: string,
  changedFiles: string[],
  recoveryContext: LocalFailureRecoveryContext,
): Promise<void> {
  const completedAt = new Date();
  const recoveredPatchSha256 = createHash("sha256").update(patch, "utf8").digest("hex");
  const orchestration = isRecord(context.orchestratorPayload.orchestration)
    ? context.orchestratorPayload.orchestration
    : {};
  const previousExecution = isRecord(context.orchestratorPayload.localExecution)
    ? context.orchestratorPayload.localExecution
    : {};
  const previousPatchApproval = isRecord(context.orchestratorPayload.localPatchApproval)
    ? context.orchestratorPayload.localPatchApproval
    : {};
  const previousSandbox = isRecord(context.orchestratorPayload.sandboxVerification)
    ? context.orchestratorPayload.sandboxVerification
    : {};

  const payload = {
    ...context.orchestratorPayload,
    localExecution: {
      ...previousExecution,
      status: "APPLIED",
      reason:
        "Deterministic local recovery produced a new combined patch and the full sandbox verification passed.",
      changedFiles,
      patch,
      verification: [],
      rolledBack: false,
      warnings: [
        "Recovered patch must pass the explicit Local Patch Gate again before commit approval.",
      ],
      recoveryApplied: true,
    },
    localPatchApproval: {
      ...previousPatchApproval,
      status: "SUPERSEDED",
      gateStatus: "RECOVERY_PATCH_REVIEW_REQUIRED",
      reason:
        "The previously validated patch was superseded by a deterministic recovery patch.",
      commitCreated: false,
      pushed: false,
      supersededAt: completedAt.toISOString(),
    },
    sandboxVerification: {
      ...previousSandbox,
      status: "SUPERSEDED",
      gateStatus: "RECOVERY_PATCH_PENDING_REVIEW",
      reason:
        "Recovery sandbox passed, but the new combined patch must be explicitly reviewed and approved again.",
    },
    failureRecoveryContext: {
      ...recoveryContext,
      status: "RECOVERY_PATCH_READY",
      nextAction: "REVIEW_LOCAL_PATCH",
    },
    localRecovery: {
      status: "RECOVERY_PATCH_READY",
      attempts,
      originalPatchSha256: context.originalPatchSha256,
      recoveredPatchSha256,
      baseHeadSha: context.baseHeadSha,
      changedFiles,
      sandboxVerification: "PASSED",
      aiInvoked: false,
      commitCreated: false,
      pushed: false,
      completedAt: completedAt.toISOString(),
    },
    orchestration: {
      ...orchestration,
      status: "READY_REVIEW",
      nextAction: "REVIEW_LOCAL_PATCH",
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
          recoveryStatus: "RECOVERY_PATCH_READY",
          attempts,
          baseHeadSha: context.baseHeadSha,
          originalPatchSha256: context.originalPatchSha256,
          recoveredPatchSha256,
          changedFiles,
          sandboxVerification: "PASSED",
          aiInvoked: false,
          nextAction: "REVIEW_LOCAL_PATCH",
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
          `Deterministic recovery produced a new combined patch across ${changedFiles.length} file(s) and sandbox verification passed. Review and approve the recovered patch again before commit.`,
      })
      .where(eq(aiCodingTasksTable.id, context.task.id));
  });

  await logAudit(
    "coding-orchestrator",
    "local_recovery_patch_ready",
    context.task.id,
    "coding_task",
    "success",
    {
      codingRunId: run.id,
      attempts: attempts.length,
      baseHeadSha: context.baseHeadSha,
      originalPatchSha256: context.originalPatchSha256,
      recoveredPatchSha256,
      changedFiles,
      aiInvoked: false,
      commitCreated: false,
      pushed: false,
    },
  );
}

async function markRecoveryFailed(
  context: RecoveryGateContext,
  run: AiCodingRun,
  error: LocalDeterministicRecoveryError,
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
          kind: error.kind,
          error: error.message.slice(0, 1200),
          nextAction: "LOCAL_RECOVERY_REQUIRED",
        }, null, 2),
      })
      .where(eq(aiCodingRunsTable.id, run.id));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "READY_REVIEW",
        resultSummary:
          "Deterministic local recovery could not run safely: " +
          error.message.slice(0, 500),
      })
      .where(eq(aiCodingTasksTable.id, context.task.id));
  }).catch(() => undefined);

  await logAudit(
    "coding-orchestrator",
    "local_recovery_failed",
    context.task.id,
    "coding_task",
    "failure",
    {
      codingRunId: run.id,
      kind: error.kind,
      error: error.message.slice(0, 700),
    },
  ).catch(() => undefined);
}

async function executeRecovery(
  context: RecoveryGateContext,
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
      throw new LocalDeterministicRecoveryError(
        "Local recovery only runs against an isolated remote clone",
        "INVALID_CONTEXT",
      );
    }
    workspacePath = workspace.path;

    const actualHead = (await git(workspacePath, ["rev-parse", "HEAD"])).toLowerCase();
    if (actualHead !== context.baseHeadSha) {
      throw new LocalDeterministicRecoveryError(
        `Repository HEAD changed from ${context.baseHeadSha} to ${actualHead}; rerun Local Coding Engine before recovery`,
        "STALE_HEAD",
      );
    }

    patchFile = join(tmpdir(), `local-coding-recovery-${randomUUID()}.diff`);
    await writeFile(patchFile, context.originalPatch, "utf8");
    try {
      await git(workspacePath, ["apply", "--check", "--whitespace=error-all", patchFile]);
      await git(workspacePath, ["apply", "--whitespace=nowarn", patchFile]);
      await git(workspacePath, ["diff", "--check"]);
    } catch (error) {
      throw new LocalDeterministicRecoveryError(
        "Validated failing patch no longer applies cleanly: " +
          (error instanceof Error ? error.message.slice(0, 700) : String(error)),
        "INVALID_CONTEXT",
      );
    }

    const initiallyApplied = (await git(workspacePath, ["diff", "--name-only", "--"]))
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean)
      .map(safeRepoPath)
      .sort();
    if (!sameFiles(initiallyApplied, context.approvedChangedFiles)) {
      throw new LocalDeterministicRecoveryError(
        "Failing patch changed files outside its approved change set",
        "INVALID_CONTEXT",
      );
    }

    let failures = context.failureContexts;
    let recoveryContext = context.failureRecoveryContext;
    const attempts: RecoveryAttemptSummary[] = [];

    for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
      const plan = planDeterministicLocalRecovery(
        failures,
        recoveryContext,
        context.verificationCommands,
      );
      attempts.push({
        attempt,
        planStatus: plan.status,
        operations: plan.operations.length,
        strategies: plan.matchedDiagnostics.map((item) => item.strategy),
        reason: plan.reason,
      });

      if (plan.status !== "EXECUTABLE") {
        await persistAiRequired(context, run, attempts, plan.reason, recoveryContext);
        return;
      }

      const execution = await executeLocalCodingPlan(
        workspacePath,
        plan,
        {
          trustedWorkspace: true,
          expectedHeadSha: context.baseHeadSha,
          runVerification: false,
          requireCleanWorktree: false,
        },
      );

      attempts[attempts.length - 1]!.changedFiles = execution.changedFiles;
      if (execution.status !== "APPLIED") {
        const reason =
          `Deterministic recovery operation did not produce a statically valid patch: ${execution.reason}`;
        attempts[attempts.length - 1]!.reason = reason;
        await persistAiRequired(context, run, attempts, reason, recoveryContext);
        return;
      }

      const sandbox = await runSandboxedRepositoryVerification(
        workspacePath,
        context.verificationCommands,
      );
      attempts[attempts.length - 1]!.sandboxStatus = sandbox.status;

      if (sandbox.status === "BLOCKED") {
        throw new LocalDeterministicRecoveryError(
          sandbox.warnings[0] ?? "Sandbox runtime is unavailable during recovery.",
          "SANDBOX_BLOCKED",
        );
      }

      if (sandbox.status === "PASSED") {
        const finalChangedFiles = (await git(workspacePath, ["diff", "--name-only", "--"]))
          .split("\n")
          .map((file) => file.trim())
          .filter(Boolean)
          .map(safeRepoPath)
          .sort();
        if (
          finalChangedFiles.length === 0 ||
          finalChangedFiles.length > MAX_CHANGED_FILES
        ) {
          throw new LocalDeterministicRecoveryError(
            "Recovered patch changed-file set is empty or exceeds the safety limit",
            "RECOVERY_FAILED",
          );
        }

        const staticIssues = await verifyChangedFilesStatically(
          workspacePath,
          finalChangedFiles,
        );
        if (staticIssues.length > 0) {
          throw new LocalDeterministicRecoveryError(
            `Recovered combined patch failed static verification: ${staticIssues[0]?.file ?? "unknown"} ${staticIssues[0]?.detail ?? ""}`.trim(),
            "RECOVERY_FAILED",
          );
        }

        const rawPatch = await git(
          workspacePath,
          ["diff", "--no-ext-diff", "--unified=2", "--"],
          false,
        );
        if (
          !rawPatch ||
          Buffer.byteLength(rawPatch, "utf8") > MAX_PATCH_BYTES ||
          rawPatch.includes("[REDACTED_SENSITIVE_DIFF_LINE]") ||
          rawPatch.includes("GIT binary patch") ||
          /(?:^|\n)Binary files /.test(rawPatch) ||
          /(?:^|\n)(?:---|\+\+\+) \/dev\/null/.test(rawPatch)
        ) {
          throw new LocalDeterministicRecoveryError(
            "Recovered combined patch is empty, too large, or contains unsupported content",
            "RECOVERY_FAILED",
          );
        }

        await persistRecoveryPatch(
          context,
          run,
          attempts,
          rawPatch,
          finalChangedFiles,
          recoveryContext,
        );
        return;
      }

      const nextFailures = await enrichFailureContextsWithSymbols(
        workspacePath,
        sandbox.failureContexts,
      );
      const nextRecoveryContext = buildLocalFailureRecoveryContext(
        context.contextPackage,
        nextFailures,
        sandbox.deterministicRetries,
      );
      failures = nextFailures;
      recoveryContext = nextRecoveryContext;

      if (attempt === MAX_RECOVERY_ATTEMPTS) {
        const reason =
          "Sandbox verification still failed after the bounded deterministic recovery attempts.";
        attempts[attempts.length - 1]!.reason = reason;
        await persistAiRequired(context, run, attempts, reason, recoveryContext);
        return;
      }
    }
  } catch (error) {
    const normalized =
      error instanceof LocalDeterministicRecoveryError
        ? error
        : new LocalDeterministicRecoveryError(
            error instanceof Error ? error.message : String(error),
            "RECOVERY_FAILED",
          );
    await markRecoveryFailed(context, run, normalized);
  } finally {
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
    }
    if (patchFile) {
      await rm(patchFile, { force: true }).catch(() => undefined);
    }
  }
}

export async function startDeterministicLocalRecovery(
  taskId: string,
): Promise<AiCodingRun> {
  const context = await latestRecoveryContext(taskId);

  const [run] = await db.transaction(async (tx) => {
    const [lockedTask] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId))
      .for("update");
    if (!lockedTask) {
      throw new LocalDeterministicRecoveryError("Coding task not found", "NOT_FOUND");
    }
    if (lockedTask.status !== "READY_REVIEW" || lockedTask.commitSha) {
      throw new LocalDeterministicRecoveryError(
        "Coding task is not awaiting local recovery",
        "NOT_READY",
      );
    }

    const [activeRun] = await tx
      .select({ id: aiCodingRunsTable.id })
      .from(aiCodingRunsTable)
      .where(and(eq(aiCodingRunsTable.taskId, taskId), eq(aiCodingRunsTable.status, "RUNNING")))
      .limit(1);
    if (activeRun) {
      throw new LocalDeterministicRecoveryError(
        "Coding task already has an active run",
        "NOT_READY",
      );
    }

    const [created] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId,
        agentName: "Local Recovery Executor",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();

    await tx
      .update(aiCodingTasksTable)
      .set({
        resultSummary:
          "Deterministic local recovery started in an isolated clone. No AI/LLM is being invoked.",
      })
      .where(eq(aiCodingTasksTable.id, taskId));

    return [created];
  });

  await logAudit(
    "coding-orchestrator",
    "local_recovery_started",
    taskId,
    "coding_task",
    "success",
    {
      codingRunId: run.id,
      baseHeadSha: context.baseHeadSha,
      originalPatchSha256: context.originalPatchSha256,
      maxAttempts: MAX_RECOVERY_ATTEMPTS,
      aiInvoked: false,
    },
  );

  void executeRecovery(context, run);
  return run;
}
