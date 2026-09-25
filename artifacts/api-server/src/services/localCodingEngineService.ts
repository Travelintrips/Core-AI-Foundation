import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import * as ts from "typescript";

const execFileAsync = promisify(execFile);

const MAX_INDEX_FILES = 8_000;
const MAX_AST_FILE_BYTES = 250_000;
const MAX_INDEX_BYTES = 24_000_000;
const MAX_RELEVANT_FILES = 24;
const MAX_SYMBOLS_IN_CONTEXT = 120;
const MAX_DEPENDENCY_EDGES = 160;
const MAX_RELATED_TESTS = 40;
const MAX_RECENT_COMMITS = 8;
const MAX_DIFF_BYTES = 120_000;
const MAX_RG_BUFFER = 2 * 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_COMMAND_TIMEOUT_MS = 180_000;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".turbo",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "generated",
  "__generated__",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const SEARCHABLE_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  ".css",
  ".go",
  ".html",
  ".java",
  ".json",
  ".md",
  ".py",
  ".rs",
  ".sql",
  ".vue",
  ".yaml",
  ".yml",
]);

const SAFE_MANIFEST_NAMES = new Set([
  "cargo.toml",
  "go.mod",
  "package.json",
  "pyproject.toml",
  "readme",
  "readme.md",
  "requirements.txt",
  "tsconfig.json",
]);

const SENSITIVE_BASENAME_PATTERNS = [
  /^\.env(?:\..+)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^credentials?(?:\..+)?$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /^service[-_.]?account(?:\..+)?$/i,
  /^secrets?(?:\..+)?$/i,
  /^tokens?(?:\..+)?$/i,
  /^vault(?:\..+)?$/i,
];

const SENSITIVE_EXTENSIONS = new Set([
  ".cer",
  ".crt",
  ".der",
  ".jks",
  ".key",
  ".keystore",
  ".p12",
  ".pfx",
  ".pem",
]);

const STOP_WORDS = new Set([
  "a",
  "agar",
  "akan",
  "and",
  "atau",
  "buat",
  "dalam",
  "dan",
  "dari",
  "di",
  "for",
  "ini",
  "itu",
  "ke",
  "make",
  "memperbaiki",
  "muncul",
  "of",
  "on",
  "pada",
  "perbaiki",
  "please",
  "the",
  "tidak",
  "to",
  "untuk",
  "yang",
]);

const KEYWORD_SYNONYMS: Record<string, string[]> = {
  booking: ["reservation", "schedule"],
  candidate: ["kandidat", "matching", "match"],
  kandidat: ["candidate", "matching", "match"],
  payment: ["pembayaran", "paid", "settlement"],
  pembayaran: ["payment", "paid", "settlement"],
  qris: ["qr", "qr-code", "payment", "settlement"],
  reconciliation: ["reconcile", "reconciliation", "rekonsiliasi", "recon"],
  rekonsiliasi: ["reconcile", "reconciliation", "recon"],
};

const ALLOWED_VERIFICATION_SCRIPTS = new Set(["test", "typecheck", "lint", "build"]);

export type LocalSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable";

export interface LocalSymbol {
  name: string;
  kind: LocalSymbolKind;
  file: string;
  line: number;
  exported: boolean;
}

export interface ImportReference {
  file: string;
  specifier: string;
  resolvedFile?: string;
  kind: "import" | "export";
}

export interface RelevantFile {
  path: string;
  score: number;
  reasons: string[];
}

export interface GitCommitContext {
  sha: string;
  date: string;
  subject: string;
}

