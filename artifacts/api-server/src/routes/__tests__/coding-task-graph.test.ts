import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persist: vi.fn(),
  getLatest: vi.fn(),
  approve: vi.fn(),
  start: vi.fn(),
  reconcile: vi.fn(),
  completeManual: vi.fn(),
}));

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
      | "INVALID_PAYLOAD"
      | "OWNERSHIP_VIOLATION"
      | "DISPATCH_FAILED",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

vi.mock("../../services/localCodingTaskGraphService.js", () => ({
  persistCodingTaskGraph: mocks.persist,
  getLatestCodingTaskGraph: mocks.getLatest,
  approveCodingTaskGraph: mocks.approve,
  LocalCodingTaskGraphError: MockTaskGraphError,
}));

vi.mock("../../services/localCodingMultiWorkerOrchestratorService.js", () => ({
  startApprovedCodingTaskGraph: mocks.start,
  reconcileCodingTaskGraph: mocks.reconcile,
  completeManualCodingWorkstream: mocks.completeManual,
  LocalCodingMultiWorkerError: MockMultiWorkerError,
}));

import router from "../coding-task-graph.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const GRAPH_ID = "22222222-2222-4222-8222-222222222222";
const WS_ID = "33333333-3333-4333-8333-333333333333";

const app = express();
app.use(express.json());
app.use(router);

describe("coding task graph control API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLatest.mockResolvedValue({
      graph: { id: GRAPH_ID, taskId: TASK_ID, status: "PREPARED" },
      workstreams: [],
    });
    mocks.persist.mockResolvedValue({
      created: true,
      graph: { id: GRAPH_ID, taskId: TASK_ID, status: "PREPARED" },
    });
    mocks.approve.mockResolvedValue({
      id: GRAPH_ID,
      taskId: TASK_ID,
      status: "APPROVED",
    });
    mocks.start.mockResolvedValue({
      graphId: GRAPH_ID,
      graphStatus: "RUNNING",
      dispatched: [],
      manualReview: [],
    });
    mocks.reconcile.mockResolvedValue({
      graphId: GRAPH_ID,
      graphStatus: "RUNNING",
      dispatched: [],
      manualReview: [],
    });
  });

  it("persists a validated plan and returns the durable snapshot", async () => {
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
    expect(response.body).toMatchObject({
      created: true,
      graph: { id: GRAPH_ID, status: "PREPARED" },
    });
  });

  it("requires explicit approval before starting multi-worker execution", async () => {
    mocks.start.mockRejectedValueOnce(
      new MockMultiWorkerError(
        "Multi-worker execution requires an explicitly APPROVED task graph.",
        "NOT_READY",
      ),
    );

    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph/start`)
      .send({ maxParallel: 4 });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "NOT_READY" });
  });

  it("approves a prepared graph explicitly", async () => {
    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/approve`);

    expect(response.status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledWith(TASK_ID, GRAPH_ID);
    expect(response.body).toMatchObject({ status: "APPROVED" });
  });

  it("starts the approved graph with bounded parallelism", async () => {
    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph/start`)
      .send({ maxParallel: 6 });

    expect(response.status).toBe(202);
    expect(mocks.start).toHaveBeenCalledWith(TASK_ID, 6);
  });

  it("rejects parallelism outside the supported range", async () => {
    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph/start`)
      .send({ maxParallel: 100 });

    expect(response.status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("reconciles child task state and unlocks the next dependency layer", async () => {
    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph/reconcile`)
      .send({ maxParallel: 3 });

    expect(response.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledWith(TASK_ID, 3);
  });

  it("completes a manual integration workstream only through its explicit endpoint", async () => {
    const response = await request(app)
      .post(
        `/ai/coding/tasks/${TASK_ID}/task-graph/workstreams/${WS_ID}/complete`,
      );

    expect(response.status).toBe(200);
    expect(mocks.completeManual).toHaveBeenCalledWith(TASK_ID, WS_ID);
    expect(mocks.reconcile).toHaveBeenCalledWith(TASK_ID);
  });

  it("returns the current graph snapshot for the control tower", async () => {
    const response = await request(app).get(
      `/ai/coding/tasks/${TASK_ID}/task-graph`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      graph: { id: GRAPH_ID, status: "PREPARED" },
    });
  });
});
