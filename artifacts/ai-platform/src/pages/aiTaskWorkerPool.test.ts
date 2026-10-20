// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assessCodingDashboardWorker, assessPoolWorker, selectPoolCandidate, summarizePool, type WorkerPoolRecord } from "./aiTaskWorkerPool";

const now = Date.parse("2026-10-20T12:00:00Z");
const worker = (overrides: Partial<WorkerPoolRecord> = {}): WorkerPoolRecord => ({
  workerName: "openclaw-gpt02",
  status: "idle",
  leaseValid: true,
  availableSlots: 1,
  runningJobs: 0,
  maxConcurrentJobs: 1,
  lastHeartbeat: "2026-10-20T11:59:40Z",
  capabilities: ["coding_workstream"],
  ...overrides,
});

describe("AI Task worker pool evidence", () => {
  it("allows a verified idle coding worker as a read-only candidate", () => {
    expect(assessPoolWorker(worker(), now).state).toBe("available");
  });

  it("chooses an idle GPT03 candidate when GPT02 is busy", () => {
    const candidate = selectPoolCandidate([
      worker({ status: "busy", runningJobs: 1, availableSlots: 0 }),
      worker({ workerName: "openclaw-gpt03" }),
    ], "coding_workstream", now);
    expect(candidate?.worker.workerName).toBe("openclaw-gpt03");
  });

  it("never treats an online, stale, missing-lease or contradictory worker as available", () => {
    expect(assessPoolWorker(worker({ status: "online" }), now).state).toBe("unverified");
    expect(assessPoolWorker(worker({ lastHeartbeat: "2026-10-20T11:50:00Z" }), now).state).toBe("unverified");
    expect(assessPoolWorker(worker({ leaseValid: false }), now).state).toBe("unverified");
    expect(assessPoolWorker(worker({ availableSlots: 2 }), now).state).toBe("unverified");
    expect(assessPoolWorker(worker({ status: "offline" }), now).state).toBe("unavailable");
  });

  it("does not invent account bindings or cross-route to a worker lacking coding capability", () => {
    expect(selectPoolCandidate([worker({ capabilities: ["system_monitor"] })], "coding_workstream", now)).toBeNull();
    expect(summarizePool([worker(), worker({ status: "busy", runningJobs: 1, availableSlots: 0 })], now)).toMatchObject({
      available: 1, busy: 1, unavailable: 0, unverified: 0,
    });
  });

  it("refuses missing or future-dated heartbeat, and expired lease after a busy job", () => {
    expect(assessPoolWorker(worker({ lastHeartbeat: "" }), now).state).toBe("unverified");
    expect(assessPoolWorker(worker({ lastHeartbeat: "2026-10-20T12:02:00Z" }), now).state).toBe("unverified");
    expect(selectPoolCandidate([
      worker({ status: "busy", runningJobs: 1, availableSlots: 0, leaseValid: false }),
    ], "coding_workstream", now)).toBeNull();
  });
});

describe("AI Coding dashboard worker status", () => {
  const dashboard = {
    status: "online",
    healthy: true,
    runningJobs: 0,
    capacity: 1,
    lastHeartbeat: "2026-10-20T11:59:40Z",
    leaseExpiresAt: "2026-10-20T12:01:00Z",
  };
  it("distinguishes verified idle and busy workers without inventing ChatGPT bindings", () => {
    expect(assessCodingDashboardWorker(dashboard, now).state).toBe("available");
    expect(assessCodingDashboardWorker({ ...dashboard, runningJobs: 1 }, now).state).toBe("busy");
  });
  it("fails closed if lease, heartbeat or evidence is missing", () => {
    expect(assessCodingDashboardWorker({ ...dashboard, leaseExpiresAt: null }, now).state).toBe("unverified");
    expect(assessCodingDashboardWorker({ ...dashboard, healthy: false }, now).state).toBe("unverified");
    expect(assessCodingDashboardWorker({ ...dashboard, capacity: -1 }, now).state).toBe("unverified");
    expect(assessCodingDashboardWorker({ ...dashboard, status: "offline" }, now).state).toBe("unavailable");
  });
});
