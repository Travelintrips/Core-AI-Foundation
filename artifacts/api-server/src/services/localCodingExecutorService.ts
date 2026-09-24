import { execFile } from "node:child_process";
import { lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import * as ts from "typescript";
import {
  isSensitiveRepositoryPath,
  runAllowlistedVerificationCommand,
  type LocalCodingContextPackage,
  type VerificationCommandResult,
  type VerificationExecutor,
} from "./localCodingEngineService.js";

const execFileAsync = promisify(execFile);

const MAX_OPERATIONS = 20;
const MAX_EDITABLE_FILE_BYTES = 512_000;
const MAX_TOTAL_WRITE_BYTES = 1_500_000;
const MAX_PATCH_BYTES = 160_000;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type LocalEditOperation =
  | {
      kind: "replace_text";
      path: string;
      search: string;
      replacement: string;
      expectedOccurrences?: number;
    }
  | {
      kind: "delete_text";
      path: string;
      search: string;
      expectedOccurrences?: number;
    }
  | {
      kind: "insert_after";
      path: string;
      anchor: string;
      content: string;
      expectedOccurrences?: number;
    }
  | {
      kind: "json_set";
      path: string;
      keyPath: string[];
      value: JsonValue;
    }
  | {
      kind: "typescript_rename_identifier";
      path: string;
      from: string;
      to: string;
      expectedOccurrences?: number;
    };

export interface LocalCodingExecutionPlan {
  status: "EXECUTABLE" | "AI_REQUIRED";
  reason: string;
  operations: LocalEditOperation[];
  verificationCommands: string[];
  targetFiles: string[];
  warnings: string[];
}

export interface LocalCodingExecutionResult {
  status:
    | "APPLIED"
    | "AI_REQUIRED"
    | "BLOCKED"
    | "VERIFICATION_FAILED"
    | "FAILED"
    | "NO_CHANGES";
  reason: string;
  changedFiles: string[];
  patch: string;
  verification: VerificationCommandResult[];
  rolledBack: boolean;
  warnings: string[];
}

interface ExecutionOptions {
  trustedWorkspace?: boolean;
  expectedHeadSha?: string;
  runVerification?: boolean;
  verificationTimeoutMs?: number;
  verificationExecutor?: VerificationExecutor;
  requireCleanWorktree?: boolean;
}

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

async function safeExistingFile(root: string, file: string): Promise<{ path: string; content: string }> {
  const normalized = normalizeRepoPath(file.trim());
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    isSensitiveRepositoryPath(normalized)
  ) {
    throw new Error(`Unsafe local coding target: ${file}`);
  }

  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, normalized);
  if (!isInsideRoot(absoluteRoot, candidate)) {
    throw new Error(`Local coding target escapes repository root: ${normalized}`);
  }

  const entry = await lstat(candidate).catch(() => null);
  if (!entry?.isFile() || entry.isSymbolicLink()) {
    throw new Error(`Local coding target must be an existing regular file: ${normalized}`);
  }
  if (entry.size > MAX_EDITABLE_FILE_BYTES) {
    throw new Error(`Local coding target exceeds ${MAX_EDITABLE_FILE_BYTES} bytes: ${normalized}`);
  }

  const [resolvedRoot, resolvedFile] = await Promise.all([
    realpath(absoluteRoot),
    realpath(candidate),
  ]);
  if (!isInsideRoot(resolvedRoot, resolvedFile)) {
    throw new Error(`Local coding target resolves outside repository root: ${normalized}`);
  }

  return {
    path: normalized,
    content: await readFile(resolvedFile, "utf8"),
  };
}

function countOccurrences(content: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= content.length) {
    const found = content.indexOf(needle, offset);
    if (found < 0) break;
    count += 1;
    offset = found + Math.max(needle.length, 1);
  }
  return count;
}