export interface VerificationCommandResult {
  command: string;
  status: "PASSED" | "FAILED" | "TIMEOUT" | "BLOCKED";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface GitBlameContext {
  file: string;
  startLine: number;
  endLine: number;
  output: string;
}

export interface LocalCodingContextPackage {
  repository: string;
  branch: string;
  headSha: string;
  task: string;
  keywords: string[];
  relevantFiles: RelevantFile[];
  affectedFiles: string[];
  symbols: LocalSymbol[];
  dependencies: ImportReference[];
  relatedTests: string[];
  recentCommits: GitCommitContext[];
  gitDiff: string;
  changedFiles: string[];
  verificationCommands: string[];
  testFrameworks: string[];
  warnings: string[];
  index: {
    filesIndexed: number;
    sourceFilesParsed: number;
    bytesParsed: number;
    sensitiveFilesExcluded: number;
    cacheHit: boolean;
    searchBackend: "ripgrep" | "local-fallback";
  };
}

interface PackageManifestInfo {
  path: string;
  name?: string;
  scripts: Record<string, string>;
  dependencies: Set<string>;
}

interface RepositoryIndex {
  files: string[];
  symbols: LocalSymbol[];
  imports: ImportReference[];
  tests: string[];
  manifests: PackageManifestInfo[];
  sourceFilesParsed: number;
  bytesParsed: number;
  sensitiveFilesExcluded: number;
  warnings: string[];
}

interface GitMetadata {
  branch: string;
  headSha: string;
  changedFiles: string[];
  diff: string;
  cacheFingerprint: string;
  commits: GitCommitContext[];
}

interface BuildLocalContextInput {
  root: string;
  repository: string;
  requestedBranch: string;
  task: string;
}

interface SearchResult {
  relevantFiles: RelevantFile[];
  backend: "ripgrep" | "local-fallback";
}

interface CommandExecutorOptions {
  cwd: string;
  timeout: number;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
}

export type VerificationExecutor = (
  file: string,
  args: string[],
  options: CommandExecutorOptions,
) => Promise<{ stdout?: string; stderr?: string }>;

const indexCache = new Map<string, RepositoryIndex>();

function normalizeRepoPath(value: string): string {
  return value.split(sep).join("/").replace(/^\.\//, "");
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

export function isSensitiveRepositoryPath(file: string): boolean {
  const normalized = normalizeRepoPath(file);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment.toLowerCase() === ".git")) return true;
  const name = basename(normalized);
  const lower = name.toLowerCase();
  if (SENSITIVE_BASENAME_PATTERNS.some((pattern) => pattern.test(name))) return true;
  if (SENSITIVE_EXTENSIONS.has(extname(lower))) return true;
  if (/(?:^|[-_.])(secret|credential|private[-_.]?key|access[-_.]?token)(?:[-_.]|$)/i.test(lower)) {
    return true;
  }
  return false;
}

function redactSensitiveDiff(value: string): string {
  return value
    .split("\n")
    .map((line) => {
      const body = line.replace(/^[ +\-]/, "");
      const looksSensitive =
        /(?:api[_-]?key|access[_-]?token|secret|password|private[_-]?key|authorization)\s*[:=]/i.test(body);
      if (!looksSensitive) return line;
      const prefix = /^[ +\-]/.test(line) ? line[0] : "";
      return `${prefix}[REDACTED_SENSITIVE_DIFF_LINE]`;
    })
    .join("\n");
}
function shouldIndexFile(file: string): boolean {
  if (isSensitiveRepositoryPath(file)) return false;
  if (/(^|\/)(__generated__|generated)(\/|$)/i.test(file) || /\.generated\./i.test(file)) return false;
  const lowerName = basename(file).toLowerCase();
  return SEARCHABLE_EXTENSIONS.has(extname(lowerName)) || SAFE_MANIFEST_NAMES.has(lowerName);
}

async function listRepositoryFiles(root: string): Promise<{
  files: string[];
  sensitiveFilesExcluded: number;
  truncated: boolean;
}> {
  const files: string[] = [];
  let sensitiveFilesExcluded = 0;
  let truncated = false;

  const visit = async (directory: string): Promise<void> => {
    if (files.length >= MAX_INDEX_FILES) {
      truncated = true;
      return;
    }
    const entries: Dirent[] = await readdir(directory, { withFileTypes: true }).catch(() => [] as Dirent[]);
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= MAX_INDEX_FILES) {
        truncated = true;
        break;
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        await visit(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const absolute = join(directory, entry.name);
      if (!isInsideRoot(root, absolute)) continue;
      const file = normalizeRepoPath(relative(root, absolute));
      if (isSensitiveRepositoryPath(file)) {
        sensitiveFilesExcluded += 1;
        continue;
      }
      if (shouldIndexFile(file)) files.push(file);
    }
  };

  await visit(root);
  return { files, sensitiveFilesExcluded, truncated };
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function declarationName(node: ts.Statement): string | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name?.text ?? null;
  }
  return null;
}

function symbolLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function extractTypeScriptSymbols(
  file: string,
  content: string,
): { symbols: LocalSymbol[]; imports: ImportReference[] } {
  const scriptKind = file.endsWith(".tsx") || file.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const symbols: LocalSymbol[] = [];
  const imports: ImportReference[] = [];
  const namedExports = new Set<string>();

  for (const node of sourceFile.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({ file, specifier: node.moduleSpecifier.text, kind: "import" });
      continue;
    }
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push({ file, specifier: node.moduleSpecifier.text, kind: "export" });
      }
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) namedExports.add(element.propertyName?.text ?? element.name.text);
      }
      continue;
    }

    let kind: LocalSymbolKind | null = null;
    if (ts.isFunctionDeclaration(node)) kind = "function";
    else if (ts.isClassDeclaration(node)) kind = "class";
    else if (ts.isInterfaceDeclaration(node)) kind = "interface";
    else if (ts.isTypeAliasDeclaration(node)) kind = "type";
    else if (ts.isEnumDeclaration(node)) kind = "enum";

    if (kind) {
      const name = declarationName(node);
      if (name) {
        symbols.push({
          name,
          kind,
          file,
          line: symbolLine(sourceFile, node),
          exported: hasExportModifier(node),
        });
      }
      continue;
    }

    if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(node);
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        symbols.push({
          name: declaration.name.text,
          kind: "variable",
          file,
          line: symbolLine(sourceFile, declaration),
          exported,
        });
      }
    }
  }

  for (const symbol of symbols) {
    if (namedExports.has(symbol.name)) symbol.exported = true;
  }

  return { symbols, imports };
}

function resolveRelativeImport(
  fromFile: string,
  specifier: string,
  fileSet: Set<string>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = normalizeRepoPath(resolve("/repo", dirname(fromFile), specifier).replace(/^\/repo\/?/, ""));
  const bases = [base];
  if (/\.(?:c|m)?js$/i.test(base)) {
    bases.push(base.replace(/\.(?:c|m)?js$/i, ""));
  }
  const candidates = bases.flatMap((candidateBase) => [
    candidateBase,
    ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].map((ext) => `${candidateBase}${ext}`),
    ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].map((ext) => `${candidateBase}/index${ext}`),
  ]);
  return candidates.find((candidate) => fileSet.has(candidate));
}

function isTestFile(file: string): boolean {
  const lower = file.toLowerCase();
  return /(^|\/)(__tests__|tests?)\//.test(lower) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(lower);
}

async function readJsonManifest(root: string, file: string): Promise<PackageManifestInfo | null> {
  try {
    const raw = await readFile(join(root, file), "utf8");
    const parsed = JSON.parse(raw) as {
      name?: unknown;
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const scripts: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.scripts ?? {})) {
      if (typeof value === "string") scripts[key] = value;
    }
    return {
      path: file,
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      scripts,
      dependencies: new Set([
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
      ]),
    };
  } catch {
    return null;
  }
}

async function buildRepositoryIndex(root: string): Promise<RepositoryIndex> {
  const listed = await listRepositoryFiles(root);
  const fileSet = new Set(listed.files);
  const symbols: LocalSymbol[] = [];
  const imports: ImportReference[] = [];
  const manifests: PackageManifestInfo[] = [];
  const warnings: string[] = [];
  let sourceFilesParsed = 0;
  let bytesParsed = 0;

  if (listed.truncated) {
    warnings.push(`Repository index stopped at ${MAX_INDEX_FILES} files to keep local analysis bounded.`);
  }

  for (const file of listed.files) {
    if (basename(file).toLowerCase() === "package.json") {
      const manifest = await readJsonManifest(root, file);
      if (manifest) manifests.push(manifest);
    }
    if (!SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    if (bytesParsed >= MAX_INDEX_BYTES) break;
    const absolute = join(root, file);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile() || info.size > MAX_AST_FILE_BYTES) continue;
    const content = await readFile(absolute, "utf8").catch(() => "");
    bytesParsed += Buffer.byteLength(content, "utf8");
    sourceFilesParsed += 1;
    const parsed = extractTypeScriptSymbols(file, content);
    symbols.push(...parsed.symbols);
    imports.push(...parsed.imports);
  }

  if (bytesParsed >= MAX_INDEX_BYTES) {
    warnings.push(`AST indexing stopped after ${MAX_INDEX_BYTES} bytes to keep analysis bounded.`);
  }

  for (const reference of imports) {
    reference.resolvedFile = resolveRelativeImport(reference.file, reference.specifier, fileSet);
  }

  return {
    files: listed.files,
    symbols,
    imports,
    tests: listed.files.filter(isTestFile),
    manifests,
    sourceFilesParsed,
    bytesParsed,
    sensitiveFilesExcluded: listed.sensitiveFilesExcluded,
    warnings,
  };
}

