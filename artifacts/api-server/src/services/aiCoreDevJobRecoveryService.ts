/** DEV-only retry planner. This does not bypass auth, pairing, or security controls. */
export type JobBlocker = "CONNECTOR_DISCONNECTED" | "CONNECTOR_AUTH_FAILED" | "RATE_LIMITED" | "TRANSIENT_NETWORK" | "SECURITY_DENIED" | "JOB_CONFLICT";
export type RecoveryDecision =
  | { action: "retry"; delay_ms: number; recheck_auth: boolean; event_key: string }
  | { action: "stop"; reason: string; needs_human: boolean };

export interface RecoveryInput {
  blocker: JobBlocker;
  attempt: number;
  session_id: string;
  job_id: string;
  event_id: string;
  environment: "DEV";
  job_terminal: boolean;
  callback_verified: boolean;
  ack_verified: boolean;
  retry_after_ms?: number;
}
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 4000, 12000] as const;
export function planDevJobRecovery(input: RecoveryInput): RecoveryDecision {
  if (input.environment !== "DEV") return { action: "stop", reason: "dev_only", needs_human: true };
  if (input.job_terminal || (input.callback_verified && input.ack_verified)) {
    return { action: "stop", reason: "already_completed_or_acknowledged", needs_human: false };
  }
  if (input.blocker === "SECURITY_DENIED" || input.blocker === "JOB_CONFLICT") {
    return { action: "stop", reason: "authorization_or_ownership_review_required", needs_human: true };
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 0 || input.attempt >= MAX_ATTEMPTS) {
    return { action: "stop", reason: "retry_budget_exhausted", needs_human: true };
  }
  if (![input.session_id, input.job_id, input.event_id].every(v => v.length > 0 && v.length <= 160)) {
    return { action: "stop", reason: "invalid_correlation", needs_human: true };
  }
  const requested = input.retry_after_ms;
  const delay = typeof requested === "number" && Number.isFinite(requested)
    ? Math.max(BACKOFF_MS[input.attempt]!, Math.min(Math.max(0, requested), 60000))
    : BACKOFF_MS[input.attempt]!;
  return {
    action: "retry",
    delay_ms: delay,
    recheck_auth: input.blocker === "CONNECTOR_AUTH_FAILED" || input.blocker === "CONNECTOR_DISCONNECTED",
    // Stable across attempts: receiver must deduplicate by this correlation key.
    event_key: [input.session_id, input.job_id, input.event_id].join(":"),
  };
}
