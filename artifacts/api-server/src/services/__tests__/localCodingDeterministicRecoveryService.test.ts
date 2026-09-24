import { describe, expect, it } from "vitest";
import {
  planDeterministicLocalRecovery,
} from "../localCodingDeterministicRecoveryService.js";
import type { LocalFailureContext } from "../localCodingFailureDiagnosticService.js";
import type { LocalFailureRecoveryContext } from "../localCodingFailureRecoveryService.js";

function recoveryContext(): LocalFailureRecoveryContext {
  return {
    status: "CONTEXT_REFINED",
    nextAction: "LOCAL_RECOVERY_REQUIRED",
    failureCommands: ["pnpm typecheck"],
    failureKinds: ["typescript"],
    errorCodes: ["TS2552"],
    focusFiles: ["src/payment.ts"],
    focusSymbols: [],
    dependencies: [],
    relatedTests: [],
    recentCommits: [],
    verificationCommands: ["pnpm typecheck", "pnpm test"],
    deterministicRetry: {
      attempted: false,
      exhausted: false,
      commands: [],
    },
    warnings: [],
  };
}

function failure(
  code: string,
  message: string,
  overrides: Partial<LocalFailureContext["diagnostics"][number]> = {},
): LocalFailureContext {
  return {
    command: "pnpm typecheck",
    status: "FAILED",
    exitCode: 2,
    kind: "typescript",
    diagnostics: [{
      kind: "typescript",
      file: "src/payment.ts",
      line: 10,
      column: 8,
      code,
      message,
      ...overrides,
    }],
    primaryFiles: ["src/payment.ts"],
    errorCodes: [code],
    retry: {
      allowed: false,
      reason: "not timeout",
    },
    warnings: [],
  };
}

describe("Deterministic Local Recovery Planner", () => {
  it("uses compiler Did-you-mean suggestions only at the diagnostic position", () => {
    const plan = planDeterministicLocalRecovery(
      [failure("TS2552", "Cannot find name 'totla'. Did you mean 'total'?")],
      recoveryContext(),
      ["pnpm typecheck", "pnpm test"],
    );

    expect(plan.status).toBe("EXECUTABLE");
    expect(plan.operations).toEqual([{
      kind: "typescript_replace_identifier_at_position",
      path: "src/payment.ts",
      line: 10,
      column: 8,
      from: "totla",
      to: "total",
    }]);
    expect(plan.matchedDiagnostics[0]?.strategy).toBe("compiler_identifier_suggestion");
  });

  it("supports TS2551 property suggestions without global rename", () => {
    const plan = planDeterministicLocalRecovery(
      [failure(
        "TS2551",
        "Property 'lenght' does not exist on type 'string[]'. Did you mean 'length'?",
      )],
      recoveryContext(),
      ["pnpm typecheck"],
    );

    expect(plan.status).toBe("EXECUTABLE");
    expect(plan.operations[0]).toMatchObject({
      kind: "typescript_replace_identifier_at_position",
      from: "lenght",
      to: "length",
    });
  });

  it("supports only comma or semicolon TS1005 punctuation recovery", () => {
    const comma = planDeterministicLocalRecovery(
      [failure("TS1005", "',' expected.")],
      recoveryContext(),
      ["pnpm typecheck"],
    );
    expect(comma.status).toBe("EXECUTABLE");
    expect(comma.operations[0]).toMatchObject({
      kind: "typescript_insert_punctuation_at_position",
      text: ",",
    });

    const brace = planDeterministicLocalRecovery(
      [failure("TS1005", "'}' expected.")],
      recoveryContext(),
      ["pnpm typecheck"],
    );
    expect(brace.status).toBe("AI_REQUIRED");
    expect(brace.operations).toEqual([]);
  });

  it("refuses diagnostics outside the refined focus files", () => {
    const plan = planDeterministicLocalRecovery(
      [failure(
        "TS2552",
        "Cannot find name 'totla'. Did you mean 'total'?",
        { file: "src/unrelated.ts" },
      )],
      recoveryContext(),
      ["pnpm typecheck"],
    );

    expect(plan.status).toBe("AI_REQUIRED");
    expect(plan.targetFiles).toEqual([]);
  });

  it("refuses semantic failures rather than guessing", () => {
    const plan = planDeterministicLocalRecovery(
      [failure(
        "TS2322",
        "Type 'string' is not assignable to type 'number'.",
      )],
      recoveryContext(),
      ["pnpm typecheck"],
    );

    expect(plan.status).toBe("AI_REQUIRED");
    expect(plan.reason).toMatch(/No compiler-backed deterministic recovery/i);
    expect(plan.warnings.join(" ")).toMatch(/refuses semantic guesses/i);
  });
});
