import { describe, expect, it } from "vitest";
import { lifecycleEventBridgeEnabled, mapPersistedResponseToLifecycleEvent, mayDispatchJobLifecycleSubscription } from "../jobLifecycleEventBridgeService.js";

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

  it("protects lifecycle events from wildcard and exact execution subscriptions", () => {
    for (const event of ["ai_core.job.lifecycle.job_checkpoint", "ai_core.job.lifecycle.job_blocked"]) {
      expect(mayDispatchJobLifecycleSubscription(event, "create_job")).toBe(false);
      expect(mayDispatchJobLifecycleSubscription(event, "call_webhook")).toBe(false);
      expect(mayDispatchJobLifecycleSubscription(event, "update_project_status")).toBe(false);
      expect(mayDispatchJobLifecycleSubscription(event, "audit_log")).toBe(true);
      expect(mayDispatchJobLifecycleSubscription(event, "notification_hook")).toBe(true);
    }
    expect(mayDispatchJobLifecycleSubscription("ai_core.job.lifecycle.job_closed", "audit_log")).toBe(false);
    expect(mayDispatchJobLifecycleSubscription("coding.bridge.response.created", "create_job")).toBe(true);
  });

  it("never synthesizes verification, closure, retry or OpenClaw help from worker claims", () => {
    for (const kind of ["ACK", "PROGRESS", "COMPLETED", "FAILED"] as const) {
      expect(mapPersistedResponseToLifecycleEvent(kind)).toBeNull();
    }
  });
});
