export function codingTaskPresentationStatus(input: {
  taskStatus: string;
  autonomousStatus?: string | null;
  hasActiveRun?: boolean;
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

  if (input.autonomousStatus === "FAILED") {
    if (input.taskStatus === "READY_REVIEW" || input.taskStatus === "FAILED") {
      return "FAILED";
    }
  }

  // BLOCKED means the autonomous runtime needs intervention, not that the
  // underlying coding task necessarily failed. Present it as review-required
  // so Workspace does not label recoverable/max-cycle blockers as "GAGAL".
  if (input.autonomousStatus === "BLOCKED") {
    if (input.taskStatus === "READY_REVIEW" || input.taskStatus === "FAILED") {
      return "READY_REVIEW";
    }
  }

  return input.taskStatus;
}
