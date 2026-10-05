import { describe, expect, it } from "vitest";
import {
  deriveCodingWorkspaceOperationalState,
  isCodingRelevantWorker,
  isHealthyCodingWorker,
} from "../codingWorkspaceOperationalStateService.js";

describe("Coding Workspace operational states", () => {
  it("shows a running job or run as ANALYZING_RUNNING", () => {
    expect(
      deriveCodingWorkspaceOperationalState({
        presentationStatus: "ANALYZING",
        hasActiveRun: false,
        jobStatus: "running",
        requiredCapability: "coding_workstream",
        healthyCapableWorkers: 1,
        availableCapableWorkers: 0,
      }),
    ).toBe("ANALYZING_RUNNING");

    expect(
      deriveCodingWorkspaceOperationalState({
        presentationStatus: "ANALYZING",
        hasActiveRun: true,
        jobStatus: null,
        requiredCapability: null,
        healthyCapableWorkers: 0,
        availableCapableWorkers: 0,
      }),
    ).toBe("ANALYZING_RUNNING");
  });

  it("distinguishes queue, missing worker, and exhausted capacity", () => {
    const base = {
      presentationStatus: "ANALYZING",
      autonomousStatus: "ACTIVE",
      hasActiveRun: false,
      jobStatus: "queued",
      requiredCapability: "coding_workstream",
    };

    expect(
      deriveCodingWorkspaceOperationalState({
        ...base,
        healthyCapableWorkers: 0,
        availableCapableWorkers: 0,
      }),
    ).toBe("WAITING_FOR_WORKER");

    expect(
      deriveCodingWorkspaceOperationalState({
        ...base,
        healthyCapableWorkers: 2,
        availableCapableWorkers: 0,
      }),
    ).toBe("WAITING_FOR_CAPACITY");

    expect(
      deriveCodingWorkspaceOperationalState({
        ...base,
        healthyCapableWorkers: 2,
        availableCapableWorkers: 1,
      }),
    ).toBe("QUEUED");
  });

  it("keeps on-demand analyzer jobs in QUEUED without requiring a worker lease", () => {
    expect(
      deriveCodingWorkspaceOperationalState({
        presentationStatus: "ANALYZING",
        hasActiveRun: false,
        jobStatus: "queued",
        requiredCapability: "coding_repository_analyzer_on_demand",
        healthyCapableWorkers: 0,
        availableCapableWorkers: 0,
      }),
    ).toBe("QUEUED");
  });

  it("requires a valid lease and fresh heartbeat before a worker is active", () => {
    expect(
      isHealthyCodingWorker({
        leaseValid: true,
        heartbeatFresh: true,
        status: "idle",
      }),
    ).toBe(true);
    expect(
      isHealthyCodingWorker({
        leaseValid: false,
        heartbeatFresh: true,
        status: "idle",
      }),
    ).toBe(false);
    expect(
      isHealthyCodingWorker({
        leaseValid: true,
        heartbeatFresh: false,
        status: "idle",
      }),
    ).toBe(false);
    expect(
      isHealthyCodingWorker({
        leaseValid: true,
        heartbeatFresh: true,
        status: "stale",
      }),
    ).toBe(false);
  });

  it("limits Coding Workspace worker cards to coding-related capabilities", () => {
    expect(isCodingRelevantWorker(["coding_workstream"])).toBe(true);
    expect(isCodingRelevantWorker(["ollama_inference"])).toBe(true);
    expect(isCodingRelevantWorker(["image_generation"])).toBe(false);
    expect(isCodingRelevantWorker(["archive_asset"])).toBe(false);
  });
});
