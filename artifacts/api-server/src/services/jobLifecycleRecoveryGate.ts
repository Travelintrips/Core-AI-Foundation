/**
 * Phase 3: fail-closed, pure decision gate for DEV lifecycle recovery.
 * This is not a dispatcher or authorization grant. The caller must establish
 * each input from server-owned records before adding an execution path.
 */
import type { LifecycleReadiness } from "./jobLifecycleReadinessService.js";

export type RecoveryDecisionReason =
  | "FLAG_OFF" | "POLICY_OFF" | "UNTRUSTED_POLICY" | "NO_BLOCKER"
  | "CHECKPOINT_ACK_REQUIRED" | "AUTHORIZATION_REQUIRED" | "WORKER_MISMATCH"
  | "WORKER_UNHEALTHY" | "LEASE_INVALID" | "RETRY_LIMIT"
  | "RATE_LIMITED" | "RECOVERY_IN_FLIGHT" | "NEEDS_MANUAL_APPROVAL"
  | "REVIEW_ELIGIBLE";

export interface RecoveryDecisionInput {
  /** Must be a server-side feature flag, never a field from worker payload. */
  enabledByServer: boolean;
  /** Validated configuration read from the server's Settings DB. */
  policy: { enabled: boolean; maxRetries: number; heartbeatGraceMinutes: number; requireAcknowledgement: boolean } | null;
  readiness: LifecycleReadiness;
  /** Authorization for this exact command and intended DEV worker. */
  authorizedCommandId: string | null;
  blockedCommandId: string;
  expectedWorkerId: string;
  actualWorkerId: string | null;
  workerHeartbeatAt: Date | null;
  now: Date;
  leaseValid: boolean;
  retriesAlreadyUsed: number;
  retryAfterAt: Date | null;
  recoveryAlreadyInFlight: boolean;
  requiresHumanApproval: boolean;
}

export interface RecoveryDecision {
  /** Eligibility for further server-side processing, NOT permission to dispatch. */
  eligibleForAuthorizedRecoveryReview: boolean;
  reason: RecoveryDecisionReason;
  mayDispatchWorker: false;
  mayCloseJob: false;
}

export function evaluateRecoveryDecision(input: RecoveryDecisionInput): RecoveryDecision {
  const deny = (reason: RecoveryDecisionReason): RecoveryDecision => ({
    eligibleForAuthorizedRecoveryReview: false, reason,
    mayDispatchWorker: false, mayCloseJob: false,
  });
  if (!input.enabledByServer) return deny("FLAG_OFF");
  if (!input.policy?.enabled) return deny("POLICY_OFF");
  const policy = input.policy;
  // Never rely on permissive or malformed stored settings to waive an ACK.
  if (!policy.requireAcknowledgement || !Number.isSafeInteger(policy.maxRetries) ||
      policy.maxRetries < 0 || policy.maxRetries > 10 ||
      !Number.isSafeInteger(policy.heartbeatGraceMinutes) ||
      policy.heartbeatGraceMinutes < 2 || policy.heartbeatGraceMinutes > 120) {
    return deny("UNTRUSTED_POLICY");
  }
  if (input.readiness.phase !== "BLOCKED" || !input.readiness.blockingResponseId) return deny("NO_BLOCKER");
  if (!input.readiness.latestCheckpointResponseId || !input.readiness.latestCheckpointAcknowledged ||
      !input.readiness.needsWorkerHealthAndAuthorization) return deny("CHECKPOINT_ACK_REQUIRED");
  if (!input.authorizedCommandId || input.authorizedCommandId !== input.blockedCommandId)
    return deny("AUTHORIZATION_REQUIRED");
  if (!input.expectedWorkerId || input.actualWorkerId !== input.expectedWorkerId)
    return deny("WORKER_MISMATCH");
  const now = input.now.getTime();
  const heartbeat = input.workerHeartbeatAt?.getTime();
  if (!Number.isFinite(now) || heartbeat === undefined || !Number.isFinite(heartbeat) ||
      heartbeat > now || now - heartbeat > policy.heartbeatGraceMinutes * 60_000)
    return deny("WORKER_UNHEALTHY");
  if (!input.leaseValid) return deny("LEASE_INVALID");
  if (!Number.isSafeInteger(input.retriesAlreadyUsed) || input.retriesAlreadyUsed < 0 ||
      input.retriesAlreadyUsed >= policy.maxRetries) return deny("RETRY_LIMIT");
  // A rate limit's Retry-After must be honored even if the worker is healthy.
  if (input.retryAfterAt && (!Number.isFinite(input.retryAfterAt.getTime()) ||
      input.retryAfterAt.getTime() > now)) return deny("RATE_LIMITED");
  if (input.recoveryAlreadyInFlight) return deny("RECOVERY_IN_FLIGHT");
  if (input.requiresHumanApproval) return deny("NEEDS_MANUAL_APPROVAL");
  return {
    eligibleForAuthorizedRecoveryReview: true, reason: "REVIEW_ELIGIBLE",
    mayDispatchWorker: false, mayCloseJob: false,
  };
}
