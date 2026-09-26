import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  executeLocalCodingPlan,
  type JsonValue,
  type LocalCodingExecutionPlan,
  type LocalEditOperation,
} from "./localCodingExecutorService.js";
import { isSensitiveRepositoryPath } from "./localCodingEngineService.js";

const execFileAsync = promisify(execFile);
export const AI_PATCH_APPLIER_LIMITS = Object.freeze({
  maxOperations: 20,
  maxAllowedFiles: 80,
  maxChangedFiles: 12,
  maxEditableFileBytes: 512_000,
  maxOperationTextBytes: 64_000,
  maxProposalBytes: 256_000,
  maxPatchBytes: 160_000,
});

export type AiPatchApplierErrorCode =
  | "INVALID_CONTEXT" | "INVALID_PROPOSAL" | "UNSUPPORTED_OPERATION"
  | "UNSAFE_PATH" | "FILE_NOT_ALLOWED" | "SYMLINK_BLOCKED" | "FILE_TOO_LARGE"
  | "TOO_MANY_OPERATIONS" | "TOO_MANY_FILES" | "PROPOSAL_TOO_LARGE" | "PATCH_TOO_LARGE"
  | "STALE_HEAD" | "WORKTREE_NOT_CLEAN" | "EXACT_MATCH_FAILED"
  | "STATIC_VERIFICATION_FAILED" | "NO_CHANGES" | "APPLY_FAILED";

export interface ApprovedAiPatchHandoffContext {
  isolatedWorkspace: true;
  expectedHeadSha: string;
  allowedFiles: string[];
}
export interface AiPatchApplyResult {
  status: "APPLIED" | "BLOCKED" | "FAILED" | "NO_CHANGES";
  code: AiPatchApplierErrorCode | null;
  reason: string;
  changedFiles: string[];
  patch: string;
  patchSha256: string | null;
  resultSha256: string | null;
  scriptsExecuted: false;
  networkUsed: false;
  commitCreated: false;
  pushed: false;
  rolledBack: boolean;
  warnings: string[];
}
type ProposalOperation =
  | { kind: "create_file"; path: string; content: string }
  | { kind: "replace_text"; path: string; search: string; replacement: string; expectedOccurrences: number }
  | { kind: "delete_text"; path: string; search: string; expectedOccurrences: number }
  | { kind: "insert_after"; path: string; anchor: string; content: string; expectedOccurrences: 1 }
  | { kind: "json_set"; path: string; keyPath: string[]; value: JsonValue }
  | { kind: "typescript_replace_identifier_at_position"; path: string; line: number; column: number; from: string; to: string; diagnosticCode: "TS2551" | "TS2552" };
interface Snapshot { file: string; absolute: string; content: string }

