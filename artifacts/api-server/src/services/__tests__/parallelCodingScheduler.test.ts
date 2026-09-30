import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("parallel coding scheduler contracts", () => {
  it("routes planner jobs only to coding-capable workers", () => {
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
    expect(cluster).toContain('"coding_multi_task_planner"');
  });

  it("provides five coding-worker slots for different coding tasks", () => {
    const dispatcher = readFileSync(
      new URL("../jobDispatcherService.ts", import.meta.url),
      "utf8",
    );

    expect(dispatcher).toContain('workerType:        "coding_worker"');
    expect(dispatcher).toMatch(
      /workerType:\s*"coding_worker"[\s\S]*?maxConcurrentJobs:\s*5/,
    );
  });

  it("fills free slots even when a worker is already busy", () => {
    const dispatcher = readFileSync(
      new URL("../jobDispatcherService.ts", import.meta.url),
      "utf8",
    );

    expect(dispatcher).toContain(
      'inArray(aiWorkersTable.status, ["idle", "busy"])',
    );
    expect(dispatcher).toContain(
      "worker.maxConcurrentJobs - worker.runningJobs",
    );
    expect(dispatcher).toContain(
      "dispatchWorkerIds.map((workerId) => dispatch(workerId))",
    );
  });

  it("serializes only claim admission for the same worker", () => {
    const worker = readFileSync(
      new URL("../jobWorkerService.ts", import.meta.url),
      "utf8",
    );

    expect(worker).toContain(
      "SELECT pg_advisory_xact_lock(${workerId})",
    );
    expect(worker).toContain(
      "lockedWorker.runningJobs >= lockedWorker.maxConcurrentJobs",
    );
  });
});
