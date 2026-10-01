export type CodingRunPresentationStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED";

const LEGACY_WORKSTREAM_FAILURE =
  /per-workstream constrained ai failed|fresh workstream ai handoff|repair inbox|autonomous repair.*(?:failed|berhenti)|tidak dapat memulihkan kegagalan/i;

export function codingRunPresentationStatus(input: {
  runStatus: string;
  agentName: string;
  taskStatus: string;
  taskResultSummary?: string | null;
  isLatestRun: boolean;
}): string {
  if (input.runStatus !== "COMPLETED" || !input.isLatestRun) {
    return input.runStatus;
  }

  if (!/^Multi-Worker\b/i.test(input.agentName.trim())) {
    return input.runStatus;
  }

  if (input.taskStatus === "FAILED") {
    return "FAILED";
  }

  if (
    input.taskStatus === "READY_REVIEW" &&
    LEGACY_WORKSTREAM_FAILURE.test(input.taskResultSummary ?? "")
  ) {
    return "FAILED";
  }

  return input.runStatus;
}

export function codingRunPresentationError(input: {
  displayedStatus: string;
  runErrorMessage?: string | null;
  taskResultSummary?: string | null;
}): string | null {
  if (input.runErrorMessage) return input.runErrorMessage;
  if (input.displayedStatus !== "FAILED") return null;
  return input.taskResultSummary?.trim() || "Coding workstream execution failed.";
}
