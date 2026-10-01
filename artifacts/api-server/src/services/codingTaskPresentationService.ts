export function codingTaskPresentationStatus(input: {
  taskStatus: string;
  autonomousStatus?: string | null;
  hasActiveRun?: boolean;
}): string {
  if (input.taskStatus !== "READY_REVIEW") {
    return input.taskStatus;
  }

  if (input.hasActiveRun) {
    return input.taskStatus;
  }

  if (
    input.autonomousStatus === "FAILED" ||
    input.autonomousStatus === "BLOCKED"
  ) {
    return "FAILED";
  }

  return input.taskStatus;
}
