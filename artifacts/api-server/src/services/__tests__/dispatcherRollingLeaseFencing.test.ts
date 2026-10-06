import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dispatcher stuck-job retry fencing", () => {
  it("terminally exhausts a no-retry job instead of requeueing it", async () => {
    const { stuckJobRetryDisposition } = await import("../jobDispatcherService.js");

    expect(stuckJobRetryDisposition({ retryCount: 0, maxRetry: 0 }))
      .toEqual({ nextRetryCount: 1, exhausted: true });
    expect(stuckJobRetryDisposition({ retryCount: 0, maxRetry: 2 }))
      .toEqual({ nextRetryCount: 1, exhausted: false });
  });

  it("uses an extended timeout for repository analyzer jobs", async () => {
    const { jobTimeoutMsForType } = await import("../jobDispatcherService.js");
    expect(jobTimeoutMsForType("coding_repository_analyzer", 300000)).toBe(900000);
    expect(jobTimeoutMsForType("image_generation", 300000)).toBe(300000);
  });

  it("clears stale claimed-worker ownership in no-holder recovery", () => {
    const source = readFileSync(
      new URL("../jobDispatcherService.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("disposition.exhausted");
    expect(source).toContain("retryCount: disposition.nextRetryCount");
    expect(source).toContain("COALESCE(payload_json, '{}'::jsonb) - '_claimedByWorkerId'");
  });
});

describe("dispatcher rolling-deploy lease fencing", () => {
  it("fences live worker registration by unique process owner", () => {
    const clusterSource = readFileSync(
      new URL("../workerClusterService.ts", import.meta.url),
      "utf8",
    );
    const dispatcherSource = readFileSync(
      new URL("../jobDispatcherService.ts", import.meta.url),
      "utf8",
    );

    expect(dispatcherSource).toContain("const DISPATCHER_INSTANCE_ID = randomUUID()");
    expect(dispatcherSource).toContain("heartbeatToken: token");
    expect(clusterSource).toContain("pg_advisory_xact_lock");
    expect(clusterSource).toContain("heldByAnotherLiveOwner");
    expect(clusterSource).toContain("existing!.leaseOwner !== input.leaseOwner");
    expect(clusterSource).toContain("return { worker: existing, acquired: false }");
  });

  it("does not overwrite another instance heartbeat token after registration", () => {
    const source = readFileSync(
      new URL("../jobDispatcherService.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain(
      '.set({ heartbeatToken: token, status: "idle", currentJob: null, runningJobs: 0 })',
    );
    expect(source).toContain("eq(aiWorkersTable.heartbeatToken, token)");
    expect(source).toContain("eq(aiWorkersTable.leaseOwner, LEASE_OWNER)");
  });

  it("drops a lost lease and reacquires missing workers automatically", () => {
    const source = readFileSync(
      new URL("../jobDispatcherService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("if (result.value.renewed) continue");
    expect(source).toContain('"[dispatcher] Lease ownership lost; scheduling worker reacquisition"');
    expect(source).toContain("_workers.splice(index, 1)");
    expect(source).toContain("if (_workers.length < DISPATCHER_WORKERS.length)");
    expect(source).toContain("await ensureWorkers().catch");
  });

  it("marks lease release stale when a worker still owns active work", () => {
    const source = readFileSync(
      new URL("../workerClusterService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("WHEN running_jobs > 0 OR current_job IS NOT NULL THEN 'stale'");
    expect(source).toContain("ELSE 'offline'");
  });

  it("recovers legacy offline workers that still advertise active occupancy", () => {
    const source = readFileSync(
      new URL("../workerClusterService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('eq(aiWorkersTable.status, "offline")');
    expect(source).toContain("${aiWorkersTable.runningJobs} > 0");
    expect(source).toContain("${aiWorkersTable.currentJob} IS NOT NULL");
    expect(source).toContain("recoverableWorkers");
  });
});


describe("dispatcher coding load balancing", () => {
  it("registers two dispatcher-owned coding workers and keeps remote Ollama separate", () => {
    const dispatcherSource = readFileSync(
      new URL("../jobDispatcherService.ts", import.meta.url),
      "utf8",
    );
    const remoteOllamaSource = readFileSync(
      new URL("../remoteOllamaWorkerService.ts", import.meta.url),
      "utf8",
    );

    expect(dispatcherSource).toContain('suffix:            "4"');
    expect(dispatcherSource).toContain('suffix:            "6"');
    expect(
      dispatcherSource.match(/workerType:\s+"coding_worker"/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(dispatcherSource).toContain("round-robin plan");
    expect(dispatcherSource).toContain(
      "_settings.maxConcurrentJobs - currentRunning",
    );

    expect(remoteOllamaSource).toContain(
      'export const REMOTE_OLLAMA_RUNTIME_KIND = "ollama_remote_pull"',
    );
    expect(remoteOllamaSource).toContain(
      "claimRemoteOllamaInvocation",
    );
    expect(remoteOllamaSource).not.toContain(
      "claimJob(workerId)",
    );
  });
});