function assertOccurrences(actual: number, expected: number | undefined, description: string): void {
  const required = expected ?? 1;
  if (actual !== required) {
    throw new Error(`${description} expected ${required} occurrence(s), found ${actual}`);
  }
}

function replaceExact(
  content: string,
  search: string,
  replacement: string,
  expectedOccurrences?: number,
): string {
  if (!search) throw new Error("Exact replacement search text cannot be empty");
  const count = countOccurrences(content, search);
  assertOccurrences(count, expectedOccurrences, "Exact replacement");
  return content.split(search).join(replacement);
}

function insertAfter(
  content: string,
  anchor: string,
  addition: string,
  expectedOccurrences?: number,
): string {
  if (!anchor) throw new Error("Insert anchor cannot be empty");
  const count = countOccurrences(content, anchor);
  assertOccurrences(count, expectedOccurrences, "Insert anchor");
  return content.replace(anchor, `${anchor}${addition}`);
}

function setJsonValue(content: string, keyPath: string[], value: JsonValue): string {
  if (keyPath.length === 0 || keyPath.length > 12 || keyPath.some((key) => !/^[A-Za-z0-9_.@/-]+$/.test(key))) {
    throw new Error("JSON key path is invalid or too deep");
  }
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON edit target must contain an object at the root");
  }

  let cursor = parsed as Record<string, unknown>;
  for (const key of keyPath.slice(0, -1)) {
    const existing = cursor[key];
    if (existing === undefined) {
      cursor[key] = {};
    } else if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      throw new Error(`JSON key path crosses a non-object value at '${key}'`);
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keyPath.at(-1)!] = value;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function renameTypeScriptIdentifier(
  file: string,
  content: string,
  from: string,
  to: string,
  expectedOccurrences?: number,
): string {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(from) || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(to)) {
    throw new Error("TypeScript identifier rename requires valid identifiers");
  }
  if (!/\.[cm]?[jt]sx?$/.test(file)) {
    throw new Error("TypeScript identifier rename only supports JS/TS source files");
  }

  const scriptKind = file.endsWith(".tsx") || file.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const spans: Array<{ start: number; end: number }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === from) {
      spans.push({ start: node.getStart(sourceFile), end: node.getEnd() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assertOccurrences(spans.length, expectedOccurrences, `Identifier '${from}'`);

  let next = content;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    next = `${next.slice(0, span.start)}${to}${next.slice(span.end)}`;
  }
  return next;
}

function applyOperation(content: string, operation: LocalEditOperation): string {
  switch (operation.kind) {
    case "replace_text":
      return replaceExact(
        content,
        operation.search,
        operation.replacement,
        operation.expectedOccurrences,
      );
    case "delete_text":
      return replaceExact(content, operation.search, "", operation.expectedOccurrences);
    case "insert_after":
      return insertAfter(
        content,
        operation.anchor,
        operation.content,
        operation.expectedOccurrences,
      );
    case "json_set":
      return setJsonValue(content, operation.keyPath, operation.value);
    case "typescript_rename_identifier":
      return renameTypeScriptIdentifier(
        operation.path,
        content,
        operation.from,
        operation.to,
        operation.expectedOccurrences,
      );
  }
}

async function git(root: string, args: string[], trim = true): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LANG: "C",
      LC_ALL: "C",
    },
  });
  return trim ? stdout.trim() : stdout;
}

function redactPatch(value: string): string {
  return value
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
    .join("\n");
}

function quotedValue(raw: string): string {
  const quote = raw[0];
  const body = raw.slice(1, -1);
  if (quote === '"') {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return body;
    }
  }
  return body.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function pathIsInContext(path: string, context: LocalCodingContextPackage): boolean {
  const allowed = new Set([
    ...context.relevantFiles.map((item) => item.path),
    ...context.affectedFiles,
    ...context.relatedTests,
    ...context.changedFiles,
  ].map(normalizeRepoPath));
  return allowed.has(normalizeRepoPath(path));
}

