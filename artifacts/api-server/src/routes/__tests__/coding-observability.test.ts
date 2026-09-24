import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTaskObservability: vi.fn(),
}));

vi.mock("../../services/localCodingAiObservabilityService.js", () => ({
  getCodingAiTaskObservability: mocks.getTaskObservability,
}));

import router from "../coding-observability.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

const app = express();
app.use(express.json());
app.use(router);

describe("coding AI observability route", () => {
  it("returns task-scoped constrained AI telemetry", async () => {
    mocks.getTaskObservability.mockResolvedValueOnce({
      taskId: TASK_ID,
      latest: {
        taskId: TASK_ID,
        executionId: "exec-1",
        status: "PROPOSAL_APPLIED",
        provider: "openai",
        model: "gpt-code",
        totalTokens: 123,
        latencyMs: 456,
        estimatedCostUsd: 0.0012,
      },
      executions: [],
      totals: {
        executions: 1,
        successful: 1,
        failed: 0,
        modelInvocations: 1,
        totalTokens: 123,
        totalLatencyMs: 456,
        estimatedCostUsd: 0.0012,
      },
    });

    const response = await request(app).get(
      `/ai/coding/tasks/${TASK_ID}/observability`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      taskId: TASK_ID,
      latest: {
        executionId: "exec-1",
        provider: "openai",
        model: "gpt-code",
      },
      totals: {
        executions: 1,
        totalTokens: 123,
      },
    });
    expect(mocks.getTaskObservability).toHaveBeenCalledWith(TASK_ID);
  });

  it("rejects invalid task IDs", async () => {
    const response = await request(app).get(
      "/ai/coding/tasks/not-a-uuid/observability",
    );
    expect(response.status).toBe(400);
  });
});
