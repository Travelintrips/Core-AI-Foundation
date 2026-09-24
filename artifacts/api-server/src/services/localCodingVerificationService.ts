import { lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import * as ts from "typescript";
import {
  isSensitiveRepositoryPath,
  runAllowlistedVerificationCommand,
  type VerificationCommandResult,
  type VerificationExecutor,
} from "./localCodingEngineService.js";

const MAX_STATIC_FILE_BYTES = 512_000;
const MAX_STATIC_TOTAL_BYTES = 2_000_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_ATTEMPTS = 3;

export interface LocalStaticVerificationIssue {
  file: string;
  kind: "unsafe_path" | "missing_file" | "symlink" | "conflict_marker" | "json_parse" | "syntax";
  detail: string;
  line?: number;
}

export interface LocalVerificationAttempt {
  attempt: number;
  staticIssues: LocalStaticVerificationIssue[];
  commands: VerificationCommandResult[];
  passed: boolean;
}

export interface LocalVerificationLoopResult {
  status: "PASSED" | "FAILED";
  attempts: LocalVerificationAttempt[];
  commandResults: VerificationCommandResult[];
  autoFixes: string[];
  scriptsExecuted: boolean;
  scriptsSkipped: boolean;
  warnings: string[];
}

interface LocalVerificationLoopOptions {
  commands?: string[];
  trustedScripts?: boolean;
  executor?: VerificationExecutor;
  timeoutMs?: number;
  maxAttempts?: number;
}

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

async function readSafeChangedFile(
  root: string,
  file: string,
): Promise<{ normalized: string; absolute: string; content: string } | LocalStaticVerificationIssue> {
  const normalized = normalizeRepoPath(file.trim());
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    isSensitiveRepositoryPath(normalized)
  ) {
    return {
      file: normalized || file,
      kind: "unsafe_path",
      detail: "Changed file is outside the safe repository context.",
    };
  }

  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, normalized);
  if (!isInsideRoot(absoluteRoot, candidate)) {
    return {
      file: normalized,
      kind: "unsafe_path",
      detail: "Changed file escapes the repository root.",
    };
  }

  const info = await lstat(candidate).catch(() => null);
  if (!info?.isFile()) {
    return {
      file: normalized,
      kind: "missing_file",
      detail: "Changed file does not exist or is not a regular file.",
    };
  }
  if (info.isSymbolicLink()) {
    return {
      file: normalized,
      kind: "symlink",
      detail: "Changed file is a symbolic link.",
    };
  }
  if (info.size > MAX_STATIC_FILE_BYTES) {
    return {
      file: normalized,
      kind: "unsafe_path",
      detail: `Changed file exceeds static verification limit of ${MAX_STATIC_FILE_BYTES} bytes.`,
    };
  }

  const [resolvedRoot, resolvedFile] = await Promise.all([
    realpath(absoluteRoot),
    realpath(candidate),
  ]);
  if (!isInsideRoot(resolvedRoot, resolvedFile)) {
    return {
      file: normalized,
      kind: "unsafe_path",
      detail: "Changed file resolves outside the repository root.",
    };
  }

  return {
    normalized,
    absolute: resolvedFile,
    content: await readFile(resolvedFile, "utf8"),
  };
}

