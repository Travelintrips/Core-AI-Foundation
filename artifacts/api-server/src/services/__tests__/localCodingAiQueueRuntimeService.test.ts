import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  runToCompletion: vi.fn(),
}));

vi.mock("../queueManagerService.js", () => ({
  enqueue: mocks.enqueue,
}));

vi.mock("../localCodingAiExecutionGateService.js", () => ({
  runAiExecutionToCompletion: mocks.runToCompletion,
}));

import {
  CODING_AI_EXECUTION_CAPABILITY,
  CODING_AI_EXECUTION_JOB_TYPE,
  enqueueCodingAiExecution,
  executeCodingAiExecutionJob,
  parseCodingAiExecutionJobPayload,
} from "../localCodingAiQueueRuntimeService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

describe("AI coding queue runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueue.mockResolvedValue({
      id: 42,
      jobType: CODING_AI_EXECUTION_JOB_TYPE,
      status: "queued",
    });
  });

  it("enqueues a dedicated non-retrying coding execution job", async () => {
    await enqueueCodingAiExecution(TASK_ID, {
      priority: 120,
      tenantId: "tenant-1",
      requestedBy: "admin",
    });

    expect(mocks.enqueue).toHaveBeenCalledWith({
      jobType: CODING_AI_EXECUTION_JOB_TYPE,
      requiredCapability: CODING_AI_EXECUTION_CAPABILITY,
      payloadJson: {
        taskId: TASK_ID,
        requestedBy: "admin",
      },
      priority: 100,
      tenantId: "tenant-1",
      maxRetry: 0,
      retryStrategy: "manual",
    });
  });

  it("validates queue payloads fail closed", () => {
    expect(() => parseCodingAiExecutionJobPayload(null)).toThrow();
    expect(() =>
      parseCodingAiExecutionJobPayload({ taskId: "not-a-uuid" }),
    ).toThrow();

    expect(
      parseCodingAiExecutionJobPayload({
        taskId: TASK_ID,
        requestedBy: " operator ",
      }),
    ).toEqual({
      taskId: TASK_ID,
      requestedBy: "operator",
    });
  });

  it("waits for the constrained execution gate to reach COMPLETED", async () => {
    mocks.runToCompletion.mockResolvedValue({
      id: "run-1",
      taskId: TASK_ID,
      agentName: "AI Execution Gate",
      status: "COMPLETED",
    });

    const result = await executeCodingAiExecutionJob({
      id: 7,
      payloadJson: { taskId: TASK_ID },
    } as any);

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

  it("fails the queue job when the execution gate is terminal but failed", async () => {
    mocks.runToCompletion.mockResolvedValue({
      id: "run-failed",
      taskId: TASK_ID,
      agentName: "AI Execution Gate",
      status: "FAILED",
    });

    await expect(
      executeCodingAiExecutionJob({
        id: 8,
        payloadJson: { taskId: TASK_ID },
      } as any),
    ).rejects.toThrow(/status 'FAILED'/);
  });
});