interface ParsedDirective {
  index: number;
  operation: LocalEditOperation;
}

function parseDeterministicDirectives(instruction: string): ParsedDirective[] {
  const directives: ParsedDirective[] = [];
  const pathPattern = "((?:[A-Za-z0-9_@./\\-]+\\.[A-Za-z0-9]+)|(?:\\.[A-Za-z0-9_.-]+))";

  const replacePattern = new RegExp(
    `(?:replace|ganti)\\s+((?:\"(?:\\\\.|[^\"])*\")|(?:'(?:\\\\.|[^'])*'))\\s+(?:with|menjadi|ke)\\s+((?:\"(?:\\\\.|[^\"])*\")|(?:'(?:\\\\.|[^'])*'))\\s+(?:in|di)\\s+${pathPattern}`,
    "gi",
  );
  for (const match of instruction.matchAll(replacePattern)) {
    directives.push({
      index: match.index ?? 0,
      operation: {
        kind: "replace_text",
        path: match[3],
        search: quotedValue(match[1]),
        replacement: quotedValue(match[2]),
        expectedOccurrences: 1,
      },
    });
  }

  const deletePattern = new RegExp(
    `(?:delete|remove|hapus)\\s+((?:\"(?:\\\\.|[^\"])*\")|(?:'(?:\\\\.|[^'])*'))\\s+(?:from|dari)\\s+${pathPattern}`,
    "gi",
  );
  for (const match of instruction.matchAll(deletePattern)) {
    directives.push({
      index: match.index ?? 0,
      operation: {
        kind: "delete_text",
        path: match[2],
        search: quotedValue(match[1]),
        expectedOccurrences: 1,
      },
    });
  }

  const insertPattern = new RegExp(
    `(?:insert|tambahkan)\\s+((?:\"(?:\\\\.|[^\"])*\")|(?:'(?:\\\\.|[^'])*'))\\s+(?:after|setelah)\\s+((?:\"(?:\\\\.|[^\"])*\")|(?:'(?:\\\\.|[^'])*'))\\s+(?:in|di)\\s+${pathPattern}`,
    "gi",
  );
  for (const match of instruction.matchAll(insertPattern)) {
    directives.push({
      index: match.index ?? 0,
      operation: {
        kind: "insert_after",
        path: match[3],
        anchor: quotedValue(match[2]),
        content: quotedValue(match[1]),
        expectedOccurrences: 1,
      },
    });
  }

  const jsonSetPattern = new RegExp(
    `(?:set|atur)\\s+json\\s+([A-Za-z0-9_.-]+(?:\\.[A-Za-z0-9_.-]+)*)\\s+(?:to|menjadi)\\s+((?:\"(?:\\\\.|[^\"])*\")|true|false|null|-?\\d+(?:\\.\\d+)?)\\s+(?:in|di)\\s+${pathPattern}`,
    "gi",
  );
  for (const match of instruction.matchAll(jsonSetPattern)) {
    let value: JsonValue;
    try {
      value = JSON.parse(match[2]) as JsonValue;
    } catch {
      continue;
    }
    directives.push({
      index: match.index ?? 0,
      operation: {
        kind: "json_set",
        path: match[3],
        keyPath: match[1].split(".").filter(Boolean),
        value,
      },
    });
  }

  const renamePattern = new RegExp(
    `(?:rename|ganti)\\s+(?:identifier|simbol)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s+(?:to|menjadi)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s+(?:in|di)\\s+${pathPattern}`,
    "gi",
  );
  for (const match of instruction.matchAll(renamePattern)) {
    directives.push({
      index: match.index ?? 0,
      operation: {
        kind: "typescript_rename_identifier",
        path: match[3],
        from: match[1],
        to: match[2],
      },
    });
  }

  return directives.sort((a, b) => a.index - b.index);
}

