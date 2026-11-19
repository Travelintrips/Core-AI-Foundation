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

/** Events for signed checkpoints created in the transaction-bound worker callback.
 * Unlike generic worker-supplied CHECKPOINT, these rows originate in the
 * verified DEV issuer and must be emitted only after transaction commit.
 */
export function signedPersistedCheckpointEvent(input: {
  enabled: boolean;
  checkpoint: {
    id: string; commandId: string; taskId: string | null;
    kind: string; metadataJson: unknown;
  } | null;
}): {
  eventType: "ai_core.job.lifecycle.job_checkpoint";
  sourceModule: "coding-control-bridge";
  sourceId: string;
  correlationId: string;
  payload: { lifecycleEvent: "JOB_CHECKPOINT"; responseId: string; commandId: string; taskId: string | null };
} | null {
  if (!input.enabled || !input.checkpoint) return null;
  const checkpoint = input.checkpoint;
  const meta = checkpoint.metadataJson;
  if (checkpoint.kind !== "CHECKPOINT" || !checkpoint.id || !checkpoint.commandId ||
    !meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const obj = meta as Record<string, unknown>;
  if (obj["checkpointVerified"] !== true || obj["verifiedAssistantReply"] !== true ||
    !obj["checkpointReceipt"] || typeof obj["checkpointReceipt"] !== "object") return null;
  return {
    eventType: "ai_core.job.lifecycle.job_checkpoint",
    sourceModule: "coding-control-bridge", sourceId: checkpoint.id,
    correlationId: checkpoint.commandId,
    payload: { lifecycleEvent: "JOB_CHECKPOINT", responseId: checkpoint.id,
      commandId: checkpoint.commandId, taskId: checkpoint.taskId },
  };
}
