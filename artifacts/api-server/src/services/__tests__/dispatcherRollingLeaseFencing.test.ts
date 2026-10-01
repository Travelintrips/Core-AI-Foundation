import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
});
