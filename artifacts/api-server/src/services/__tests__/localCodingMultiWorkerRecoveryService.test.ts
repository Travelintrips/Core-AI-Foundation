import { readFileSync } from "node:fs";
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
  it("reconciles only stale detached READY_REVIEW Multi-Worker children without active work", () => {
    const source = readFileSync(
      new URL("../localCodingMultiWorkerRecoveryService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("DETACHED_READY_REVIEW_GRACE_MS = 10 * 60_000");
    expect(source).toContain("t.status = 'READY_REVIEW'");
    expect(source).toContain("t.task_number LIKE 'MW-%'");
    expect(source).toContain("NULLIF(t.commit_sha, '') IS NULL");
    expect(source).toContain("NULLIF(t.pull_request_url, '') IS NULL");
    expect(source).toContain("active_run.status = 'RUNNING'");
    expect(source).toContain("active_binding.child_task_id = t.id");
    expect(source).toContain("active_job.status IN ('queued', 'waiting', 'running', 'retrying')");
    expect(source).toContain("ai_coding_critical_approvals");
    expect(source).toContain("approval.status IN ('PENDING', 'REQUESTED', 'AWAITING_APPROVAL')");
    expect(source).toContain("SET status = 'COMPLETED'");
    expect(source).toContain("coding_status = 'COMPLETED'");
    expect(source).toContain("Auto-reconciled completed Multi-Worker child");
  });

  it("purges only superseded queued workstream jobs whose execution binding no longer matches", () => {
    const source = readFileSync(
      new URL("../localCodingMultiWorkerRecoveryService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("reconcileSupersededQueuedWorkstreamJobs");
    expect(source).toContain("j.job_type = 'coding_workstream_execution'");
    expect(source).toContain("j.status IN ('queued', 'waiting', 'retrying')");
    expect(source).toContain("w.job_id = j.id");
    expect(source).toContain("w.lease_token = j.payload_json->>'leaseToken'");
    expect(source).toContain("w.child_task_id::text = j.payload_json->>'codingTaskId'");
    expect(source).toContain("w.child_run_id::text = j.payload_json->>'codingRunId'");
    expect(source).toContain("Superseded workstream execution binding");
  });

  it("synchronizes READY_REVIEW children from terminal workstream truth", () => {
    const source = readFileSync(
      new URL("../localCodingMultiWorkerRecoveryService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("w.status IN ('COMPLETED', 'FAILED', 'CANCELLED')");
    expect(source).toContain("WHEN linked_terminal.workstream_status = 'COMPLETED'");
    expect(source).toContain("THEN 'COMPLETED'");
    expect(source).toContain("ELSE 'FAILED'");
  });

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
