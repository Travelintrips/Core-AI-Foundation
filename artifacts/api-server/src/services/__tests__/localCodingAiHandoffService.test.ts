import { describe, expect, it } from "vitest";
import {
  buildAiHandoffPackage,
  type AiHandoffSnippet,
} from "../localCodingAiHandoffService.js";
import type { LocalFailureContext } from "../localCodingFailureDiagnosticService.js";
import type { LocalFailureRecoveryContext } from "../localCodingFailureRecoveryService.js";

function recoveryContext(): LocalFailureRecoveryContext {
  return {
    status: "DETERMINISTIC_RECOVERY_EXHAUSTED",
    nextAction: "AI_REQUIRED",
    failureCommands: ["pnpm typecheck"],
    failureKinds: ["typescript"],
    errorCodes: ["TS2322"],
    focusFiles: [
      "src/payment.ts",
      "src/reconcile.ts",
      "src/controller.ts",
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
      "src/f.ts",
      "src/g.ts",
      "src/h.ts",
      "src/i.ts",
      "src/j.ts",
      ".env",
      "../outside.ts",
    ],
    focusSymbols: [
      { name: "calculatePayment", kind: "function", file: "src/payment.ts", line: 4, exported: true },
      { name: "outside", kind: "function", file: "src/outside.ts", line: 1, exported: true },
    ],
    dependencies: [
      { file: "src/reconcile.ts", specifier: "./payment", resolvedFile: "src/payment.ts", kind: "import" },
      { file: "src/outside.ts", specifier: "./secret", resolvedFile: ".env", kind: "import" },
    ],
    relatedTests: ["src/__tests__/payment.test.ts", "../escape.test.ts"],
    recentCommits: [
      { sha: "1".repeat(40), date: "2026-09-24", subject: "fix payment" },
    ],
    verificationCommands: ["pnpm typecheck", "pnpm test"],
    deterministicRetry: {
      attempted: true,
      exhausted: true,
      commands: ["pnpm typecheck"],
    },
    warnings: [],
  };
}

function failureContexts(): LocalFailureContext[] {
  return [{
    command: "pnpm typecheck",
    status: "FAILED",
    exitCode: 2,
    kind: "typescript",
    diagnostics: [{
      kind: "typescript",
      file: "src/payment.ts",
      line: 10,
      column: 6,
      code: "TS2322",
      symbol: "calculatePayment",
      message: "password=super-secret Type 'string' is not assignable to type 'number'.",
    }],
    primaryFiles: ["src/payment.ts"],
    errorCodes: ["TS2322"],
    retry: {
      allowed: false,
      reason: "semantic failure",
    },
    warnings: [],
  }];
}

describe("Local Coding AI Handoff Package", () => {
  it("builds a bounded read-only package without invoking a model", () => {
    const snippets: AiHandoffSnippet[] = [
      {
        file: "src/payment.ts",
        startLine: 1,
        endLine: 3,
        content: "const password=super-secret;\nexport const x = 1;",
        reason: "diagnostic",
      },
      {
        file: "src/outside.ts",
        startLine: 1,
        endLine: 1,
        content: "must not be included",
        reason: "focus",
      },
    ];

    const pkg = buildAiHandoffPackage({
      task: {
        id: "11111111-1111-4111-8111-111111111111",
        projectName: "Payment recovery",
        instruction: "Fix payment. api_key=abcdef",
        repository: "Travelintrips/Core-AI-Foundation",
        branch: "main",
      },
      baseHeadSha: "a".repeat(40),
      reason: "Semantic mismatch secret=hidden",
      recoveryContext: recoveryContext(),
      failureContexts: failureContexts(),
      snippets,
      currentPatch: [
        "diff --git a/src/payment.ts b/src/payment.ts",
        "--- a/src/payment.ts",
        "+++ b/src/payment.ts",
        "@@ -1 +1 @@",
        "-const password=old-secret",
        "+const password=new-secret",
      ].join("\n"),
    });

    expect(pkg.version).toBe(1);
    expect(pkg.allowedFiles).toHaveLength(12);
    expect(pkg.allowedFiles).not.toContain(".env");
    expect(pkg.allowedFiles).not.toContain("../outside.ts");
    expect(pkg.policy).toEqual({
      readOnlyContext: true,
      repositoryAccess: false,
      networkAccess: false,
      shellAccess: false,
      secretAccess: false,
      sourceWrite: false,
      commitPushMerge: false,
      modelInvoked: false,
      requiresExplicitApprovalBeforeModel: true,
      allowedFilesOnly: true,
    });
    expect(pkg.snippets).toHaveLength(1);
    expect(pkg.snippets[0]?.content).toContain("password=[REDACTED]");
    expect(pkg.snippets[0]?.content).not.toContain("super-secret");
    expect(pkg.diagnostics[0]?.message).toContain("password=[REDACTED]");
    expect(pkg.diagnostics[0]?.message).not.toContain("super-secret");
    expect(pkg.task.instruction).toContain("api_key=[REDACTED]");
    expect(pkg.currentPatch.excerpt).toContain("[REDACTED_SENSITIVE_DIFF_LINE]");
    expect(pkg.currentPatch.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pkg.symbols.map((item) => item.name)).toEqual(["calculatePayment"]);
    expect(pkg.dependencies).toHaveLength(1);
  });

  it("keeps snippets and allowed files bounded", () => {
    const snippets: AiHandoffSnippet[] = Array.from({ length: 20 }, (_, index) => ({
      file: index === 0 ? "src/payment.ts" : "src/reconcile.ts",
      startLine: 1,
      endLine: 100,
      content: "x".repeat(10_000),
      reason: "focus" as const,
    }));

    const pkg = buildAiHandoffPackage({
      task: {
        id: "22222222-2222-4222-8222-222222222222",
        projectName: "Bounded",
        instruction: "inspect",
        repository: "owner/repo",
        branch: "main",
      },
      baseHeadSha: "b".repeat(40),
      reason: "AI required",
      recoveryContext: recoveryContext(),
      failureContexts: failureContexts(),
      snippets,
      currentPatch: "diff --git a/src/payment.ts b/src/payment.ts\n" + "x".repeat(30_000),
    });

    expect(pkg.allowedFiles.length).toBeLessThanOrEqual(12);
    expect(pkg.snippets.length).toBeLessThanOrEqual(10);
    expect(pkg.snippets.every((item) => item.content.length <= 4_000)).toBe(true);
    expect(pkg.currentPatch.excerpt.length).toBeLessThanOrEqual(24_000);
    expect(pkg.currentPatch.truncated).toBe(true);
  });

  it("omits unsafe diagnostic paths from the package", () => {
    const unsafe: LocalFailureContext = {
      ...failureContexts()[0]!,
      diagnostics: [{
        kind: "typescript",
        file: ".env",
        line: 1,
        column: 1,
        code: "TS1005",
        message: "';' expected.",
      }],
      primaryFiles: [".env"],
    };

    const pkg = buildAiHandoffPackage({
      task: {
        id: "33333333-3333-4333-8333-333333333333",
        projectName: "Unsafe",
        instruction: "inspect",
        repository: "owner/repo",
        branch: "main",
      },
      baseHeadSha: "c".repeat(40),
      reason: "AI required",
      recoveryContext: recoveryContext(),
      failureContexts: [unsafe],
      snippets: [],
      currentPatch: "diff --git a/src/payment.ts b/src/payment.ts",
    });

    expect(pkg.diagnostics[0]?.file).toBeUndefined();
    expect(JSON.stringify(pkg)).not.toContain('".env"');
  });
});
