import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockTaskGraphError extends Error {
    constructor(
      message: string,
      readonly code:
        | "TASK_MISMATCH"
        | "ACTIVE_GRAPH_EXISTS"
        | "PERSIST_FAILED"
        | "NOT_FOUND"
        | "NOT_READY",
      readonly details?: Record<string, unknown>,
    ) {
      super(message);
    }
  }

  class MockMultiWorkerError extends Error {
    constructor(
      message: string,
      readonly code:
        | "NOT_FOUND"
        | "NOT_READY"
        | "INVALID_INPUT"
        | "LEASE_LOST"
        | "CLAIM_FAILED",
      readonly details?: Record<string, unknown>,
    ) {
      super(message);
    }
  }

  return {
    persist: vi.fn(),
    latest: vi.fn(),
    approve: vi.fn(),
    dispatch: vi.fn(),
    completeReviewed: vi.fn(),
    MockTaskGraphError,
    MockMultiWorkerError,
  };
});

vi.mock("../../services/localCodingTaskGraphService.js", () => ({
  persistCodingTaskGraph: mocks.persist,
  getLatestCodingTaskGraph: mocks.latest,
  approveCodingTaskGraph: mocks.approve,
  LocalCodingTaskGraphError: mocks.MockTaskGraphError,
}));

vi.mock("../../services/localCodingMultiWorkerOrchestratorService.js", () => ({
  completeReviewedCodingWorkstream: mocks.completeReviewed,
  LocalCodingMultiWorkerError: mocks.MockMultiWorkerError,
}));

vi.mock("../../services/localCodingMultiWorkerExecutionService.js", () => ({
  dispatchReadyCodingWorkstreams: mocks.dispatch,
}));

import router from "../coding-task-graph.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const GRAPH_ID = "22222222-2222-4222-8222-222222222222";
const WS_ID = "33333333-3333-4333-8333-333333333333";
const BASE_SHA = "a".repeat(40);

const app = express();
app.use(express.json());
app.use(router);

describe("multi-worker coding task graph API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.latest.mockResolvedValue({
      graph: {
        id: GRAPH_ID,
        taskId: TASK_ID,
        status: "PREPARED",
      },
      workstreams: [
        {
          id: WS_ID,
          key: "WS-001",
          status: "REVIEW_REQUIRED",
        },
      ],
    });
    mocks.persist.mockResolvedValue({
      created: true,
      graph: {
        id: GRAPH_ID,
        taskId: TASK_ID,
        status: "PREPARED",
      },
    });
    mocks.approve.mockResolvedValue({
      id: GRAPH_ID,
      taskId: TASK_ID,
      status: "APPROVED",
    });
    mocks.dispatch.mockResolvedValue({
      graphId: GRAPH_ID,
      graphStatus: "RUNNING",
      dispatched: [],
      manualReview: [],
    });
    mocks.completeReviewed.mockResolvedValue({
      id: WS_ID,
      status: "COMPLETED",
    });
  });

  it("persists a bounded planner contract and returns the durable snapshot", async () => {
    const plan = {
      version: 1,
      taskId: TASK_ID,
      objective: "Parallel implementation",
      workstreams: [{
        id: "WS-001",
        title: "Backend",
        role: "backend",
        instruction: "Implement backend.",
        dependencies: [],
        ownershipPaths: ["artifacts/api-server/src/example"],
        acceptanceCriteria: ["Tests pass."],
        verificationProfiles: ["unit_tests"],
        priority: 80,
      }],
    };

    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph`)
      .send(plan);

    expect(response.status).toBe(201);
    expect(mocks.persist).toHaveBeenCalledWith(TASK_ID, plan);
  });

  it("approves a prepared graph explicitly", async () => {
    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/approve`);

    expect(response.status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledWith(TASK_ID, GRAPH_ID);
    expect(response.body).toMatchObject({ status: "APPROVED" });
  });

  it("requires a 40-character base SHA to dispatch leased workers", async () => {
    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/dispatch`)
      .send({ maxParallel: 4 });

    expect(response.status).toBe(400);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("dispatches only the graph currently bound to the task", async () => {
    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/dispatch`)
      .send({
        baseSha: BASE_SHA,
        maxParallel: 4,
        leaseSeconds: 120,
        workerPoolId: "coding-pool",
      });

    expect(response.status).toBe(202);
    expect(mocks.dispatch).toHaveBeenCalledWith(GRAPH_ID, {
      baseSha: BASE_SHA,
      maxParallel: 4,
      leaseSeconds: 120,
      workerPoolId: "coding-pool",
    });
  });

  it("rejects a graph id that is not the task's latest durable graph", async () => {
    mocks.latest.mockResolvedValueOnce({
      graph: {
        id: "44444444-4444-4444-8444-444444444444",
        taskId: TASK_ID,
        status: "APPROVED",
      },
      workstreams: [],
    });

    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/dispatch`)
      .send({ baseSha: BASE_SHA });

    expect(response.status).toBe(404);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("completes only a workstream that belongs to the graph snapshot", async () => {
    const response = await request(app)
      .post(
        `/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/workstreams/${WS_ID}/complete`,
      );

    expect(response.status).toBe(200);
    expect(mocks.completeReviewed).toHaveBeenCalledWith(WS_ID);
  });

  it("does not allow cross-graph workstream completion", async () => {
    mocks.latest.mockResolvedValueOnce({
      graph: { id: GRAPH_ID, taskId: TASK_ID, status: "RUNNING" },
      workstreams: [],
    });

    const response = await request(app)
      .post(
        `/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/workstreams/${WS_ID}/complete`,
      );

    expect(response.status).toBe(404);
    expect(mocks.completeReviewed).not.toHaveBeenCalled();
  });

  it("returns the current graph snapshot for the control tower", async () => {
    const response = await request(app).get(
      `/ai/coding/tasks/${TASK_ID}/task-graph`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      graph: { id: GRAPH_ID },
      workstreams: [expect.objectContaining({ id: WS_ID })],
    });
  });
});