function cacheKey(repository: string, metadata: GitMetadata): string {
  return `${repository}|${metadata.headSha}|${metadata.cacheFingerprint}`;
}

function rememberIndex(key: string, index: RepositoryIndex): void {
  indexCache.set(key, index);
  if (indexCache.size <= 12) return;
  const oldest = indexCache.keys().next().value as string | undefined;
  if (oldest) indexCache.delete(oldest);
}

export function clearLocalCodingIndexCache(): void {
  indexCache.clear();
}

async function git(
  root: string,
  args: string[],
  timeout = 10_000,
  trimOutput = true,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    timeout,
    maxBuffer: 512 * 1024,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LANG: "C",
      LC_ALL: "C",
    },
  });
  const text = typeof stdout === "string"
    ? stdout
    : stdout?.toString("utf8") ?? "";
  return trimOutput ? text.trim() : text;
}

function parseChangedFiles(statusOutput: string): string[] {
  return statusOutput
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.length >= 4 ? line.slice(3).split(" -> ").at(-1) ?? "" : "")
    .map(normalizeRepoPath)
    .filter((file) => file && !isSensitiveRepositoryPath(file));
}

function scoreText(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((score, keyword) => score + (lower.includes(keyword.toLowerCase()) ? 1 : 0), 0);
}

async function readGitMetadata(root: string, requestedBranch: string, keywords: string[]): Promise<GitMetadata> {
  const warningsFallback = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  const branch = await warningsFallback(
    () => git(root, ["branch", "--show-current"]),
    requestedBranch,
  );
  const headSha = await warningsFallback(
    () => git(root, ["rev-parse", "HEAD"]),
    "unknown",
  );
  const statusOutput = await warningsFallback(
    () => git(root, ["status", "--porcelain=v1", "--untracked-files=normal"], 10_000, false),
    "",
  );
  const changedFiles = parseChangedFiles(statusOutput);
  const diff = changedFiles.length > 0
    ? await warningsFallback(
        () => git(root, ["diff", "--no-ext-diff", "--unified=2", "--", ...changedFiles.slice(0, 80)], 10_000, false),
        "",
      )
    : "";
  const logOutput = await warningsFallback(
    () => git(root, ["log", "-30", "--date=short", "--pretty=format:%H%x09%ad%x09%s"]),
    "",
  );
  const commits = logOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha = "", date = "", ...subjectParts] = line.split("\t");
      return { sha, date, subject: subjectParts.join("\t") };
    })
    .filter((commit) => commit.sha)
    .sort((a, b) => scoreText(b.subject, keywords) - scoreText(a.subject, keywords))
    .slice(0, MAX_RECENT_COMMITS);

  const cacheFingerprint = createHash("sha256")
    .update(statusOutput)
    .update("\n")
    .update(diff)
    .digest("hex")
    .slice(0, 16);

  return {
    branch: branch || requestedBranch,
    headSha,
    changedFiles,
    diff: redactSensitiveDiff(Buffer.byteLength(diff, "utf8") > MAX_DIFF_BYTES ? diff.slice(0, MAX_DIFF_BYTES) : diff),
    cacheFingerprint,
    commits,
  };
}

