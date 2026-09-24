import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import * as ts from "typescript";
import {
  isSensitiveRepositoryPath,
  type VerificationCommandResult,
} from "./localCodingEngineService.js";

const MAX_OUTPUT_CHARS = 240_000;
const MAX_DIAGNOSTICS = 48;
const MAX_PRIMARY_FILES = 20;
const MAX_MESSAGE_CHARS = 700;

export type LocalFailureKind =
  | "typescript"
  | "lint"
  | "test"
  | "build"
  | "timeout"
  | "dependency"
  | "unknown";

export interface LocalFailureDiagnostic {
  kind: LocalFailureKind;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  symbol?: string;
  message: string;
}

export interface LocalFailureContext {
  command: string;
  status: VerificationCommandResult["status"];
  exitCode: number | null;
  kind: LocalFailureKind;
  diagnostics: LocalFailureDiagnostic[];
  primaryFiles: string[];
  errorCodes: string[];
  retry: {
    allowed: boolean;
    reason: string;
    command?: string;
  };
  warnings: string[];
}

function normalizeRepoPath(value: string): string | null {
  const candidate = normalize(value.trim())
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^file:\/\//, "");
  if (
    !candidate ||
    isAbsolute(candidate) ||
    candidate === ".." ||
    candidate.startsWith("../") ||
    candidate.includes("/../") ||
    isSensitiveRepositoryPath(candidate)
  ) {
    return null;
  }
  return candidate;
}

function redactMessage(value: string): string {
  return value
    .replace(
      /((?:api[_-]?key|access[_-]?token|secret|password|private[_-]?key|authorization)\s*[:=]\s*)\S+/gi,
      "$1[REDACTED]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/gi, "[REDACTED_CREDENTIAL_URL]")
    .replace(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[REDACTED_TOKEN]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

function commandKind(command: string): LocalFailureKind {
  const lower = command.toLowerCase();
  if (lower.includes("typecheck")) return "typescript";
  if (lower.includes("lint")) return "lint";
  if (lower.includes("test")) return "test";
  if (lower.includes("build")) return "build";
  if (lower.includes("install")) return "dependency";
  return "unknown";
}

function diagnostic(
  kind: LocalFailureKind,
  message: string,
  extras: Partial<LocalFailureDiagnostic> = {},
): LocalFailureDiagnostic | null {
  const cleanMessage = redactMessage(message);
  if (!cleanMessage) return null;
  const file = extras.file ? normalizeRepoPath(extras.file) : undefined;
  if (extras.file && !file) return null;
  return {
    kind,
    ...(file ? { file } : {}),
    ...(typeof extras.line === "number" && extras.line > 0 ? { line: extras.line } : {}),
    ...(typeof extras.column === "number" && extras.column > 0 ? { column: extras.column } : {}),
    ...(extras.code ? { code: extras.code.slice(0, 80) } : {}),
    ...(extras.symbol ? { symbol: extras.symbol.slice(0, 160) } : {}),
    message: cleanMessage,
  };
}

function addUnique(
  list: LocalFailureDiagnostic[],
  item: LocalFailureDiagnostic | null,
): void {
  if (!item || list.length >= MAX_DIAGNOSTICS) return;
  const key = [
    item.kind,
    item.file ?? "",
    item.line ?? "",
    item.column ?? "",
    item.code ?? "",
    item.message,
  ].join("|");
  if (
    list.some((existing) =>
      [
        existing.kind,
        existing.file ?? "",
        existing.line ?? "",
        existing.column ?? "",
        existing.code ?? "",
        existing.message,
      ].join("|") === key
    )
  ) {
    return;
  }
  list.push(item);
}

function parseOutput(
  command: string,
  output: string,
): LocalFailureDiagnostic[] {
  const diagnostics: LocalFailureDiagnostic[] = [];
  const fallbackKind = commandKind(command);
  const bounded = output.slice(0, MAX_OUTPUT_CHARS);
  const lines = bounded.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let match = /^(.+?)\((\d+),(\d+)\):\s*(?:error|warning)\s+(TS\d+):\s*(.+)$/i.exec(line);
    if (match) {
      addUnique(diagnostics, diagnostic("typescript", match[5], {
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4].toUpperCase(),
      }));
      continue;
    }

    match = /^(.+?):(\d+):(\d+)\s+-\s+(?:error|warning)\s+(TS\d+):\s*(.+)$/i.exec(line);
    if (match) {
      addUnique(diagnostics, diagnostic("typescript", match[5], {
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4].toUpperCase(),
      }));
      continue;
    }

    match = /^(.+?):(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}([@A-Za-z0-9_./-]+))?$/i.exec(line);
    if (match && command.toLowerCase().includes("lint")) {
      addUnique(diagnostics, diagnostic("lint", match[5], {
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[6],
      }));
      continue;
    }

    match = /^(?:FAIL|FAILED)\s+(.+?)(?::(\d+)(?::(\d+))?)?\s*$/i.exec(line);
    if (match) {
      addUnique(diagnostics, diagnostic("test", "Test file reported a failure.", {
        file: match[1],
        line: match[2] ? Number(match[2]) : undefined,
        column: match[3] ? Number(match[3]) : undefined,
      }));
      continue;
    }

    match = /^(?:❯|>)\s+(.+?):(\d+):(\d+)(?:\s+.*)?$/u.exec(line);
    if (match) {
      addUnique(diagnostics, diagnostic("test", "Test failure location.", {
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
      }));
      continue;
    }

    match = /^(.+?):(\d+):(\d+):\s*(?:ERROR|Error):\s*(.+)$/i.exec(line);
    if (match) {
      addUnique(diagnostics, diagnostic(fallbackKind === "unknown" ? "build" : fallbackKind, match[4], {
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
      }));
      continue;
    }

    match = /(?:^|\s)([A-Za-z0-9_./@-]+\.[cm]?[jt]sx?):(\d+):(\d+)(?:\)|\s|$)/.exec(line);
    if (match) {
      addUnique(diagnostics, diagnostic(fallbackKind, line, {
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
      }));
      continue;
    }

    match = /\b(TS\d+)\b[:\s-]*(.+)$/i.exec(line);
    if (match && fallbackKind === "typescript") {
      addUnique(diagnostics, diagnostic("typescript", match[2], {
        code: match[1].toUpperCase(),
      }));
    }
  }

  return diagnostics;
}

