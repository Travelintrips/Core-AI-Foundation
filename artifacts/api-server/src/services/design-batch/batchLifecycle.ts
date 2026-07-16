/**
 * Design Batch Engine — Explicit Lifecycle State Machine
 *
 * Valid transitions:
 *   draft           → queued
 *   queued          → dispatching
 *   dispatching     → processing
 *   processing      → completed | partially_failed | failed
 *   queued          → cancelling
 *   dispatching     → cancelling
 *   processing      → cancelling
 *   cancelling      → cancelled
 *   partially_failed → queued   (via user retry)
 *   failed          → queued   (via user retry)
 *
 * Illegal transitions throw BatchLifecycleError with a structured payload.
 */

export type BatchStatus =
  | "draft"
  | "queued"
  | "dispatching"
  | "processing"
  | "completed"
  | "partially_failed"
  | "failed"
  | "cancelling"
  | "cancelled";

export class BatchLifecycleError extends Error {
  constructor(
    public readonly currentStatus: string,
    public readonly attemptedStatus: string,
  ) {
    super(
      `Invalid batch transition: ${currentStatus} → ${attemptedStatus}. ` +
        `Allowed from '${currentStatus}': ${(ALLOWED_TRANSITIONS[currentStatus as BatchStatus] ?? []).join(", ") || "none"}`,
    );
    this.name = "BatchLifecycleError";
  }
}

/** Canonical map of valid state machine transitions. */
export const ALLOWED_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  draft:            ["queued"],
  queued:           ["dispatching", "cancelling"],
  dispatching:      ["processing", "cancelling"],
  processing:       ["completed", "partially_failed", "failed", "cancelling"],
  completed:        [],
  partially_failed: ["queued"],
  failed:           ["queued"],
  cancelling:       ["cancelled"],
  cancelled:        [],
};

/**
 * Assert that a transition is legal.
 * Throws BatchLifecycleError if the transition is not in ALLOWED_TRANSITIONS.
 */
export function assertBatchTransition(
  currentStatus: string,
  nextStatus: string,
): void {
  const allowed = ALLOWED_TRANSITIONS[currentStatus as BatchStatus] ?? [];
  if (!(allowed as string[]).includes(nextStatus)) {
    throw new BatchLifecycleError(currentStatus, nextStatus);
  }
}

/** Returns true when the status represents a terminal (non-progressing) state. */
export function isBatchTerminal(status: string): boolean {
  return status === "completed" || status === "partially_failed" || status === "failed" || status === "cancelled";
}

/** Returns true when the batch is in a non-terminal active state. */
export function isBatchActive(status: string): boolean {
  return status === "queued" || status === "dispatching" || status === "processing" || status === "cancelling";
}

/** Returns true when the batch can accept a cancel request from the user. */
export function isBatchCancellable(status: string): boolean {
  return status === "queued" || status === "dispatching" || status === "processing";
}

/** Returns true when the batch can accept a retry request from the user. */
export function isBatchRetryable(status: string): boolean {
  return status === "partially_failed" || status === "failed";
}