export function extractTaskKeywords(task: string): string[] {
  const base = task
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_\-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  const expanded = new Set<string>();
  for (const token of base) {
    expanded.add(token);
    for (const synonym of KEYWORD_SYNONYMS[token] ?? []) expanded.add(synonym);
  }
  return [...expanded].slice(0, 18);
}

function rgExcludeArgs(): string[] {
  const args: string[] = [];
  for (const directory of IGNORED_DIRECTORIES) {
    args.push("--glob", `!${directory}/**`);
  }
  args.push(
    "--glob", "!.env",
    "--glob", "!.env.*",
    "--glob", "!*.pem",
    "--glob", "!*.key",
    "--glob", "!credentials*",
    "--glob", "!credential*",
    "--glob", "!secrets*",
    "--glob", "!secret*",
    "--glob", "!tokens*",
    "--glob", "!token*",
    "--glob", "!service-account*",
    "--glob", "!service_account*",
    "--glob", "!id_rsa*",
    "--glob", "!id_dsa*",
    "--glob", "!id_ecdsa*",
    "--glob", "!id_ed25519*",
  );
  return args;
}

async function findMatchesWithRipgrep(root: string, keywords: string[]): Promise<Set<string>> {
  if (keywords.length === 0) return new Set();
  const args = ["--files-with-matches", "--ignore-case", "--hidden", "--no-messages", ...rgExcludeArgs()];
  for (const keyword of keywords) args.push("-e", keyword);
  args.push(".");
  const { stdout } = await execFileAsync("rg", args, {
    cwd: root,
    timeout: 20_000,
    maxBuffer: MAX_RG_BUFFER,
    env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" },
  });
  const text = typeof stdout === "string"
    ? stdout
    : stdout?.toString("utf8") ?? "";
  return new Set(
    text
      .split("\n")
      .map((file) => normalizeRepoPath(file.trim()))
      .filter((file) => file && !isSensitiveRepositoryPath(file)),
  );
}

function occurrences(content: string, keyword: string): number {
  const lower = content.toLowerCase();
  const needle = keyword.toLowerCase();
  let count = 0;
  let position = 0;
  while (count < 8) {
    const found = lower.indexOf(needle, position);
    if (found < 0) break;
    count += 1;
    position = found + needle.length;
  }
  return count;
}

async function scoreCandidateFiles(
  root: string,
  index: RepositoryIndex,
  keywords: string[],
  candidates: Set<string>,
): Promise<RelevantFile[]> {
  const symbolFiles = new Map<string, string[]>();
  for (const symbol of index.symbols) {
    if (keywords.some((keyword) => symbol.name.toLowerCase().includes(keyword.toLowerCase()))) {
      const list = symbolFiles.get(symbol.file) ?? [];
      list.push(symbol.name);
      symbolFiles.set(symbol.file, list);
      candidates.add(symbol.file);
    }
  }
  for (const file of index.files) {
    if (keywords.some((keyword) => file.toLowerCase().includes(keyword.toLowerCase()))) candidates.add(file);
  }

  const scored: RelevantFile[] = [];
  for (const file of [...candidates].slice(0, 500)) {
    if (!index.files.includes(file) || isSensitiveRepositoryPath(file)) continue;
    const reasons: string[] = [];
    let score = 0;
    const lowerPath = file.toLowerCase();
    for (const keyword of keywords) {
      if (lowerPath.includes(keyword.toLowerCase())) {
        score += 12;
        reasons.push(`path:${keyword}`);
      }
    }
    const matchingSymbols = symbolFiles.get(file) ?? [];
    if (matchingSymbols.length > 0) {
      score += Math.min(24, matchingSymbols.length * 6);
      reasons.push(`symbols:${matchingSymbols.slice(0, 3).join(",")}`);
    }

    const absolute = join(root, file);
    const info = await stat(absolute).catch(() => null);
    if (info?.isFile() && info.size <= MAX_AST_FILE_BYTES) {
      const content = await readFile(absolute, "utf8").catch(() => "");
      let contentHits = 0;
      for (const keyword of keywords) contentHits += occurrences(content, keyword);
      if (contentHits > 0) {
        score += Math.min(40, contentHits * 2);
        reasons.push(`content:${contentHits}`);
      }
    }

    if (isTestFile(file)) score -= 2;
    if (score > 0) scored.push({ path: file, score, reasons: [...new Set(reasons)] });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, MAX_RELEVANT_FILES);
}

