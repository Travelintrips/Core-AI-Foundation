import { describe, expect, it } from "vitest";
import { lifecycleEventBridgeEnabled, mapPersistedResponseToLifecycleEvent } from "../jobLifecycleEventBridgeService.js";

describe("Job lifecycle informational event bridge", () => {
  it("defaults to off unless explicitly opted in", () => {
    expect(lifecycleEventBridgeEnabled(undefined)).toBe(false);
    expect(lifecycleEventBridgeEnabled("TRUE")).toBe(false);
    expect(lifecycleEventBridgeEnabled("false")).toBe(false);
    expect(lifecycleEventBridgeEnabled("true")).toBe(true);
  });

  it("maps only real checkpoint and blocker responses", () => {
    expect(mapPersistedResponseToLifecycleEvent("CHECKPOINT")).toBe("JOB_CHECKPOINT");
    expect(mapPersistedResponseToLifecycleEvent("BLOCKER")).toBe("JOB_BLOCKED");
  });

  it("never synthesizes verification, closure, retry or OpenClaw help from worker claims", () => {
    for (const kind of ["ACK", "PROGRESS", "COMPLETED", "FAILED"] as const) {
      expect(mapPersistedResponseToLifecycleEvent(kind)).toBeNull();
    }
  });
});
