import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  aiCodingRunsTable: {},
  aiCodingTaskGraphsTable: {},
  aiCodingTasksTable: {},
  aiCodingWorkstreamsTable: {},
  aiJobsTable: {},
  db: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNotNull: vi.fn(),
  lte: vi.fn(),
}));

import {
  expiredLeaseRecoveryDisposition,
  workstreamChildLifecycleDisposition,
} from "../localCodingMultiWorkerRecoveryService.js";

describe("multi-worker child lifecycle recovery", () => {
  it("marks a legacy failed constrained-AI review as FAILED instead of READY_REVIEW", () => {
    expect(
      workstreamChildLifecycleDisposition("REVIEW_REQUIRED", {
        localExecutionPlan: { status: "AI_REQUIRED" },
        workstreamAiExecution: {
          status: "FAILED",
          nextAction: "AI_REQUIRED",
        },
      }),
    ).toEqual({
      runStatus: "FAILED",
      taskStatus: "FAILED",
      aiFailure: true,
    });
  });

  it("does not terminalize the short REVIEW_REQUIRED window while auto-repair is pending", () => {
    expect(
      workstreamChildLifecycleDisposition("REVIEW_REQUIRED", {
        workstreamAiExecution: {
          status: "FAILED",
          nextAction: "AI_REQUIRED",
          autoRepairStatus: "RETRY_PENDING",
        },
      }),
    ).toEqual({
      runStatus: "COMPLETED",
      taskStatus: "READY_REVIEW",
      aiFailure: false,
    });
  });

  it("keeps ordinary review handoffs reviewable", () => {
    expect(
      workstreamChildLifecycleDisposition("REVIEW_REQUIRED", {
        localExecutionPlan: { status: "EXECUTABLE" },
      }),
    ).toEqual({
      runStatus: "COMPLETED",
      taskStatus: "READY_REVIEW",
      aiFailure: false,
    });
  });

  it("treats an expired active lease as a recoverable requeue while closing the stale child lifecycle", () => {
    expect(expiredLeaseRecoveryDisposition()).toEqual({
      workstreamStatus: "READY",
      graphStatus: "RUNNING",
      staleRunStatus: "FAILED",
      staleTaskStatus: "FAILED",
      clearExecutionBindings: true,
    });
  });

  it("auto-finishes the child task when the workstream is already completed", () => {
    expect(
      workstreamChildLifecycleDisposition("COMPLETED", {
        localExecutionPlan: { status: "EXECUTABLE" },
        localExecution: { status: "NO_CHANGES" },
      }),
    ).toEqual({
      runStatus: "COMPLETED",
      taskStatus: "COMPLETED",
      aiFailure: false,
    });
  });
});