class GuardError extends Error {
  constructor(message: string, readonly code: AiPatchApplierErrorCode) { super(message); }
}
function result(status: AiPatchApplyResult["status"], code: AiPatchApplierErrorCode | null, reason: string, rolledBack = false, warnings: string[] = []): AiPatchApplyResult {
  return { status, code, reason, changedFiles: [], patch: "", patchSha256: null, resultSha256: null,
    scriptsExecuted: false, networkUsed: false, commitCreated: false, pushed: false, rolledBack, warnings };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GuardError("Proposal entry must be an object.", "INVALID_PROPOSAL");
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, keys: string[]): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new GuardError(`Unsupported proposal field '${unknown}'.`, "INVALID_PROPOSAL");
}
function safePath(value: unknown): string {
  if (typeof value !== "string") throw new GuardError("Proposal path must be a string.", "UNSAFE_PATH");
  const file = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!file || file.includes("\0") || isAbsolute(file) || /^[A-Za-z]:\//.test(file) || file.startsWith("//") || file === ".." || file.startsWith("../") || file.includes("/../") || isSensitiveRepositoryPath(file)) {
    throw new GuardError(`Unsafe AI patch path: ${value}`, "UNSAFE_PATH");
  }
  return file;
}
function text(value: unknown, label: string, empty = false): string {
  if (typeof value !== "string" || (!empty && !value)) throw new GuardError(`${label} must be ${empty ? "a string" : "non-empty"}.`, "INVALID_PROPOSAL");
  if (Buffer.byteLength(value, "utf8") > AI_PATCH_APPLIER_LIMITS.maxOperationTextBytes) throw new GuardError(`${label} is too large.`, "INVALID_PROPOSAL");
  return value;
}
function positive(value: unknown, label: string, max = 100_000): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) throw new GuardError(`${label} must be a bounded positive integer.`, "INVALID_PROPOSAL");
  return value as number;
}
function jsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 16) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 200 && value.every((v) => jsonValue(v, depth + 1));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).length <= 200 && Object.entries(value).every(([k, v]) => !["__proto__", "prototype", "constructor"].includes(k) && jsonValue(v, depth + 1));
}
function parseOperation(raw: unknown): ProposalOperation {
  const op = record(raw);
  const path = safePath(op.path);
  switch (op.kind) {
    case "create_file":
      onlyKeys(op, ["kind", "path", "content"]);
      return { kind: op.kind, path, content: text(op.content, "content") };
    case "replace_text":
      onlyKeys(op, ["kind", "path", "search", "replacement", "expectedOccurrences"]);
      return { kind: op.kind, path, search: text(op.search, "search"), replacement: text(op.replacement, "replacement", true), expectedOccurrences: positive(op.expectedOccurrences, "expectedOccurrences", 100) };
    case "delete_text":
      onlyKeys(op, ["kind", "path", "search", "expectedOccurrences"]);
      return { kind: op.kind, path, search: text(op.search, "search"), expectedOccurrences: positive(op.expectedOccurrences, "expectedOccurrences", 100) };
    case "insert_after": {
      onlyKeys(op, ["kind", "path", "anchor", "content", "expectedOccurrences"]);
      const count = positive(op.expectedOccurrences, "expectedOccurrences", 1);
      return { kind: op.kind, path, anchor: text(op.anchor, "anchor"), content: text(op.content, "content", true), expectedOccurrences: count as 1 };
    }
    case "json_set":
      onlyKeys(op, ["kind", "path", "keyPath", "value"]);
      if (!Array.isArray(op.keyPath) || op.keyPath.length < 1 || op.keyPath.length > 12 || !op.keyPath.every((k) => typeof k === "string" && /^[A-Za-z0-9_.@/-]+$/.test(k) && !["__proto__", "prototype", "constructor"].includes(k))) throw new GuardError("JSON keyPath is invalid.", "INVALID_PROPOSAL");
      if (!jsonValue(op.value) || Buffer.byteLength(JSON.stringify(op.value), "utf8") > AI_PATCH_APPLIER_LIMITS.maxOperationTextBytes) throw new GuardError("JSON value is not bounded.", "INVALID_PROPOSAL");
      return { kind: op.kind, path, keyPath: op.keyPath as string[], value: op.value };
    case "typescript_replace_identifier_at_position": {
      onlyKeys(op, ["kind", "path", "line", "column", "from", "to", "diagnosticCode"]);
      const from = text(op.from, "from"), to = text(op.to, "to");
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(from) || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(to) || (op.diagnosticCode !== "TS2551" && op.diagnosticCode !== "TS2552")) throw new GuardError("TypeScript identifier edit requires valid identifiers and TS2551/TS2552 compiler evidence.", "INVALID_PROPOSAL");
      return { kind: op.kind, path, line: positive(op.line, "line", 2_000_000), column: positive(op.column, "column"), from, to, diagnosticCode: op.diagnosticCode };
    }
    default: throw new GuardError(`Unsupported AI patch operation: ${String(op.kind)}`, "UNSUPPORTED_OPERATION");
  }
}
function parseProposal(input: unknown): ProposalOperation[] {
  const proposal = record(input); onlyKeys(proposal, ["operations"]);
  if (!Array.isArray(proposal.operations) || proposal.operations.length < 1) throw new GuardError("Proposal must contain operations.", "INVALID_PROPOSAL");
  if (proposal.operations.length > AI_PATCH_APPLIER_LIMITS.maxOperations) throw new GuardError("Too many proposal operations.", "TOO_MANY_OPERATIONS");
  let serialized: string;
  try { serialized = JSON.stringify(input); } catch { throw new GuardError("Proposal is not JSON-serializable.", "INVALID_PROPOSAL"); }
  if (Buffer.byteLength(serialized, "utf8") > AI_PATCH_APPLIER_LIMITS.maxProposalBytes) throw new GuardError("Proposal is too large.", "PROPOSAL_TOO_LARGE");
  return proposal.operations.map(parseOperation);
}
function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate); return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}
async function safeNewFileTarget(root: string, file: string): Promise<string> {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, file);
  if (!inside(absoluteRoot, candidate)) throw new GuardError(`Create target escapes workspace: ${file}`, "UNSAFE_PATH");
  if (await lstat(candidate).catch(() => null)) throw new GuardError(`Create target already exists: ${file}`, "APPLY_FAILED");

  let current = absoluteRoot;
  for (const segment of file.split("/").slice(0, -1)) {
    current = resolve(current, segment);
    const info = await lstat(current).catch(() => null);
    if (!info) throw new GuardError(`Create target parent does not exist: ${file}`, "APPLY_FAILED");
    if (info.isSymbolicLink()) throw new GuardError(`Create target parent contains a symlink: ${file}`, "SYMLINK_BLOCKED");
    if (!info.isDirectory()) throw new GuardError(`Create target parent is not a directory: ${file}`, "APPLY_FAILED");
  }

  const [realRoot, realParent] = await Promise.all([
    realpath(absoluteRoot),
    realpath(dirname(candidate)),
  ]);
  if (!inside(realRoot, realParent)) throw new GuardError(`Create target parent resolves outside workspace: ${file}`, "SYMLINK_BLOCKED");
  return candidate;
}