export function planLocalCodingExecution(
  instruction: string,
  context: LocalCodingContextPackage,
): LocalCodingExecutionPlan {
  const parsed = parseDeterministicDirectives(instruction);
  if (parsed.length === 0) {
    return {
      status: "AI_REQUIRED",
      reason:
        "No deterministic local edit directive was detected. Semantic reasoning is required before any file write.",
      operations: [],
      verificationCommands: context.verificationCommands,
      targetFiles: [],
      warnings: [],
    };
  }

  if (parsed.length > MAX_OPERATIONS) {
    return {
      status: "AI_REQUIRED",
      reason: `Task expands to more than ${MAX_OPERATIONS} local edit operations.`,
      operations: [],
      verificationCommands: context.verificationCommands,
      targetFiles: [],
      warnings: [],
    };
  }

  const operations = parsed.map((item) => item.operation);
  const targets = [...new Set(operations.map((operation) => normalizeRepoPath(operation.path)))];
  const unsafe = targets.find((path) => isSensitiveRepositoryPath(path));
  if (unsafe) {
    return {
      status: "AI_REQUIRED",
      reason: `Deterministic edit targets a sensitive path: ${unsafe}`,
      operations: [],
      verificationCommands: context.verificationCommands,
      targetFiles: targets,
      warnings: ["Sensitive files are never eligible for local coding execution."],
    };
  }
  const outsideContext = targets.find((path) => !pathIsInContext(path, context));
  if (outsideContext) {
    return {
      status: "AI_REQUIRED",
      reason: `Target file is outside the bounded analyzed context: ${outsideContext}`,
      operations: [],
      verificationCommands: context.verificationCommands,
      targetFiles: targets,
      warnings: ["Re-run repository analysis with enough context before editing this file."],
    };
  }

  return {
    status: "EXECUTABLE",
    reason: `Detected ${operations.length} deterministic local edit operation(s) across ${targets.length} analyzed file(s).`,
    operations,
    verificationCommands: context.verificationCommands,
    targetFiles: targets,
    warnings: [],
  };
}