function failureKind(
  result: VerificationCommandResult,
  diagnostics: LocalFailureDiagnostic[],
): LocalFailureKind {
  if (result.status === "TIMEOUT") return "timeout";
  const firstSpecific = diagnostics.find((item) => item.kind !== "unknown");
  return firstSpecific?.kind ?? commandKind(result.command);
}

export function buildLocalFailureContext(
  result: VerificationCommandResult,
): LocalFailureContext {
  const output = `${result.stderr}\n${result.stdout}`;
  const diagnostics = parseOutput(result.command, output);
  const kind = failureKind(result, diagnostics);
  const primaryFiles = [
    ...new Set(
      diagnostics
        .map((item) => item.file)
        .filter((item): item is string => Boolean(item)),
    ),
  ].slice(0, MAX_PRIMARY_FILES);
  const errorCodes = [
    ...new Set(
      diagnostics
        .map((item) => item.code)
        .filter((item): item is string => Boolean(item)),
    ),
  ].slice(0, 20);

  const timeoutRetry = result.status === "TIMEOUT";
  const warnings: string[] = [];
  if (diagnostics.length === 0 && result.status !== "TIMEOUT") {
    warnings.push(
      "Verification failed without a recognized structured diagnostic. Raw process output was not retained in the failure context.",
    );
  }
  if (primaryFiles.length === 0) {
    warnings.push(
      "No safe repository-relative file location could be extracted from the verification failure.",
    );
  }

  return {
    command: result.command,
    status: result.status,
    exitCode: result.exitCode,
    kind,
    diagnostics,
    primaryFiles,
    errorCodes,
    retry: timeoutRetry
      ? {
          allowed: true,
          reason:
            "A single bounded retry of the same allowlisted command is permitted only for timeout failures; no source mutation is implied.",
          command: result.command,
        }
      : {
          allowed: false,
          reason:
            "Deterministic blind retry is disabled for non-timeout failures; use the structured diagnostics to narrow the next local coding context.",
        },
    warnings,
  };
}

