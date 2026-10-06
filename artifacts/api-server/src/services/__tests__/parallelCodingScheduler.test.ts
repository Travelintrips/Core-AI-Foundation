import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("single-slot coding scheduler contracts", () => {
  it("routes planner jobs to a dedicated planner-capable worker", () => {
    const planner = readFileSync(
      new URL("../localCodingPlannerQueueRuntimeService.ts", import.meta.url),
      "utf8",
    );
    const cluster = readFileSync(
      new URL("../workerClusterService.ts", import.meta.url),
      "utf8",
    );

    expect(planner).toContain(
      "requiredCapability: CODING_MULTI_TASK_PLANNER_JOB_TYPE",
    );
    expect(cluster).toContain('planner_worker: ["coding_multi_task_planner"]');
    expect(cluster).not.toContain(
      'coding_worker: ["coding_ai_execution", "coding_workstream", "coding_multi_task_planner"]',
    );

    const dispatcher = readFileSync(
      new URL("../jobDispatcherService.ts", import.meta.url),
      "utf8",
    );
    expect(dispatcher).toContain('suffix:            "7"');
    expect(dispatcher).toContain('workerType:        "planner_worker"');
    expect(dispatcher).toContain(
      'capabilities:      WORKER_TYPE_CAPABILITIES["planner_worker"]!',
    );
  });

  it("gives every dispatcher coding worker exactly one active slot", () => {
    const dispatcher = readFileSync(
      new URL("../jobDispatcherService.ts", import.meta.url),
      "utf8",
    );

    expect(dispatcher).toContain('workerType:        "coding_worker"');
    expect(dispatcher).toContain(
      "maxConcurrentJobs: MAX_ACTIVE_JOBS_PER_WORKER",
    );
    expect(dispatcher).not.toMatch(/maxConcurrentJobs:\s*[2-9]/);
  });

  it("keeps a busy worker from receiving a second active job", () => {
    const dispatcher = readFileSync(
      new URL("../jobDispatcherService.ts", import.meta.url),
      "utf8",
    );

    expect(dispatcher).toContain(
      'inArray(aiWorkersTable.status, ["idle", "busy"])',
    );
    expect(dispatcher).toContain(
      "MAX_ACTIVE_JOBS_PER_WORKER - worker.runningJobs",
    );
    expect(dispatcher).toContain(
      "dispatchWorkerIds.map((workerId) => dispatch(workerId))",
    );
  });


  it("preserves live job occupancy when a rolling deploy reacquires a worker lease", () => {
    const dispatcher = readFileSync(
      new URL("../jobDispatcherService.ts", import.meta.url),
      "utf8",
    );

    expect(dispatcher).toContain(
      "payload_json->>'_claimedByWorkerId'",
    );
    expect(dispatcher).toContain("COUNT(*)::int AS running_count");
    expect(dispatcher).toContain("status: runningCount > 0 ? \"busy\" : \"idle\"");
    expect(dispatcher).not.toContain(
      'status: "idle",\n        currentJob: null,\n        runningJobs: 0',
    );
  });

  it("serializes claim admission and rechecks the one-job cap under lock", () => {
    const worker = readFileSync(
      new URL("../jobWorkerService.ts", import.meta.url),
      "utf8",
    );

    expect(worker).toContain(
      "SELECT pg_advisory_xact_lock(${workerId})",
    );
    expect(worker).toContain(
      "lockedWorker.runningJobs >= MAX_ACTIVE_JOBS_PER_WORKER",
    );
  });
});
