import { readFileSync } from "node:fs";
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

  it("keeps stale active task recovery nonterminal and callback-capable", () => {
    const source = readFileSync(
      new URL("../localCodingRunRecoveryService.ts", import.meta.url),
      "utf8",
    );
    const recoveryBlock = source.slice(
      source.indexOf('if (ACTIVE_TASK_STATUSES.has(task.status))'),
      source.indexOf('export interface CodingTestTaskRetentionResult'),
    );

    expect(recoveryBlock).toContain('status: "BLOCKED"');
    expect(recoveryBlock).toContain("status = 'BLOCKED'");
    expect(recoveryBlock).toContain("last_action = 'RECOVERABLE_OPERATIONAL_FAILURE'");
    expect(recoveryBlock).toContain('status: "BLOCKED"');
    expect(recoveryBlock).toContain('source: "coding-run-stale-recovery"');
    expect(recoveryBlock).not.toContain('status: "READY_REVIEW",\n            resultSummary');
    expect(recoveryBlock).not.toContain('status: "FAILED",\n            resultSummary');
    expect(recoveryBlock).not.toContain("enabled = FALSE");
  });

  it("reconciles only detached completed Multi-Worker shards and preserves live/critical work", () => {
    const source = readFileSync(
      new URL("../localCodingRunRecoveryService.ts", import.meta.url),
      "utf8",
    );

    const start = source.indexOf("export async function reconcileDetachedCompletedMultiWorkerTasks");
    const end = source.indexOf("export async function reconcileStaleCodingRuns", start);
    const block = source.slice(start, end);

    expect(block).toContain("t.task_number LIKE 'MW-%'");
    expect(block).toContain("t.status IN ('ANALYZING', 'READY_REVIEW')");
    expect(block).toContain("FROM ai_platform.ai_coding_workstreams AS w");
    expect(block).toContain("active_run.status = 'RUNNING'");
    expect(block).toContain("active_job.status IN ('queued', 'waiting', 'retrying', 'running')");
    expect(block).toContain("approval.status IN ('PENDING', 'REQUESTED', 'AWAITING_APPROVAL')");
    expect(block).toContain("autonomous.last_action = 'MANUAL_STOP'");
    expect(block).toContain("latest_run.status");
    expect(block).toContain("= 'COMPLETED'");
    expect(block).toContain("SET status = 'COMPLETED'");
  });

  it("reconciles orphan parent lifecycle rows and releases only orphan reservations", () => {
    const source = readFileSync(
      new URL("../localCodingRunRecoveryService.ts", import.meta.url),
      "utf8",
    );

    const start = source.indexOf("export async function reconcileOrphanedParentTaskLifecycle");
    const end = source.indexOf("export async function reconcileStaleCodingRuns", start);
    const block = source.slice(start, end);

    expect(block).toContain("ai_coding_active_file_reservations");
    expect(block).toContain("job.status IN ('queued', 'waiting', 'retrying', 'running')");
    expect(block).toContain("graph.status IN ('PREPARED', 'APPROVED', 'RUNNING')");
    expect(block).toContain("workstream.status IN ('PENDING', 'READY', 'CLAIMED', 'RUNNING', 'REVIEW_REQUIRED')");
    expect(block).toContain("approval.status IN ('PENDING', 'REQUESTED', 'AWAITING_APPROVAL')");
    expect(block).toContain("task.status IN ('ANALYZING', 'READY_REVIEW', 'BLOCKED')");
    expect(block).toContain("THEN 'COMPLETED'");
    expect(block).toContain("ELSE 'FAILED'");
    expect(block).toContain("last_action = 'STALE_LIFECYCLE_RECONCILED'");
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
