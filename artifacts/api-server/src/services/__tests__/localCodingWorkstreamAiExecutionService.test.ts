import { describe, expect, it } from "vitest";
import {
  hashWorkstreamAnalyzerResult,
  parseWorkstreamAiJobPayload,
  selectWorkstreamAiAllowedFiles,
} from "../localCodingWorkstreamAiExecutionService.js";

const GRAPH_ID = "11111111-1111-4111-8111-111111111111";
const WORKSTREAM_ID = "22222222-2222-4222-8222-222222222222";
const CHILD_TASK_ID = "33333333-3333-4333-8333-333333333333";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("per-workstream constrained AI execution contract", () => {
  it("hashes analyzer results deterministically regardless of object key order", () => {
    const left = {
      localExecutionPlan: { status: "AI_REQUIRED", targetFiles: ["src/a.ts"] },
      contextPackage: { headSha: "c".repeat(40), affectedFiles: ["src/a.ts"] },
    };
    const right = {
      contextPackage: { affectedFiles: ["src/a.ts"], headSha: "c".repeat(40) },
      localExecutionPlan: { targetFiles: ["src/a.ts"], status: "AI_REQUIRED" },
    };

    expect(hashWorkstreamAnalyzerResult(left)).toBe(
      hashWorkstreamAnalyzerResult(right),
    );
    expect(hashWorkstreamAnalyzerResult(left)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts only a fully bound queue payload", () => {
    expect(
      parseWorkstreamAiJobPayload({
        graphId: GRAPH_ID,
        workstreamId: WORKSTREAM_ID,
        childTaskId: CHILD_TASK_ID,
        claimAttempt: 2,
        leaseToken: "lease-token",
        authorizationPackageHash: HASH_A,
        analyzerResultHash: HASH_B,
        requestedBy: "control-tower",
      }),
    ).toEqual({
      graphId: GRAPH_ID,
      workstreamId: WORKSTREAM_ID,
      childTaskId: CHILD_TASK_ID,
      claimAttempt: 2,
      leaseToken: "lease-token",
      authorizationPackageHash: HASH_A,
      analyzerResultHash: HASH_B,
      requestedBy: "control-tower",
    });
  });

  it("rejects malformed hashes and invalid claim attempts fail closed", () => {
    expect(() =>
      parseWorkstreamAiJobPayload({
        graphId: GRAPH_ID,
        workstreamId: WORKSTREAM_ID,
        childTaskId: CHILD_TASK_ID,
        claimAttempt: 0,
        leaseToken: "lease-token",
        authorizationPackageHash: HASH_A,
        analyzerResultHash: HASH_B,
      }),
    ).toThrow(/claimAttempt/);

    expect(() =>
      parseWorkstreamAiJobPayload({
        graphId: GRAPH_ID,
        workstreamId: WORKSTREAM_ID,
        childTaskId: CHILD_TASK_ID,
        claimAttempt: 2,
        leaseToken: "lease-token",
        authorizationPackageHash: "not-a-hash",
        analyzerResultHash: HASH_B,
      }),
    ).toThrow(/SHA-256/);
  });

  it("derives concrete allowed files only from workstream-owned safe paths", () => {
    const analyzer = {
      contextPackage: {
        affectedFiles: [
          "artifacts/api-server/src/routes/a.ts",
          "artifacts/ai-platform/src/outside.tsx",
          "../escape.ts",
          ".env",
        ],
        relevantFiles: [
          { path: "artifacts/api-server/src/services/b.ts" },
          { path: "artifacts/api-server/src/routes/a.ts" },
        ],
        symbols: [
          { file: "artifacts/api-server/src/services/c.ts" },
        ],
        dependencies: [
          { file: "artifacts/api-server/src/lib/d.ts" },
        ],
        relatedTests: [
          "artifacts/api-server/src/routes/__tests__/a.test.ts",
        ],
      },
      localExecutionPlan: {
        targetFiles: ["artifacts/api-server/src/services/e.ts"],
      },
    };

    expect(
      selectWorkstreamAiAllowedFiles(analyzer, [
        "artifacts/api-server/src/**",
      ]),
    ).toEqual([
      "artifacts/api-server/src/routes/a.ts",
      "artifacts/api-server/src/services/b.ts",
      "artifacts/api-server/src/services/e.ts",
      "artifacts/api-server/src/services/c.ts",
      "artifacts/api-server/src/lib/d.ts",
      "artifacts/api-server/src/routes/__tests__/a.test.ts",
    ]);
  });

  it("caps the model-edit allowlist at twelve files", () => {
    const affectedFiles = Array.from(
      { length: 30 },
      (_, index) => `artifacts/api-server/src/file-${index}.ts`,
    );
    const selected = selectWorkstreamAiAllowedFiles(
      { contextPackage: { affectedFiles }, localExecutionPlan: {} },
      ["artifacts/api-server/src/**"],
    );

    expect(selected).toHaveLength(12);
    expect(new Set(selected).size).toBe(12);
  });
});
