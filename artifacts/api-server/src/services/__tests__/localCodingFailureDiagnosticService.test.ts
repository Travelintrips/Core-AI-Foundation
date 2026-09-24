import { describe, expect, it } from "vitest";
import {
  buildFailureContexts,
  buildLocalFailureContext,
} from "../localCodingFailureDiagnosticService.js";
import type { VerificationCommandResult } from "../localCodingEngineService.js";

function result(
  command: string,
  stderr: string,
  overrides: Partial<VerificationCommandResult> = {},
): VerificationCommandResult {
  return {
    command,
    status: "FAILED",
    exitCode: 1,
    stdout: "",
    stderr,
    durationMs: 10,
    ...overrides,
  };
}

describe("Local Coding Failure Diagnostics", () => {
  it("extracts TypeScript file, line, column, code and message", () => {
    const context = buildLocalFailureContext(result(
      "pnpm typecheck",
      "src/example.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    ));

    expect(context.kind).toBe("typescript");
    expect(context.primaryFiles).toEqual(["src/example.ts"]);
    expect(context.errorCodes).toEqual(["TS2322"]);
    expect(context.diagnostics[0]).toMatchObject({
      kind: "typescript",
      file: "src/example.ts",
      line: 12,
      column: 7,
      code: "TS2322",
    });
    expect(context.retry.allowed).toBe(false);
  });

  it("extracts lint diagnostics and rule codes", () => {
    const context = buildLocalFailureContext(result(
      "pnpm lint",
      "src/a.ts:4:9  error  'foo' is assigned a value but never used  @typescript-eslint/no-unused-vars",
    ));

    expect(context.kind).toBe("lint");
    expect(context.primaryFiles).toEqual(["src/a.ts"]);
    expect(context.diagnostics[0]).toMatchObject({
      file: "src/a.ts",
      line: 4,
      column: 9,
      code: "@typescript-eslint/no-unused-vars",
    });
  });

  it("extracts test failure files and stack locations", () => {
    const contexts = buildFailureContexts([
      result(
        "pnpm test",
        [
          "FAIL src/__tests__/payment.test.ts",
          "❯ src/__tests__/payment.test.ts:44:11",
        ].join("\n"),
      ),
    ]);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.kind).toBe("test");
    expect(contexts[0]?.primaryFiles).toEqual(["src/__tests__/payment.test.ts"]);
  });

  it("allows only a bounded same-command retry for timeouts", () => {
    const context = buildLocalFailureContext(result(
      "pnpm build",
      "",
      { status: "TIMEOUT", exitCode: null },
    ));

    expect(context.kind).toBe("timeout");
    expect(context.retry).toEqual(expect.objectContaining({
      allowed: true,
      command: "pnpm build",
    }));
  });

  it("redacts secret-like values and credential URLs", () => {
    const context = buildLocalFailureContext(result(
      "pnpm build",
      "src/config.ts:2:3: ERROR: password=super-secret https://user:pass@example.com/path",
    ));

    expect(context.diagnostics[0]?.message).toContain("password=[REDACTED]");
    expect(context.diagnostics[0]?.message).toContain("[REDACTED_CREDENTIAL_URL]");
    expect(context.diagnostics[0]?.message).not.toContain("super-secret");
    expect(context.diagnostics[0]?.message).not.toContain("user:pass");
  });

  it("drops sensitive or escaping file paths from structured context", () => {
    const sensitive = buildLocalFailureContext(result(
      "pnpm typecheck",
      ".env(1,1): error TS1005: ';' expected.",
    ));
    const escaping = buildLocalFailureContext(result(
      "pnpm typecheck",
      "../outside.ts(1,1): error TS1005: ';' expected.",
    ));

    expect(sensitive.primaryFiles).toEqual([]);
    expect(escaping.primaryFiles).toEqual([]);
    expect(sensitive.diagnostics).toEqual([]);
    expect(escaping.diagnostics).toEqual([]);
  });

  it("never retains raw output when parsing is unknown", () => {
    const raw = "some opaque failure with SECRET=abc123";
    const context = buildLocalFailureContext(result("pnpm build", raw));

    expect(context.diagnostics).toEqual([]);
    expect(JSON.stringify(context)).not.toContain(raw);
    expect(context.warnings.join(" ")).toMatch(/raw process output was not retained/i);
  });
});
