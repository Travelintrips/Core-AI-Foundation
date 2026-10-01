import { describe, expect, it } from "vitest";
import {
  codingRunPresentationError,
  codingRunPresentationStatus,
} from "./codingRunPresentation";

describe("coding run presentation", () => {
  it("shows a legacy completed multi-worker run as failed when the task summary records constrained AI failure", () => {
    const status = codingRunPresentationStatus({
      runStatus: "COMPLETED",
      agentName: "Multi-Worker WS-002",
      taskStatus: "READY_REVIEW",
      taskResultSummary:
        "Per-workstream constrained AI failed after the one-shot authorization was consumed. Prepare a fresh workstream AI handoff.",
      isLatestRun: true,
    });

    expect(status).toBe("FAILED");
    expect(
      codingRunPresentationError({
        displayedStatus: status,
        taskResultSummary:
          "Per-workstream constrained AI failed after the one-shot authorization was consumed.",
      }),
    ).toMatch(/constrained AI failed/i);
  });

  it("keeps a successful completed multi-worker run as completed", () => {
    expect(
      codingRunPresentationStatus({
        runStatus: "COMPLETED",
        agentName: "Multi-Worker WS-001",
        taskStatus: "COMPLETED",
        taskResultSummary: "Workstream completed successfully.",
        isLatestRun: true,
      }),
    ).toBe("COMPLETED");
  });

  it("does not rewrite historical runs or unrelated agents", () => {
    expect(
      codingRunPresentationStatus({
        runStatus: "COMPLETED",
        agentName: "Multi-Worker WS-002",
        taskStatus: "READY_REVIEW",
        taskResultSummary: "Per-workstream constrained AI failed.",
        isLatestRun: false,
      }),
    ).toBe("COMPLETED");

    expect(
      codingRunPresentationStatus({
        runStatus: "COMPLETED",
        agentName: "Repository Analyzer",
        taskStatus: "FAILED",
        taskResultSummary: "Repository analysis failed.",
        isLatestRun: true,
      }),
    ).toBe("COMPLETED");
  });

  it("keeps actual running state untouched so worker activity is based on real lifecycle state", () => {
    expect(
      codingRunPresentationStatus({
        runStatus: "RUNNING",
        agentName: "Multi-Worker WS-002",
        taskStatus: "FAILED",
        taskResultSummary: "Per-workstream constrained AI failed.",
        isLatestRun: true,
      }),
    ).toBe("RUNNING");
  });
});
