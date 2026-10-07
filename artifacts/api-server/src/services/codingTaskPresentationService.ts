export function codingTaskPresentationStatus(input: {
  taskStatus: string;
  autonomousStatus?: string | null;
  autonomousEnabled?: boolean | null;
  autonomousLastAction?: string | null;
  hasActiveRun?: boolean;
  hasPendingCriticalApproval?: boolean;
  workstreamStatus?: string | null;
}): string {
  const workstreamStatus = input.workstreamStatus?.toUpperCase() ?? null;

  // Multi-worker child rows are execution shards. REVIEW_REQUIRED means
  // automated QC/reconciliation is pending; it is not a human-review gate.
  if (workstreamStatus === "COMPLETED") return "COMPLETED";
  if (workstreamStatus === "FAILED") return "FAILED";
  if (workstreamStatus === "CANCELLED") return "CANCELLED";
  if (workstreamStatus === "BLOCKED") return "BLOCKED";
  if (workstreamStatus === "REVIEW_REQUIRED") {
    return input.hasPendingCriticalApproval ? "READY_REVIEW" : "TESTING";
  }
  if (workstreamStatus === "CLAIMED" || workstreamStatus === "RUNNING") {
    return "CODING";
  }
  if (workstreamStatus === "PENDING" || workstreamStatus === "READY") {
    return "QUEUED";
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

  // Human review is reserved for a live critical-approval row. A stale
  // autonomous APPROVAL_REQUIRED marker by itself must never summon a human.
  if (input.hasPendingCriticalApproval) {
    return "READY_REVIEW";
  }

  if (input.autonomousStatus === "APPROVAL_REQUIRED") {
    return "BLOCKED";
  }

  // A recoverable technical blocker is not a terminal task failure. Keep it
  // visible as BLOCKED so the fallback coordinator can retry or choose another
  // path without falsely closing the overall job.
  if (input.autonomousStatus === "BLOCKED") {
    if (
      input.taskStatus === "READY_REVIEW" ||
      input.taskStatus === "FAILED" ||
      input.taskStatus === "ANALYZING"
    ) {
      return "BLOCKED";
    }
  }

  // FAILED remains terminal only when the autonomous runtime itself has
  // exhausted its allowed recovery path and no active retry is running.
  if (input.autonomousStatus === "FAILED") {
    if (
      input.taskStatus === "READY_REVIEW" ||
      input.taskStatus === "FAILED" ||
      input.taskStatus === "ANALYZING"
    ) {
      return "FAILED";
    }
  }

  // READY_REVIEW without an explicit critical approval is a technical
  // intervention state, not human review and not terminal failure.
  if (input.taskStatus === "READY_REVIEW") {
    return "BLOCKED";
  }

  return input.taskStatus;
}


export function codingDashboardTaskPresentationStatus(input: {
  taskNumber?: string | null;
  taskStatus: string;
  latestRunStatus?: string | null;
  autonomousStatus?: string | null;
  autonomousEnabled?: boolean | null;
  autonomousLastAction?: string | null;
  hasActiveRun?: boolean;
  hasPendingCriticalApproval?: boolean;
  workstreamStatus?: string | null;
}): string {
  const taskNumber = input.taskNumber?.trim() ?? "";
  const latestRunStatus = input.latestRunStatus?.toUpperCase() ?? null;

  // An explicit manual stop is an operator decision, not a blocker and not a
  // human-review gate. Keep it visible as a neutral terminal display state.
  if (
    !input.hasActiveRun &&
    input.autonomousEnabled === false &&
    input.autonomousStatus === "DISABLED" &&
    input.autonomousLastAction === "MANUAL_STOP"
  ) {
    return "CANCELLED";
  }

  // A live workstream binding is authoritative for multi-worker children.
  // In particular REVIEW_REQUIRED is automated QC and must not be hidden by a
  // legacy completed child run.
  if (input.workstreamStatus) {
    return codingTaskPresentationStatus(input);
  }

  // Detached legacy Multi-Worker rows can still be normalized from their
  // completed child run when no live workstream binding remains.
  if (
    taskNumber.startsWith("MW-") &&
    input.taskStatus === "READY_REVIEW" &&
    latestRunStatus === "COMPLETED" &&
    !input.hasActiveRun &&
    !input.hasPendingCriticalApproval &&
    (
      input.autonomousStatus == null ||
      input.autonomousStatus === "DISABLED" ||
      input.autonomousStatus === "COMPLETED"
    )
  ) {
    return "COMPLETED";
  }

  return codingTaskPresentationStatus(input);
}
