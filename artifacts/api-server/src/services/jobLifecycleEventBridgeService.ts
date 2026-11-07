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
