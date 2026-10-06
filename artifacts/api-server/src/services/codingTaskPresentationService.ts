export function codingTaskPresentationStatus(input: {
  taskStatus: string;
  autonomousStatus?: string | null;
  hasActiveRun?: boolean;
  hasPendingCriticalApproval?: boolean;
  workstreamStatus?: string | null;
}): string {
  // Multi-worker child tasks use the workstream lifecycle as the source of
  // truth. REVIEW_REQUIRED is an automated QC state, never a human-review gate.
  if (input.workstreamStatus) {
    const workstreamStatus = input.workstreamStatus.toUpperCase();
    if (workstreamStatus === "COMPLETED") return "COMPLETED";
    if (workstreamStatus === "FAILED" || workstreamStatus === "CANCELLED") return "FAILED";
    if (workstreamStatus === "REVIEW_REQUIRED") return "TESTING";
    if (workstreamStatus === "CLAIMED" || workstreamStatus === "RUNNING") return "CODING";
    if (workstreamStatus === "READY" || workstreamStatus === "PENDING") return "QUEUED";
  }

  // A live run/recovery always wins over stale persisted terminal state.
  if (input.hasActiveRun) {
    return "ANALYZING";
  }

  if (
    input.autonomousStatus === "ACTIVE" ||
    input.autonomousStatus === "WAITING"
  ) {
    return "ANALYZING";
  }

  // Verified autonomous completion is authoritative for stale FAILED or
  // READY_REVIEW rows. The autonomous runtime only reaches COMPLETED after
  // hasVerifiedCompletionEvidence() succeeds.
  if (
    input.autonomousStatus === "COMPLETED" &&
    (input.taskStatus === "FAILED" || input.taskStatus === "READY_REVIEW")
  ) {
    return "COMPLETED";
  }

  // Human review is reserved for an explicit critical approval gate. A
  // technical runtime blocker must never masquerade as a review request.
  if (
    input.autonomousStatus === "APPROVAL_REQUIRED" ||
    input.hasPendingCriticalApproval
  ) {
    return "READY_REVIEW";
  }

  if (input.autonomousStatus === "FAILED" || input.autonomousStatus === "BLOCKED") {
    if (
      input.taskStatus === "READY_REVIEW" ||
      input.taskStatus === "FAILED" ||
      input.taskStatus === "ANALYZING"
    ) {
      return "FAILED";
    }
  }

  if (input.taskStatus === "READY_REVIEW") {
    return "FAILED";
  }

  return input.taskStatus;
}
