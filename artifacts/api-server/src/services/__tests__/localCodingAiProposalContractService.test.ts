import { describe, expect, it } from "vitest";
import {
  LocalCodingAiProposalContractError,
  localCodingAiProposalContractLimits,
  parseLocalCodingAiProposalV1,
  safeParseLocalCodingAiProposalV1,
  validateLocalCodingAiProposalV1,
  type LocalCodingAiProposalBinding,
} from "../localCodingAiProposalContractService.js";

function binding(): LocalCodingAiProposalBinding {
  return {
    taskId: "11111111-1111-4111-8111-111111111111",
    packageHash: "a".repeat(64),
    baseHeadSha: "b".repeat(40),
    currentPatchSha256: "c".repeat(64),
    allowedFiles: ["src/payment.ts", "src/reconcile.ts"],
  };
}

function proposal() {
  const expected = binding();
  return {
    version: 1,
    taskId: expected.taskId,
    packageHash: expected.packageHash,
    baseHeadSha: expected.baseHeadSha,
    currentPatchSha256: expected.currentPatchSha256,
    allowedFiles: [...expected.allowedFiles],
    capabilities: {
      shellCommand: false,
      networkRequest: false,
      commit: false,
      push: false,
      merge: false,
      secretAccess: false,
      envAccess: false,
    },
    proposal: {
      summary: "Repair the type mismatch with bounded edits.",
      rationale: "Use exact-text operations only in approved files.",
      operations: [
        {
          type: "replace_text",
          file: "src/payment.ts",
          oldText: "const total: number = raw;",
          newText: "const total: number = Number(raw);",
          expectedOccurrences: 1,
        },
        {
          type: "insert_after",
          file: "src/reconcile.ts",
          anchor: "const result = reconcile(input);",
          content: "\nassertFinite(result.total);",
          expectedOccurrences: 1,
        },
      ],
    },
  };
}

