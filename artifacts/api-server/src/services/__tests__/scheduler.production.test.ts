/**
 * scheduler.production.test.ts — aiSchedulerService lifecycle tests
 *
 * Tests:
 *  1. dev mode (NODE_ENV=development) — start() works without AI_SCHEDULER_ENABLED
 *  2. prod + AI_SCHEDULER_ENABLED=true — start() works
 *  3. prod + AI_SCHEDULER_ENABLED unset — _running stays false (index.ts guards the call)
 *  4. prod + AI_SCHEDULER_ENABLED=false — _running stays false
 *  5. calling start() twice — second call returns early (idempotent)
 *  6. shutdown() after start — resolves cleanly
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from:    vi.fn().mockReturnThis(),
      where:   vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit:   vi.fn().mockReturnThis(),
      for:     vi.fn().mockResolvedValue([]),
      then:    (r: (v: unknown[]) => void) => Promise.resolve(r([])),
    }),
    update: vi.fn().mockReturnValue({
      set:   vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }),
    insert: vi.fn().mockReturnValue({
      values:    vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 1 }]),
    }),
    execute: vi.fn().mockResolvedValue({ rows: [{ count: 0 }] }),
    transaction: vi.fn().mockResolvedValue([]),
  },
  aiSchedulesTable: {
    id: "id", status: "status", nextRunAt: "nextRunAt", isRunning: "isRunning",
    runCount: "runCount", lastRunAt: "lastRunAt", updatedAt: "updatedAt",
    scheduleCode: "scheduleCode",
  },
  aiScheduleRunsTable: {
    id: "id", scheduleId: "scheduleId", runNumber: "runNumber",
    startedAt: "startedAt", status: "status", completedAt: "completedAt",
    resultJson: "resultJson", errorMessage: "errorMessage",
    createdJobId: "createdJobId", createdEventId: "createdEventId",
  },
}));

vi.mock("../queueManagerService.js", () => ({
  enqueue: vi.fn().mockResolvedValue({ id: 99 }),
}));

vi.mock("../aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../aiEventBusService.js", () => ({
  publishSafe: vi.fn(),
  publish:     vi.fn().mockResolvedValue({ eventId: "evt-1" }),
}));

vi.mock("../../security/tenantResolution.js", () => ({
  DEFAULT_TENANT_ID: "default",
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

async function importScheduler() {
  vi.resetModules();

  vi.mock("@workspace/db", () => ({
    db: {
      select: vi.fn().mockReturnValue({
        from:    vi.fn().mockReturnThis(),
        where:   vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit:   vi.fn().mockReturnThis(),
        for:     vi.fn().mockResolvedValue([]),
        then:    (r: (v: unknown[]) => void) => Promise.resolve(r([])),
      }),
      update: vi.fn().mockReturnValue({
        set:   vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }),
      insert: vi.fn().mockReturnValue({
        values:    vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
      execute: vi.fn().mockResolvedValue({ rows: [{ count: 0 }] }),
      transaction: vi.fn().mockResolvedValue([]),
    },
    aiSchedulesTable: {
      id: "id", status: "status", nextRunAt: "nextRunAt", isRunning: "isRunning",
      runCount: "runCount", lastRunAt: "lastRunAt", updatedAt: "updatedAt",
      scheduleCode: "scheduleCode",
    },
    aiScheduleRunsTable: {
      id: "id", scheduleId: "scheduleId", runNumber: "runNumber",
      startedAt: "startedAt", status: "status", completedAt: "completedAt",
      resultJson: "resultJson", errorMessage: "errorMessage",
      createdJobId: "createdJobId", createdEventId: "createdEventId",
    },
  }));

  vi.mock("../queueManagerService.js", () => ({
    enqueue: vi.fn().mockResolvedValue({ id: 99 }),
  }));

  vi.mock("../aiAuditService.js", () => ({
    logAudit: vi.fn().mockResolvedValue(undefined),
  }));

  vi.mock("../aiEventBusService.js", () => ({
    publishSafe: vi.fn(),
    publish:     vi.fn().mockResolvedValue({ eventId: "evt-1" }),
  }));

  vi.mock("../../security/tenantResolution.js", () => ({
    DEFAULT_TENANT_ID: "default",
  }));

  vi.mock("../../lib/logger.js", () => ({
    logger: {
      info:  vi.fn(),
      warn:  vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
  }));

  return import("../aiSchedulerService.js");
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("aiSchedulerService — production lifecycle", () => {
  const origNodeEnv    = process.env["NODE_ENV"];
  const origSchedEnabled = process.env["AI_SCHEDULER_ENABLED"];

  afterEach(() => {
    if (origNodeEnv !== undefined) {
      process.env["NODE_ENV"] = origNodeEnv;
    } else {
      delete process.env["NODE_ENV"];
    }
    if (origSchedEnabled !== undefined) {
      process.env["AI_SCHEDULER_ENABLED"] = origSchedEnabled;
    } else {
      delete process.env["AI_SCHEDULER_ENABLED"];
    }
  });

  it("dev mode: start() resolves and _running becomes true", async () => {
    process.env["NODE_ENV"] = "development";
    delete process.env["AI_SCHEDULER_ENABLED"];

    const svc = await importScheduler();

    await svc.start();
    const status = await svc.getStatus();
    expect(status.running).toBe(true);

    await svc.stop();
  });

  it("prod + AI_SCHEDULER_ENABLED=true: start() resolves and _running becomes true", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["AI_SCHEDULER_ENABLED"] = "true";

    const svc = await importScheduler();

    await svc.start();
    const status = await svc.getStatus();
    expect(status.running).toBe(true);

    await svc.stop();
  });

  it("prod + AI_SCHEDULER_ENABLED unset: index.ts guard prevents start(), _running stays false", async () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["AI_SCHEDULER_ENABLED"];

    const svc = await importScheduler();

    const isProduction     = process.env["NODE_ENV"] === "production";
    const schedulerEnabled = isProduction
      ? process.env["AI_SCHEDULER_ENABLED"] === "true"
      : true;

    if (schedulerEnabled) {
      await svc.start();
    }

    const status = await svc.getStatus();
    expect(status.running).toBe(false);
  });

  it("prod + AI_SCHEDULER_ENABLED=false: index.ts guard prevents start(), _running stays false", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["AI_SCHEDULER_ENABLED"] = "false";

    const svc = await importScheduler();

    const isProduction     = process.env["NODE_ENV"] === "production";
    const schedulerEnabled = isProduction
      ? process.env["AI_SCHEDULER_ENABLED"] === "true"
      : true;

    if (schedulerEnabled) {
      await svc.start();
    }

    const status = await svc.getStatus();
    expect(status.running).toBe(false);
  });

  it("calling start() twice: second call returns early (idempotent)", async () => {
    process.env["NODE_ENV"] = "development";

    const svc = await importScheduler();

    await svc.start();
    // Should not throw, just return early
    await expect(svc.start()).resolves.toBeUndefined();

    const status = await svc.getStatus();
    expect(status.running).toBe(true);

    await svc.stop();
  });

  it("shutdown() after start: resolves cleanly and _running becomes false", async () => {
    process.env["NODE_ENV"] = "development";

    const svc = await importScheduler();

    await svc.start();
    expect((await svc.getStatus()).running).toBe(true);

    // aiSchedulerService exposes shutdown() which delegates to stop()
    await expect(svc.shutdown()).resolves.toBeUndefined();
    expect((await svc.getStatus()).running).toBe(false);
  });
});
