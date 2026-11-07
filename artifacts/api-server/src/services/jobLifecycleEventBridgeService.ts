/**
 * Maps persisted worker responses into informational lifecycle events.
 * This bridge does not grant authority, invoke workers, or certify PASS.
 * Enable only after subscriber review; disabled by default.
 */
export type WorkerResponseKind = "ACK" | "PROGRESS" | "CHECKPOINT" | "BLOCKER" | "COMPLETED" | "FAILED";
export type LifecycleEvent = "JOB_CHECKPOINT" | "JOB_BLOCKED";

export function mapPersistedResponseToLifecycleEvent(kind: WorkerResponseKind): LifecycleEvent | null {
  switch (kind) {
    case "CHECKPOINT": return "JOB_CHECKPOINT";
    case "BLOCKER": return "JOB_BLOCKED";
    default: return null;
  }
}

export function lifecycleEventBridgeEnabled(value: string | undefined): boolean {
  return value === "true";
}

/** Explicitly restrict passive lifecycle notifications to non-executing handlers.
 * Even an existing wildcard subscription must not dispatch a new job.
 */
export function mayDispatchJobLifecycleSubscription(eventType: string, handlerType: string): boolean {
  if (!eventType.startsWith("ai_core.job.lifecycle.")) return true;
  return (eventType === "ai_core.job.lifecycle.job_checkpoint" ||
    eventType === "ai_core.job.lifecycle.job_blocked") &&
    (handlerType === "audit_log" || handlerType === "notification_hook");
}
