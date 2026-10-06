import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codingTaskPresentationStatus } from "../codingTaskPresentationService.js";

describe("coding task presentation status", () => {
  it("shows terminal autonomous failure instead of READY_REVIEW", () => {
    expect(
      codingTaskPresentationStatus({
        taskStatus: "READY_REVIEW",
        autonomousStatus: "FAILED",
        hasActiveRun: false,
      }),
    ).toBe("FAILED");
  });

  it("shows autonomous blockers as review-required instead of false failure", () => {
    for (const taskStatus of ["READY_REVIEW", "FAILED"]) {
      expect(
        codingTaskPresentationStatus({
          taskStatus,
          autonomousStatus: "BLOCKED",
          hasActiveRun: false,
        }),
      ).toBe("READY_REVIEW");
    }
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
  });

  it("workspace list query includes active autonomous states for presentation mapping", () => {
    const source = readFileSync(
      new URL("../../routes/coding-workspace.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "a.status IN ('ACTIVE', 'WAITING', 'COMPLETED', 'FAILED', 'BLOCKED')",
    );
    expect(source).toContain("LEFT JOIN ai_platform.ai_coding_autonomous_tasks AS a");
    expect(source).toContain("AND a.enabled = TRUE");
    expect(source).toContain("FROM ai_platform.ai_coding_runs AS r");
  });

});

