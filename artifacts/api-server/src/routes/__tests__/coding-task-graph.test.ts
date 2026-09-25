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

  class MockWorkstreamHandoffError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly details?: Record<string, unknown>,
    ) {
      super(message);
    }
  }

  class MockWorkstreamAiExecutionError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly details?: Record<string, unknown>,
    ) {
      super(message);
    }
  }

  class MockIntegrationGateError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly details?: Record<string, unknown>,
    ) {
      super(message);
    }
  }

  class MockAutomatedPlannerError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly details?: Record<string, unknown>,
    ) {
      super(message);
    }
  }

  return {
    persist: vi.fn(),
    latest: vi.fn(),
    approve: vi.fn(),
    generate: vi.fn(),
    dispatch: vi.fn(),
    completeReviewed: vi.fn(),
    prepareAiHandoff: vi.fn(),
    approveAiHandoff: vi.fn(),
    revokeAiHandoff: vi.fn(),
    enqueueAi: vi.fn(),
    approveAiPatch: vi.fn(),
    buildIntegrationManifest: vi.fn(),
    MockIntegrationGateError,
    MockTaskGraphError,
    MockMultiWorkerError,
    MockWorkstreamHandoffError,
    MockWorkstreamAiExecutionError,
    MockAutomatedPlannerError,
  };
});

vi.mock("../../services/localCodingTaskGraphService.js", () => ({
  persistCodingTaskGraph: mocks.persist,
  getLatestCodingTaskGraph: mocks.latest,
  approveCodingTaskGraph: mocks.approve,
  LocalCodingTaskGraphError: mocks.MockTaskGraphError,
}));

vi.mock("../../services/localCodingAutomatedMultiTaskPlannerService.js", () => ({
  generateAndPersistCodingMultiTaskPlan: mocks.generate,
  AutomatedMultiTaskPlannerError: mocks.MockAutomatedPlannerError,
}));

vi.mock("../../services/localCodingMultiWorkerOrchestratorService.js", () => ({
  completeReviewedCodingWorkstream: mocks.completeReviewed,
  LocalCodingMultiWorkerError: mocks.MockMultiWorkerError,
}));

vi.mock("../../services/localCodingMultiWorkerExecutionService.js", () => ({
  dispatchReadyCodingWorkstreams: mocks.dispatch,
}));

vi.mock("../../services/localCodingMultiWorkerIntegrationGateService.js", () => ({
  buildCodingIntegrationManifest: mocks.buildIntegrationManifest,
  CodingIntegrationGateError: mocks.MockIntegrationGateError,
}));

vi.mock("../../services/localCodingWorkstreamAiHandoffService.js", () => ({
  LocalCodingWorkstreamAiHandoffError: mocks.MockWorkstreamHandoffError,
}));

vi.mock("../../services/localCodingWorkstreamAiExecutionService.js", () => ({
  prepareWorkstreamAiExecutionHandoff: mocks.prepareAiHandoff,
  approveWorkstreamAiExecutionHandoff: mocks.approveAiHandoff,
  revokeWorkstreamAiExecutionHandoff: mocks.revokeAiHandoff,
  enqueueWorkstreamAiExecution: mocks.enqueueAi,
  approveWorkstreamAiCandidatePatch: mocks.approveAiPatch,
  LocalCodingWorkstreamAiExecutionError: mocks.MockWorkstreamAiExecutionError,
}));

