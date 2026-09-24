import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTransaction = vi.hoisted(() => vi.fn());
const mockSelectFor = vi.hoisted(() => vi.fn());
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockInsertValues = vi.hoisted(() => vi.fn());
const mockInsertReturning = vi.hoisted(() => vi.fn());
const mockUpdateSet = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn());
const mockStartCodingOrchestration = vi.hoisted(() => vi.fn());
const mockApprovePlanAndStartCoding = vi.hoisted(() => vi.fn());
const mockApproveAndValidateLocalPatch = vi.hoisted(() => vi.fn());
const MockLocalPatchApprovalError = vi.hoisted(() => class extends Error {
  constructor(
    message: string,
    readonly kind: "NOT_FOUND" | "NOT_READY" | "STALE_HEAD" | "INVALID_PATCH" | "VERIFICATION_FAILED",
  ) {
    super(message);
  }
});

const selectBuilder = {
  from: vi.fn(() => selectBuilder),
  where: vi.fn(() => selectBuilder),
  for: mockSelectFor,
  limit: mockSelectLimit,
};
const insertBuilder = {
  values: mockInsertValues,
  returning: mockInsertReturning,
};
const updateBuilder = {
  set: mockUpdateSet,
  where: mockUpdateWhere,
};
const transactionDb = {
  select: vi.fn(() => selectBuilder),
  insert: vi.fn(() => insertBuilder),
  update: vi.fn(() => updateBuilder),
};

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  desc: vi.fn(),
  eq: vi.fn((...conditions: unknown[]) => conditions),
}));

vi.mock("@workspace/db", () => ({
  db: {
    transaction: mockTransaction,
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  aiCodeChangesTable: {
    taskId: "codeChanges.taskId",
    createdAt: "codeChanges.createdAt",
  },
  aiCodingRunsTable: {
    id: "codingRuns.id",
    taskId: "codingRuns.taskId",
    status: "codingRuns.status",
    startedAt: "codingRuns.startedAt",
    createdAt: "codingRuns.createdAt",
  },
  aiCodingTasksTable: {
    id: "codingTasks.id",
    createdAt: "codingTasks.createdAt",
  },
}));

vi.mock("../../services/codingOrchestratorService.js", () => ({
  startCodingOrchestration: mockStartCodingOrchestration,
}));

vi.mock("../../services/codingAgentService.js", () => ({
  approvePlanAndStartCoding: mockApprovePlanAndStartCoding,
}));

vi.mock("../../services/localCodingPatchApprovalService.js", () => ({
  approveAndValidateLocalPatch: mockApproveAndValidateLocalPatch,
  LocalPatchApprovalError: MockLocalPatchApprovalError,
}));

const { default: codingWorkspaceRouter } = await import("../coding-workspace.js");

const taskId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

const task = {
  id: taskId,
  taskNumber: "CWS-TEST123",
  projectName: "Test project",
  repository: "owner/repo",
  branch: "main",
  instruction: "Inspect the repository",
  status: "PENDING",
  priority: 50,
  resultSummary: null,
  commitSha: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const run = {
  id: runId,
  taskId,
  agentName: "Coding Orchestrator",
  status: "RUNNING",
  startedAt: new Date("2026-01-01T00:01:00.000Z"),
  finishedAt: null,
  logs: null,
  errorMessage: null,
};

const app = express();
app.use(express.json());
app.use(codingWorkspaceRouter);

describe("AI coding workspace run endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation((callback: (tx: typeof transactionDb) => unknown) => callback(transactionDb));
    mockSelectFor.mockResolvedValue([task]);
    mockSelectLimit.mockResolvedValue([]);
    mockInsertValues.mockReturnValue(insertBuilder);
    mockInsertReturning.mockResolvedValue([run]);
    mockUpdateSet.mockReturnValue(updateBuilder);
    mockUpdateWhere.mockResolvedValue([]);
    mockStartCodingOrchestration.mockResolvedValue({ sessionId: `coding-${runId}` });
    mockApprovePlanAndStartCoding.mockResolvedValue({ ...run, agentName: "Coding Agent" });
    mockApproveAndValidateLocalPatch.mockResolvedValue({
      ...run,
      agentName: "Local Patch Gate",
      status: "COMPLETED",
      finishedAt: new Date("2026-01-01T00:02:00.000Z"),
    });
  });

  it("creates one Coding Orchestrator run and moves the task to ANALYZING atomically", async () => {
    const response = await request(app).post(`/ai/coding/tasks/${taskId}/run`);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "Coding Orchestrator",
      status: "RUNNING",
    });
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledWith({
      taskId,
      agentName: "Coding Orchestrator",
      status: "RUNNING",
      startedAt: expect.any(Date),
    });
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "ANALYZING" });
    expect(mockStartCodingOrchestration).toHaveBeenCalledWith({
      task,
      run,
    });
  });

  it("returns 404 without creating a run when the task does not exist", async () => {
    mockSelectFor.mockResolvedValueOnce([]);

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/run`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Coding task not found" });
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockStartCodingOrchestration).not.toHaveBeenCalled();
  });

  it("returns 409 and preserves history when a RUNNING run already exists", async () => {
    mockSelectLimit.mockResolvedValueOnce([{ id: runId }]);

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/run`);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Coding task already has an active run" });
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockStartCodingOrchestration).not.toHaveBeenCalled();
  });

  it("returns 503 when the Coding Orchestrator cannot start", async () => {
    mockStartCodingOrchestration.mockRejectedValueOnce(new Error("queue unavailable"));

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/run`);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Coding Orchestrator could not be started" });
  });
});

describe("AI coding workspace plan approval endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApprovePlanAndStartCoding.mockResolvedValue({
      ...run,
      agentName: "Coding Agent",
    });
  });

  it("starts the Coding Agent only through explicit plan approval", async () => {
    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-plan`);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "Coding Agent",
      status: "RUNNING",
    });
    expect(mockApprovePlanAndStartCoding).toHaveBeenCalledWith(taskId);
  });

  it("returns 409 when the task is not awaiting plan approval", async () => {
    mockApprovePlanAndStartCoding.mockRejectedValueOnce(
      new Error("Coding task is not awaiting plan approval"),
    );

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-plan`);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Coding task is not awaiting plan approval",
    });
  });

  it("returns 404 when the task does not exist", async () => {
    mockApprovePlanAndStartCoding.mockRejectedValueOnce(new Error("Coding task not found"));

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-plan`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Coding task not found" });
  });
});


