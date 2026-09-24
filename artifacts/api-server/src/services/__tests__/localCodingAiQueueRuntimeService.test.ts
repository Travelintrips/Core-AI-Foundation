import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  txExecute: vi.fn(),
  existingLimit: vi.fn(),
  insertValues: vi.fn(),
  insertReturning: vi.fn(),
  runToCompletion: vi.fn(),
  assertFresh: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const selectBuilder = {
    from: vi.fn(() => selectBuilder),
    where: vi.fn(() => selectBuilder),
    orderBy: vi.fn(() => selectBuilder),
    limit: mocks.existingLimit,
  };
  const insertBuilder = {
    values: mocks.insertValues,
    returning: mocks.insertReturning,
  };
  const tx = {
    execute: mocks.txExecute,
    select: vi.fn(() => selectBuilder),
    insert: vi.fn(() => insertBuilder),
  };
  return {
    aiJobsTable: {
      id: "aiJobs.id",
      jobType: "aiJobs.jobType",
      status: "aiJobs.status",
      payloadJson: "aiJobs.payloadJson",
    },
    db: {
      transaction: vi.fn(async (callback: (tx: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((...args: unknown[]) => args),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock("../localCodingAiExecutionGateService.js", () => ({
  runAiExecutionToCompletion: mocks.runToCompletion,
}));

vi.mock("../localCodingAiHandoffService.js", () => ({
  assertApprovedAiHandoffFresh: mocks.assertFresh,
}));

vi.mock("../aiAuditService.js", () => ({
  logAudit: mocks.logAudit,
}));

vi.mock("../priorityEngine.js", () => ({
  computePriorityScore: vi.fn(() => 123.456),
}));

import {
  CODING_AI_EXECUTION_CAPABILITY,
  CODING_AI_EXECUTION_JOB_TYPE,
  enqueueCodingAiExecution,
  executeCodingAiExecutionJob,
  parseCodingAiExecutionJobPayload,
} from "../localCodingAiQueueRuntimeService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PACKAGE_HASH = "a".repeat(64);

describe("AI coding queue runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.txExecute.mockResolvedValue(undefined);
    mocks.existingLimit.mockResolvedValue([]);
    mocks.insertValues.mockImplementation(() => ({
      returning: mocks.insertReturning,
    }));
    mocks.insertReturning.mockResolvedValue([{
      id: 42,
      jobCode: "JOB-NEW",
      jobType: CODING_AI_EXECUTION_JOB_TYPE,
      requiredCapability: CODING_AI_EXECUTION_CAPABILITY,
      status: "queued",
      payloadJson: {
        taskId: TASK_ID,
        packageHash: PACKAGE_HASH,
      },
    }]);
    mocks.assertFresh.mockResolvedValue({
      packageHash: PACKAGE_HASH,
    });
    mocks.logAudit.mockResolvedValue(undefined);
  });

  it("atomically enqueues one non-retrying coding execution job bound to the approved package", async () => {
    const job = await enqueueCodingAiExecution(TASK_ID, {
      priority: 120,
      tenantId: "tenant-1",
      requestedBy: "admin",
      expectedPackageHash: PACKAGE_HASH,
    });

    expect(mocks.txExecute).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: CODING_AI_EXECUTION_JOB_TYPE,
        requiredCapability: CODING_AI_EXECUTION_CAPABILITY,
        priority: 100,
        priorityScore: "123.456",
        maxRetry: 0,
        retryStrategy: "manual",
        status: "queued",
        retryCount: 0,
        payloadJson: {
          taskId: TASK_ID,
          packageHash: PACKAGE_HASH,
          requestedBy: "admin",
          _tenantId: "tenant-1",
        },
      }),
    );
    expect(job).toMatchObject({
      id: 42,
      status: "queued",
    });
  });

  it("returns an active existing job inside the task-scoped advisory lock", async () => {
    const existing = {
      id: 99,
      jobCode: "JOB-EXISTING",
      jobType: CODING_AI_EXECUTION_JOB_TYPE,
      status: "running",
      payloadJson: { taskId: TASK_ID, packageHash: PACKAGE_HASH },
    };
    mocks.existingLimit.mockResolvedValueOnce([existing]);

    await expect(
      enqueueCodingAiExecution(TASK_ID, {
        requestedBy: "double-click",
        expectedPackageHash: PACKAGE_HASH,
      }),
    ).resolves.toEqual(existing);

    expect(mocks.txExecute).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("validates task/package binding fail closed", () => {
    expect(() => parseCodingAiExecutionJobPayload(null)).toThrow();
    expect(() =>
      parseCodingAiExecutionJobPayload({
        taskId: "not-a-uuid",
        packageHash: PACKAGE_HASH,
      }),
    ).toThrow();
    expect(() =>
      parseCodingAiExecutionJobPayload({
        taskId: TASK_ID,
        packageHash: "not-a-sha",
      }),
    ).toThrow();

    expect(
      parseCodingAiExecutionJobPayload({
        taskId: TASK_ID,
        packageHash: PACKAGE_HASH.toUpperCase(),
        requestedBy: " operator ",
      }),
    ).toEqual({
      taskId: TASK_ID,
      packageHash: PACKAGE_HASH,
      requestedBy: "operator",
    });
  });

  it("revalidates the exact queued package before worker model execution", async () => {
    mocks.runToCompletion.mockResolvedValue({
      id: "run-1",
      taskId: TASK_ID,
      agentName: "AI Execution Gate",
      status: "COMPLETED",
    });

    const result = await executeCodingAiExecutionJob({
      id: 7,
      payloadJson: { taskId: TASK_ID, packageHash: PACKAGE_HASH },
    } as any);

    expect(mocks.assertFresh).toHaveBeenCalledWith(TASK_ID);
    expect(mocks.runToCompletion).toHaveBeenCalledTimes(1);
    expect(mocks.runToCompletion).toHaveBeenCalledWith(TASK_ID);
    expect(result).toMatchObject({
      jobId: 7,
      taskId: TASK_ID,
      codingRunId: "run-1",
      codingRunStatus: "COMPLETED",
      completed: true,
    });
  });

  it("rejects a delayed/replayed job if the current approved package changed", async () => {
    mocks.assertFresh.mockResolvedValueOnce({
      packageHash: "b".repeat(64),
    });

    await expect(
      executeCodingAiExecutionJob({
        id: 8,
        payloadJson: { taskId: TASK_ID, packageHash: PACKAGE_HASH },
      } as any),
    ).rejects.toThrow(/package no longer matches/i);

    expect(mocks.runToCompletion).not.toHaveBeenCalled();
  });

  it("fails the queue job when the execution gate is terminal but failed", async () => {
    mocks.runToCompletion.mockResolvedValue({
      id: "run-failed",
      taskId: TASK_ID,
      agentName: "AI Execution Gate",
      status: "FAILED",
    });

    await expect(
      executeCodingAiExecutionJob({
        id: 9,
        payloadJson: { taskId: TASK_ID, packageHash: PACKAGE_HASH },
      } as any),
    ).rejects.toThrow(/status 'FAILED'/);
  });
});