async function searchRepository(
  root: string,
  index: RepositoryIndex,
  keywords: string[],
): Promise<SearchResult> {
  try {
    const candidates = await findMatchesWithRipgrep(root, keywords);
    return {
      relevantFiles: await scoreCandidateFiles(root, index, keywords, candidates),
      backend: "ripgrep",
    };
  } catch {
    const candidates = new Set<string>();
    for (const file of index.files) {
      if (keywords.some((keyword) => file.toLowerCase().includes(keyword))) candidates.add(file);
    }
    if (candidates.size < 120) {
      for (const file of index.files) {
        if (candidates.size >= 240) break;
        if (isSensitiveRepositoryPath(file)) continue;
        const absolute = join(root, file);
        const info = await stat(absolute).catch(() => null);
        if (!info?.isFile() || info.size > MAX_AST_FILE_BYTES) continue;
        const content = await readFile(absolute, "utf8").catch(() => "");
        if (keywords.some((keyword) => content.toLowerCase().includes(keyword))) candidates.add(file);
      }
    }
    return {
      relevantFiles: await scoreCandidateFiles(root, index, keywords, candidates),
      backend: "local-fallback",
    };
  }
}

function graphMaps(imports: ImportReference[]): {
  downstream: Map<string, Set<string>>;
  upstream: Map<string, Set<string>>;
} {
  const downstream = new Map<string, Set<string>>();
  const upstream = new Map<string, Set<string>>();
  for (const reference of imports) {
    if (!reference.resolvedFile) continue;
    const down = downstream.get(reference.file) ?? new Set<string>();
    down.add(reference.resolvedFile);
    downstream.set(reference.file, down);
    const up = upstream.get(reference.resolvedFile) ?? new Set<string>();
    up.add(reference.file);
    upstream.set(reference.resolvedFile, up);
  }
  return { downstream, upstream };
}

