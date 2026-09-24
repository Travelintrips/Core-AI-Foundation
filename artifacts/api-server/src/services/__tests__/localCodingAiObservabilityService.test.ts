import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pricing: {
    inputPer1m: 2,
    outputPer1m: 8,
    cachedPer1m: null,
    reasoningPer1m: null,
  },
}));

vi.mock("../observabilityService.js", () => ({
  getPricingForModel: vi.fn(async () => mocks.pricing),
}));

vi.mock("@workspace/db", () => ({
  aiCodingRunsTable: { taskId: {}, startedAt: {} },
  db: {},
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((value) => value),
  eq: vi.fn(() => ({})),
}));

import {
  parseCodingAiExecutionTelemetry,
  summarizeCodingAiTelemetry,
} from "../localCodingAiObservabilityService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

function run(logs: Record<string, unknown>, errorMessage: string | null = null) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    logs: JSON.stringify(logs),
    errorMessage,
  };
}

describe("AI coding observability telemetry", () => {
  beforeEach(() => {
    mocks.pricing = {
      inputPer1m: 2,
      outputPer1m: 8,
      cachedPer1m: null,
      reasoningPer1m: null,
    };
  });

  it("parses canonical successful constrained execution payload", async () => {
    const telemetry = await parseCodingAiExecutionTelemetry(
      TASK_ID,
      run({
        aiHandoff: {
          packageHash: "a".repeat(64),
          modelInvoked: true,
          gateStatus: "PRIVILEGE_ENDED",
        },
        aiExecution: {
          status: "PROPOSAL_APPLIED",
          executionId: "exec-1",
          proposalHash: "b".repeat(64),
          policyStatus: "PASSED",
          candidatePatchSha256: "c".repeat(64),
          resultSha256: "d".repeat(64),
          changedFiles: ["src/a.ts", "src/b.ts"],
          modelInvoked: true,
          privilegeEnded: true,
          completedAt: "2026-09-24T12:00:01.000Z",
          metadata: {
            provider: "openai",
            model: "gpt-code",
            latencyMs: 1250,
            attempts: 1,
            retries: 0,
            fallbackUsed: false,
            timeoutMs: 45000,
            maxOutputTokens: 4096,
            usage: {
              inputTokens: 1000,
              outputTokens: 500,
              totalTokens: 1500,
            },
          },
        },
        orchestration: {
          nextAction: "REVIEW_AI_PATCH",
        },
      }),
    );

    expect(telemetry).toMatchObject({
      taskId: TASK_ID,
      executionId: "exec-1",
      status: "PROPOSAL_APPLIED",
      nextAction: "REVIEW_AI_PATCH",
      provider: "openai",
      model: "gpt-code",
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      latencyMs: 1250,
      changedFiles: ["src/a.ts", "src/b.ts"],
      policyStatus: "PASSED",
      modelInvoked: true,
      privilegeEnded: true,
      attempts: 1,
      retries: 0,
      fallbackUsed: false,
    });
    expect(telemetry?.estimatedCostUsd).toBeCloseTo(0.006);
  });

  it("parses failed execution without inventing token or cost values", async () => {
    const telemetry = await parseCodingAiExecutionTelemetry(
      TASK_ID,
      run(
        {
          aiExecution: {
            status: "FAILED",
            executionId: "exec-fail",
            errorKind: "MODEL_FAILED",
            errorMessage: "provider unavailable",
            modelInvoked: true,
            privilegeEnded: true,
          },
          orchestration: { nextAction: "AI_REQUIRED" },
        },
        "provider unavailable",
      ),
    );

    expect(telemetry).toMatchObject({
      status: "FAILED",
      failureKind: "MODEL_FAILED",
      errorMessage: "provider unavailable",
      totalTokens: 0,
      estimatedCostUsd: null,
      nextAction: "AI_REQUIRED",
    });
  });

  it("returns null for malformed non-observability logs", async () => {
    await expect(
      parseCodingAiExecutionTelemetry(TASK_ID, {
        id: "run",
        logs: "{bad-json",
        errorMessage: null,
      }),
    ).resolves.toBeNull();
  });

  it("summarizes executions without changing execution state", () => {
    const summary = summarizeCodingAiTelemetry(TASK_ID, [
      {
        taskId: TASK_ID,
        executionId: "e2",
        runId: "r2",
        status: "FAILED",
        nextAction: "AI_REQUIRED",
        provider: "openai",
        model: "gpt-code",
        inputTokens: 200,
        outputTokens: 50,
        totalTokens: 250,
        latencyMs: 100,
        packageHash: null,
        proposalHash: null,
        candidatePatchSha256: null,
        resultSha256: null,
        changedFiles: [],
        policyStatus: null,
        modelInvoked: true,
        privilegeEnded: true,
        attempts: 1,
        retries: 0,
        fallbackUsed: false,
        timeoutMs: 45000,
        maxOutputTokens: 4096,
        failureKind: "MODEL_FAILED",
        errorMessage: "boom",
        completedAt: null,
        estimatedCostUsd: 0.001,
      },
      {
        taskId: TASK_ID,
        executionId: "e1",
        runId: "r1",
        status: "PROPOSAL_APPLIED",
        nextAction: "REVIEW_AI_PATCH",
        provider: "openai",
        model: "gpt-code",
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
        latencyMs: 50,
        packageHash: null,
        proposalHash: null,
        candidatePatchSha256: null,
        resultSha256: null,
        changedFiles: ["src/a.ts"],
        policyStatus: "PASSED",
        modelInvoked: true,
        privilegeEnded: true,
        attempts: 1,
        retries: 0,
        fallbackUsed: false,
        timeoutMs: 45000,
        maxOutputTokens: 4096,
        failureKind: null,
        errorMessage: null,
        completedAt: null,
        estimatedCostUsd: 0.0005,
      },
    ]);

    expect(summary.latest?.executionId).toBe("e2");
    expect(summary.totals).toEqual({
      executions: 2,
      successful: 1,
      failed: 1,
      modelInvocations: 2,
      totalTokens: 375,
      totalLatencyMs: 150,
      estimatedCostUsd: 0.0015,
    });
  });
});
