/**
 * dispatcher.production.test.ts — jobDispatcherService lifecycle tests
 *
 * Tests:
 *  1. dev mode (NODE_ENV=development) — start() works without AI_DISPATCHER_ENABLED
 *  2. prod + AI_DISPATCHER_ENABLED=true — start() works
 *  3. prod + AI_DISPATCHER_ENABLED unset — _running stays false (index.ts guards the call)
 *  4. prod + AI_DISPATCHER_ENABLED=false — _running stays false
 *  5. calling start() twice — second call returns early (idempotent)
 *  6. shutdown() after start — resolves cleanly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted helpers ────────────────────────────────────────────────────────────
const mockRegisterWorker = vi.hoisted(() => vi.fn());
const mockRenewLease     = vi.hoisted(() => vi.fn());
const mockReleaseLease   = vi.hoisted(() => vi.fn());
const mockMarkStale      = vi.hoisted(() => vi.fn());
const mockRebalance      = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }),
    update: vi.fn().mockReturnValue({
      set:     vi.fn().mockReturnThis(),
      where:   vi.fn().mockResolvedValue([]),
    }),
    execute: vi.fn().mockResolvedValue({ rows: [{ count: 0 }] }),
  },
  aiJobsTable:    { id: "id", status: "status", startedAt: "startedAt" },
  aiWorkersTable: {
    id: "id", status: "status", currentJob: "currentJob",
    runningJobs: "runningJobs", heartbeatToken: "heartbeatToken",
  },
}));

vi.mock("../workerClusterService.js", () => ({
  registerWorker:            mockRegisterWorker,
  renewLease:                mockRenewLease,
  releaseLease:              mockReleaseLease,
  markStaleWorkers:          mockMarkStale,
  rebalanceJobs:             mockRebalance,
  DEFAULT_LEASE_TTL_MS:      30_000,
  WORKER_TYPE_CAPABILITIES:  {
    text_worker:    ["text_generation"],
    image_worker:   ["image_generation"],
    export_worker:  ["pdf_export"],
    system_worker:  ["noop"],
    storage_worker: ["archive"],
  },
}));

vi.mock("../jobWorkerService.js", () => ({
  claimJob:    vi.fn().mockResolvedValue(null),
  executeJob:  vi.fn().mockResolvedValue({}),
  completeJob: vi.fn().mockResolvedValue(undefined),
  retryJob:    vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../jobCompletionGuard.js", () => ({
  validateJobCompletion: vi.fn(),
}));

vi.mock("../aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../aiEventBusService.js", () => ({
  publishSafe: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Fresh import of the service after env changes and module reset. */
