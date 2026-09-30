import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  aiCodingRunsTable: {},
  aiCodingTasksTable: {},
}));

import { isRecoverableStaleCodingRun } from "../localCodingRunRecoveryService.js";

describe("local coding run recovery policy", () => {
  const now = new Date("2026-09-30T06:00:00.000Z");

  it("keeps a fresh terminal-task child run alive during its grace period", () => {
    expect(isRecoverableStaleCodingRun({
      taskStatus: "READY_REVIEW",
      runStatus: "RUNNING",
      startedAt: new Date(now.getTime() - 5 * 60_000),
      now,
      terminalStaleMs: 15 * 60_000,
    })).toBe(false);
  });

  it("recovers a terminal-task child run after the short stale threshold", () => {
    expect(isRecoverableStaleCodingRun({
      taskStatus: "READY_REVIEW",
      runStatus: "RUNNING",
      startedAt: new Date(now.getTime() - 20 * 60_000),
      now,
      terminalStaleMs: 15 * 60_000,
    })).toBe(true);
  });

  it("uses a longer threshold for active task lifecycles", () => {
    expect(isRecoverableStaleCodingRun({
      taskStatus: "ANALYZING",
      runStatus: "RUNNING",
      startedAt: new Date(now.getTime() - 89 * 60_000),
      now,
      activeStaleMs: 90 * 60_000,
    })).toBe(false);
    expect(isRecoverableStaleCodingRun({
      taskStatus: "ANALYZING",
      runStatus: "RUNNING",
      startedAt: new Date(now.getTime() - 91 * 60_000),
      now,
      activeStaleMs: 90 * 60_000,
    })).toBe(true);
  });

  it("never recovers a non-running lifecycle", () => {
    expect(isRecoverableStaleCodingRun({
      taskStatus: "READY_REVIEW",
      runStatus: "COMPLETED",
      startedAt: new Date(now.getTime() - 24 * 60 * 60_000),
      now,
    })).toBe(false);
  });
});