function expectContractKind(
  action: () => unknown,
  kind: LocalCodingAiProposalContractError["kind"],
) {
  try {
    action();
    throw new Error("Expected contract validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(LocalCodingAiProposalContractError);
    expect((error as LocalCodingAiProposalContractError).kind).toBe(kind);
  }
}

describe("Local Coding AI Proposal Contract V1", () => {
  it("accepts a structured proposal bound to the approved handoff", () => {
    const parsed = parseLocalCodingAiProposalV1(
      JSON.stringify(proposal()),
      binding(),
    );

    expect(parsed.version).toBe(1);
    expect(parsed.taskId).toBe(binding().taskId);
    expect(parsed.packageHash).toBe(binding().packageHash);
    expect(parsed.baseHeadSha).toBe(binding().baseHeadSha);
    expect(parsed.currentPatchSha256).toBe(binding().currentPatchSha256);
    expect(parsed.allowedFiles).toEqual(binding().allowedFiles);
    expect(parsed.proposal.operations.map((item) => item.type)).toEqual([
      "replace_text",
      "insert_after",
    ]);
  });

  it("accepts a bounded create_file operation for an allowed path", () => {
    const expected = binding();
    const value = proposal();
    value.allowedFiles = ["docs/ollama-local-smoke-test-8b.md"];
    value.proposal.operations = [
      {
        type: "create_file",
        file: "docs/ollama-local-smoke-test-8b.md",
        content:
          "Created to verify the local Ollama coding worker, multi-worker dispatcher, and planner authority lease.\n",
      },
    ] as never;

    const parsed = validateLocalCodingAiProposalV1(
      value,
      { ...expected, allowedFiles: ["docs/ollama-local-smoke-test-8b.md"] },
    );

    expect(parsed.proposal.operations).toEqual(value.proposal.operations);
  });

  it("rejects malformed, prose-wrapped, and markdown/code-fenced output", () => {
    expectContractKind(
      () => parseLocalCodingAiProposalV1('{"version":1', binding()),
      "MALFORMED_JSON",
    );
    expectContractKind(
      () =>
        parseLocalCodingAiProposalV1(
          "Proposal:\n" + JSON.stringify(proposal()),
          binding(),
        ),
      "MALFORMED_JSON",
    );
    const fence = String.fromCharCode(96).repeat(3);
    expectContractKind(
      () =>
        parseLocalCodingAiProposalV1(
          fence + "json\n" + JSON.stringify(proposal()) + "\n" + fence,
          binding(),
        ),
      "MALFORMED_JSON",
    );
  });

  it("rejects every stale/spoofed handoff binding", () => {
    const replacements = [
      ["taskId", "other-task"],
      ["packageHash", "d".repeat(64)],
      ["baseHeadSha", "e".repeat(40)],
      ["currentPatchSha256", "f".repeat(64)],
    ] as const;

    for (const [field, replacement] of replacements) {
      expectContractKind(
        () =>
          validateLocalCodingAiProposalV1(
            { ...proposal(), [field]: replacement },
            binding(),
          ),
        "BINDING_MISMATCH",
      );
    }

    const reordered = proposal();
    reordered.allowedFiles.reverse();
    expectContractKind(
      () => validateLocalCodingAiProposalV1(reordered, binding()),
      "BINDING_MISMATCH",
    );
  });

  it("rejects unknown fields and arbitrary patch payloads", () => {
    expectContractKind(
      () =>
        validateLocalCodingAiProposalV1(
          { ...proposal(), patch: "diff --git a/a b/a" },
          binding(),
        ),
      "INVALID_SCHEMA",
    );

    const value = proposal();
    (value.proposal.operations[0] as Record<string, unknown>).command =
      "pnpm test";
    expectContractKind(
      () => validateLocalCodingAiProposalV1(value, binding()),
      "INVALID_SCHEMA",
    );
  });

  it.each([
    "shell_command",
    "network_request",
    "git_commit",
    "git_push",
    "git_merge",
    "read_env",
    "read_secret",
    "arbitrary_patch",
  ])("rejects forbidden/unknown operation type %s", (type: string) => {
    const value = proposal();
    value.proposal.operations = [
      {
        type,
        file: "src/payment.ts",
        command: "forbidden",
        expectedOccurrences: 1,
      } as never,
    ];

    expectContractKind(
      () => validateLocalCodingAiProposalV1(value, binding()),
      "INVALID_SCHEMA",
    );
  });

  it("requires shell/network/git/secret/env capabilities to stay false", () => {
    for (const capability of [
      "shellCommand",
      "networkRequest",
      "commit",
      "push",
      "merge",
      "secretAccess",
      "envAccess",
    ] as const) {
      const value = proposal();
      value.capabilities[capability] = true as never;
      expect(() =>
        validateLocalCodingAiProposalV1(value, binding()),
      ).toThrow(LocalCodingAiProposalContractError);
    }
  });

  it("rejects operations outside allowedFiles", () => {
    const value = proposal();
    value.proposal.operations[0]!.file = "src/not-approved.ts";
    expectContractKind(
      () => validateLocalCodingAiProposalV1(value, binding()),
      "OUT_OF_SCOPE",
    );
  });

  it.each([
    ".env",
    ".env.production",
    "credentials.json",
    "keys/private-key.pem",
    ".git/config",
  ])("rejects sensitive allowed file %s", (file: string) => {
    const unsafeBinding = { ...binding(), allowedFiles: [file] };
    const value = proposal();
    value.allowedFiles = [file];
    value.proposal.operations[0]!.file = file;

    expectContractKind(
      () => validateLocalCodingAiProposalV1(value, unsafeBinding),
      "OUT_OF_SCOPE",
    );
  });

  it("enforces file and operation count limits", () => {
    const tooManyFiles = Array.from(
      { length: localCodingAiProposalContractLimits.maxAllowedFiles + 1 },
      (_, index) => "src/file-" + index + ".ts",
    );
    expectContractKind(
      () =>
        validateLocalCodingAiProposalV1(
          { ...proposal(), allowedFiles: tooManyFiles },
          { ...binding(), allowedFiles: tooManyFiles },
        ),
      "LIMIT_EXCEEDED",
    );

    const value = proposal();
    value.proposal.operations = Array.from(
      { length: localCodingAiProposalContractLimits.maxOperations + 1 },
      () => ({
        type: "delete_text",
        file: "src/payment.ts",
        text: "x",
        expectedOccurrences: 1,
      }),
    ) as never;

    expectContractKind(
      () => validateLocalCodingAiProposalV1(value, binding()),
      "LIMIT_EXCEEDED",
    );
  });

  it("enforces per-operation and aggregate content limits", () => {
    const oversized = proposal();
    oversized.proposal.operations[0] = {
      type: "replace_text",
      file: "src/payment.ts",
      oldText: "x",
      newText: "y".repeat(
        localCodingAiProposalContractLimits.maxContentChars + 1,
      ),
      expectedOccurrences: 1,
    };
    expectContractKind(
      () => validateLocalCodingAiProposalV1(oversized, binding()),
      "LIMIT_EXCEEDED",
    );

    const aggregate = proposal();
    aggregate.proposal.operations = Array.from({ length: 5 }, (_, index) => ({
      type: "replace_text",
      file: "src/payment.ts",
      oldText: "old-" + index,
      newText: "x".repeat(localCodingAiProposalContractLimits.maxContentChars),
      expectedOccurrences: 1,
    }));
    expectContractKind(
      () => validateLocalCodingAiProposalV1(aggregate, binding()),
      "LIMIT_EXCEEDED",
    );
  });

  it("exports a non-throwing fail-closed parser for downstream workstreams", () => {
    const valid = safeParseLocalCodingAiProposalV1(
      JSON.stringify(proposal()),
      binding(),
    );
    expect(valid.success).toBe(true);

    const invalid = safeParseLocalCodingAiProposalV1("not json", binding());
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.kind).toBe("MALFORMED_JSON");
    }
  });
});