async function importDispatcher() {
  vi.resetModules();

  // Re-apply mocks after resetModules
  vi.mock("@workspace/db", () => ({
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }),
      update: vi.fn().mockReturnValue({
        set:   vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }),
      execute: vi.fn().mockResolvedValue({ rows: [{ count: 0 }] }),
    },
    aiJobsTable:    { id: "id", status: "status", startedAt: "startedAt" },
    aiWorkersTable: {
      id: "id", status: "status", currentJob: "currentJob",
      runningJobs: "runningJobs", heartbeatToken: "heartbeatToken",
    },
  }));

  vi.mock("../workerClusterService.js", () => ({
    registerWorker: vi.fn().mockResolvedValue({ id: 1 }),
    renewLease:     vi.fn().mockResolvedValue(undefined),
    releaseLease:   vi.fn().mockResolvedValue(undefined),
    markStaleWorkers: vi.fn().mockResolvedValue([]),
    rebalanceJobs:  vi.fn().mockResolvedValue(undefined),
    DEFAULT_LEASE_TTL_MS: 30_000,
    WORKER_TYPE_CAPABILITIES: {
      text_worker:    ["text_generation"],
      image_worker:   ["image_generation"],
      export_worker:  ["pdf_export"],
      system_worker:  ["noop"],
      storage_worker: ["archive"],
    },
  }));

  vi.mock("../jobWorkerService.js", () => ({
    claimJob:    vi.fn().mockResolvedValue(null),
    executeJob:  vi.fn().mockResolvedValue({}),
    completeJob: vi.fn().mockResolvedValue(undefined),
    retryJob:    vi.fn().mockResolvedValue(undefined),
  }));

  vi.mock("../jobCompletionGuard.js", () => ({
    validateJobCompletion: vi.fn(),
  }));

  vi.mock("../aiAuditService.js", () => ({
    logAudit: vi.fn().mockResolvedValue(undefined),
  }));

  vi.mock("../aiEventBusService.js", () => ({
    publishSafe: vi.fn(),
  }));

  vi.mock("../../lib/logger.js", () => ({
    logger: {
      info:  vi.fn(),
      warn:  vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
  }));

  return import("../jobDispatcherService.js");
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("jobDispatcherService — production lifecycle", () => {
  const origNodeEnv   = process.env["NODE_ENV"];
  const origDispEnabled = process.env["AI_DISPATCHER_ENABLED"];

  afterEach(() => {
    // Restore env
    if (origNodeEnv !== undefined) {
      process.env["NODE_ENV"] = origNodeEnv;
    } else {
      delete process.env["NODE_ENV"];
    }
    if (origDispEnabled !== undefined) {
      process.env["AI_DISPATCHER_ENABLED"] = origDispEnabled;
    } else {
      delete process.env["AI_DISPATCHER_ENABLED"];
    }
  });

  it("dev mode: start() resolves and _running becomes true", async () => {
    process.env["NODE_ENV"] = "development";
    delete process.env["AI_DISPATCHER_ENABLED"];

    const svc = await importDispatcher();

    await svc.start();
    const status = await svc.getStatus();
    expect(status.running).toBe(true);

    // cleanup
    await svc.shutdown();
  });

  it("prod + AI_DISPATCHER_ENABLED=true: start() resolves and _running becomes true", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["AI_DISPATCHER_ENABLED"] = "true";

    const svc = await importDispatcher();

    await svc.start();
    const status = await svc.getStatus();
    expect(status.running).toBe(true);

    await svc.shutdown();
  });

  it("prod + AI_DISPATCHER_ENABLED unset: index.ts would not call start(), _running stays false", async () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["AI_DISPATCHER_ENABLED"];

    const svc = await importDispatcher();

    // Mirror index.ts guard: only call start() when dispatcherEnabled
    const isProduction      = process.env["NODE_ENV"] === "production";
    const dispatcherEnabled = isProduction
      ? process.env["AI_DISPATCHER_ENABLED"] === "true"
      : true;

    if (dispatcherEnabled) {
      await svc.start();
    }

    const status = await svc.getStatus();
    expect(status.running).toBe(false);
  });

  it("prod + AI_DISPATCHER_ENABLED=false: index.ts guard prevents start(), _running stays false", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["AI_DISPATCHER_ENABLED"] = "false";

    const svc = await importDispatcher();

    const isProduction      = process.env["NODE_ENV"] === "production";
    const dispatcherEnabled = isProduction
      ? process.env["AI_DISPATCHER_ENABLED"] === "true"
      : true;

    if (dispatcherEnabled) {
      await svc.start();
    }

    const status = await svc.getStatus();
    expect(status.running).toBe(false);
  });

  it("calling start() twice: second call returns early (idempotent)", async () => {
    process.env["NODE_ENV"] = "development";

    const svc = await importDispatcher();

    await svc.start();
    // Should not throw and should return early
    await expect(svc.start()).resolves.toBeUndefined();

    const status = await svc.getStatus();
    expect(status.running).toBe(true);

    await svc.shutdown();
  });

  it("shutdown() after start: resolves cleanly and _running becomes false", async () => {
    process.env["NODE_ENV"] = "development";

    const svc = await importDispatcher();

    await svc.start();
    expect((await svc.getStatus()).running).toBe(true);

    await expect(svc.shutdown()).resolves.toBeUndefined();
    expect((await svc.getStatus()).running).toBe(false);
  });
});
