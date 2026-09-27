import { describe, expect, it } from "vitest";
import {
  decideCiSelfRepair,
  resolveCiSelfRepairMaxAttempts,
} from "../localCodingCiSelfRepairService.js";

describe("bounded CI self-repair policy", () => {
  it("waits for check-run diagnostics instead of double-triggering from workflow_run", () => {
    expect(
      decideCiSelfRepair({
        eventType: "coding.github.workflow_run",
        headSha: "a".repeat(40),
        headBranch: "ai-integration/task-1",
        previousCheckpoint: {},
        maxAttempts: 3,
      }),
    ).toEqual({ action: "WAIT_FOR_CHECK_DIAGNOSTICS", attempt: 0 });
  });

  it("schedules the first bounded repair from a failed check_run", () => {
    expect(
      decideCiSelfRepair({
        eventType: "coding.github.check_run",
        headSha: "a".repeat(40),
        headBranch: "ai-integration/task-1",
        previousCheckpoint: {},
        maxAttempts: 3,
      }),
    ).toEqual({ action: "SCHEDULE", attempt: 1, maxAttempts: 3 });
  });

  it("deduplicates repeated failure events for the same head", () => {
    expect(
      decideCiSelfRepair({
        eventType: "coding.github.check_run",
        headSha: "b".repeat(40),
        headBranch: "ai-integration/task-1",
        previousCheckpoint: {
          ciSelfRepair: {
            status: "SCHEDULED",
            attempt: 1,
            scheduledForHeadSha: "b".repeat(40),
          },
        },
        maxAttempts: 3,
      }),
    ).toEqual({ action: "DUPLICATE", attempt: 1 });
  });

  it("increments attempts for a new repaired head and stops after the cap", () => {
    const checkpoint = {
      ciSelfRepair: {
        status: "WAITING_CI",
        attempt: 2,
        scheduledForHeadSha: "a".repeat(40),
      },
    };

    expect(
      decideCiSelfRepair({
        eventType: "coding.github.check_run",
        headSha: "c".repeat(40),
        headBranch: "ai-integration/task-1",
        previousCheckpoint: checkpoint,
        maxAttempts: 3,
      }),
    ).toEqual({ action: "SCHEDULE", attempt: 3, maxAttempts: 3 });

    expect(
      decideCiSelfRepair({
        eventType: "coding.github.check_run",
        headSha: "d".repeat(40),
        headBranch: "ai-integration/task-1",
        previousCheckpoint: {
          ciSelfRepair: { status: "WAITING_CI", attempt: 3 },
        },
        maxAttempts: 3,
      }),
    ).toEqual({ action: "EXHAUSTED", attempt: 3, maxAttempts: 3 });
  });

  it("bounds the configured retry limit", () => {
    expect(resolveCiSelfRepairMaxAttempts("0")).toBe(1);
    expect(resolveCiSelfRepairMaxAttempts("3")).toBe(3);
    expect(resolveCiSelfRepairMaxAttempts("99")).toBe(5);
  });
});
