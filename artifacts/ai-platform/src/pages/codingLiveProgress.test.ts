import { describe, expect, it } from "vitest";
import {
  deriveCodingLiveProgress,
  formatCodingElapsed,
} from "./codingLiveProgress";

describe("coding live progress", () => {
  it("surfaces the analyzer slot blocker instead of generic ANALYZING", () => {
    const progress = deriveCodingLiveProgress({
      taskStatus: "ANALYZING",
      runStatus: "RUNNING",
      agentName: "Coding Orchestrator",
      runStartedAt: "2026-10-02T08:27:07.000Z",
      orchestration: {
        status: "WAITING",
        nextAction: "WAIT_REPOSITORY_ANALYZER_SLOT",
        activeAnalyzerJobId: 2027,
        stages: [],
      },
    });

    expect(progress).toMatchObject({
      phase: "WAITING_FOR_ANALYZER",
      percent: 12,
      blockerJobId: 2027,
    });
    expect(progress.detail).toContain("#2027");
  });

  it("uses the running orchestration stage when one is available", () => {
    const progress = deriveCodingLiveProgress({
      taskStatus: "ANALYZING",
      runStatus: "RUNNING",
      agentName: "Coding Orchestrator",
      runStartedAt: "2026-10-02T08:27:07.000Z",
      orchestration: {
        status: "RUNNING",
        nextAction: "ANALYZE_REPOSITORY",
        stages: [{
          id: "repository_analyzer",
          label: "Repository Analyzer",
          status: "RUNNING",
          detail: "Scanning repository context.",
          startedAt: "2026-10-02T08:27:10.000Z",
        }],
      },
    });

    expect(progress).toMatchObject({
      phase: "REPOSITORY_ANALYZER",
      label: "Repository Analyzer",
      detail: "Scanning repository context.",
      percent: 28,
      startedAt: "2026-10-02T08:27:10.000Z",
    });
  });

  it("falls back to task lifecycle progress when live stage metadata is absent", () => {
    expect(deriveCodingLiveProgress({
      taskStatus: "TESTING",
      runStatus: "RUNNING",
      agentName: "Test Agent",
    })).toMatchObject({
      phase: "TESTING",
      label: "Running verification",
      percent: 75,
    });
  });

  it("formats elapsed time for a live task", () => {
    expect(formatCodingElapsed(
      "2026-10-02T08:27:00.000Z",
      Date.parse("2026-10-02T08:29:05.000Z"),
    )).toBe("2m 5s");
  });
});