export function buildFailureContexts(
  results: VerificationCommandResult[],
): LocalFailureContext[] {
  return results
    .filter((result) => result.status !== "PASSED")
    .slice(0, 6)
    .map(buildLocalFailureContext);
}


function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

function scriptKind(file: string): ts.ScriptKind {
  const lower = file.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function identifierName(name: ts.DeclarationName | ts.BindingName | undefined): string | null {
  return name && ts.isIdentifier(name) ? name.text : null;
}

function declarationName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node)) return identifierName(node.name);
  if (ts.isClassDeclaration(node)) return identifierName(node.name);
  if (ts.isInterfaceDeclaration(node)) return identifierName(node.name);
  if (ts.isTypeAliasDeclaration(node)) return identifierName(node.name);
  if (ts.isMethodDeclaration(node)) return identifierName(node.name);
  if (ts.isFunctionExpression(node)) return identifierName(node.name);
  if (ts.isVariableDeclaration(node)) return identifierName(node.name);
  return null;
}

function nearestSymbolAtLine(
  file: string,
  content: string,
  lineNumber: number,
): string | null {
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const targetLine = Math.max(0, lineNumber - 1);
  let best: { name: string; span: number } | null = null;

  const visit = (node: ts.Node): void => {
    const name = declarationName(node);
    if (name) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      const end = source.getLineAndCharacterOfPosition(node.getEnd()).line;
      if (targetLine >= start && targetLine <= end) {
        const span = Math.max(0, end - start);
        if (!best || span < best.span) best = { name, span };
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return best?.name ?? null;
}

export async function enrichFailureContextsWithSymbols(
  root: string,
  contexts: LocalFailureContext[],
): Promise<LocalFailureContext[]> {
  const absoluteRoot = resolve(root);
  const resolvedRoot = await realpath(absoluteRoot).catch(() => null);
  if (!resolvedRoot) return contexts;

  const cache = new Map<string, string | null>();
  const enriched: LocalFailureContext[] = [];

  for (const context of contexts) {
    const diagnostics: LocalFailureDiagnostic[] = [];
    for (const item of context.diagnostics) {
      if (
        !item.file ||
        !item.line ||
        !/\.[cm]?[jt]sx?$/i.test(item.file)
      ) {
        diagnostics.push(item);
        continue;
      }

      const normalized = normalizeRepoPath(item.file);
      if (!normalized) {
        diagnostics.push(item);
        continue;
      }
      const candidate = resolve(absoluteRoot, normalized);
      if (!isInsideRoot(absoluteRoot, candidate)) {
        diagnostics.push(item);
        continue;
      }

      let content = cache.get(normalized);
      if (content === undefined) {
        const info = await lstat(candidate).catch(() => null);
        if (!info?.isFile() || info.isSymbolicLink() || info.size > 512_000) {
          cache.set(normalized, null);
          diagnostics.push(item);
          continue;
        }
        const resolvedFile = await realpath(candidate).catch(() => null);
        if (!resolvedFile || !isInsideRoot(resolvedRoot, resolvedFile)) {
          cache.set(normalized, null);
          diagnostics.push(item);
          continue;
        }
        content = await readFile(resolvedFile, "utf8").catch(() => null);
        cache.set(normalized, content);
      }

      if (!content) {
        diagnostics.push(item);
        continue;
      }
      const symbol = nearestSymbolAtLine(normalized, content, item.line);
      diagnostics.push(symbol ? { ...item, symbol } : item);
    }

    enriched.push({ ...context, diagnostics });
  }

  return enriched;
}
