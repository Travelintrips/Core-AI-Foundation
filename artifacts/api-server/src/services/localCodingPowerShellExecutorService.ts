import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { logAudit } from "./aiAuditService.js";

const execFileAsync = promisify(execFile);

const MAX_COMMANDS = 6;
const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 180_000;
const DEFAULT_APPROVAL_TTL_MS = 10 * 60_000;
const MAX_APPROVAL_TTL_MS = 15 * 60_000;
const MAX_STDOUT_CHARS = 200_000;
const MAX_STDERR_CHARS = 100_000;

const ALLOWED_SCRIPTS = new Set(["test", "typecheck", "lint", "build"]);
const FORBIDDEN_SHELL_META = /[;&|><\x60\r\n\0]/;

export type PowerShellExecutionStatus =
  | "PREPARED"
  | "APPROVED"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED";

export interface PowerShellCommandResult {
  command: string;
  status: "PASSED" | "FAILED" | "TIMEOUT";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface PreparedPowerShellExecution {
  approvalId: string;
  taskId: string | null;
  requestedBy: string;
  source: "OLLAMA_TASK";
  modelId: string;
  commands: string[];
  digest: string;
  status: PowerShellExecutionStatus;
  preparedAt: string;
  approvedAt: string | null;
  expiresAt: string;
  executedAt: string | null;
  results: PowerShellCommandResult[];
}

interface ParsedPowerShellCommand {
  display: string;
  script: string;
}

export interface PowerShellExecutorOptions {
  cwd: string;
  timeout: number;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
}

export type PowerShellExecutor = (
  file: string,
  args: string[],
  options: PowerShellExecutorOptions,
) => Promise<{ stdout?: string; stderr?: string }>;

export class LocalCodingPowerShellError extends Error {
  constructor(
    message: string,
    readonly code:
      | "DISABLED"
      | "INVALID_COMMAND"
      | "NOT_FOUND"
      | "NOT_READY"
      | "EXPIRED"
      | "DIGEST_MISMATCH"
      | "WORKSPACE_INVALID",
  ) {
    super(message);
    this.name = "LocalCodingPowerShellError";
  }
}

const approvals = new Map<string, PreparedPowerShellExecution>();

function envTrue(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function assertRuntimeEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (!envTrue(env["OLLAMA_WORKER_POWERSHELL_ENABLED"])) {
    throw new LocalCodingPowerShellError(
      "Ollama PowerShell execution is disabled. Set OLLAMA_WORKER_POWERSHELL_ENABLED=true explicitly.",
      "DISABLED",
    );
  }
  if (
    env["NODE_ENV"] === "production" &&
    !envTrue(env["OLLAMA_WORKER_POWERSHELL_ALLOW_PRODUCTION"])
  ) {
    throw new LocalCodingPowerShellError(
      "PowerShell execution is fail-closed in production unless OLLAMA_WORKER_POWERSHELL_ALLOW_PRODUCTION=true.",
      "DISABLED",
    );
  }
}

function safeFilterName(value: string): boolean {
  return (
    /^[@A-Za-z0-9._/*-]+$/.test(value) &&
    !value.includes("..") &&
    value.length <= 160
  );
}

export function parseAllowlistedPowerShellCommand(
  command: unknown,
): ParsedPowerShellCommand | null {
  if (typeof command !== "string") return null;
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 300 || FORBIDDEN_SHELL_META.test(normalized)) {
    return null;
  }

  if (normalized === "Get-Location") {
    return { display: normalized, script: "Get-Location" };
  }
  if (normalized === "Get-ChildItem") {
    return { display: normalized, script: "Get-ChildItem" };
  }
  if (normalized === "Get-ChildItem -Name") {
    return { display: normalized, script: "Get-ChildItem -Name" };
  }
  if (
    normalized === "git status --short" ||
    normalized === "git diff --check" ||
    normalized === "git diff --name-only" ||
    normalized === "git rev-parse HEAD" ||
    normalized === "node --version" ||
    normalized === "pnpm --version"
  ) {
    return { display: normalized, script: "& " + normalized };
  }

  const parts = normalized.split(" ");
  if (parts[0] === "pnpm") {
    let script: string | undefined;
    if (parts.length === 2) {
      script = parts[1];
    } else if (parts.length === 3 && parts[1] === "run") {
      script = parts[2];
    } else if (
      parts.length === 4 &&
      parts[1] === "--filter" &&
      safeFilterName(parts[2] ?? "")
    ) {
      script = parts[3];
    } else if (
      parts.length === 5 &&
      parts[1] === "--filter" &&
      safeFilterName(parts[2] ?? "") &&
      parts[3] === "run"
    ) {
      script = parts[4];
    }
    if (script && ALLOWED_SCRIPTS.has(script)) {
      return { display: normalized, script: "& " + normalized };
    }
  }

  if (
    parts[0] === "npm" &&
    parts.length === 3 &&
    parts[1] === "run" &&
    ALLOWED_SCRIPTS.has(parts[2] ?? "")
  ) {
    return { display: normalized, script: "& " + normalized };
  }

  return null;
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.max(
    MIN_TIMEOUT_MS,
    Math.min(MAX_TIMEOUT_MS, Math.floor(value ?? DEFAULT_TIMEOUT_MS)),
  );
}

function boundedTtl(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_APPROVAL_TTL_MS;
  return Math.max(
    60_000,
    Math.min(MAX_APPROVAL_TTL_MS, Math.floor(value ?? DEFAULT_APPROVAL_TTL_MS)),
  );
}

async function resolveWorkspaceRoot(env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env["LOCAL_CODING_POWERSHELL_ROOT"]?.trim();
  const candidate = resolve(configured || process.cwd());
  const info = await stat(candidate).catch(() => null);
  if (!info?.isDirectory()) {
    throw new LocalCodingPowerShellError(
      "Configured PowerShell workspace root does not exist or is not a directory.",
      "WORKSPACE_INVALID",
    );
  }
  return realpath(candidate);
}

function executionDigest(input: {
  taskId: string | null;
  requestedBy: string;
  source: "OLLAMA_TASK";
  modelId: string;
  commands: string[];
  workspaceRoot: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");
}

function expireIfNeeded(item: PreparedPowerShellExecution): void {
  if (
    ["PREPARED", "APPROVED"].includes(item.status) &&
    Date.parse(item.expiresAt) <= Date.now()
  ) {
    item.status = "EXPIRED";
  }
}

function publicSnapshot(item: PreparedPowerShellExecution): PreparedPowerShellExecution {
  expireIfNeeded(item);
  return {
    ...item,
    commands: [...item.commands],
    results: item.results.map((result) => ({ ...result })),
  };
}

export function getPowerShellExecutorStatus(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const enabled =
    envTrue(env["OLLAMA_WORKER_POWERSHELL_ENABLED"]) &&
    (env["NODE_ENV"] !== "production" ||
      envTrue(env["OLLAMA_WORKER_POWERSHELL_ALLOW_PRODUCTION"]));
  const active = [...approvals.values()].filter((item) => {
    expireIfNeeded(item);
    return ["PREPARED", "APPROVED", "EXECUTING"].includes(item.status);
  }).length;
  return {
    enabled,
    production: env["NODE_ENV"] === "production",
    workspace: basename(resolve(env["LOCAL_CODING_POWERSHELL_ROOT"] || process.cwd())),
    approvalTtlMs: DEFAULT_APPROVAL_TTL_MS,
    maxCommands: MAX_COMMANDS,
    timeoutRangeMs: [MIN_TIMEOUT_MS, MAX_TIMEOUT_MS],
    activeApprovals: active,
    allowlist: [
      "Get-Location",
      "Get-ChildItem",
      "Get-ChildItem -Name",
      "git status --short",
      "git diff --check",
      "git diff --name-only",
      "git rev-parse HEAD",
      "node --version",
      "pnpm --version",
      "pnpm [--filter <package>] [run] <test|typecheck|lint|build>",
      "npm run <test|typecheck|lint|build>",
    ],
  };
}

export async function prepareOllamaPowerShellExecution(input: {
  taskId?: string | null;
  requestedBy: string;
  modelId: string;
  commands: string[];
  approvalTtlMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<PreparedPowerShellExecution> {
  const env = input.env ?? process.env;
  assertRuntimeEnabled(env);

  if (
    !input.requestedBy.trim() ||
    input.requestedBy.length > 200 ||
    /[\r\n\0]/.test(input.requestedBy)
  ) {
    throw new LocalCodingPowerShellError("requestedBy is invalid.", "INVALID_COMMAND");
  }
  if (
    !input.modelId.trim() ||
    input.modelId.length > 300 ||
    /[\r\n\0]/.test(input.modelId)
  ) {
    throw new LocalCodingPowerShellError("modelId is invalid.", "INVALID_COMMAND");
  }
  if (
    !Array.isArray(input.commands) ||
    input.commands.length < 1 ||
    input.commands.length > MAX_COMMANDS
  ) {
    throw new LocalCodingPowerShellError(
      "PowerShell execution requires between 1 and " + MAX_COMMANDS + " commands.",
      "INVALID_COMMAND",
    );
  }

  const parsed = input.commands.map((command) => {
    const value = parseAllowlistedPowerShellCommand(command);
    if (!value) {
      throw new LocalCodingPowerShellError(
        "PowerShell command is not allowlisted: " + String(command).slice(0, 180),
        "INVALID_COMMAND",
      );
    }
    return value;
  });

  const commands = parsed.map((item) => item.display);
  const workspaceRoot = await resolveWorkspaceRoot(env);
  const taskId = input.taskId?.trim() || null;
  const requestedBy = input.requestedBy.trim();
  const modelId = input.modelId.trim();
  const digest = executionDigest({
    taskId,
    requestedBy,
    source: "OLLAMA_TASK",
    modelId,
    commands,
    workspaceRoot,
  });
  const now = Date.now();
  const item: PreparedPowerShellExecution = {
    approvalId: randomUUID(),
    taskId,
    requestedBy,
    source: "OLLAMA_TASK",
    modelId,
    commands,
    digest,
    status: "PREPARED",
    preparedAt: new Date(now).toISOString(),
    approvedAt: null,
    expiresAt: new Date(now + boundedTtl(input.approvalTtlMs)).toISOString(),
    executedAt: null,
    results: [],
  };
  approvals.set(item.approvalId, item);

  await logAudit(
    "ollama-worker",
    "powershell_execution_prepared",
    item.approvalId,
    "coding_powershell_execution",
    "success",
    {
      taskId,
      requestedBy,
      modelId,
      commands,
      digest,
      expiresAt: item.expiresAt,
    },
  ).catch(() => undefined);

  return publicSnapshot(item);
}

export async function approveOllamaPowerShellExecution(
  approvalId: string,
  expectedDigest: string,
): Promise<PreparedPowerShellExecution> {
  const item = approvals.get(approvalId);
  if (!item) {
    throw new LocalCodingPowerShellError("PowerShell approval was not found.", "NOT_FOUND");
  }
  expireIfNeeded(item);
  if (item.status === "EXPIRED") {
    throw new LocalCodingPowerShellError("PowerShell approval has expired.", "EXPIRED");
  }
  if (item.status !== "PREPARED") {
    throw new LocalCodingPowerShellError(
      "PowerShell execution is not awaiting approval.",
      "NOT_READY",
    );
  }
  if (expectedDigest !== item.digest) {
    throw new LocalCodingPowerShellError(
      "PowerShell approval digest does not match the prepared command set.",
      "DIGEST_MISMATCH",
    );
  }

  item.status = "APPROVED";
  item.approvedAt = new Date().toISOString();

  await logAudit(
    "ollama-worker",
    "powershell_execution_approved",
    item.approvalId,
    "coding_powershell_execution",
    "success",
    {
      taskId: item.taskId,
      digest: item.digest,
      commands: item.commands,
    },
  ).catch(() => undefined);

  return publicSnapshot(item);
}

export function getOllamaPowerShellExecution(
  approvalId: string,
): PreparedPowerShellExecution {
  const item = approvals.get(approvalId);
  if (!item) {
    throw new LocalCodingPowerShellError("PowerShell approval was not found.", "NOT_FOUND");
  }
  return publicSnapshot(item);
}

export async function executeApprovedOllamaPowerShellExecution(input: {
  approvalId: string;
  expectedDigest: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  executor?: PowerShellExecutor;
}): Promise<PreparedPowerShellExecution> {
  const env = input.env ?? process.env;
  assertRuntimeEnabled(env);

  const item = approvals.get(input.approvalId);
  if (!item) {
    throw new LocalCodingPowerShellError("PowerShell approval was not found.", "NOT_FOUND");
  }
  expireIfNeeded(item);
  if (item.status === "EXPIRED") {
    throw new LocalCodingPowerShellError("PowerShell approval has expired.", "EXPIRED");
  }
  if (item.status !== "APPROVED") {
    throw new LocalCodingPowerShellError(
      "PowerShell execution must be explicitly approved before execution.",
      "NOT_READY",
    );
  }
  if (input.expectedDigest !== item.digest) {
    throw new LocalCodingPowerShellError(
      "PowerShell execution digest does not match the approved command set.",
      "DIGEST_MISMATCH",
    );
  }

  const workspaceRoot = await resolveWorkspaceRoot(env);
  const expected = executionDigest({
    taskId: item.taskId,
    requestedBy: item.requestedBy,
    source: item.source,
    modelId: item.modelId,
    commands: item.commands,
    workspaceRoot,
  });
  if (expected !== item.digest) {
    throw new LocalCodingPowerShellError(
      "PowerShell workspace or approved command context changed after approval.",
      "DIGEST_MISMATCH",
    );
  }

  const parsed = item.commands.map((command) => {
    const value = parseAllowlistedPowerShellCommand(command);
    if (!value) {
      throw new LocalCodingPowerShellError(
        "Previously approved command no longer passes the allowlist.",
        "INVALID_COMMAND",
      );
    }
    return value;
  });

  item.status = "EXECUTING";
  const timeout = boundedTimeout(input.timeoutMs);
  const shell =
    env["LOCAL_CODING_POWERSHELL_BIN"]?.trim() ||
    (process.platform === "win32" ? "powershell.exe" : "pwsh");
  const executor = input.executor ?? (async (file, args, options) => {
    const output = await execFileAsync(file, args, options);
    return { stdout: output.stdout, stderr: output.stderr };
  });

  const results: PowerShellCommandResult[] = [];
  try {
    for (const command of parsed) {
      const started = Date.now();
      try {
        const output = await executor(
          shell,
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command.script],
          {
            cwd: workspaceRoot,
            timeout,
            maxBuffer: 2 * 1024 * 1024,
            env: {
              PATH: env["PATH"] ?? "",
              HOME: env["HOME"] ?? "",
              USERPROFILE: env["USERPROFILE"] ?? "",
              TEMP: env["TEMP"] ?? "",
              TMP: env["TMP"] ?? "",
              CI: "1",
              NO_COLOR: "1",
            },
          },
        );
        results.push({
          command: command.display,
          status: "PASSED",
          exitCode: 0,
          stdout: (output.stdout ?? "").slice(0, MAX_STDOUT_CHARS),
          stderr: (output.stderr ?? "").slice(0, MAX_STDERR_CHARS),
          durationMs: Date.now() - started,
        });
      } catch (error) {
        const typed = error as Error & {
          code?: number | string;
          killed?: boolean;
          signal?: string;
          stdout?: string;
          stderr?: string;
        };
        const timedOut =
          typed.killed === true ||
          typed.signal === "SIGTERM" ||
          typed.code === "ETIMEDOUT";
        results.push({
          command: command.display,
          status: timedOut ? "TIMEOUT" : "FAILED",
          exitCode: typeof typed.code === "number" ? typed.code : null,
          stdout: (typed.stdout ?? "").slice(0, MAX_STDOUT_CHARS),
          stderr: (typed.stderr ?? typed.message ?? "").slice(0, MAX_STDERR_CHARS),
          durationMs: Date.now() - started,
        });
        break;
      }
    }

    item.results = results;
    item.executedAt = new Date().toISOString();
    item.status =
      results.length === parsed.length &&
      results.every((result) => result.status === "PASSED")
        ? "COMPLETED"
        : "FAILED";

    await logAudit(
      "ollama-worker",
      "powershell_execution_completed",
      item.approvalId,
      "coding_powershell_execution",
      item.status === "COMPLETED" ? "success" : "failure",
      {
        taskId: item.taskId,
        modelId: item.modelId,
        digest: item.digest,
        commandCount: item.commands.length,
        results: results.map((result) => ({
          command: result.command,
          status: result.status,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        })),
      },
    ).catch(() => undefined);

    return publicSnapshot(item);
  } catch (error) {
    item.results = results;
    item.executedAt = new Date().toISOString();
    item.status = "FAILED";
    throw error;
  }
}
