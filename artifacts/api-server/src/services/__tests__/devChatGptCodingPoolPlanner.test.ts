// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  planDevChatGptCodingWorker,
  type DevChatGptPoolJob,
  type DevChatGptPoolWorker,
} from "../devChatGptCodingPoolPlanner.js";

const NOW = Date.parse("2026-10-20T13:00:00Z");
const job: DevChatGptPoolJob = {
  jobId: "AI-CODE-1001", capability: "coding", approvedForDev: true, status: "QUEUED",
};
function worker(alias: string, executorId: string, extra: Partial<DevChatGptPoolWorker> = {}): DevChatGptPoolWorker {
  return {
    accountAlias: alias,
    executorId,
    browserProfile: alias.toLowerCase() + "-isolated",
    capabilities: ["coding", "testing"],
    bindingEnabled: true,
    accountSessionAttested: true,
    signedDestinationReceiptVerified: true,
    leaseExpiresAt: "2026-10-20T13:01:00Z",
    heartbeatAt: "2026-10-20T12:59:45Z",
    activeJobs: 0,
    availableSlots: 1,
    maxConcurrentJobs: 1,
    ...extra,
  };
}
const plan = (workers: DevChatGptPoolWorker[], patch: Partial<DevChatGptPoolJob> = {}, occupiedExecutors: string[] = []) =>
  planDevChatGptCodingWorker({ job: { ...job, ...patch }, workers, occupiedExecutors, nowMs: NOW });

describe("DEV ChatGPT coding worker-pool admission", () => {
  it("chooses GPT03 when GPT02 is coding on a different verified executor", () => {
    expect(plan([
      worker("GPT02", "dell-executor", { activeJobs: 1, availableSlots: 0 }),
      worker("GPT03", "vps-browser-executor"),
    ])).toEqual({
      outcome: "CANDIDATE", accountAlias: "GPT03", executorId: "vps-browser-executor",
      browserProfile: "gpt03-isolated", evidence: "VERIFIED_IDLE_SESSION", requiresAtomicClaim: true,
    });
  });

  it("does NOT claim parallel coding is possible through the SAME serial DELL executor", () => {
    expect(plan([
      worker("GPT02", "shared-dell-worker", { activeJobs: 1, availableSlots: 0 }),
      worker("GPT03", "shared-dell-worker"),
    ])).toEqual({ outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER" });
  });

  it("waits when GPT03 is missing, disabled, not attested, or lacks a signed destination receipt", () => {
    const busy = worker("GPT02", "dell", { activeJobs: 1, availableSlots: 0 });
    for (const candidate of [
      undefined,
      worker("GPT03", "second", { bindingEnabled: false }),
      worker("GPT03", "second", { accountSessionAttested: false }),
      worker("GPT03", "second", { signedDestinationReceiptVerified: false }),
    ]) {
      expect(plan([busy, ...(candidate ? [candidate] : [])])).toEqual({
        outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER",
      });
    }
  });

  it("requires a live valid lease, fresh heartbeat, integer free slots and matching capability", () => {
    const invalid = [
      { leaseExpiresAt: null },
      { leaseExpiresAt: "2026-10-20T12:59:59Z" },
      { heartbeatAt: null },
      { heartbeatAt: "2026-10-20T12:50:00Z" },
      { heartbeatAt: "2026-10-20T13:02:00Z" },
      { activeJobs: -1 },
      { availableSlots: 0 },
      { availableSlots: 2 },
      { maxConcurrentJobs: 0 },
      { capabilities: ["model:chat"] },
    ];
    for (const item of invalid) {
      expect(plan([worker("GPT03", "worker3", item)])).toEqual({
        outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER",
      });
    }
  });

  it("does not cross another active executor or a held project lock", () => {
    expect(plan([worker("GPT03", "worker3")], {}, ["worker3"])).toEqual({
      outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER",
    });
    expect(plan([worker("GPT03", "worker3")], { projectLockHeldBy: "job-previous" })).toEqual({
      outcome: "WAIT", reason: "PROJECT_LOCKED",
    });
  });

  it("never assigns testing of the same change to its coding account", () => {
    expect(plan([worker("GPT02", "e2"), worker("GPT03", "e3")], {
      capability: "testing", codingAccountAlias: "GPT02",
    })).toMatchObject({ outcome: "CANDIDATE", accountAlias: "GPT03" });
  });

  it("blocks claimed jobs, non-approved jobs, GPT01, and duplicate/ambiguous bindings", () => {
    expect(plan([worker("GPT02", "e2")], { status: "RUNNING" })).toEqual({
      outcome: "BLOCK", reason: "JOB_ALREADY_CLAIMED",
    });
    expect(plan([worker("GPT02", "e2")], { approvedForDev: false })).toEqual({
      outcome: "BLOCK", reason: "APPROVAL_REQUIRED",
    });
    expect(plan([worker("GPT01", "e1")])).toEqual({
      outcome: "BLOCK", reason: "DUPLICATE_BINDING",
    });
    expect(plan([worker("GPT02", "e2"), worker("GPT02", "e3")])).toEqual({
      outcome: "BLOCK", reason: "DUPLICATE_BINDING",
    });
    expect(plan([worker("GPT02", "e2"), worker("GPT03", "e3", { browserProfile: "gpt02-isolated" })])).toEqual({
      outcome: "BLOCK", reason: "DUPLICATE_BINDING",
    });
  });

  it("does not turn a read-only candidate preview into a server-side claim", () => {
    const before = worker("GPT03", "executor3");
    const result = plan([before]);
    expect(result).toMatchObject({ outcome: "CANDIDATE", requiresAtomicClaim: true });
    expect(before.activeJobs).toBe(0);
    expect(before.availableSlots).toBe(1);
  });
});