function scriptKind(file: string): ts.ScriptKind {
  const lower = file.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function firstConflictMarkerLine(content: string): number | null {
  const lines = content.split("\n");
  const index = lines.findIndex((line) =>
    /^(?:<<<<<<< |=======|>>>>>>> )/.test(line),
  );
  return index >= 0 ? index + 1 : null;
}

export async function verifyChangedFilesStatically(
  root: string,
  changedFiles: string[],
): Promise<LocalStaticVerificationIssue[]> {
  const issues: LocalStaticVerificationIssue[] = [];
  let totalBytes = 0;

  for (const file of [...new Set(changedFiles)].slice(0, 80)) {
    const loaded = await readSafeChangedFile(root, file);
    if ("kind" in loaded) {
      issues.push(loaded);
      continue;
    }

    totalBytes += Buffer.byteLength(loaded.content, "utf8");
    if (totalBytes > MAX_STATIC_TOTAL_BYTES) {
      issues.push({
        file: loaded.normalized,
        kind: "unsafe_path",
        detail: `Static verification exceeded ${MAX_STATIC_TOTAL_BYTES} total bytes.`,
      });
      break;
    }

    const conflictLine = firstConflictMarkerLine(loaded.content);
    if (conflictLine !== null) {
      issues.push({
        file: loaded.normalized,
        kind: "conflict_marker",
        detail: "Git conflict marker is present in changed content.",
        line: conflictLine,
      });
      continue;
    }

    const extension = extname(loaded.normalized).toLowerCase();
    if (extension === ".json") {
      try {
        JSON.parse(loaded.content);
      } catch (error) {
        issues.push({
          file: loaded.normalized,
          kind: "json_parse",
          detail: error instanceof Error ? error.message.slice(0, 500) : "Invalid JSON.",
        });
      }
      continue;
    }

    if (/\.[cm]?[jt]sx?$/.test(extension)) {
      const source = ts.createSourceFile(
        loaded.normalized,
        loaded.content,
        ts.ScriptTarget.Latest,
        true,
        scriptKind(loaded.normalized),
      );
      const parseDiagnostics = (
        source as unknown as { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }
      ).parseDiagnostics ?? [];
      for (const diagnostic of parseDiagnostics.slice(0, 12)) {
        const start = diagnostic.start ?? 0;
        const line = source.getLineAndCharacterOfPosition(Math.min(start, source.end)).line + 1;
        issues.push({
          file: loaded.normalized,
          kind: "syntax",
          detail: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").slice(0, 500),
          line,
        });
      }
    }
  }

  return issues;
}

async function formatJsonDeterministically(
  root: string,
  changedFiles: string[],
): Promise<string[]> {
  const fixes: string[] = [];

  for (const file of [...new Set(changedFiles)].slice(0, 80)) {
    if (extname(file).toLowerCase() !== ".json" || isSensitiveRepositoryPath(file)) continue;
    const loaded = await readSafeChangedFile(root, file);
    if ("kind" in loaded) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(loaded.content);
    } catch {
      continue;
    }

    const formatted = `${JSON.stringify(parsed, null, 2)}\n`;
    if (formatted !== loaded.content) {
      await writeFile(loaded.absolute, formatted, "utf8");
      fixes.push(`json_format:${loaded.normalized}`);
    }
  }

  return fixes;
}

async function applyRegisteredAutoFixes(
  root: string,
  changedFiles: string[],
): Promise<string[]> {
  return formatJsonDeterministically(root, changedFiles);
}

export async function runLocalVerificationLoop(
  root: string,
  changedFiles: string[],
  options: LocalVerificationLoopOptions = {},
): Promise<LocalVerificationLoopResult> {
  const absoluteRoot = resolve(root);
  const rootInfo = await stat(absoluteRoot).catch(() => null);
  if (!rootInfo?.isDirectory()) {
    return {
      status: "FAILED",
      attempts: [{
        attempt: 1,
        staticIssues: [{
          file: ".",
          kind: "missing_file",
          detail: "Repository root does not exist.",
        }],
        commands: [],
        passed: false,
      }],
      commandResults: [],
      autoFixes: [],
      scriptsExecuted: false,
      scriptsSkipped: false,
      warnings: [],
    };
  }

  const commands = [...new Set(options.commands ?? [])].slice(0, 6);
  const trustedScripts = options.trustedScripts === true;
  const maxAttempts = Math.max(
    1,
    Math.min(Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS), MAX_ATTEMPTS),
  );
  const attempts: LocalVerificationAttempt[] = [];
  const autoFixes: string[] = [];
  const commandResults: VerificationCommandResult[] = [];
  const warnings: string[] = [];
  const scriptsSkipped = commands.length > 0 && !trustedScripts;
  if (scriptsSkipped) {
    warnings.push(
      "Project verification scripts were discovered but not executed because script execution was not explicitly trusted.",
    );
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const staticIssues = await verifyChangedFilesStatically(absoluteRoot, changedFiles);
    const commandAttempt: VerificationCommandResult[] = [];

    if (staticIssues.length === 0 && trustedScripts) {
      for (const command of commands) {
        const result = await runAllowlistedVerificationCommand(absoluteRoot, command, {
          trustedWorkspace: true,
          timeoutMs: options.timeoutMs,
          executor: options.executor,
        });
        commandAttempt.push(result);
        commandResults.push(result);
        if (result.status !== "PASSED") break;
      }
    }

    const commandsPassed =
      !trustedScripts ||
      commands.length === 0 ||
      (commandAttempt.length === commands.length && commandAttempt.every((item) => item.status === "PASSED"));
    const passed = staticIssues.length === 0 && commandsPassed;
    attempts.push({ attempt, staticIssues, commands: commandAttempt, passed });
    if (passed) {
      return {
        status: "PASSED",
        attempts,
        commandResults,
        autoFixes,
        scriptsExecuted: trustedScripts && commands.length > 0,
        scriptsSkipped,
        warnings,
      };
    }

    if (attempt >= maxAttempts) break;
    const fixes = await applyRegisteredAutoFixes(absoluteRoot, changedFiles);
    if (fixes.length === 0) break;
    autoFixes.push(...fixes);
  }

  return {
    status: "FAILED",
    attempts,
    commandResults,
    autoFixes,
    scriptsExecuted: trustedScripts && commands.length > 0,
    scriptsSkipped,
    warnings,
  };
}