function normalizeCreatedFileContent(content: string): string {
  return content.endsWith("\n") ? content : content + "\n";
}

function createFilePatch(file: string, content: string): string {
  const normalized = normalizeCreatedFileContent(content);
  const lines = normalized.slice(0, -1).split("\n");
  return [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => "+" + line),
    "",
  ].join("\n");
}

async function snapshot(root: string, file: string): Promise<Snapshot> {
  const absoluteRoot = resolve(root); let current = absoluteRoot;
  for (const segment of file.split("/")) {
    current = resolve(current, segment); const info = await lstat(current).catch(() => null);
    if (!info) throw new GuardError(`Patch target does not exist: ${file}`, "APPLY_FAILED");
    if (info.isSymbolicLink()) throw new GuardError(`Patch target contains a symlink: ${file}`, "SYMLINK_BLOCKED");
  }
  if (!inside(absoluteRoot, current)) throw new GuardError(`Patch target escapes workspace: ${file}`, "UNSAFE_PATH");
  const info = await stat(current);
  if (!info.isFile()) throw new GuardError(`Patch target is not a regular file: ${file}`, "APPLY_FAILED");
  if (info.size > AI_PATCH_APPLIER_LIMITS.maxEditableFileBytes) throw new GuardError(`Patch target exceeds file-size limit: ${file}`, "FILE_TOO_LARGE");
  const [realRoot, realFile] = await Promise.all([realpath(absoluteRoot), realpath(current)]);
  if (!inside(realRoot, realFile)) throw new GuardError(`Patch target resolves outside workspace: ${file}`, "SYMLINK_BLOCKED");
  return { file, absolute: realFile, content: await readFile(realFile, "utf8") };
}
async function restore(snapshots: Snapshot[]): Promise<void> { for (const item of snapshots) await writeFile(item.absolute, item.content, "utf8"); }
async function git(root: string, args: string[], trim = true): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root, timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LANG: "C", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" } });
  return trim ? stdout.trim() : stdout;
}
function executorOp(op: ProposalOperation): LocalEditOperation {
  if (op.kind === "create_file") {
    throw new GuardError("create_file must be handled before existing-file execution.", "INVALID_PROPOSAL");
  }
  if (op.kind !== "typescript_replace_identifier_at_position") return op;
  return { kind: op.kind, path: op.path, line: op.line, column: op.column, from: op.from, to: op.to };
}
function classify(reason: string): AiPatchApplierErrorCode {
  if (/HEAD changed/i.test(reason)) return "STALE_HEAD";
  if (/worktree is not clean/i.test(reason)) return "WORKTREE_NOT_CLEAN";
  if (/expected \d+ occurrence\(s\), found \d+/i.test(reason)) return "EXACT_MATCH_FAILED";
  if (/static verification failed/i.test(reason)) return "STATIC_VERIFICATION_FAILED";
  return "APPLY_FAILED";
}
function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }

export async function applyAiProposalPatch(root: string, proposalInput: unknown, approved: ApprovedAiPatchHandoffContext): Promise<AiPatchApplyResult> {
  let operations: ProposalOperation[]; let allowed: Set<string>; let expectedHeadSha: string;
  try {
    operations = parseProposal(proposalInput);
    if (!approved || approved.isolatedWorkspace !== true || !/^[0-9a-f]{40}$/i.test(approved.expectedHeadSha) || !Array.isArray(approved.allowedFiles) || approved.allowedFiles.length < 1 || approved.allowedFiles.length > AI_PATCH_APPLIER_LIMITS.maxAllowedFiles) throw new GuardError("Approved handoff context is invalid.", "INVALID_CONTEXT");
    allowed = new Set(approved.allowedFiles.map(safePath)); expectedHeadSha = approved.expectedHeadSha.toLowerCase();
  } catch (error) { return error instanceof GuardError ? result("BLOCKED", error.code, error.message) : result("FAILED", "APPLY_FAILED", String(error)); }
  const files = [...new Set(operations.map((op) => op.path))].sort();
  const createOperations = operations.filter((op): op is Extract<ProposalOperation, { kind: "create_file" }> => op.kind === "create_file");
  if (createOperations.length > 0 && createOperations.length !== operations.length) {
    return result("BLOCKED", "INVALID_PROPOSAL", "create_file operations cannot be mixed with edits to existing files.");
  }
  if (createOperations.length > 0 && new Set(createOperations.map((op) => op.path)).size !== createOperations.length) {
    return result("BLOCKED", "INVALID_PROPOSAL", "create_file targets must be unique.");
  }
  if (files.length > AI_PATCH_APPLIER_LIMITS.maxChangedFiles) return result("BLOCKED", "TOO_MANY_FILES", "Proposal targets too many files.");
  const disallowed = files.find((file) => !allowed.has(file));
  if (disallowed) return result("BLOCKED", "FILE_NOT_ALLOWED", `File is not allowed by approved handoff: ${disallowed}`);
  const absoluteRoot = resolve(root); if (!(await stat(absoluteRoot).catch(() => null))?.isDirectory()) return result("BLOCKED", "INVALID_CONTEXT", "Isolated workspace does not exist.");
  let snapshots: Snapshot[] = [];
  try {
    const head = (await git(absoluteRoot, ["rev-parse", "HEAD"])).toLowerCase();
    if (head !== expectedHeadSha) return result("BLOCKED", "STALE_HEAD", "Approved handoff HEAD is stale.");
    if ((await git(absoluteRoot, ["status", "--porcelain=v1", "--untracked-files=normal"], false)).trim()) return result("BLOCKED", "WORKTREE_NOT_CLEAN", "Isolated workspace must be clean.");

    if (createOperations.length > 0) {
      const created: string[] = [];
      try {
        for (const operation of createOperations) {
          const absolute = await safeNewFileTarget(absoluteRoot, operation.path);
          const normalizedContent = normalizeCreatedFileContent(operation.content);
          await writeFile(absolute, normalizedContent, { encoding: "utf8", flag: "wx" });
          created.push(absolute);
        }
        const rawPatch = createOperations.map((operation) => createFilePatch(operation.path, operation.content)).join("");
        if (Buffer.byteLength(rawPatch, "utf8") > AI_PATCH_APPLIER_LIMITS.maxPatchBytes) {
          await Promise.all(created.map((file) => unlink(file).catch(() => undefined)));
          return result("BLOCKED", "PATCH_TOO_LARGE", "Unified patch exceeded the bounded patch size and was rolled back.", true);
        }
        const digests = await Promise.all(
          [...createOperations]
            .sort((a, b) => a.path.localeCompare(b.path))
            .map(async (operation) => `${operation.path}\0${sha256(await readFile(resolve(absoluteRoot, operation.path)))}`),
        );
        return {
          status: "APPLIED",
          code: null,
          reason: "Structured AI proposal created bounded authorized file(s) deterministically.",
          changedFiles: files,
          patch: rawPatch,
          patchSha256: sha256(rawPatch),
          resultSha256: sha256(digests.join("\n")),
          scriptsExecuted: false,
          networkUsed: false,
          commitCreated: false,
          pushed: false,
          rolledBack: false,
          warnings: [],
        };
      } catch (error) {
        await Promise.all(created.map((file) => unlink(file).catch(() => undefined)));
        return error instanceof GuardError
          ? result("BLOCKED", error.code, error.message, created.length > 0)
          : result("FAILED", "APPLY_FAILED", error instanceof Error ? error.message : String(error), created.length > 0);
      }
    }

    snapshots = await Promise.all(files.map((file) => snapshot(absoluteRoot, file)));
    const plan: LocalCodingExecutionPlan = { status: "EXECUTABLE", reason: "Validated structured AI proposal.", operations: operations.map(executorOp), verificationCommands: [], targetFiles: files, warnings: [] };
    const applied = await executeLocalCodingPlan(absoluteRoot, plan, { trustedWorkspace: true, expectedHeadSha, runVerification: false, trustedVerificationScripts: false, requireCleanWorktree: true, maxVerificationAttempts: 1 });
    if (applied.status === "NO_CHANGES") return result("NO_CHANGES", "NO_CHANGES", applied.reason, false, applied.warnings);
    if (applied.status !== "APPLIED") { await restore(snapshots); const code = classify(applied.reason); return result(code === "EXACT_MATCH_FAILED" ? "BLOCKED" : "FAILED", code, applied.reason, true, applied.warnings); }
    if (applied.scriptsExecuted === true || applied.changedFiles.some((file) => !allowed.has(file))) { await restore(snapshots); return result("FAILED", "APPLY_FAILED", "Patch applier invariant failed.", true); }
    const rawPatch = await git(absoluteRoot, ["diff", "--no-ext-diff", "--unified=2", "--", ...applied.changedFiles], false);
    if (Buffer.byteLength(rawPatch, "utf8") > AI_PATCH_APPLIER_LIMITS.maxPatchBytes) { await restore(snapshots); return result("BLOCKED", "PATCH_TOO_LARGE", "Unified patch exceeded the bounded patch size and was rolled back.", true); }
    const digests = await Promise.all([...applied.changedFiles].sort().map(async (file) => `${file}\0${sha256(await readFile(resolve(absoluteRoot, file)))}`));
    return { status: "APPLIED", code: null, reason: "Structured AI proposal applied deterministically.", changedFiles: [...applied.changedFiles].sort(), patch: rawPatch,
      patchSha256: sha256(rawPatch), resultSha256: sha256(digests.join("\n")), scriptsExecuted: false, networkUsed: false, commitCreated: false, pushed: false, rolledBack: false, warnings: applied.warnings };
  } catch (error) {
    if (snapshots.length) await restore(snapshots).catch(() => undefined);
    return error instanceof GuardError ? result("BLOCKED", error.code, error.message, snapshots.length > 0) : result("FAILED", "APPLY_FAILED", error instanceof Error ? error.message : String(error), snapshots.length > 0);
  }
}
