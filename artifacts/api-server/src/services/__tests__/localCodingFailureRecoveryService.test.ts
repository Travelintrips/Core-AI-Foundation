import { describe, expect, it } from "vitest";
import {
  buildLocalFailureRecoveryContext,
} from "../localCodingFailureRecoveryService.js";
import type { LocalCodingContextPackage } from "../localCodingEngineService.js";
import type { LocalFailureContext } from "../localCodingFailureDiagnosticService.js";

function context(): LocalCodingContextPackage {
  return {
    repository: "Travelintrips/Core-AI-Foundation",
    branch: "main",
    headSha: "a".repeat(40),
    task: "Fix payment reconciliation",
    keywords: ["payment", "reconciliation"],
    relevantFiles: [
      { path: "src/payment.ts", score: 20, reasons: ["keyword"] },
      { path: "src/reconcile.ts", score: 18, reasons: ["keyword"] },
      { path: "src/unrelated.ts", score: 1, reasons: [] },
    ],
    affectedFiles: ["src/payment.ts", "src/reconcile.ts"],
    symbols: [
      { name: "calculatePayment", kind: "function", file: "src/payment.ts", line: 1, exported: true },
      { name: "reconcile", kind: "function", file: "src/reconcile.ts", line: 1, exported: true },
      { name: "unrelated", kind: "function", file: "src/unrelated.ts", line: 1, exported: true },
    ],
    dependencies: [
      { file: "src/reconcile.ts", specifier: "./payment", resolvedFile: "src/payment.ts", kind: "import" },
      { file: "src/controller.ts", specifier: "./reconcile", resolvedFile: "src/reconcile.ts", kind: "import" },
      { file: "src/__tests__/payment.test.ts", specifier: "../payment", resolvedFile: "src/payment.ts", kind: "import" },
      { file: "src/unrelated.ts", specifier: "./other", resolvedFile: "src/other.ts", kind: "import" },
    ],
    relatedTests: [
      "src/__tests__/payment.test.ts",
      "src/__tests__/unrelated.test.ts",
    ],
    recentCommits: [
      { sha: "1".repeat(40), date: "2026-09-24", subject: "fix payment" },
      { sha: "2".repeat(40), date: "2026-09-23", subject: "other" },
    ],
    gitDiff: "",
    changedFiles: [],
    verificationCommands: ["pnpm typecheck", "pnpm test", "pnpm build"],
    testFrameworks: ["vitest"],
    warnings: [],
    index: {
      filesIndexed: 100,
      sourceFilesParsed: 80,
      bytesParsed: 1000,
      sensitiveFilesExcluded: 2,
      cacheHit: false,
      searchBackend: "ripgrep",
    },
  };
}

function failure(): LocalFailureContext {
  return {
    command: "pnpm typecheck",
    status: "FAILED",
    exitCode: 2,
    kind: "typescript",
    diagnostics: [{
      kind: "typescript",
      file: "src/payment.ts",
      line: 3,
      column: 4,
      code: "TS2322",
      symbol: "calculatePayment",
      message: "Type mismatch",
    }],
    primaryFiles: ["src/payment.ts"],
    errorCodes: ["TS2322"],
    retry: {
      allowed: false,
      reason: "Non-timeout failures are not retried blindly.",
    },
    warnings: [],
  };
}

describe("Local Coding Failure Recovery Context", () => {
  it("narrows a failure to bounded files, symbols, dependencies and tests", () => {
    const result = buildLocalFailureRecoveryContext(context(), [failure()]);

    expect(result.status).toBe("CONTEXT_REFINED");
    expect(result.nextAction).toBe("LOCAL_RECOVERY_REQUIRED");
    expect(result.focusFiles).toEqual(expect.arrayContaining([
      "src/payment.ts",
      "src/reconcile.ts",
      "src/controller.ts",
      "src/__tests__/payment.test.ts",
    ]));
    expect(result.focusFiles).not.toContain("src/unrelated.ts");
    expect(result.focusSymbols.map((item) => item.name)).toEqual(expect.arrayContaining([
      "calculatePayment",
      "reconcile",
    ]));
    expect(result.relatedTests).toContain("src/__tests__/payment.test.ts");
    expect(result.dependencies.length).toBeGreaterThan(0);
    expect(result.verificationCommands).toEqual(["pnpm typecheck"]);
  });

  it("records exhausted deterministic timeout retry without repeating source changes", () => {
    const timeout: LocalFailureContext = {
      ...failure(),
      command: "pnpm test",
      status: "TIMEOUT",
      kind: "timeout",
      retry: {
        allowed: true,
        reason: "One same-command retry is permitted.",
        command: "pnpm test",
      },
    };

    const result = buildLocalFailureRecoveryContext(
      context(),
      [timeout],
      [{ command: "pnpm test", trigger: "TIMEOUT", status: "TIMEOUT" }],
    );

    expect(result.deterministicRetry).toEqual({
      attempted: true,
      exhausted: true,
      commands: ["pnpm test"],
    });
    expect(result.nextAction).toBe("LOCAL_RECOVERY_REQUIRED");
  });

  it("returns no-actionable context rather than guessing when no safe file exists", () => {
    const unknown: LocalFailureContext = {
      ...failure(),
      kind: "unknown",
      diagnostics: [],
      primaryFiles: [],
      errorCodes: [],
    };

    const result = buildLocalFailureRecoveryContext(context(), [unknown]);

    expect(result.status).toBe("NO_ACTIONABLE_CONTEXT");
    expect(result.focusFiles).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/automatic source mutation remains disabled/i);
  });

  it("filters sensitive failure paths from the recovery context", () => {
    const sensitive: LocalFailureContext = {
      ...failure(),
      diagnostics: [{
        kind: "typescript",
        file: ".env",
        line: 1,
        message: "bad",
      }],
      primaryFiles: [".env", "../outside.ts"],
    };

    const result = buildLocalFailureRecoveryContext(context(), [sensitive]);

    expect(result.focusFiles).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(".env");
    expect(JSON.stringify(result)).not.toContain("../outside.ts");
  });
});
