import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeLocalCodingPlan,
  planLocalCodingExecution,
  type LocalCodingExecutionPlan,
} from "../localCodingExecutorService.js";
import type { LocalCodingContextPackage } from "../localCodingEngineService.js";

const workspaces: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "local-coding-executor-test-"));
  workspaces.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src", "sample.ts"),
    [
      "export const oldName = 1;",
      "export function message() { return \"old value\"; }",
      "export function useValue() { return oldName; }",
      "export const label = \"oldName\";",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: { test: "vitest run", typecheck: "tsc --noEmit" },
    }, null, 2) + "\n",
    "utf8",
  );
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "ci@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "CI"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root });
  return root;
}

function context(rootTask = "replace"): LocalCodingContextPackage {
  return {
    repository: "fixture/repo",
    branch: "main",
    headSha: "a".repeat(40),
    task: rootTask,
    keywords: ["sample"],
    relevantFiles: [{ path: "src/sample.ts", score: 10, reasons: ["path:sample"] }],
    affectedFiles: ["src/sample.ts"],
    symbols: [],
    dependencies: [],
    relatedTests: [],
    recentCommits: [],
    gitDiff: "",
    changedFiles: [],
    verificationCommands: ["pnpm test", "pnpm typecheck"],
    testFrameworks: ["vitest"],
    warnings: [],
    index: {
      filesIndexed: 2,
      sourceFilesParsed: 1,
      bytesParsed: 100,
      sensitiveFilesExcluded: 0,
      cacheHit: false,
      searchBackend: "local-fallback",
    },
  };
}