describe("AI coding workspace local patch approval endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApproveAndValidateLocalPatch.mockResolvedValue({
      ...run,
      agentName: "Local Patch Gate",
      status: "COMPLETED",
      finishedAt: new Date("2026-01-01T00:02:00.000Z"),
    });
  });

  it("revalidates a deterministic local patch only through explicit approval", async () => {
    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-local-patch`);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "Local Patch Gate",
      status: "COMPLETED",
    });
    expect(mockApproveAndValidateLocalPatch).toHaveBeenCalledWith(taskId);
  });

  it("returns 409 when the local patch is stale against remote HEAD", async () => {
    mockApproveAndValidateLocalPatch.mockRejectedValueOnce(
      new MockLocalPatchApprovalError(
        "Repository HEAD changed; rerun Local Coding Engine before approval",
        "STALE_HEAD",
      ),
    );

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-local-patch`);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/HEAD changed/);
  });

  it("returns 409 when the task is not at the local patch approval gate", async () => {
    mockApproveAndValidateLocalPatch.mockRejectedValueOnce(
      new MockLocalPatchApprovalError(
        "Coding task is not at the REVIEW_LOCAL_PATCH gate",
        "NOT_READY",
      ),
    );

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-local-patch`);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/REVIEW_LOCAL_PATCH/);
  });

  it("returns 422 for an invalid or unverifiable patch", async () => {
    mockApproveAndValidateLocalPatch.mockRejectedValueOnce(
      new MockLocalPatchApprovalError(
        "Local patch headers do not match the recorded changed-file list",
        "INVALID_PATCH",
      ),
    );

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-local-patch`);

    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/headers do not match/);
  });

  it("returns 404 when the coding task does not exist", async () => {
    mockApproveAndValidateLocalPatch.mockRejectedValueOnce(
      new MockLocalPatchApprovalError("Coding task not found", "NOT_FOUND"),
    );

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-local-patch`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Coding task not found" });
  });
});
