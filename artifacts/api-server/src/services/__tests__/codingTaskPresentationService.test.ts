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

    expect(
      codingTaskPresentationStatus({
        taskStatus: "READY_REVIEW",
        autonomousStatus: "BLOCKED",
        hasActiveRun: false,
      }),
    ).toBe("FAILED");
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

  it("shows verified autonomous completion over stale READY_REVIEW and FAILED", () => {\n    for (const taskStatus of ["READY_REVIEW", "FAILED"]) {\n      expect(\n        codingTaskPresentationStatus({\n          taskStatus,\n          autonomousStatus: "COMPLETED",\n          hasActiveRun: false,\n        }),\n      ).toBe("COMPLETED");\n    }\n  });\n\n  it("shows a retry in progress over stale FAILED", () => {\n    expect(\n      codingTaskPresentationStatus({\n        taskStatus: "FAILED",\n        autonomousStatus: "ACTIVE",\n        hasActiveRun: false,\n      }),\n    ).toBe("ANALYZING");\n    expect(\n      codingTaskPresentationStatus({\n        taskStatus: "FAILED",\n        autonomousStatus: "FAILED",\n        hasActiveRun: true,\n      }),\n    ).toBe("ANALYZING");\n  });

  it("keeps persisted terminal task states unchanged", () => {
    expect(
      codingTaskPresentationStatus({
        taskStatus: "COMPLETED",
        autonomousStatus: "FAILED",
        hasActiveRun: false,
      }),
    ).toBe("COMPLETED");
  });
  it("workspace list query includes active autonomous states for presentation mapping", () => {
    const source = readFileSync(
      new URL("../../routes/coding-workspace.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "a.status IN ('ACTIVE', 'WAITING', 'COMPLETED', 'FAILED', 'BLOCKED')",
    );
    expect(source).toContain("WHERE a.enabled = TRUE");
  });

});