function head(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

describe("Local Coding Executor", () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("creates an executable plan only for an exact deterministic edit inside analyzed context", () => {
    const plan = planLocalCodingExecution(
      'Replace "old value" with "new value" in src/sample.ts',
      context(),
    );

    expect(plan.status).toBe("EXECUTABLE");
    expect(plan.targetFiles).toEqual(["src/sample.ts"]);
    expect(plan.operations).toEqual([
      expect.objectContaining({
        kind: "replace_text",
        path: "src/sample.ts",
        search: "old value",
        replacement: "new value",
        expectedOccurrences: 1,
      }),
    ]);
    expect(plan.verificationCommands).toEqual(["pnpm test", "pnpm typecheck"]);
  });

  it("returns AI_REQUIRED instead of guessing for semantic coding instructions", () => {
    const plan = planLocalCodingExecution(
      "Perbaiki kandidat QRIS yang tidak muncul dan pastikan logika matching benar",
      context(),
    );

    expect(plan.status).toBe("AI_REQUIRED");
    expect(plan.operations).toEqual([]);
    expect(plan.reason).toMatch(/Semantic reasoning/i);
  });

  it("refuses deterministic directives outside analyzed context or targeting sensitive files", () => {
    const outside = planLocalCodingExecution(
      'Replace "x" with "y" in src/not-analyzed.ts',
      context(),
    );
    const sensitiveContext = {
      ...context(),
      relevantFiles: [{ path: ".env", score: 99, reasons: ["fixture"] }],
      affectedFiles: [".env"],
    };
    const sensitive = planLocalCodingExecution(
      'Replace "SECRET=x" with "SECRET=y" in .env',
      sensitiveContext,
    );

    expect(outside.status).toBe("AI_REQUIRED");
    expect(outside.reason).toMatch(/outside the bounded analyzed context/i);
    expect(sensitive.status).toBe("AI_REQUIRED");
    expect(sensitive.reason).toMatch(/sensitive path/i);
  });

  it("applies an exact local patch and runs only the discovered allowlisted verification", async () => {
    const root = await createWorkspace();
    const plan = planLocalCodingExecution(
      'Replace "old value" with "new value" in src/sample.ts',
      context(),
    );
    const calls: Array<{ file: string; args: string[] }> = [];

    const result = await executeLocalCodingPlan(root, plan, {
      trustedWorkspace: true,
      expectedHeadSha: head(root),
      verificationExecutor: async (file, args) => {
        calls.push({ file, args });
        return { stdout: "ok", stderr: "" };
      },
    });

    expect(result.status).toBe("APPLIED");
    expect(result.changedFiles).toEqual(["src/sample.ts"]);
    expect(result.patch).toContain("new value");
    expect(result.verification.map((item) => item.status)).toEqual(["PASSED", "PASSED"]);
    expect(calls).toEqual([
      { file: "pnpm", args: ["test"] },
      { file: "pnpm", args: ["typecheck"] },
    ]);
    expect(await readFile(join(root, "src", "sample.ts"), "utf8")).toContain("new value");
  });

  it("rolls back all edits when an allowlisted verification command fails", async () => {
    const root = await createWorkspace();
    const original = await readFile(join(root, "src", "sample.ts"), "utf8");
    const plan = planLocalCodingExecution(
      'Replace "old value" with "new value" in src/sample.ts',
      context(),
    );

    const result = await executeLocalCodingPlan(root, plan, {
      trustedWorkspace: true,
      expectedHeadSha: head(root),
      verificationExecutor: async () => {
        throw Object.assign(new Error("test failure"), { code: 1, stderr: "failed" });
      },
    });

    expect(result.status).toBe("VERIFICATION_FAILED");
    expect(result.rolledBack).toBe(true);
    expect(result.patch).toContain("new value");
    expect(await readFile(join(root, "src", "sample.ts"), "utf8")).toBe(original);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe("");
  });

  it("uses TypeScript AST positions to rename identifiers without changing comments or string literals", async () => {
    const root = await createWorkspace();
    const plan: LocalCodingExecutionPlan = {
      status: "EXECUTABLE",
      reason: "test",
      operations: [{
        kind: "typescript_rename_identifier",
        path: "src/sample.ts",
        from: "oldName",
        to: "newName",
        expectedOccurrences: 2,
      }],
      verificationCommands: [],
      targetFiles: ["src/sample.ts"],
      warnings: [],
    };

    const result = await executeLocalCodingPlan(root, plan, {
      trustedWorkspace: true,
      expectedHeadSha: head(root),
      runVerification: false,
    });
    const next = await readFile(join(root, "src", "sample.ts"), "utf8");

    expect(result.status).toBe("APPLIED");
    expect(next).toContain("const newName = 1");
    expect(next).toContain("return newName");
    expect(next).toContain('label = "oldName"');
  });

  it("supports bounded JSON set operations without arbitrary script execution", async () => {
    const root = await createWorkspace();
    const plan: LocalCodingExecutionPlan = {
      status: "EXECUTABLE",
      reason: "test",
      operations: [{
        kind: "json_set",
        path: "package.json",
        keyPath: ["scripts", "lint"],
        value: "eslint .",
      }],
      verificationCommands: [],
      targetFiles: ["package.json"],
      warnings: [],
    };

    const result = await executeLocalCodingPlan(root, plan, {
      trustedWorkspace: true,
      expectedHeadSha: head(root),
      runVerification: false,
    });
    const parsed = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

    expect(result.status).toBe("APPLIED");
    expect(parsed.scripts.lint).toBe("eslint .");
  });

  it("fails closed for symlink targets, dirty worktrees, untrusted writes, and arbitrary verification commands", async () => {
    const root = await createWorkspace();
    const outside = join(root, "..", `outside-${Date.now()}.ts`);
    await writeFile(outside, "export const x = 1;\n", "utf8");
    await symlink(outside, join(root, "src", "linked.ts"));

    const symlinkPlan: LocalCodingExecutionPlan = {
      status: "EXECUTABLE",
      reason: "test",
      operations: [{
        kind: "replace_text",
        path: "src/linked.ts",
        search: "x = 1",
        replacement: "x = 2",
      }],
      verificationCommands: [],
      targetFiles: ["src/linked.ts"],
      warnings: [],
    };
    const symlinkResult = await executeLocalCodingPlan(root, symlinkPlan, {
      trustedWorkspace: true,
      expectedHeadSha: head(root),
      requireCleanWorktree: false,
      runVerification: false,
    });
    expect(symlinkResult.status).toBe("FAILED");
    expect(symlinkResult.reason).toMatch(/regular file/i);
    await rm(outside, { force: true });

    const normalPlan = planLocalCodingExecution(
      'Replace "old value" with "new value" in src/sample.ts',
      context(),
    );
    const untrusted = await executeLocalCodingPlan(root, normalPlan);
    expect(untrusted.status).toBe("BLOCKED");

    await writeFile(join(root, "src", "sample.ts"), "dirty\n", "utf8");
    const dirty = await executeLocalCodingPlan(root, normalPlan, {
      trustedWorkspace: true,
      expectedHeadSha: head(root),
    });
    expect(dirty.status).toBe("BLOCKED");
    expect(dirty.reason).toMatch(/not clean/i);
  });

  it("blocks non-allowlisted verification and rolls the patch back", async () => {
    const root = await createWorkspace();
    const plan = planLocalCodingExecution(
      'Replace "old value" with "new value" in src/sample.ts',
      context(),
    );
    const unsafePlan = {
      ...plan,
      verificationCommands: ["pnpm exec bash -lc whoami"],
    };

    const result = await executeLocalCodingPlan(root, unsafePlan, {
      trustedWorkspace: true,
      expectedHeadSha: head(root),
      verificationExecutor: async () => ({ stdout: "must not run" }),
    });

    expect(result.status).toBe("VERIFICATION_FAILED");
    expect(result.verification[0]?.status).toBe("BLOCKED");
    expect(result.rolledBack).toBe(true);
    expect(await readFile(join(root, "src", "sample.ts"), "utf8")).toContain("old value");
  });
});
