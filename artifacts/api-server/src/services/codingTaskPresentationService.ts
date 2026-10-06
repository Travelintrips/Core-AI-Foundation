export function codingTaskPresentationStatus(input: {
  taskStatus: string;
  autonomousStatus?: string | null;
  hasActiveRun?: boolean;
  hasPendingCriticalApproval?: boolean;
}): string {
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
