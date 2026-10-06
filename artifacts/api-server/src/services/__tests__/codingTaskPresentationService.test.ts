import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  codingDashboardTaskPresentationStatus,
  codingTaskPresentationStatus,
} from "../codingTaskPresentationService.js";

describe("coding task presentation status", () => {
  it("shows explicit manual stops as CANCELLED on the operations dashboard", () => {
    expect(
      codingDashboardTaskPresentationStatus({
        taskNumber: "CWS-MANUAL-STOP",
        taskStatus: "READY_REVIEW",
        latestRunStatus: "COMPLETED",
        autonomousStatus: "DISABLED",
        autonomousEnabled: false,
        autonomousLastAction: "MANUAL_STOP",
        hasActiveRun: false,
        hasPendingCriticalApproval: false,
      }),
    ).toBe("CANCELLED");

    expect(
      codingDashboardTaskPresentationStatus({
        taskNumber: "CWS-TECHNICAL-BLOCKER",
        taskStatus: "READY_REVIEW",
        latestRunStatus: "COMPLETED",
        autonomousStatus: null,
        autonomousEnabled: null,
        autonomousLastAction: null,
        hasActiveRun: false,
        hasPendingCriticalApproval: false,
      }),
    ).toBe("BLOCKED");
  });

  it("shows completed Multi-Worker child shards as COMPLETED when no critical gate remains", () => {
    expect(
      codingDashboardTaskPresentationStatus({
        taskNumber: "MW-CWS-12345678-V1-WS-001-A1",
        taskStatus: "READY_REVIEW",
        latestRunStatus: "COMPLETED",
        autonomousStatus: null,
        hasActiveRun: false,
        hasPendingCriticalApproval: false,
      }),
    ).toBe("COMPLETED");

    expect(
      codingDashboardTaskPresentationStatus({
        taskNumber: "MW-CWS-12345678-V1-WS-001-A1",
        taskStatus: "READY_REVIEW",
        latestRunStatus: "COMPLETED",
        autonomousStatus: null,
        hasActiveRun: false,
        hasPendingCriticalApproval: true,
      }),
    ).toBe("READY_REVIEW");

    expect(
      codingDashboardTaskPresentationStatus({
        taskNumber: "MW-CWS-12345678-V1-WS-001-A1",
        taskStatus: "READY_REVIEW",
        latestRunStatus: "COMPLETED",
        autonomousStatus: "BLOCKED",
        hasActiveRun: false,
        hasPendingCriticalApproval: false,
      }),
    ).toBe("BLOCKED");
  });

  it("shows terminal autonomous failure instead of READY_REVIEW", () => {
    expect(
      codingTaskPresentationStatus({
        taskStatus: "READY_REVIEW",
        autonomousStatus: "FAILED",
        hasActiveRun: false,
      }),
    ).toBe("FAILED");
  });

  it("shows technical autonomous blockers as BLOCKED, not terminal failure or human review", () => {
    for (const taskStatus of ["READY_REVIEW", "FAILED", "ANALYZING"]) {
      expect(
        codingTaskPresentationStatus({
          taskStatus,
          autonomousStatus: "BLOCKED",
          hasActiveRun: false,
        }),
      ).toBe("BLOCKED");
    }
  });

  it("shows READY_REVIEW only for explicit approval-required state", () => {
    for (const taskStatus of ["READY_REVIEW", "FAILED", "ANALYZING"]) {
      expect(
        codingTaskPresentationStatus({
          taskStatus,
          autonomousStatus: "APPROVAL_REQUIRED",
          hasActiveRun: false,
        }),
      ).toBe("READY_REVIEW");
    }
  });


  it("does not show orphan READY_REVIEW without a real critical approval", () => {
    expect(
      codingTaskPresentationStatus({
        taskStatus: "READY_REVIEW",
        autonomousStatus: null,
        hasActiveRun: false,
        hasPendingCriticalApproval: false,
      }),
    ).toBe("BLOCKED");

    expect(
      codingTaskPresentationStatus({
        taskStatus: "READY_REVIEW",
        autonomousStatus: null,
        hasActiveRun: false,
        hasPendingCriticalApproval: true,
      }),
    ).toBe("READY_REVIEW");
  });

  it("shows active autonomous work as ANALYZING instead of READY_REVIEW", () => {
    expect(
      codingTaskPresentationStatus({
        taskStatus: "READY_REVIEW",
        autonomousStatus: "WAITING",
        hasActiveRun: false,
      }),
    ).toBe("ANALYZING");

    expect(
      codingTaskPresentationStatus({
        taskStatus: "READY_REVIEW",
        autonomousStatus: "ACTIVE",
        hasActiveRun: false,
      }),
    ).toBe("ANALYZING");
  });

  it("does not mask an active recovery run as READY_REVIEW", () => {
    expect(
      codingTaskPresentationStatus({
        taskStatus: "READY_REVIEW",
        autonomousStatus: "FAILED",
        hasActiveRun: true,
      }),
    ).toBe("ANALYZING");
  });

  it("shows verified autonomous completion over stale READY_REVIEW and FAILED", () => {
    for (const taskStatus of ["READY_REVIEW", "FAILED"]) {
      expect(
        codingTaskPresentationStatus({
          taskStatus,
          autonomousStatus: "COMPLETED",
          hasActiveRun: false,
        }),
      ).toBe("COMPLETED");
    }
  });

  it("shows a retry in progress over stale FAILED", () => {
    expect(
      codingTaskPresentationStatus({
        taskStatus: "FAILED",
        autonomousStatus: "ACTIVE",
        hasActiveRun: false,
      }),
    ).toBe("ANALYZING");
    expect(
      codingTaskPresentationStatus({
        taskStatus: "FAILED",
        autonomousStatus: "FAILED",
        hasActiveRun: true,
      }),
    ).toBe("ANALYZING");
  });

  it("keeps persisted terminal task states unchanged", () => {
    expect(
      codingTaskPresentationStatus({
        taskStatus: "COMPLETED",
        autonomousStatus: "FAILED",
        hasActiveRun: false,
      }),
    ).toBe("COMPLETED");
  });
  it("uses presentation status consistently in task detail and MCP progress endpoints", () => {
    const workspaceRoute = readFileSync(
      new URL("../../routes/coding-workspace.ts", import.meta.url),
      "utf8",
    );
    const chatRoute = readFileSync(
      new URL("../../routes/ai-core-chat.ts", import.meta.url),
      "utf8",
    );

    expect(workspaceRoute).toContain("const presentedStatus = codingTaskPresentationStatus({");
    expect(workspaceRoute).toContain("task: presentedTask");
    expect(chatRoute).toContain("const presentedStatus = codingTaskPresentationStatus({");
    expect(chatRoute).toContain("status: presentedStatus");
    expect(chatRoute).toContain("persistedStatus: task.status");
    const dashboardRoute = readFileSync(
      new URL("../../routes/aicoding-dashboard.ts", import.meta.url),
      "utf8",
    );
    expect(dashboardRoute).toContain("codingDashboardTaskPresentationStatus");
    expect(dashboardRoute).toContain("a.enabled AS autonomous_enabled");
    expect(dashboardRoute).toContain("a.last_action AS autonomous_last_action");
  });

  it("workspace list query includes active autonomous states for presentation mapping", () => {
    const source = readFileSync(
      new URL("../../routes/coding-workspace.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "a.status IN ('ACTIVE', 'WAITING', 'APPROVAL_REQUIRED', 'COMPLETED', 'FAILED', 'BLOCKED')",
    );
    expect(source).toContain("LEFT JOIN ai_platform.ai_coding_autonomous_tasks AS a");
    expect(source).toContain("AND a.enabled = TRUE");
    expect(source).toContain("FROM ai_platform.ai_coding_runs AS r");
  });

});