import router from "../coding-task-graph.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const GRAPH_ID = "22222222-2222-4222-8222-222222222222";
const WS_ID = "33333333-3333-4333-8333-333333333333";
const HANDOFF_ID = "44444444-4444-4444-8444-444444444444";
const BASE_SHA = "a".repeat(40);
const PACKAGE_HASH = "b".repeat(64);

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
    mocks.generate.mockResolvedValue({
      created: true,
      graphId: GRAPH_ID,
      graphVersion: 1,
      planHash: "f".repeat(64),
      graphStatus: "PREPARED",
      plan: {
        version: 1,
        taskId: TASK_ID,
        objective: "Parallel implementation",
        workstreams: [],
      },
      model: {
        provider: "fake-provider",
        model: "fake-model",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        latencyMs: 25,
      },
      nextAction: "APPROVE_TASK_GRAPH",
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
    mocks.prepareAiHandoff.mockResolvedValue({
      handoffId: HANDOFF_ID,
      packageHash: PACKAGE_HASH,
      status: "PREPARED",
      claimAttempt: 2,
      branchName: "ai-core/task/ws-001-a2",
      leaseExpiresAt: "2026-09-25T01:00:00.000Z",
      package: { version: 1 },
    });
    mocks.approveAiHandoff.mockResolvedValue({
      handoffId: HANDOFF_ID,
      workstreamId: WS_ID,
      graphId: GRAPH_ID,
      claimAttempt: 2,
      packageHash: PACKAGE_HASH,
      approvedAt: "2026-09-25T00:00:00.000Z",
      expiresAt: "2026-09-25T00:15:00.000Z",
    });
    mocks.revokeAiHandoff.mockResolvedValue({
      status: "REVOKED",
      revokedAt: "2026-09-25T00:01:00.000Z",
    });
    mocks.enqueueAi.mockResolvedValue({
      id: 91,
      jobCode: "JOB-AI91",
      status: "queued",
    });
    mocks.approveAiPatch.mockResolvedValue({
      id: WS_ID,
      status: "REVIEW_REQUIRED",
      resultJson: {
        workstreamAiExecution: {
          status: "CANDIDATE_READY",
          reviewStatus: "APPROVED",
        },
      },
    });
    mocks.buildIntegrationManifest.mockReturnValue({
      version: 1,
      taskId: TASK_ID,
      graphId: GRAPH_ID,
      graphVersion: 1,
      planHash: "f".repeat(64),
      objective: "Parallel implementation",
      baseSha: BASE_SHA,
      workstreams: [],
      changedFiles: [],
      patchCount: 0,
      manifestHash: "c".repeat(64),
      nextAction: "REVIEW_INTEGRATION_MANIFEST",
      commitCreated: false,
      pushed: false,
      merged: false,
    });
  });

  it("generates and persists a constrained PREPARED multi-task plan", async () => {
    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph/generate`)
      .send({});

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      created: true,
      graphId: GRAPH_ID,
      graphStatus: "PREPARED",
      nextAction: "APPROVE_TASK_GRAPH",
      model: {
        provider: "fake-provider",
        model: "fake-model",
      },
    });
    expect(mocks.generate).toHaveBeenCalledWith(TASK_ID);
  });

  it("returns 409 when repository analysis is not ready for automated planning", async () => {
    mocks.generate.mockRejectedValueOnce(
      new mocks.MockAutomatedPlannerError(
        "Repository analysis must complete first.",
        "ANALYSIS_REQUIRED",
      ),
    );

    const response = await request(app)
      .post(`/ai/coding/tasks/${TASK_ID}/task-graph/generate`)
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ANALYSIS_REQUIRED");
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

  it("prepares a dedicated AI handoff for a graph-owned workstream", async () => {
    const response = await request(app).post(
      `/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/workstreams/${WS_ID}/prepare-ai-handoff`,
    );

    expect(response.status).toBe(201);
    expect(mocks.prepareAiHandoff).toHaveBeenCalledWith(WS_ID);
    expect(response.body).toMatchObject({
      handoffId: HANDOFF_ID,
      packageHash: PACKAGE_HASH,
      status: "PREPARED",
    });
  });

  it("requires explicit approval before workstream AI execution can be queued", async () => {
    const approve = await request(app).post(
      `/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/workstreams/${WS_ID}/ai-handoff/${HANDOFF_ID}/approve`,
    );
    expect(approve.status).toBe(200);
    expect(mocks.approveAiHandoff).toHaveBeenCalledWith(WS_ID, HANDOFF_ID);

    const run = await request(app)
      .post(
        `/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/workstreams/${WS_ID}/run-ai-execution`,
      )
      .send({ expectedPackageHash: PACKAGE_HASH, requestedBy: "control-tower" });

    expect(run.status).toBe(202);
    expect(mocks.enqueueAi).toHaveBeenCalledWith(WS_ID, {
      expectedPackageHash: PACKAGE_HASH,
      requestedBy: "control-tower",
    });
    expect(run.body).toMatchObject({
      jobId: 91,
      nextAction: "AI_EXECUTION_QUEUED",
    });
  });

  it("supports explicit handoff revocation without running a model", async () => {
    const response = await request(app).post(
      `/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/workstreams/${WS_ID}/revoke-ai-handoff`,
    );

    expect(response.status).toBe(200);
    expect(mocks.revokeAiHandoff).toHaveBeenCalledWith(WS_ID);
    expect(response.body).toMatchObject({ status: "REVOKED" });
  });

  it("requires explicit REVIEW_AI_PATCH approval for a workstream candidate", async () => {
    const response = await request(app).post(
      `/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/workstreams/${WS_ID}/approve-ai-patch`,
    );

    expect(response.status).toBe(200);
    expect(mocks.approveAiPatch).toHaveBeenCalledWith(WS_ID);
    expect(response.body.resultJson.workstreamAiExecution).toMatchObject({
      status: "CANDIDATE_READY",
      reviewStatus: "APPROVED",
    });
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

  it("returns a read-only integration manifest for the task-bound graph", async () => {
    const response = await request(app).get(
      `/ai/coding/tasks/${TASK_ID}/task-graph/${GRAPH_ID}/integration-manifest`,
    );

    expect(response.status).toBe(200);
    expect(mocks.buildIntegrationManifest).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({
        graph: expect.objectContaining({ id: GRAPH_ID }),
      }),
    );
    expect(response.body).toMatchObject({
      graphId: GRAPH_ID,
      nextAction: "REVIEW_INTEGRATION_MANIFEST",
      commitCreated: false,
      pushed: false,
      merged: false,
    });
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
