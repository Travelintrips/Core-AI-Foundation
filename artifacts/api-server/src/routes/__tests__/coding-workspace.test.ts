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
const mockStartSandboxVerification = vi.hoisted(() => vi.fn());
const mockStartDeterministicLocalRecovery = vi.hoisted(() => vi.fn());
const mockStartAiHandoffPreparation = vi.hoisted(() => vi.fn());
const mockApproveAiHandoff = vi.hoisted(() => vi.fn());
const mockRevokeAiHandoff = vi.hoisted(() => vi.fn());
const mockAssertApprovedAiHandoffFresh = vi.hoisted(() => vi.fn());
const mockEnqueueCodingAiExecution = vi.hoisted(() => vi.fn());
const mockGetLatestCodingAiExecutionJob = vi.hoisted(() => vi.fn());
const mockApproveAndValidateAiPatch = vi.hoisted(() => vi.fn());
const mockApproveCommitAndCreatePullRequest = vi.hoisted(() => vi.fn());
const mockStartPullRequestVerification = vi.hoisted(() => vi.fn());
const mockApproveAndMergePullRequest = vi.hoisted(() => vi.fn());
const MockLocalPatchApprovalError = vi.hoisted(() => class extends Error {
  constructor(
    message: string,
    readonly kind: "NOT_FOUND" | "NOT_READY" | "STALE_HEAD" | "INVALID_PATCH" | "VERIFICATION_FAILED",
  ) {
    super(message);
  }
});
const MockLocalCodingSandboxGateError = vi.hoisted(() => class extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_HEAD"
      | "INVALID_PATCH"
      | "VERIFICATION_FAILED"
      | "SANDBOX_BLOCKED",
  ) {
    super(message);
  }
});
const MockLocalDeterministicRecoveryError = vi.hoisted(() => class extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_HEAD"
      | "INVALID_CONTEXT"
      | "SANDBOX_BLOCKED"
      | "RECOVERY_FAILED",
  ) {
    super(message);
  }
});
const MockLocalAiHandoffError = vi.hoisted(() => class extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_HEAD"
      | "INVALID_CONTEXT"
      | "APPROVAL_FAILED"
      | "EXPIRED"
      | "REVOKED",
  ) {
    super(message);
  }
});
const MockLocalCodingAiExecutionGateError = vi.hoisted(() => class extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "EXPIRED"
      | "REVOKED"
      | "STALE_HEAD"
      | "INVALID_CONTEXT"
      | "MODEL_UNAVAILABLE"
      | "MODEL_FAILED"
      | "INVALID_PROPOSAL"
      | "POLICY_REJECTED"
      | "APPLY_FAILED",
  ) {
    super(message);
  }
});
const MockLocalAiPatchApprovalError = vi.hoisted(() => class extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_HEAD"
      | "INVALID_PATCH"
      | "VERIFICATION_FAILED",
  ) {
    super(message);
  }
});
const MockLocalPullRequestGateError = vi.hoisted(() => class extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "GITHUB_AUTH"
      | "INVALID_CONTEXT"
      | "CHECKS_PENDING"
      | "CHECKS_FAILED"
      | "STALE_PR"
      | "MERGE_FAILED",
  ) {
    super(message);
  }
});
const MockLocalCommitApprovalError = vi.hoisted(() => class extends Error {
  constructor(
    message: string,
    readonly kind:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_HEAD"
      | "INVALID_PATCH"
      | "VERIFICATION_FAILED"
      | "GITHUB_AUTH"
      | "PUBLISH_FAILED",
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

vi.mock("../../services/localCodingCommitApprovalService.js", () => ({
  approveCommitAndCreatePullRequest: mockApproveCommitAndCreatePullRequest,
  LocalCommitApprovalError: MockLocalCommitApprovalError,
}));

vi.mock("../../services/localCodingSandboxGateService.js", () => ({
  startSandboxVerification: mockStartSandboxVerification,
  LocalCodingSandboxGateError: MockLocalCodingSandboxGateError,
}));

vi.mock("../../services/localCodingDeterministicRecoveryService.js", () => ({
  startDeterministicLocalRecovery: mockStartDeterministicLocalRecovery,
  LocalDeterministicRecoveryError: MockLocalDeterministicRecoveryError,
}));

vi.mock("../../services/localCodingAiHandoffService.js", () => ({
  startAiHandoffPreparation: mockStartAiHandoffPreparation,
  approveAiHandoff: mockApproveAiHandoff,
  assertApprovedAiHandoffFresh: mockAssertApprovedAiHandoffFresh,
  revokeAiHandoff: mockRevokeAiHandoff,
  LocalAiHandoffError: MockLocalAiHandoffError,
}));

vi.mock("../../services/localCodingAiQueueRuntimeService.js", () => ({
  enqueueCodingAiExecution: mockEnqueueCodingAiExecution,
  getLatestCodingAiExecutionJob: mockGetLatestCodingAiExecutionJob,
}));

vi.mock("../../services/localCodingAiPatchApprovalService.js", () => ({
  approveAndValidateAiPatch: mockApproveAndValidateAiPatch,
  LocalAiPatchApprovalError: MockLocalAiPatchApprovalError,
}));

vi.mock("../../services/localCodingPullRequestGateService.js", () => ({
  startPullRequestVerification: mockStartPullRequestVerification,
  approveAndMergePullRequest: mockApproveAndMergePullRequest,
  LocalPullRequestGateError: MockLocalPullRequestGateError,
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
    mockStartSandboxVerification.mockResolvedValue({
      ...run,
      agentName: "Sandbox Verification",
      status: "RUNNING",
    });
    mockApproveCommitAndCreatePullRequest.mockResolvedValue({
      ...run,
      agentName: "Local Commit Gate",
      status: "RUNNING",
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


describe("AI coding workspace sandbox verification endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartSandboxVerification.mockResolvedValue({
      ...run,
      agentName: "Sandbox Verification",
      status: "RUNNING",
    });
  });

  it("starts sandbox verification only through the explicit verification gate", async () => {
    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/run-sandbox-verification`,
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "Sandbox Verification",
      status: "RUNNING",
    });
    expect(mockStartSandboxVerification).toHaveBeenCalledWith(taskId);
  });

  it("returns 409 when the task is not at RUN_SANDBOX_VERIFICATION", async () => {
    mockStartSandboxVerification.mockRejectedValueOnce(
      new MockLocalCodingSandboxGateError(
        "Coding task is not at the RUN_SANDBOX_VERIFICATION gate",
        "NOT_READY",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/run-sandbox-verification`,
    );

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/RUN_SANDBOX_VERIFICATION/);
  });

  it("returns 503 when the sandbox runtime is fail-closed", async () => {
    mockStartSandboxVerification.mockRejectedValueOnce(
      new MockLocalCodingSandboxGateError(
        "AI_CODING_SANDBOX_ENABLED is not true",
        "SANDBOX_BLOCKED",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/run-sandbox-verification`,
    );

    expect(response.status).toBe(503);
  });

  it("returns 422 when the approved patch cannot be verified safely", async () => {
    mockStartSandboxVerification.mockRejectedValueOnce(
      new MockLocalCodingSandboxGateError(
        "Validated local patch digest no longer matches",
        "INVALID_PATCH",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/run-sandbox-verification`,
    );

    expect(response.status).toBe(422);
  });
});


describe("AI coding workspace deterministic local recovery endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartDeterministicLocalRecovery.mockResolvedValue({
      ...run,
      agentName: "Local Recovery Executor",
      status: "RUNNING",
    });
  });

  it("starts recovery only through the explicit LOCAL_RECOVERY_REQUIRED gate", async () => {
    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/run-local-recovery`,
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "Local Recovery Executor",
      status: "RUNNING",
    });
    expect(mockStartDeterministicLocalRecovery).toHaveBeenCalledWith(taskId);
  });

  it("returns 409 when the task is not at LOCAL_RECOVERY_REQUIRED", async () => {
    mockStartDeterministicLocalRecovery.mockRejectedValueOnce(
      new MockLocalDeterministicRecoveryError(
        "Coding task is not at the LOCAL_RECOVERY_REQUIRED gate",
        "NOT_READY",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/run-local-recovery`,
    );

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/LOCAL_RECOVERY_REQUIRED/);
  });

  it("returns 503 when the recovery sandbox is unavailable", async () => {
    mockStartDeterministicLocalRecovery.mockRejectedValueOnce(
      new MockLocalDeterministicRecoveryError(
        "Docker sandbox runtime is unavailable",
        "SANDBOX_BLOCKED",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/run-local-recovery`,
    );

    expect(response.status).toBe(503);
  });

  it("returns 422 for inconsistent recovery context", async () => {
    mockStartDeterministicLocalRecovery.mockRejectedValueOnce(
      new MockLocalDeterministicRecoveryError(
        "Validated failing patch digest no longer matches",
        "INVALID_CONTEXT",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/run-local-recovery`,
    );

    expect(response.status).toBe(422);
  });
});


