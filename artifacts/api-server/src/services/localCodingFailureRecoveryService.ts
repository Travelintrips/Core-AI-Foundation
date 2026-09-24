import { basename, dirname, isAbsolute, normalize } from "node:path";
import {
  isSensitiveRepositoryPath,
  type GitCommitContext,
  type ImportReference,
  type LocalCodingContextPackage,
  type LocalSymbol,
} from "./localCodingEngineService.js";
import type { LocalFailureContext } from "./localCodingFailureDiagnosticService.js";

const MAX_FOCUS_FILES = 24;
const MAX_SYMBOLS = 80;
const MAX_DEPENDENCIES = 120;
const MAX_TESTS = 32;
const MAX_COMMITS = 6;
const MAX_FAILURES = 6;
const MAX_GRAPH_DEPTH = 2;

export interface LocalFailureRecoveryContext {
  status: "CONTEXT_REFINED" | "NO_ACTIONABLE_CONTEXT";
  nextAction: "LOCAL_RECOVERY_REQUIRED";
  failureCommands: string[];
  failureKinds: string[];
  errorCodes: string[];
  focusFiles: string[];
  focusSymbols: LocalSymbol[];
  dependencies: ImportReference[];
  relatedTests: string[];
  recentCommits: GitCommitContext[];
  verificationCommands: string[];
  deterministicRetry: {
    attempted: boolean;
    exhausted: boolean;
    commands: string[];
  };
  warnings: string[];
}

function safePath(value: string): string | null {
  const normalized = normalize(value.trim()).replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    isSensitiveRepositoryPath(normalized)
  ) {
    return null;
  }
  return normalized;
}

function uniqueSafePaths(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = safePath(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= MAX_FOCUS_FILES) break;
  }
  return output;
}

function dependencyNeighbors(
  dependencies: ImportReference[],
  seedFiles: string[],
): string[] {
  const visited = new Set(seedFiles);
  let frontier = new Set(seedFiles);

  for (let depth = 0; depth < MAX_GRAPH_DEPTH; depth += 1) {
    const next = new Set<string>();
    for (const edge of dependencies) {
      const from = safePath(edge.file);
      const to = edge.resolvedFile ? safePath(edge.resolvedFile) : null;
      if (!from || !to) continue;
      if (frontier.has(from) && !visited.has(to)) next.add(to);
      if (frontier.has(to) && !visited.has(from)) next.add(from);
    }
    if (next.size === 0) break;
    for (const file of next) {
      visited.add(file);
      if (visited.size >= MAX_FOCUS_FILES) break;
    }
    frontier = next;
    if (visited.size >= MAX_FOCUS_FILES) break;
  }

  return [...visited].slice(0, MAX_FOCUS_FILES);
}