export async function executeLocalCodingPlan(
  root: string,
  plan: LocalCodingExecutionPlan,
  options: ExecutionOptions = {},
): Promise<LocalCodingExecutionResult> {
  if (plan.status !== "EXECUTABLE") {
    return {
      status: "AI_REQUIRED",
      reason: plan.reason,
      changedFiles: [],
      patch: "",
      verification: [],
      rolledBack: false,
      warnings: plan.warnings,
    };
  }
  if (options.trustedWorkspace !== true) {
    return {
      status: "BLOCKED",
      reason: "Local file writes are fail-closed until the workspace is explicitly trusted.",
      changedFiles: [],
      patch: "",
      verification: [],
      rolledBack: false,
      warnings: plan.warnings,
    };
  }
  if (plan.operations.length === 0 || plan.operations.length > MAX_OPERATIONS) {
    return {
      status: "BLOCKED",
      reason: "Local execution plan has an invalid operation count.",
      changedFiles: [],
      patch: "",
      verification: [],
      rolledBack: false,
      warnings: plan.warnings,
    };
  }

  const absoluteRoot = resolve(root);
  const rootInfo = await stat(absoluteRoot).catch(() => null);
  if (!rootInfo?.isDirectory()) {
    return {
      status: "BLOCKED",
      reason: "Repository workspace does not exist.",
      changedFiles: [],
      patch: "",
      verification: [],
      rolledBack: false,
      warnings: plan.warnings,
    };
  }

  try {
    const headSha = await git(absoluteRoot, ["rev-parse", "HEAD"]);
    if (options.expectedHeadSha && options.expectedHeadSha !== headSha) {
      return {
        status: "BLOCKED",
        reason: `Repository HEAD changed from ${options.expectedHeadSha} to ${headSha}; re-analysis is required.`,
        changedFiles: [],
        patch: "",
        verification: [],
        rolledBack: false,
        warnings: plan.warnings,
      };
    }

    if (options.requireCleanWorktree !== false) {
      const statusOutput = await git(
        absoluteRoot,
        ["status", "--porcelain=v1", "--untracked-files=normal"],
        false,
      );
      if (statusOutput.trim()) {
        return {
          status: "BLOCKED",
          reason: "Repository worktree is not clean; deterministic local execution refuses to overwrite existing changes.",
          changedFiles: [],
          patch: "",
          verification: [],
          rolledBack: false,
          warnings: plan.warnings,
        };
      }
    }

    const originals = new Map<string, string>();
    const nextContents = new Map<string, string>();
    let totalWriteBytes = 0;

    for (const operation of plan.operations) {
      const file = normalizeRepoPath(operation.path);
      let content = nextContents.get(file);
      if (content === undefined) {
        const loaded = await safeExistingFile(absoluteRoot, file);
        content = loaded.content;
        originals.set(file, loaded.content);
      }
      const next = applyOperation(content, operation);
      totalWriteBytes += Buffer.byteLength(next, "utf8");
      if (totalWriteBytes > MAX_TOTAL_WRITE_BYTES) {
        throw new Error(`Local coding writes exceed ${MAX_TOTAL_WRITE_BYTES} bytes`);
      }
      nextContents.set(file, next);
    }

    const actuallyChanged = [...nextContents.entries()]
      .filter(([file, content]) => originals.get(file) !== content)
      .map(([file]) => file);

    if (actuallyChanged.length === 0) {
      return {
        status: "NO_CHANGES",
        reason: "Deterministic operations produced no file changes.",
        changedFiles: [],
        patch: "",
        verification: [],
        rolledBack: false,
        warnings: plan.warnings,
      };
    }

    const rollback = async (): Promise<void> => {
      for (const [file, original] of originals.entries()) {
        await writeFile(resolve(absoluteRoot, file), original, "utf8");
      }
    };

    try {
      for (const file of actuallyChanged) {
        await writeFile(resolve(absoluteRoot, file), nextContents.get(file)!, "utf8");
      }

      const rawPatch = await git(
        absoluteRoot,
        ["diff", "--no-ext-diff", "--unified=2", "--", ...actuallyChanged],
        false,
      );
      const patch = redactPatch(
        Buffer.byteLength(rawPatch, "utf8") > MAX_PATCH_BYTES
          ? rawPatch.slice(0, MAX_PATCH_BYTES)
          : rawPatch,
      );

      const verification: VerificationCommandResult[] = [];
      if (options.runVerification !== false) {
        for (const command of plan.verificationCommands.slice(0, 6)) {
          const result = await runAllowlistedVerificationCommand(absoluteRoot, command, {
            trustedWorkspace: true,
            timeoutMs: options.verificationTimeoutMs,
            executor: options.verificationExecutor,
          });
          verification.push(result);
          if (result.status !== "PASSED") {
            await rollback();
            return {
              status: "VERIFICATION_FAILED",
              reason: `Verification command did not pass: ${command}`,
              changedFiles: actuallyChanged,
              patch,
              verification,
              rolledBack: true,
              warnings: plan.warnings,
            };
          }
        }
      }

      return {
        status: "APPLIED",
        reason:
          options.runVerification === false
            ? "Deterministic local patch was produced; verification was intentionally not executed."
            : "Deterministic local patch was produced and allowlisted verification passed.",
        changedFiles: actuallyChanged,
        patch,
        verification,
        rolledBack: false,
        warnings:
          options.runVerification === false
            ? [...plan.warnings, "Verification was skipped; repository scripts were not executed."]
            : plan.warnings,
      };
    } catch (error) {
      await rollback().catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return {
      status: "FAILED",
      reason: error instanceof Error ? error.message : String(error),
      changedFiles: [],
      patch: "",
      verification: [],
      rolledBack: false,
      warnings: plan.warnings,
    };
  }
}
