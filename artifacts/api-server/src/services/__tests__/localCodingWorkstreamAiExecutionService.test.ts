import { describe, expect, it } from "vitest";
import {
  buildWorkstreamMaterializationClonePlan,
  decideWorkstreamAiAutoRepair,
  hashWorkstreamAnalyzerResult,
  manualAiPatchReviewReason,
  normalizeWorkstreamGitHeadOutput,
  parseWorkstreamAiJobPayload,
  selectWorkstreamAiAllowedFiles,
} from "../localCodingWorkstreamAiExecutionService.js";

const GRAPH_ID = "11111111-1111-4111-8111-111111111111";
const WORKSTREAM_ID = "22222222-2222-4222-8222-222222222222";
const CHILD_TASK_ID = "33333333-3333-4333-8333-333333333333";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("per-workstream constrained AI execution contract", () => {
  it("fails closed instead of trimming undefined git HEAD output", () => {
    expect(() => normalizeWorkstreamGitHeadOutput(undefined)).toThrow(
      /Repository HEAD could not be resolved/,
    );
    expect(
      normalizeWorkstreamGitHeadOutput(Buffer.from("a".repeat(40) + "\n")),
    ).toBe("a".repeat(40));
  });

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

  it("includes an exact owned target even when the analyzer has no concrete file yet", () => {
    const selected = selectWorkstreamAiAllowedFiles(
      {
        contextPackage: { affectedFiles: [], relevantFiles: [] },
        localExecutionPlan: { targetFiles: [] },
      },
      ["docs/ollama-local-smoke-test-8b.md"],
    );

    expect(selected).toEqual(["docs/ollama-local-smoke-test-8b.md"]);
  });

  it("ignores malformed non-string ownership paths instead of crashing", () => {
    const selected = selectWorkstreamAiAllowedFiles(
      {
        contextPackage: {
          affectedFiles: ["src/a.ts"],
          relevantFiles: [{ path: "src/a.ts" }],
        },
        localExecutionPlan: { targetFiles: [] },
      },
      [undefined as unknown as string, null as unknown as string, "src/a.ts"],
    );

    expect(selected).toEqual(["src/a.ts"]);
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


  it("auto-advances ordinary warning-free AI patches", () => {
    expect(
      manualAiPatchReviewReason(
        [
          "artifacts/api-server/src/services/exampleService.ts",
          "artifacts/api-server/src/routes/example.ts",
        ],
        [],
      ),
    ).toBeNull();
  });

  it("keeps high-risk or warned AI patches behind manual review", () => {
    expect(
      manualAiPatchReviewReason(
        ["scripts/migrations/001-risky.sql"],
        [],
      ),
    ).toMatch(/high-risk path/i);

    expect(
      manualAiPatchReviewReason(
        ["artifacts/api-server/src/services/auth/tokenService.ts"],
        [],
      ),
    ).toMatch(/high-risk path/i);

    expect(
      manualAiPatchReviewReason(
        ["artifacts/api-server/src/middleware/adminAuth.ts"],
        [],
      ),
    ).toMatch(/high-risk path/i);

    expect(
      manualAiPatchReviewReason(
        ["artifacts/api-server/src/middleware/securityHardening.ts"],
        [],
      ),
    ).toMatch(/high-risk path/i);

    expect(
      manualAiPatchReviewReason(
        ["integration/migrations/team-07.sql"],
        [],
      ),
    ).toMatch(/high-risk path/i);

    expect(
      manualAiPatchReviewReason(
        ["lib/db/migrations/add-observability-tables.sql"],
        [],
      ),
    ).toMatch(/high-risk path/i);

    expect(
      manualAiPatchReviewReason(
        ["artifacts/api-server/src/services/exampleService.ts"],
        ["verification warning"],
      ),
    ).toMatch(/warnings/i);
  });
});


describe("workstream AI isolated branch binding", () => {
  it("uses the isolated workstream branch for analyzer binding after child tasks stay on the remote source branch", () => {
    const childTaskBranch = "main";
    const workstreamBranch = "ai-core/0dd869883fb3/ws-001-a2";
    const expectedAnalyzerBranch = workstreamBranch || childTaskBranch;

    expect(expectedAnalyzerBranch).toBe("ai-core/0dd869883fb3/ws-001-a2");
    expect(expectedAnalyzerBranch).not.toBe(childTaskBranch);
  });

});


describe("approved workstream candidate materialization branch binding", () => {
  it("clones the real remote source branch and recreates the authorized synthetic branch locally", () => {
    expect(
      buildWorkstreamMaterializationClonePlan({
        parentBranch: "main",
        authorizedBranch: "ai-core/0dd869883fb3/ws-001-a11",
      }),
    ).toEqual({
      sourceBranch: "main",
      isolatedBranchName: "ai-core/0dd869883fb3/ws-001-a11",
    });
  });

  it("uses the real CI repair branch when the authorized branch already exists remotely", () => {
    expect(
      buildWorkstreamMaterializationClonePlan({
        parentBranch: "main",
        authorizedBranch: "fix/ci-repair",
        ciRepairBranch: "fix/ci-repair",
      }),
    ).toEqual({
      sourceBranch: "fix/ci-repair",
      isolatedBranchName: "fix/ci-repair",
    });
  });
});

describe("workstream AI failure context preservation", () => {
  it("retains analyzer state when execution fails before loadExecutionContext completes", () => {
    const analyzerResult = {
      codingTaskId: "child-task",
      localExecutionPlan: { status: "AI_REQUIRED" },
      contextPackage: { branch: "ai-core/task/ws-001-a3" },
    };
    const persisted = {
      ...analyzerResult,
      workstreamAiExecution: { status: "FAILED", nextAction: "AI_REQUIRED" },
    };

    expect(persisted.localExecutionPlan).toEqual({ status: "AI_REQUIRED" });
    expect(persisted.contextPackage).toEqual({ branch: "ai-core/task/ws-001-a3" });
    expect(persisted.workstreamAiExecution).toMatchObject({ status: "FAILED" });
  });

  it("auto-retries Proposal Contract formatting failures with a bounded budget", () => {
    const first = decideWorkstreamAiAutoRepair(
      new Error(
        "AI proposal failed Proposal Contract V1 validation after bounded schema repair: AI proposal output must be raw JSON only",
      ),
      {
        localExecutionPlan: { status: "AI_REQUIRED" },
      },
    );

    expect(first).toMatchObject({
      recoverable: true,
      shouldRetry: true,
      previousRepairAttempts: 0,
      nextRepairAttempt: 1,
      maxRepairAttempts: 2,
      reason: "SAFE_AUTOMATIC_REPAIR",
    });

    const exhausted = decideWorkstreamAiAutoRepair(
      new Error("AI proposal failed Proposal Contract V1 validation"),
      {
        localExecutionPlan: { status: "AI_REQUIRED" },
        workstreamAiExecution: {
          status: "FAILED",
          autoRepairAttempt: 2,
        },
      },
    );

    expect(exhausted).toMatchObject({
      recoverable: true,
      shouldRetry: false,
      previousRepairAttempts: 2,
      reason: "AUTOMATIC_REPAIR_BUDGET_EXHAUSTED",
    });
  });

  it("does not auto-retry policy violations", () => {
    const decision = decideWorkstreamAiAutoRepair(
      new Error("AI candidate patch escaped its workstream ownership boundary."),
      {
        localExecutionPlan: { status: "AI_REQUIRED" },
      },
    );

    expect(decision).toMatchObject({
      recoverable: false,
      shouldRetry: false,
      reason: "NON_RETRYABLE_FAILURE",
    });
  });
});
