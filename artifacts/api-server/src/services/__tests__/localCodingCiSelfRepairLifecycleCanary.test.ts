import { describe, expect, it } from "vitest";
import { decideCiSelfRepair } from "../localCodingCiSelfRepairService.js";
import { summarizeCodingMissionControl } from "../localCodingMissionControlService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const GRAPH_ID = "22222222-2222-4222-8222-222222222222";

function missionSnapshot(ciSelfRepair: Record<string, unknown>) {
  return {
    graph: {
      id: GRAPH_ID,
      taskId: TASK_ID,
      version: 1,
      contractVersion: 1,
      planHash: "f".repeat(64),
      objective: "CI self-repair lifecycle canary",
      status: "RUNNING",
      planJson: {},
      approvedAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    workstreams: [{
      id: "ws-1",
      key: "WS-001",
      title: "Bounded CI repair fixture",
      role: "backend",
      instruction: "Repair a harmless CI fixture.",
      status: "REVIEW_REQUIRED",
      priority: 100,
      ownershipPaths: ["artifacts/api-server/src/services/__tests__/**"],
      acceptanceCriteria: ["CI returns green."],
      verificationProfiles: ["unit_tests", "typecheck"],
      workerId: null,
      branchName: "ai-integration/ci-self-repair-canary",
      childTaskId: null,
      childRunId: null,
      jobId: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      baseSha: "a".repeat(40),
      headSha: "a".repeat(40),
      attemptCount: 1,
      resultJson: { ciSelfRepair },
      errorMessage: "CI Verify failed",
      dependencies: [],
    }],
  } as any;
}

describe("CI self-repair lifecycle canary", () => {
  it("proves failure -> scheduled repair -> workspace visibility -> retry -> exhaustion", () => {
    const first = decideCiSelfRepair({
      eventType: "coding.github.check_run",
      headSha: "a".repeat(40),
      headBranch: "ai-integration/ci-self-repair-canary",
      previousCheckpoint: {},
      maxAttempts: 3,
    });
    expect(first).toEqual({ action: "SCHEDULE", attempt: 1, maxAttempts: 3 });

    const scheduled = summarizeCodingMissionControl(
      TASK_ID,
      missionSnapshot({
        status: "REPAIR_REQUIRED",
        attempt: 1,
        maxAttempts: 3,
        checkName: "CI Verify",
        failureSummary: "Typecheck failed in harmless canary fixture.",
        repairCommitSha: null,
      }),
    );
    expect(scheduled.nextActions).toContain("MONITOR_CI_SELF_REPAIR");
    expect(scheduled.active[0]?.ciSelfRepair).toMatchObject({
      status: "REPAIR_REQUIRED",
      attempt: 1,
      maxAttempts: 3,
      checkName: "CI Verify",
    });

    const waiting = summarizeCodingMissionControl(
      TASK_ID,
      missionSnapshot({
        status: "WAITING_CI",
        attempt: 1,
        maxAttempts: 3,
        checkName: "CI Verify",
        failureSummary: "Typecheck failed in harmless canary fixture.",
        repairCommitSha: "b".repeat(40),
      }),
    );
    expect(waiting.active[0]?.ciSelfRepair).toMatchObject({
      status: "WAITING_CI",
      attempt: 1,
      repairCommitSha: "b".repeat(40),
    });

    const second = decideCiSelfRepair({
      eventType: "coding.github.check_run",
      headSha: "b".repeat(40),
      headBranch: "ai-integration/ci-self-repair-canary",
      previousCheckpoint: {
        ciSelfRepair: {
          status: "WAITING_CI",
          attempt: 1,
          scheduledForHeadSha: "a".repeat(40),
        },
      },
      maxAttempts: 3,
    });
    expect(second).toEqual({ action: "SCHEDULE", attempt: 2, maxAttempts: 3 });

    const third = decideCiSelfRepair({
      eventType: "coding.github.check_run",
      headSha: "c".repeat(40),
      headBranch: "ai-integration/ci-self-repair-canary",
      previousCheckpoint: {
        ciSelfRepair: {
          status: "WAITING_CI",
          attempt: 2,
          scheduledForHeadSha: "b".repeat(40),
        },
      },
      maxAttempts: 3,
    });
    expect(third).toEqual({ action: "SCHEDULE", attempt: 3, maxAttempts: 3 });

    const exhausted = decideCiSelfRepair({
      eventType: "coding.github.check_run",
      headSha: "d".repeat(40),
      headBranch: "ai-integration/ci-self-repair-canary",
      previousCheckpoint: {
        ciSelfRepair: {
          status: "WAITING_CI",
          attempt: 3,
          scheduledForHeadSha: "c".repeat(40),
        },
      },
      maxAttempts: 3,
    });
    expect(exhausted).toEqual({
      action: "EXHAUSTED",
      attempt: 3,
      maxAttempts: 3,
    });

    const manual = summarizeCodingMissionControl(
      TASK_ID,
      missionSnapshot({
        status: "EXHAUSTED",
        attempt: 3,
        maxAttempts: 3,
        checkName: "CI Verify",
        failureSummary: "Still failing after bounded retries.",
        repairCommitSha: "c".repeat(40),
      }),
    );
    expect(manual.active[0]?.ciSelfRepair).toMatchObject({
      status: "EXHAUSTED",
      attempt: 3,
      maxAttempts: 3,
    });
  });
});
