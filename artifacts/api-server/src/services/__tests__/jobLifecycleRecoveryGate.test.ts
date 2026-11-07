import { describe, expect, it } from "vitest";
import { evaluateRecoveryDecision, type RecoveryDecisionInput } from "../jobLifecycleRecoveryGate.js";

const now = new Date("2026-11-07T12:30:00Z");
const valid = (): RecoveryDecisionInput => ({
  enabledByServer: true,
  policy: { enabled: true, maxRetries: 2, heartbeatGraceMinutes: 5, requireAcknowledgement: true },
  readiness: {
    phase: "BLOCKED", blockingResponseId: "b1", latestCheckpointResponseId: "cp1",
    latestCheckpointAcknowledged: true, needsWorkerHealthAndAuthorization: true,
    mayAutoResume: false, mayAutoClose: false,
  },
  authorizedCommandId: "c1", blockedCommandId: "c1",
  expectedWorkerId: "openclaw-dell-chatgpt-wake-dev", actualWorkerId: "openclaw-dell-chatgpt-wake-dev",
  workerHeartbeatAt: new Date(now.getTime() - 60_000), now, leaseValid: true,
  retriesAlreadyUsed: 0, retryAfterAt: null, recoveryAlreadyInFlight: false,
  requiresHumanApproval: false,
});

describe("fail-closed lifecycle recovery review gate", () => {
  it("only declares review eligibility, never dispatch or close authority", () => {
    expect(evaluateRecoveryDecision(valid())).toEqual({
      eligibleForAuthorizedRecoveryReview: true, reason: "REVIEW_ELIGIBLE",
      mayDispatchWorker: false, mayCloseJob: false,
    });
  });
  it.each([
    ["FLAG_OFF", { enabledByServer: false }],
    ["POLICY_OFF", { policy: null }],
    ["POLICY_OFF", { policy: { ...valid().policy!, enabled: false } }],
    ["UNTRUSTED_POLICY", { policy: { ...valid().policy!, requireAcknowledgement: false } }],
    ["UNTRUSTED_POLICY", { policy: { ...valid().policy!, maxRetries: 99 } }],
    ["NO_BLOCKER", { readiness: { ...valid().readiness, phase: "TERMINAL_REPORTED" } }],
    ["CHECKPOINT_ACK_REQUIRED", { readiness: { ...valid().readiness, latestCheckpointAcknowledged: false } }],
    ["AUTHORIZATION_REQUIRED", { authorizedCommandId: "other" }],
    ["WORKER_MISMATCH", { actualWorkerId: "openclaw-other" }],
    ["WORKER_UNHEALTHY", { workerHeartbeatAt: null }],
    ["WORKER_UNHEALTHY", { workerHeartbeatAt: new Date(now.getTime() - 6 * 60_000) }],
    ["WORKER_UNHEALTHY", { workerHeartbeatAt: new Date(now.getTime() + 10_000) }],
    ["LEASE_INVALID", { leaseValid: false }],
    ["RETRY_LIMIT", { retriesAlreadyUsed: 2 }],
    ["RETRY_LIMIT", { retriesAlreadyUsed: -1 }],
    ["RATE_LIMITED", { retryAfterAt: new Date(now.getTime() + 10_000) }],
    ["RECOVERY_IN_FLIGHT", { recoveryAlreadyInFlight: true }],
    ["NEEDS_MANUAL_APPROVAL", { requiresHumanApproval: true }],
  ] as const)("rejects %s", (reason, override) => {
    const result = evaluateRecoveryDecision({ ...valid(), ...override } as RecoveryDecisionInput);
    expect(result.reason).toBe(reason);
    expect(result.eligibleForAuthorizedRecoveryReview).toBe(false);
    expect(result.mayDispatchWorker).toBe(false);
    expect(result.mayCloseJob).toBe(false);
  });
  it("honors elapsed Retry-After without skipping other safety checks", () => {
    const result = evaluateRecoveryDecision({ ...valid(), retryAfterAt: new Date(now.getTime() - 1000) });
    expect(result.eligibleForAuthorizedRecoveryReview).toBe(true);
    expect(result.mayDispatchWorker).toBe(false);
  });
});
