// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  planDevDellOnlyCodingWorker,
  type DevDellAccountWorker,
} from "../devDellOnlyCodingPoolService.js";
import type { DevChatGptPoolJob } from "../devChatGptCodingPoolPlanner.js";

const time = Date.parse("2026-10-20T14:00:00Z");
const job: DevChatGptPoolJob = {
  jobId: "CST-DEV-1001",
  capability: "coding",
  approvedForDev: true,
  status: "QUEUED",
};
function worker(alias: string, executorId: string, extra: Partial<DevDellAccountWorker> = {}): DevDellAccountWorker {
  return {
    accountAlias: alias,
    executorId,
    browserProfile: alias.toLowerCase() + "-dell-dev",
    capabilities: ["coding", "testing"],
    bindingEnabled: true,
    accountSessionAttested: true,
    signedDestinationReceiptVerified: true,
    leaseExpiresAt: "2026-10-20T14:01:00Z",
    heartbeatAt: "2026-10-20T13:59:45Z",
    activeJobs: 0,
    availableSlots: 1,
    maxConcurrentJobs: 1,
    hostId: "DELL",
    hostAttested: true,
    profileSessionIsolated: true,
    distinctExecutorAttested: true,
    ...extra,
  };
}
const plan = (
  workers: DevDellAccountWorker[],
  occupiedExecutors: string[] = [],
  patch: Partial<DevChatGptPoolJob> = {},
  maxHostExecutors = 2,
) => planDevDellOnlyCodingWorker({
  job: { ...job, ...patch }, workers, occupiedExecutors, maxHostExecutors, nowMs: time,
});

describe("DELL-only two-account task candidate policy", () => {
  it("can preview GPT03 when GPT02 is busy and a second independent DELL executor is proven", () => {
    expect(plan([
      worker("GPT02", "dell-exec-02", { activeJobs: 1, availableSlots: 0 }),
      worker("GPT03", "dell-exec-03"),
    ])).toEqual({
      outcome: "CANDIDATE", accountAlias: "GPT03", executorId: "dell-exec-03",
      browserProfile: "gpt03-dell-dev",
      evidence: "VERIFIED_IDLE_SESSION", requiresAtomicClaim: true,
    });
  });

  it("never redirects to a healthy worker hosted by Travelintrips or VPS", () => {
    expect(plan([worker("GPT03", "travelintrips", { hostId: "Travelintrips" })]))
      .toEqual({ outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER" });
    expect(plan([worker("GPT03", "vps", { hostId: "VPS" })]))
      .toEqual({ outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER" });
  });

  it("does not count a configured browser as an independent worker", () => {
    const busy = worker("GPT02", "dell-shared", { activeJobs: 1, availableSlots: 0 });
    expect(plan([busy, worker("GPT03", "dell-shared")]))
      .toEqual({ outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER" });
    for (const bad of [
      { hostAttested: false },
      { profileSessionIsolated: false },
      { distinctExecutorAttested: false },
      { accountSessionAttested: false },
      { signedDestinationReceiptVerified: false },
      { bindingEnabled: false },
    ]) {
      expect(plan([busy, worker("GPT03", "dell-distinct", bad)]))
        .toEqual({ outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER" });
    }
  });

  it("reserves administrative/legacy GPT01 browser profiles on DELL", () => {
    for (const profile of ["openclaw", "admcst001-dev", "ADMCST001-DEV"]) {
      expect(plan([worker("GPT03", "e03", { browserProfile: profile })]))
        .toEqual({ outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER" });
    }
  });

  it("limits DELL execution to verified two-job host capacity", () => {
    expect(plan([worker("GPT03", "e03")], ["e01", "e02"]))
      .toEqual({ outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER" });
    expect(plan([worker("GPT03", "e03")], ["e01"], {}, 1))
      .toEqual({ outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER" });
    expect(plan([worker("GPT03", "e03")], [], {}, 3))
      .toEqual({ outcome: "BLOCK", reason: "INVALID_JOB" });
  });

  it("retains authorization, project locking, and independent QA requirements", () => {
    expect(plan([worker("GPT03", "e03")], [], { approvedForDev: false }))
      .toEqual({ outcome: "BLOCK", reason: "APPROVAL_REQUIRED" });
    expect(plan([worker("GPT03", "e03")], [], { projectLockHeldBy: "other-job" }))
      .toEqual({ outcome: "WAIT", reason: "PROJECT_LOCKED" });
    expect(plan([worker("GPT03", "e03")], [], { status: "RUNNING" }))
      .toEqual({ outcome: "BLOCK", reason: "JOB_ALREADY_CLAIMED" });
    expect(plan([worker("GPT03", "e03")], [], {
      capability: "testing", codingAccountAlias: "GPT03",
    })).toEqual({ outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER" });
  });
});