function boundedAffectedFiles(imports: ImportReference[], seeds: string[]): string[] {
  const { downstream, upstream } = graphMaps(imports);
  const visited = new Set(seeds);
  let frontier = [...seeds];
  for (let depth = 0; depth < 2 && frontier.length > 0 && visited.size < 60; depth += 1) {
    const next: string[] = [];
    for (const file of frontier) {
      for (const neighbor of [...(downstream.get(file) ?? []), ...(upstream.get(file) ?? [])]) {
        if (visited.size >= 60) break;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return [...visited];
}

function discoverRelatedTests(index: RepositoryIndex, targets: Set<string>): string[] {
  const related = new Set<string>();
  const targetStems = [...targets].map((file) => basename(file).replace(/\.[^.]+$/, "").toLowerCase());
  for (const test of index.tests) {
    const lower = test.toLowerCase();
    if (targetStems.some((stem) => stem && lower.includes(stem))) related.add(test);
  }
  for (const reference of index.imports) {
    if (reference.resolvedFile && targets.has(reference.resolvedFile) && isTestFile(reference.file)) {
      related.add(reference.file);
    }
  }
  return [...related].sort().slice(0, MAX_RELATED_TESTS);
}

function discoverTestFrameworks(index: RepositoryIndex): string[] {
  const frameworks = new Set<string>();
  for (const manifest of index.manifests) {
    for (const dependency of manifest.dependencies) {
      if (dependency === "vitest") frameworks.add("vitest");
      if (dependency === "jest" || dependency.startsWith("@jest/")) frameworks.add("jest");
      if (dependency === "mocha") frameworks.add("mocha");
      if (dependency === "ava") frameworks.add("ava");
    }
  }
  if (index.tests.some((file) => file.endsWith(".test.ts") || file.endsWith(".test.js"))) {
    if (frameworks.size === 0) frameworks.add("node-or-project-test-runner");
  }
  return [...frameworks];
}

function safeFilterName(value: string): boolean {
  return /^[@A-Za-z0-9._/*-]+$/.test(value) && !value.includes("..");
}

export function parseAllowlistedVerificationCommand(command: string): { file: "pnpm"; args: string[] } | null {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts[0] !== "pnpm") return null;
  let script: string | undefined;
  if (parts.length === 2) {
    script = parts[1];
  } else if (parts.length === 3 && parts[1] === "run") {
    script = parts[2];
  } else if (parts.length === 4 && parts[1] === "--filter" && safeFilterName(parts[2])) {
    script = parts[3];
  } else if (parts.length === 5 && parts[1] === "--filter" && safeFilterName(parts[2]) && parts[3] === "run") {
    script = parts[4];
  } else {
    return null;
  }
  if (!script || !ALLOWED_VERIFICATION_SCRIPTS.has(script)) return null;
  return { file: "pnpm", args: parts.slice(1) };
}

function discoverVerificationCommands(index: RepositoryIndex, relevantFiles: string[]): string[] {
  const commands = new Set<string>();
  const manifests = [...index.manifests]
    .filter((manifest) => typeof manifest?.path === "string" && manifest.path.trim().length > 0)
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  for (const manifest of manifests) {
    const packageDir = dirname(manifest.path) === "." ? "" : dirname(manifest.path);
    const isRelevantPackage = !packageDir || relevantFiles.some((file) => file === packageDir || file.startsWith(`${packageDir}/`));
    if (!isRelevantPackage) continue;
    for (const script of ALLOWED_VERIFICATION_SCRIPTS) {
      if (!(script in manifest.scripts)) continue;
      if (!packageDir) commands.add(`pnpm ${script}`);
      else if (manifest.name && safeFilterName(manifest.name)) commands.add(`pnpm --filter ${manifest.name} ${script}`);
    }
  }
  return [...commands].filter((command) => parseAllowlistedVerificationCommand(command) !== null).slice(0, 12);
}

export async function runAllowlistedVerificationCommand(
  root: string,
  command: string,
  options: {
    timeoutMs?: number;
    executor?: VerificationExecutor;
    trustedWorkspace?: boolean;
  } = {},
): Promise<VerificationCommandResult> {
  const parsed = parseAllowlistedVerificationCommand(command);
  if (!parsed) {
    return { command, status: "BLOCKED", exitCode: null, stdout: "", stderr: "Command is not allowlisted.", durationMs: 0 };
  }
  if (options.trustedWorkspace !== true) {
    return {
      command,
      status: "BLOCKED",
      exitCode: null,
      stdout: "",
      stderr: "Verification is fail-closed until the repository workspace is explicitly trusted.",
      durationMs: 0,
    };
  }
  const absoluteRoot = resolve(root);
  const rootInfo = await stat(absoluteRoot).catch(() => null);
  if (!rootInfo?.isDirectory()) {
    return { command, status: "BLOCKED", exitCode: null, stdout: "", stderr: "Repository root does not exist.", durationMs: 0 };
  }
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS));
  const executor = options.executor ?? (async (file, args, execOptions) => {
    const output = await execFileAsync(file, args, execOptions);
    return { stdout: output.stdout, stderr: output.stderr };
  });
  const started = Date.now();
  try {
    const output = await executor(parsed.file, parsed.args, {
      cwd: absoluteRoot,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        CI: "1",
        NODE_ENV: "test",
        NO_COLOR: "1",
      },
    });
    return {
      command,
      status: "PASSED",
      exitCode: 0,
      stdout: (output.stdout ?? "").slice(0, 200_000),
      stderr: (output.stderr ?? "").slice(0, 100_000),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const typed = error as Error & { code?: number | string; killed?: boolean; signal?: string; stdout?: string; stderr?: string };
    const timedOut = typed.killed === true || typed.signal === "SIGTERM" || typed.code === "ETIMEDOUT";
    return {
      command,
      status: timedOut ? "TIMEOUT" : "FAILED",
      exitCode: typeof typed.code === "number" ? typed.code : null,
      stdout: (typed.stdout ?? "").slice(0, 200_000),
      stderr: (typed.stderr ?? typed.message ?? "").slice(0, 100_000),
      durationMs: Date.now() - started,
    };
  }
}

export async function readLocalGitBlame(
  root: string,
  file: string,
  options: { startLine?: number; endLine?: number } = {},
): Promise<GitBlameContext> {
  const normalized = normalizeRepoPath(file);
  if (!normalized || normalized.startsWith("../") || isSensitiveRepositoryPath(normalized)) {
    throw new Error("Git blame target is outside the safe repository context");
  }

  const absoluteRoot = resolve(root);
  const absoluteFile = resolve(absoluteRoot, normalized);
  if (!isInsideRoot(absoluteRoot, absoluteFile)) {
    throw new Error("Git blame target escapes the repository root");
  }
  const info = await stat(absoluteFile).catch(() => null);
  if (!info?.isFile()) {
    throw new Error(`Git blame target does not exist: ${normalized}`);
  }

  const startLine = Math.max(1, Math.floor(options.startLine ?? 1));
  const requestedEnd = Math.max(startLine, Math.floor(options.endLine ?? startLine + 79));
  const endLine = Math.min(requestedEnd, startLine + 199);
  const output = await git(
    absoluteRoot,
    ["blame", "--line-porcelain", `-L${startLine},${endLine}`, "--", normalized],
    15_000,
    false,
  );

  return {
    file: normalized,
    startLine,
    endLine,
    output: output.slice(0, 120_000),
  };
}

export async function buildLocalCodingContextPackage(
  input: BuildLocalContextInput,
): Promise<LocalCodingContextPackage> {
  const root = resolve(input.root);
  const keywords = extractTaskKeywords(input.task);
  const gitMetadata = await readGitMetadata(root, input.requestedBranch, keywords);
  const key = cacheKey(input.repository, gitMetadata);
  let index = indexCache.get(key);
  const cacheHit = Boolean(index);
  if (!index) {
    index = await buildRepositoryIndex(root);
    rememberIndex(key, index);
  }

  const search = await searchRepository(root, index, keywords);
  const seedFiles = search.relevantFiles.slice(0, 10).map((file) => file.path);
  const affectedFiles = boundedAffectedFiles(index.imports, seedFiles);
  const affectedSet = new Set(affectedFiles);
  const relatedTests = discoverRelatedTests(index, affectedSet);
  const relevantSet = new Set(seedFiles);
  const symbols = index.symbols
    .filter((symbol) => relevantSet.has(symbol.file) || affectedSet.has(symbol.file))
    .sort((a, b) => Number(b.exported) - Number(a.exported) || a.file.localeCompare(b.file) || a.line - b.line)
    .slice(0, MAX_SYMBOLS_IN_CONTEXT);
  const dependencies = index.imports
    .filter((reference) => affectedSet.has(reference.file) || Boolean(reference.resolvedFile && affectedSet.has(reference.resolvedFile)))
    .slice(0, MAX_DEPENDENCY_EDGES);
  const verificationCommands = discoverVerificationCommands(index, affectedFiles);
  const warnings = [...index.warnings];
  if (index.sensitiveFilesExcluded > 0) warnings.push(`${index.sensitiveFilesExcluded} sensitive file(s) were excluded from indexing and AI context.`);
  if (search.backend === "local-fallback") warnings.push("ripgrep was unavailable; repository search used the bounded local fallback scanner.");
  if (gitMetadata.headSha === "unknown") warnings.push("Git HEAD could not be resolved; cache reuse is limited for this workspace.");

  return {
    repository: input.repository,
    branch: gitMetadata.branch,
    headSha: gitMetadata.headSha,
    task: input.task,
    keywords,
    relevantFiles: search.relevantFiles,
    affectedFiles,
    symbols,
    dependencies,
    relatedTests,
    recentCommits: gitMetadata.commits,
    gitDiff: gitMetadata.diff,
    changedFiles: gitMetadata.changedFiles,
    verificationCommands,
    testFrameworks: discoverTestFrameworks(index),
    warnings,
    index: {
      filesIndexed: index.files.length,
      sourceFilesParsed: index.sourceFilesParsed,
      bytesParsed: index.bytesParsed,
      sensitiveFilesExcluded: index.sensitiveFilesExcluded,
      cacheHit,
      searchBackend: search.backend,
    },
  };
}
