import { describe, expect, it } from "vitest";
import {
  buildCodingWorkstreamReviewModel,
  codingWorkstreamReviewCanApproveAiPatch,
} from "./codingWorkstreamReviewModel";

describe("coding workstream review model", () => {
  it("builds a complete AI candidate review surface from persisted execution metadata", () => {
    const model = buildCodingWorkstreamReviewModel({
      workstreamAiExecution: {
        status: "CANDIDATE_READY",
        reviewStatus: "PENDING",
        executionId: "exec-1",
        proposalSummary: "Update the bounded payment route.",
        proposalRationale: "The analyzer identified the exact failing branch.",
        provider: "openai",
        model: "gpt-code",
        policyStatus: "PASSED",
        changedFiles: ["src/payments.ts"],
        patch: "diff --git a/src/payments.ts b/src/payments.ts\n+fixed",
        patchSha256: "a".repeat(64),
        resultSha256: "b".repeat(64),
        warnings: ["review exact payment semantics"],
        scriptsExecuted: false,
        networkUsed: false,
        commitCreated: false,
        pushed: false,
        modelInvoked: true,
        privilegeEnded: true,
        metadata: {
          latencyMs: 123,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      },
    });

    expect(model).toMatchObject({
      kind: "AI_CANDIDATE",
      policyStatus: "PASSED",
      changedFiles: ["src/payments.ts"],
      latencyMs: 123,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      completeForReview: true,
    });
    expect(codingWorkstreamReviewCanApproveAiPatch(model)).toBe(true);
  });

  it("blocks AI approval when the visible review material is incomplete", () => {
    const model = buildCodingWorkstreamReviewModel({
      workstreamAiExecution: {
        status: "CANDIDATE_READY",
        reviewStatus: "PENDING",
        policyStatus: "PASSED",
        changedFiles: ["src/a.ts"],
        patchSha256: "a".repeat(64),
        resultSha256: "b".repeat(64),
        scriptsExecuted: false,
        networkUsed: false,
        commitCreated: false,
        pushed: false,
        modelInvoked: true,
        privilegeEnded: true,
      },
    });

    expect(model?.completeForReview).toBe(false);
    expect(codingWorkstreamReviewCanApproveAiPatch(model)).toBe(false);
  });

  it("blocks AI approval if privileged side effects are not explicitly false", () => {
    const model = buildCodingWorkstreamReviewModel({
      workstreamAiExecution: {
        status: "CANDIDATE_READY",
        reviewStatus: "PENDING",
        policyStatus: "PASSED",
        changedFiles: ["src/a.ts"],
        patch: "diff --git a/src/a.ts b/src/a.ts\n+x",
        patchSha256: "a".repeat(64),
        resultSha256: "b".repeat(64),
        scriptsExecuted: true,
        networkUsed: false,
        commitCreated: false,
        pushed: false,
        modelInvoked: true,
        privilegeEnded: true,
      },
    });

    expect(model?.completeForReview).toBe(false);
    expect(codingWorkstreamReviewCanApproveAiPatch(model)).toBe(false);
  });

  it("recognizes approved AI candidates but does not expose another approval action", () => {
    const model = buildCodingWorkstreamReviewModel({
      workstreamAiExecution: {
        status: "CANDIDATE_READY",
        reviewStatus: "APPROVED",
        policyStatus: "PASSED",
        changedFiles: ["src/a.ts"],
        patch: "diff --git a/src/a.ts b/src/a.ts\n+x",
        patchSha256: "a".repeat(64),
        resultSha256: "b".repeat(64),
        scriptsExecuted: false,
        networkUsed: false,
        commitCreated: false,
        pushed: false,
        modelInvoked: true,
        privilegeEnded: true,
      },
    });

    expect(model?.completeForReview).toBe(true);
    expect(codingWorkstreamReviewCanApproveAiPatch(model)).toBe(false);
  });

  it("builds deterministic local review material without treating it as an AI approval", () => {
    const model = buildCodingWorkstreamReviewModel({
      localExecution: {
        status: "APPLIED",
        changedFiles: ["src/local.ts"],
        patch: "diff --git a/src/local.ts b/src/local.ts\n+local",
        patchSha256: "c".repeat(64),
        resultSha256: "d".repeat(64),
        warnings: [],
      },
    });

    expect(model).toMatchObject({
      kind: "LOCAL_DETERMINISTIC",
      completeForReview: true,
      changedFiles: ["src/local.ts"],
    });
    expect(codingWorkstreamReviewCanApproveAiPatch(model)).toBe(false);
  });
});
