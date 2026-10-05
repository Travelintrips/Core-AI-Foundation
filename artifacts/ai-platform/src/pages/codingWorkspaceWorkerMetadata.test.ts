// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./coding-workspace.tsx", import.meta.url),
  "utf8",
);

describe("coding workspace worker metadata presentation", () => {
  it("shows explicit task operational states instead of one generic analyzing label", () => {
    expect(source).toContain("ANALYZING_RUNNING");
    expect(source).toContain("WAITING_FOR_WORKER");
    expect(source).toContain("QUEUED");
    expect(source).toContain("WAITING_FOR_CAPACITY");
    expect(source).toContain("OperationalStatusBadge");
    expect(source).toContain("monitor?.taskStates?.[task.id]");
  });

  it("surfaces worker activity from live lease-aware monitor data", () => {
    expect(source).toContain('label: "Worker Active"');
    expect(source).toContain("worker.leaseValid");
    expect(source).toContain("worker.heartbeatAgeMs");
  });
  it("surfaces retired legacy worker suppression without presenting it as provider failure", () => {
    expect(source).toContain("retiredLegacy?: number");
    expect(source).toContain("legacy retired hidden");
    expect(source).toContain("monitor.workers.retiredLegacy");
  });
});
