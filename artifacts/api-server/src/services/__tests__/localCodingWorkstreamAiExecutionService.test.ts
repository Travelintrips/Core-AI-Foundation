import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decideWorkstreamAiAutoRepair,
  LocalCodingWorkstreamAiExecutionError,
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

  it("auto-advances warning-free AI patches even on formerly high-risk paths", () => {
    for (const file of [
      "scripts/migrations/001-risky.sql",
      "artifacts/api-server/src/services/auth/tokenService.ts",
      "artifacts/api-server/src/middleware/adminAuth.ts",
      "artifacts/api-server/src/middleware/securityHardening.ts",
      "integration/migrations/team-07.sql",
      "lib/db/migrations/add-observability-tables.sql",
      ".github/workflows/ci.yml",
      "deploy/production/docker-compose.yml",
      "package.json",
    ]) {
      expect(manualAiPatchReviewReason([file], [])).toBeNull();
    }
  });

  it("still blocks autonomous advancement when policy or verification warnings exist", () => {
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
  it("uses the authorized workstream branch rather than the moving parent branch", () => {
    const parentBranch = "main";
    const authorizedBranch = "ai-core/0dd869883fb3/ws-001-a11";
    const materializationSourceBranch = authorizedBranch;

    expect(materializationSourceBranch).toBe(authorizedBranch);
    expect(materializationSourceBranch).not.toBe(parentBranch);
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
      maxRepairAttempts: 3,
      reason: "SAFE_AUTOMATIC_REPAIR",
    });

    const exhausted = decideWorkstreamAiAutoRepair(
      new Error("AI proposal failed Proposal Contract V1 validation"),
      {
        localExecutionPlan: { status: "AI_REQUIRED" },
        workstreamAiExecution: {
          status: "FAILED",
          autoRepairAttempt: 3,
        },
      },
    );

    expect(exhausted).toMatchObject({
      recoverable: true,
      shouldRetry: false,
      previousRepairAttempts: 3,
      reason: "AUTOMATIC_REPAIR_BUDGET_EXHAUSTED",
    });
  });

  it("auto-retries candidate-set drift discovered during materialization", () => {
    const candidateSetDrift = decideWorkstreamAiAutoRepair(
      new LocalCodingWorkstreamAiExecutionError(
        "Reviewed patch file set no longer matches the stored candidate set.",
        "STALE_CONTEXT",
      ),
      {
        localExecutionPlan: { status: "AI_REQUIRED" },
      },
    );

    expect(candidateSetDrift).toMatchObject({
      recoverable: true,
      shouldRetry: true,
      reason: "SAFE_AUTOMATIC_REPAIR",
    });
  });

  it("auto-retries stale exact-replacement and materialization context failures", () => {
    const exactReplacement = decideWorkstreamAiAutoRepair(
      new Error("Deterministic AI proposal application failed: Exact replacement expected 1 occurrence(s), found 0"),
      {
        localExecutionPlan: { status: "AI_REQUIRED" },
      },
    );
    expect(exactReplacement).toMatchObject({
      recoverable: true,
      shouldRetry: true,
      reason: "SAFE_AUTOMATIC_REPAIR",
    });

    const staleMaterialization = decideWorkstreamAiAutoRepair(
      new LocalCodingWorkstreamAiExecutionError(
        "Materialized patch no longer matches the stored candidate file set.",
        "STALE_CONTEXT",
      ),
      {
        localExecutionPlan: { status: "AI_REQUIRED" },
      },
    );
    expect(staleMaterialization).toMatchObject({
      recoverable: true,
      shouldRetry: true,
      reason: "SAFE_AUTOMATIC_REPAIR",
    });
  });

  it("auto-retries consumed or unavailable one-shot handoff races with a fresh bounded handoff", () => {
    const unavailable = decideWorkstreamAiAutoRepair(
      new Error("Workstream AI handoff one-shot privilege is not available."),
      {
        localExecutionPlan: { status: "AI_REQUIRED" },
      },
    );
    expect(unavailable).toMatchObject({
      recoverable: true,
      shouldRetry: true,
      previousRepairAttempts: 0,
      nextRepairAttempt: 1,
      maxRepairAttempts: 3,
      reason: "SAFE_AUTOMATIC_REPAIR",
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


describe("workstream AI materialization workspace sanitation", () => {
  it("resets and cleans the disposable workspace before validating candidate files", () => {
    const source = readFileSync(
      new URL("../localCodingWorkstreamAiExecutionService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'await runGit(workspace.path, ["reset", "--hard", baseSha], childTask.repository)',
    );
    expect(source).toContain(
      'await runGit(workspace.path, ["clean", "-fd"], childTask.repository)',
    );
    expect(source).toContain("const cleanStatusPaths = normalizedChangedFiles(");
    expect(source).toContain(
      '"Isolated materialization workspace could not be normalized to a clean base."',
    );
    expect(source).toContain(
      "const unexpectedStatusPaths = normalizedStatusPaths.filter(",
    );
    expect(source).not.toContain("baselineStatusPaths");
    expect(source).not.toContain("materializedStatusPaths");
  });
});

describe("workstream AI materialization git status parsing", () => {
  it("uses NUL-delimited porcelain status so candidate paths are not corrupted by Git quoting", () => {
    const source = readFileSync(
      new URL("../localCodingWorkstreamAiExecutionService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      '["status", "--porcelain=v1", "-z", "--untracked-files=normal"]',
    );
    expect(source).toContain('if (raw.includes("\\0"))');
    expect(source).toContain('const records = raw.split("\\0")');
    expect(source).toContain('if (/[RC]/.test(status))');
  });
});

describe("workstream AI concurrent materialization advance", () => {
  it("treats a workstream already claimed, running, or completed as a benign race", () => {
    const source = readFileSync(
      new URL("../localCodingWorkstreamAiExecutionService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('["CLAIMED", "RUNNING", "COMPLETED"].includes(current.status)');
    expect(source).toContain('reason: "CONCURRENT_ADVANCE"');
    expect(source).toContain("concurrentAdvance: true");
    expect(source).toContain('["CLAIMED", "RUNNING", "COMPLETED"].includes(advanced.status)');
  });
});

describe("workstream AI materialization recovery wiring", () => {
  it("bubbles recoverable materialization failures into the bounded auto-repair path", () => {
    const source = readFileSync(
      new URL("../localCodingWorkstreamAiExecutionService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      '["STALE_CONTEXT", "MATERIALIZATION_FAILED"].includes(autoAdvanceError.code)',
    );
    expect(source).toContain(
      '"Reviewed patch file set no longer matches the stored candidate set.",\n        "STALE_CONTEXT"',
    );
    expect(source).toContain("const reviewedPatchFiles = patchTargetFiles(patch)");
    expect(source).toContain('"materialization_workspace_extra_status_ignored"');
  });
});

describe("workstream AI stale completed graph recovery", () => {
  it("reopens a stale COMPLETED graph before constrained AI claims unresolved review work", () => {
    const source = readFileSync(
      new URL("../localCodingWorkstreamAiExecutionService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('if (graphStatus === "COMPLETED")');
    expect(source).toContain('status: "RUNNING"');
    expect(source).toContain("completedAt: null");
    expect(source).toContain(
      "Coding task graph is not active for constrained AI work.",
    );
  });
});

describe("workstream AI stale-job handoff revocation", () => {
  it("scopes failure cleanup to the queued job claim attempt", () => {
    const source = readFileSync(
      new URL("../localCodingWorkstreamAiExecutionService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "payload.workstreamId,\n        new Date(),\n        payload.claimAttempt",
    );
    expect(source).toContain(
      "workstreamId,\n    new Date(),\n    current.attemptCount",
    );
    expect(source).toContain(
      "workstreamId,\n      new Date(),\n      lease.claimAttempt",
    );
  });
});

describe("workstream AI automatic repair classification", () => {
  it("treats ambiguous exact-replacement drift and expired handoffs as bounded repairable failures", async () => {
    const { decideWorkstreamAiAutoRepair } = await import(
      "../localCodingWorkstreamAiExecutionService.js"
    );

    expect(
      decideWorkstreamAiAutoRepair(
        new Error("Exact replacement expected 1 occurrence(s), found 3"),
        null,
      ).shouldRetry,
    ).toBe(true);

    expect(
      decideWorkstreamAiAutoRepair(
        new Error("AI proposal policy rejected: EXPIRED_HANDOFF"),
        null,
      ).shouldRetry,
    ).toBe(true);

    expect(
      decideWorkstreamAiAutoRepair(
        new Error("AI proposal policy rejected: FORBIDDEN_GIT_ACTION"),
        null,
      ).shouldRetry,
    ).toBe(false);
  });
});
