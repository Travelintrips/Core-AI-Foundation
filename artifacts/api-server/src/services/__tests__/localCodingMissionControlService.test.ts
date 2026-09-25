import { describe, expect, it } from "vitest";
import { summarizeCodingMissionControl } from "../localCodingMissionControlService.js";

function graph(status = "RUNNING") {
  return {
    graph: {
      id: "11111111-1111-4111-8111-111111111111",
      taskId: "22222222-2222-4222-8222-222222222222",
      version: 3,
      contractVersion: 1,
      planHash: "a".repeat(64),
      objective: "Ship MVP",
      status,
      planJson: {},
      approvedAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    workstreams: [
      {
        id: "w1", key: "T01", title: "Foundation", role: "planner",
        instruction: "", status: "COMPLETED", priority: 10,
        ownershipPaths: [], acceptanceCriteria: [], verificationProfiles: [],
        workerId: null, branchName: null, childTaskId: null, childRunId: null,
        jobId: null, leaseExpiresAt: null, heartbeatAt: null, baseSha: null,
        headSha: null, attemptCount: 1, errorMessage: null, dependencies: [],
      },
      {
        id: "w2", key: "T02", title: "Worker", role: "coder",
        instruction: "", status: "RUNNING", priority: 9,
        ownershipPaths: [], acceptanceCriteria: [], verificationProfiles: [],
        workerId: "worker-1", branchName: "feat/t02", childTaskId: null, childRunId: null,
        jobId: 7, leaseExpiresAt: new Date(), heartbeatAt: new Date(), baseSha: null,
        headSha: null, attemptCount: 1, errorMessage: null, dependencies: ["T01"],
      },
      {
        id: "w3", key: "T03", title: "Review", role: "reviewer",
        instruction: "", status: "REVIEW_REQUIRED", priority: 8,
        ownershipPaths: [], acceptanceCriteria: [], verificationProfiles: [],
        workerId: null, branchName: "feat/t03", childTaskId: null, childRunId: null,
        jobId: null, leaseExpiresAt: null, heartbeatAt: null, baseSha: null,
        headSha: null, attemptCount: 1, errorMessage: null, dependencies: ["T01"],
      },
      {
        id: "w4", key: "T04", title: "Blocked", role: "coder",
        instruction: "", status: "PENDING", priority: 7,
        ownershipPaths: [], acceptanceCriteria: [], verificationProfiles: [],
        workerId: null, branchName: null, childTaskId: null, childRunId: null,
        jobId: null, leaseExpiresAt: null, heartbeatAt: null, baseSha: null,
        headSha: null, attemptCount: 0, errorMessage: null, dependencies: ["T02"],
      },
    ],
  } as any;
}

describe("summarizeCodingMissionControl", () => {
  it("summarizes progress, active work and next actions deterministically", () => {
    const result = summarizeCodingMissionControl(
      "22222222-2222-4222-8222-222222222222",
      graph(),
    );
    expect(result.progressPercent).toBe(25);
    expect(result.totals).toEqual({
      workstreams: 4,
      completed: 1,
      running: 1,
      waiting: 1,
      reviewRequired: 1,
      failed: 0,
      ready: 0,
    });
    expect(result.nextActions).toEqual([
      "REVIEW_WORKSTREAMS",
      "MONITOR_ACTIVE_LEASES",
    ]);
    expect(result.blockers.map((item) => item.key)).toEqual(["T04"]);
  });

  it("routes a fully completed graph to explicit integration manifest review", () => {
    const snapshot = graph("COMPLETED");
    for (const workstream of snapshot.workstreams) {
      workstream.status = "COMPLETED";
      workstream.errorMessage = null;
    }

    const result = summarizeCodingMissionControl(
      "22222222-2222-4222-8222-222222222222",
      snapshot,
    );

    expect(result.progressPercent).toBe(100);
    expect(result.nextActions).toEqual(["REVIEW_INTEGRATION_MANIFEST"]);
  });

  it("prioritizes failed workstreams and ready dispatch", () => {
    const snapshot = graph("FAILED");
    snapshot.workstreams[1].status = "FAILED";
    snapshot.workstreams[1].errorMessage = "test failed";
    snapshot.workstreams[3].status = "READY";
    const result = summarizeCodingMissionControl(
      "22222222-2222-4222-8222-222222222222",
      snapshot,
    );
    expect(result.nextActions).toEqual([
      "RESOLVE_FAILED_WORKSTREAMS",
      "REVIEW_WORKSTREAMS",
      "DISPATCH_READY_WORKSTREAMS",
    ]);
    expect(result.blockers[0]?.errorMessage).toBe("test failed");
  });
});
