export function codingTaskPresentationStatus(input: {
  taskStatus: string;
  autonomousStatus?: string | null;
  hasActiveRun?: boolean;
}): string {
  if (input.taskStatus !== "READY_REVIEW") {
    return input.taskStatus;
  }

  if (input.hasActiveRun) {
    return "ANALYZING";
  }

  if (
    input.autonomousStatus === "ACTIVE" ||
    input.autonomousStatus === "WAITING"
  ) {
    return "ANALYZING";
  }

  if (
    input.autonomousStatus === "FAILED" ||
    input.autonomousStatus === "BLOCKED"
  ) {
    return "FAILED";
  }

  // Autonomous bookkeeping alone is not terminal implementation evidence.
  // Persisted task status must only become COMPLETED after the runtime proves
  // the requested work actually reached its final verified outcome.
  return input.taskStatus;
}