describe("AI coding workspace AI handoff gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartAiHandoffPreparation.mockResolvedValue({
      ...run,
      agentName: "AI Handoff Gate",
      status: "RUNNING",
    });
    mockApproveAiHandoff.mockResolvedValue({
      ...run,
      agentName: "AI Handoff Approval",
      status: "COMPLETED",
      finishedAt: new Date("2026-01-01T00:03:00.000Z"),
    });
    mockRevokeAiHandoff.mockResolvedValue({
      ...run,
      agentName: "AI Handoff Revocation",
      status: "COMPLETED",
      finishedAt: new Date("2026-01-01T00:04:00.000Z"),
    });
  });

  it("prepares bounded AI handoff only from AI_REQUIRED", async () => {
    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/prepare-ai-handoff`,
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "AI Handoff Gate",
      status: "RUNNING",
    });
    expect(mockStartAiHandoffPreparation).toHaveBeenCalledWith(taskId);
  });

  it("returns 409 when handoff preparation is not at AI_REQUIRED", async () => {
    mockStartAiHandoffPreparation.mockRejectedValueOnce(
      new MockLocalAiHandoffError(
        "Coding task is not at the AI_REQUIRED gate",
        "NOT_READY",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/prepare-ai-handoff`,
    );

    expect(response.status).toBe(409);
  });

  it("records explicit handoff approval without invoking a model", async () => {
    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/approve-ai-handoff`,
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "AI Handoff Approval",
      status: "COMPLETED",
    });
    expect(mockApproveAiHandoff).toHaveBeenCalledWith(taskId);
  });

  it("returns 409 for stale remote HEAD during handoff approval", async () => {
    mockApproveAiHandoff.mockRejectedValueOnce(
      new MockLocalAiHandoffError(
        "Repository HEAD changed; prepare the AI handoff again",
        "STALE_HEAD",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/approve-ai-handoff`,
    );

    expect(response.status).toBe(409);
  });

  it("revokes a prepared or approved handoff explicitly", async () => {
    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/revoke-ai-handoff`,
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "AI Handoff Revocation",
      status: "COMPLETED",
    });
    expect(mockRevokeAiHandoff).toHaveBeenCalledWith(taskId);
  });

  it("returns 409 when handoff revocation is not allowed", async () => {
    mockRevokeAiHandoff.mockRejectedValueOnce(
      new MockLocalAiHandoffError(
        "AI handoff is not revocable in its current state",
        "NOT_READY",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/revoke-ai-handoff`,
    );

    expect(response.status).toBe(409);
  });

  it("returns 422 when package integrity or policy validation fails", async () => {
    mockApproveAiHandoff.mockRejectedValueOnce(
      new MockLocalAiHandoffError(
        "AI handoff package hash no longer matches",
        "APPROVAL_FAILED",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/approve-ai-handoff`,
    );

    expect(response.status).toBe(422);
  });
});


describe("AI coding workspace constrained AI execution endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLatestCodingAiExecutionJob.mockResolvedValue(null);
    mockAssertApprovedAiHandoffFresh.mockResolvedValue({
      packageHash: "a".repeat(64),
      approvedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    mockEnqueueCodingAiExecution.mockResolvedValue({
      id: 77,
      jobCode: "JOB-AI123456",
      jobType: "coding_ai_execution",
      requiredCapability: "coding_ai_execution",
      status: "queued",
    });
    mockApproveAndValidateAiPatch.mockResolvedValue({
      ...run,
      agentName: "AI Patch Gate",
      status: "COMPLETED",
      finishedAt: new Date("2026-01-01T00:05:00.000Z"),
    });
  });

  it("returns the latest worker queue status for the coding task", async () => {
    mockGetLatestCodingAiExecutionJob.mockResolvedValueOnce({
      id: 77,
      jobCode: "JOB-AI123456",
      status: "running",
      jobType: "coding_ai_execution",
      requiredCapability: "coding_ai_execution",
      startedAt: "2026-01-01T00:05:00.000Z",
      completedAt: null,
      errorMessage: null,
    });

    const response = await request(app).get(
      `/ai/coding/tasks/${taskId}/ai-execution-job`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      taskId,
      job: {
        id: 77,
        status: "running",
        jobType: "coding_ai_execution",
      },
    });
    expect(mockGetLatestCodingAiExecutionJob).toHaveBeenCalledWith(taskId);
  });

  it("validates the handoff and enqueues constrained AI instead of invoking the model in HTTP", async () => {
    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/run-ai-execution`,
    );

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      taskId,
      jobId: 77,
      jobCode: "JOB-AI123456",
      jobType: "coding_ai_execution",
      requiredCapability: "coding_ai_execution",
      status: "queued",
    });
    expect(mockAssertApprovedAiHandoffFresh).toHaveBeenCalledWith(taskId);
    expect(mockEnqueueCodingAiExecution).toHaveBeenCalledWith(taskId, {
      requestedBy: "coding-workspace",
    });
  });

  it("returns 409 and does not enqueue when the approved handoff is expired", async () => {
    mockAssertApprovedAiHandoffFresh.mockRejectedValueOnce(
      new MockLocalAiHandoffError(
        "AI handoff approval lease expired",
        "EXPIRED",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/run-ai-execution`,
    );

    expect(response.status).toBe(409);
    expect(mockEnqueueCodingAiExecution).not.toHaveBeenCalled();
  });

  it("records explicit human approval before existing sandbox verification", async () => {
    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/approve-ai-patch`,
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "AI Patch Gate",
      status: "COMPLETED",
    });
    expect(mockApproveAndValidateAiPatch).toHaveBeenCalledTimes(1);
    expect(mockApproveAndValidateAiPatch).toHaveBeenCalledWith(taskId);
  });

  it("returns 409 when AI candidate HEAD is stale", async () => {
    mockApproveAndValidateAiPatch.mockRejectedValueOnce(
      new MockLocalAiPatchApprovalError(
        "Repository HEAD changed; regenerate the AI proposal",
        "STALE_HEAD",
      ),
    );

    const response = await request(app).post(
      `/ai/coding/tasks/${taskId}/approve-ai-patch`,
    );

    expect(response.status).toBe(409);
  });
});


