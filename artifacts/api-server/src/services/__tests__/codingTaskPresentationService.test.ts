import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  codingDashboardTaskPresentationStatus,
  codingTaskPresentationStatus,
} from "../codingTaskPresentationService.js";

describe("coding task presentation status", () => {
  it("maps workstream lifecycle to operational states without fake human review", () => {
    expect(codingTaskPresentationStatus({
      taskStatus: "READY_REVIEW",
      workstreamStatus: "REVIEW_REQUIRED",
      hasPendingCriticalApproval: false,
    })).toBe("TESTING");

    expect(codingTaskPresentationStatus({
      taskStatus: "READY_REVIEW",
      workstreamStatus: "REVIEW_REQUIRED",
      hasPendingCriticalApproval: true,
    })).toBe("READY_REVIEW");

    expect(codingTaskPresentationStatus({
      taskStatus: "READY_REVIEW",
      workstreamStatus: "RUNNING",
    })).toBe("CODING");

    expect(codingTaskPresentationStatus({
      taskStatus: "READY_REVIEW",
      workstreamStatus: "COMPLETED",
    })).toBe("COMPLETED");
  });

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

  it("uses live workstream status before detached child-run heuristics", () => {
    expect(
      codingDashboardTaskPresentationStatus({
        taskNumber: "MW-CWS-12345678-V1-WS-001-A1",
        taskStatus: "READY_REVIEW",
        latestRunStatus: "COMPLETED",
        autonomousStatus: null,
        hasActiveRun: false,
        hasPendingCriticalApproval: false,
        workstreamStatus: "REVIEW_REQUIRED",
      }),
    ).toBe("TESTING");
  });

  it("shows detached completed Multi-Worker shards as COMPLETED even when persistence is stuck ANALYZING", () => {
    expect(
      codingDashboardTaskPresentationStatus({
        taskNumber: "MW-CWS-12345678-V1-WS-001-A1",
        taskStatus: "ANALYZING",
        latestRunStatus: "COMPLETED",
        autonomousStatus: null,
        hasActiveRun: false,
        hasPendingCriticalApproval: false,
      }),
    ).toBe("COMPLETED");
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

  it("shows READY_REVIEW only when a live critical approval exists", () => {
    for (const taskStatus of ["READY_REVIEW", "FAILED", "ANALYZING"]) {
      expect(
        codingTaskPresentationStatus({
          taskStatus,
          autonomousStatus: "APPROVAL_REQUIRED",
          hasActiveRun: false,
          hasPendingCriticalApproval: false,
        }),
      ).toBe("BLOCKED");

      expect(
        codingTaskPresentationStatus({
          taskStatus,
          autonomousStatus: "APPROVAL_REQUIRED",
          hasActiveRun: false,
          hasPendingCriticalApproval: true,
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

  it("requires live run or job evidence before showing ANALYZING", () => {
    for (const autonomousStatus of ["WAITING", "ACTIVE"]) {
      expect(
        codingTaskPresentationStatus({
          taskStatus: "READY_REVIEW",
          autonomousStatus,
          hasActiveRun: false,
          hasActiveJob: false,
        }),
      ).toBe("BLOCKED");
    }

    expect(
      codingTaskPresentationStatus({
        taskStatus: "READY_REVIEW",
        autonomousStatus: "WAITING",
        hasActiveRun: true,
        hasActiveJob: false,
      }),
    ).toBe("ANALYZING");

    expect(
      codingTaskPresentationStatus({
        taskStatus: "READY_REVIEW",
        autonomousStatus: "ACTIVE",
        hasActiveRun: false,
        hasActiveJob: true,
      }),
    ).toBe("ANALYZING");
  });

  it("uses latest terminal run truth for stale persisted ANALYZING", () => {
    expect(
      codingTaskPresentationStatus({
        taskStatus: "ANALYZING",
        autonomousStatus: "WAITING",
        latestRunStatus: "FAILED",
        hasActiveRun: false,
        hasActiveJob: false,
      }),
    ).toBe("FAILED");

    expect(
      codingTaskPresentationStatus({
        taskStatus: "ANALYZING",
        autonomousStatus: "WAITING",
        latestRunStatus: "COMPLETED",
        hasActiveRun: false,
        hasActiveJob: false,
      }),
    ).toBe("BLOCKED");

    expect(
      codingTaskPresentationStatus({
        taskStatus: "ANALYZING",
        autonomousStatus: "COMPLETED",
        latestRunStatus: "COMPLETED",
        hasActiveRun: false,
        hasActiveJob: false,
      }),
    ).toBe("COMPLETED");
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

  it("shows a retry in progress only when live execution exists", () => {
    expect(
      codingTaskPresentationStatus({
        taskStatus: "FAILED",
        autonomousStatus: "ACTIVE",
        hasActiveRun: false,
        hasActiveJob: false,
      }),
    ).toBe("BLOCKED");
    expect(
      codingTaskPresentationStatus({
        taskStatus: "FAILED",
        autonomousStatus: "ACTIVE",
        hasActiveRun: false,
        hasActiveJob: true,
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

  it("does not present a false-completed parent as complete when autonomy is waiting", () => {
    for (const autonomousStatus of ["ACTIVE", "WAITING"]) {
      expect(codingTaskPresentationStatus({
        taskStatus: "COMPLETED",
        autonomousStatus,
        latestRunStatus: "COMPLETED",
        hasActiveRun: false,
        hasActiveJob: false,
        hasVerifiedCompletionEvidence: false,
      })).toBe("BLOCKED");
    }
    expect(codingTaskPresentationStatus({
      taskStatus: "COMPLETED",
      autonomousStatus: "COMPLETED",
      hasVerifiedCompletionEvidence: true,
    })).toBe("COMPLETED");
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

  it("routes retry/requeue commands to the existing task without a new coding job", () => {
    const source = readFileSync(new URL("../../routes/ai-core-chat.ts", import.meta.url), "utf8");
    expect(source).toMatch(/const EXISTING_CWS_RESUME = [^;]*retry[^;]*requeue/);
    expect(source).toContain('operation: "TASK_RETRY"');
    expect(source).toContain('accepted: true');
    expect(source).toContain('const existingTaskLifecycle = await runExistingCodingTaskLifecycleCommand(contextualCommand)');
    expect(source).toContain('if (existingTaskLifecycle) return existingTaskLifecycle');
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
    expect(source).toContain("AS latest_run_status");
    expect(source).toContain("AS has_active_job");
    expect(source).toContain("WHERE has_active_run = TRUE");
    expect(source).toContain("OR has_active_job = TRUE");
    expect(source).not.toContain("OR autonomous_status IN ('ACTIVE', 'WAITING')");
  });

});