function relatedTestCandidates(
  context: LocalCodingContextPackage,
  focusFiles: string[],
): string[] {
  const focusSet = new Set(focusFiles);
  const stems = focusFiles.map((file) =>
    basename(file).replace(/\.[^.]+$/, "").toLowerCase()
  );
  const dirs = new Set(focusFiles.map((file) => dirname(file)).filter((dir) => dir !== "."));
  const candidates = new Set<string>();

  for (const test of context.relatedTests) {
    const safe = safePath(test);
    if (!safe) continue;
    const lower = safe.toLowerCase();
    if (
      stems.some((stem) => stem && lower.includes(stem)) ||
      [...dirs].some((dir) => safe.startsWith(`${dir}/`))
    ) {
      candidates.add(safe);
    }
  }

  for (const edge of context.dependencies) {
    const from = safePath(edge.file);
    const to = edge.resolvedFile ? safePath(edge.resolvedFile) : null;
    if (!from || !to) continue;
    if (
      focusSet.has(to) &&
      /(?:^|\/)(?:__tests__|tests?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(from)
    ) {
      candidates.add(from);
    }
  }

  return [...candidates].sort().slice(0, MAX_TESTS);
}

function symbolCandidates(
  context: LocalCodingContextPackage,
  focusFiles: string[],
  failures: LocalFailureContext[],
): LocalSymbol[] {
  const focusSet = new Set(focusFiles);
  const requestedNames = new Set(
    failures
      .flatMap((failure) => failure.diagnostics.map((item) => item.symbol))
      .filter((item): item is string => Boolean(item)),
  );

  return context.symbols
    .filter((symbol) => {
      const file = safePath(symbol.file);
      if (!file) return false;
      return focusSet.has(file) || requestedNames.has(symbol.name);
    })
    .sort(
      (a, b) =>
        Number(b.exported) - Number(a.exported) ||
        Number(requestedNames.has(b.name)) - Number(requestedNames.has(a.name)) ||
        a.file.localeCompare(b.file) ||
        a.line - b.line,
    )
    .slice(0, MAX_SYMBOLS);
}

function dependencySlice(
  context: LocalCodingContextPackage,
  focusFiles: string[],
): ImportReference[] {
  const focusSet = new Set(focusFiles);
  return context.dependencies
    .filter((edge) => {
      const from = safePath(edge.file);
      const to = edge.resolvedFile ? safePath(edge.resolvedFile) : null;
      return Boolean(from && (focusSet.has(from) || Boolean(to && focusSet.has(to))));
    })
    .slice(0, MAX_DEPENDENCIES);
}

export function buildLocalFailureRecoveryContext(
  context: LocalCodingContextPackage,
  failureContexts: LocalFailureContext[],
  deterministicRetries: Array<{
    command: string;
    trigger: "TIMEOUT";
    status: string;
  }> = [],
): LocalFailureRecoveryContext {
  const failures = failureContexts.slice(0, MAX_FAILURES);
  const failureFiles = uniqueSafePaths(
    failures.flatMap((failure) => [
      ...failure.primaryFiles,
      ...failure.diagnostics
        .map((item) => item.file)
        .filter((item): item is string => Boolean(item)),
    ]),
  );

  const graphFiles = dependencyNeighbors(context.dependencies, failureFiles);
  const focusFiles = uniqueSafePaths([
    ...failureFiles,
    ...graphFiles,
    ...context.relevantFiles
      .map((item) => item.path)
      .filter((path) => graphFiles.includes(path)),
  ]);

  const failureCommands = [
    ...new Set(failures.map((failure) => failure.command).filter(Boolean)),
  ].slice(0, 6);
  const failureKinds = [
    ...new Set(failures.map((failure) => failure.kind).filter(Boolean)),
  ].slice(0, 8);
  const errorCodes = [
    ...new Set(failures.flatMap((failure) => failure.errorCodes)),
  ].slice(0, 20);
  const retryCommands = [
    ...new Set(deterministicRetries.map((retry) => retry.command)),
  ].slice(0, 6);
  const exhausted = deterministicRetries.some(
    (retry) => retry.trigger === "TIMEOUT" && retry.status !== "PASSED",
  );

  const warnings: string[] = [];
  if (failures.length === 0) {
    warnings.push("No structured verification failure context was available.");
  }
  if (focusFiles.length === 0) {
    warnings.push(
      "No safe repository-relative focus file could be derived; automatic source mutation remains disabled.",
    );
  }
  if (failures.some((failure) => failure.kind === "unknown")) {
    warnings.push(
      "At least one failure could not be classified; keep the next step review-only until a concrete file or symbol is identified.",
    );
  }
  warnings.push(
    "Failure-directed refinement is context-only. It does not mutate source files, execute AI, or bypass commit/merge gates.",
  );

  return {
    status: focusFiles.length > 0 ? "CONTEXT_REFINED" : "NO_ACTIONABLE_CONTEXT",
    nextAction: "LOCAL_RECOVERY_REQUIRED",
    failureCommands,
    failureKinds,
    errorCodes,
    focusFiles,
    focusSymbols: symbolCandidates(context, focusFiles, failures),
    dependencies: dependencySlice(context, focusFiles),
    relatedTests: relatedTestCandidates(context, focusFiles),
    recentCommits: context.recentCommits.slice(0, MAX_COMMITS),
    verificationCommands: context.verificationCommands
      .filter((command) => failureCommands.includes(command))
      .slice(0, 6),
    deterministicRetry: {
      attempted: deterministicRetries.length > 0,
      exhausted,
      commands: retryCommands,
    },
    warnings,
  };
}