describe("AI coding workspace commit approval endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApproveCommitAndCreatePullRequest.mockResolvedValue({
      ...run,
      agentName: "Local Commit Gate",
      status: "RUNNING",
    });
  });

  it("starts safe branch and PR creation only through explicit commit approval", async () => {
    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-commit`);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "Local Commit Gate",
      status: "RUNNING",
    });
    expect(mockApproveCommitAndCreatePullRequest).toHaveBeenCalledWith(taskId);
  });

  it("returns 409 when the task is not at APPROVE_COMMIT or base HEAD is stale", async () => {
    mockApproveCommitAndCreatePullRequest.mockRejectedValueOnce(
      new MockLocalCommitApprovalError(
        "Coding task is not at the APPROVE_COMMIT gate",
        "NOT_READY",
      ),
    );

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-commit`);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/APPROVE_COMMIT/);
  });

  it("returns 503 when the dedicated GitHub publish token is not configured", async () => {
    mockApproveCommitAndCreatePullRequest.mockRejectedValueOnce(
      new MockLocalCommitApprovalError(
        "AI_CODING_GITHUB_TOKEN is not configured",
        "GITHUB_AUTH",
      ),
    );

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-commit`);

    expect(response.status).toBe(503);
  });

  it("returns 502 when GitHub branch or PR publication fails", async () => {
    mockApproveCommitAndCreatePullRequest.mockRejectedValueOnce(
      new MockLocalCommitApprovalError(
        "GitHub API failed",
        "PUBLISH_FAILED",
      ),
    );

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-commit`);

    expect(response.status).toBe(502);
  });

  it("returns 422 when the validated patch no longer passes commit verification", async () => {
    mockApproveCommitAndCreatePullRequest.mockRejectedValueOnce(
      new MockLocalCommitApprovalError(
        "Validated patch digest no longer matches",
        "INVALID_PATCH",
      ),
    );

    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-commit`);

    expect(response.status).toBe(422);
  });
});


describe("AI coding workspace pull request verification endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartPullRequestVerification.mockResolvedValue({
      ...run,
      agentName: "Pull Request Verification",
      status: "RUNNING",
    });
  });

  it("starts explicit PR verification", async () => {
    const response = await request(app).post(`/ai/coding/tasks/${taskId}/verify-pull-request`);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "Pull Request Verification",
      status: "RUNNING",
    });
    expect(mockStartPullRequestVerification).toHaveBeenCalledWith(taskId);
  });

  it("returns 409 when the task is not at REVIEW_PR", async () => {
    mockStartPullRequestVerification.mockRejectedValueOnce(
      new MockLocalPullRequestGateError("Coding task is not at the REVIEW_PR gate", "NOT_READY"),
    );
    const response = await request(app).post(`/ai/coding/tasks/${taskId}/verify-pull-request`);
    expect(response.status).toBe(409);
  });

  it("returns 503 when GitHub verification auth is unavailable", async () => {
    mockStartPullRequestVerification.mockRejectedValueOnce(
      new MockLocalPullRequestGateError("AI_CODING_GITHUB_TOKEN is not configured", "GITHUB_AUTH"),
    );
    const response = await request(app).post(`/ai/coding/tasks/${taskId}/verify-pull-request`);
    expect(response.status).toBe(503);
  });
});

describe("AI coding workspace explicit merge endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApproveAndMergePullRequest.mockResolvedValue({
      ...run,
      agentName: "Pull Request Merge Gate",
      status: "RUNNING",
    });
  });

  it("starts merge only after explicit approval", async () => {
    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-merge`);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: runId,
      taskId,
      agentName: "Pull Request Merge Gate",
      status: "RUNNING",
    });
    expect(mockApproveAndMergePullRequest).toHaveBeenCalledWith(taskId);
  });

  it("returns 409 when PR verification is stale or missing", async () => {
    mockApproveAndMergePullRequest.mockRejectedValueOnce(
      new MockLocalPullRequestGateError("Pull request has not passed the explicit verification gate", "NOT_READY"),
    );
    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-merge`);
    expect(response.status).toBe(409);
  });

  it("returns 502 when GitHub merge mutation fails", async () => {
    mockApproveAndMergePullRequest.mockRejectedValueOnce(
      new MockLocalPullRequestGateError("GitHub merge failed", "MERGE_FAILED"),
    );
    const response = await request(app).post(`/ai/coding/tasks/${taskId}/approve-merge`);
    expect(response.status).toBe(502);
  });
});
