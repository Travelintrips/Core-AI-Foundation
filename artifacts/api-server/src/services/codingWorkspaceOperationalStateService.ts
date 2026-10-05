export type CodingWorkspaceOperationalState =
  | "ANALYZING_RUNNING"
  | "WAITING_FOR_WORKER"
  | "QUEUED"
  | "WAITING_FOR_CAPACITY"
  | "BLOCKED";

const CODING_MONITOR_CAPABILITIES = new Set([
  "coding_repository_analyzer",
  "coding_repository_analyzer_on_demand",
  "coding_ai_execution",
  "coding_workstream",
  "coding_multi_task_planner",
  "ollama_inference",
  "coding_powershell_execution",
]);

export function isCodingRelevantWorker(capabilities: string[]): boolean {
  return capabilities.some((capability) =>
    CODING_MONITOR_CAPABILITIES.has(capability),
  );
}

export function isHealthyCodingWorker(input: {
  leaseValid: boolean;
  heartbeatFresh: boolean;
  status: string;
}): boolean {
  return (
    input.leaseValid &&
    input.heartbeatFresh &&
    !["offline", "stale"].includes(input.status.toLowerCase())
  );
}

export function deriveCodingWorkspaceOperationalState(input: {
  presentationStatus: string;
  autonomousStatus?: string | null;
  hasActiveRun: boolean;
  jobStatus?: string | null;
  requiredCapability?: string | null;
  healthyCapableWorkers: number;
  availableCapableWorkers: number;
}): CodingWorkspaceOperationalState | null {
  const jobStatus = input.jobStatus?.trim().toLowerCase() ?? "";
  const requiredCapability = input.requiredCapability?.trim() ?? "";

  if (jobStatus === "running") {
    return "ANALYZING_RUNNING";
  }

  if (["queued", "waiting", "retrying"].includes(jobStatus)) {
    // On-demand analyzer jobs are claimed inside the API process and therefore
    // do not depend on a registered worker lease.
    if (!requiredCapability || requiredCapability.endsWith("_on_demand")) {
      return "QUEUED";
    }
    if (input.healthyCapableWorkers <= 0) {
      return "WAITING_FOR_WORKER";
    }
    if (input.availableCapableWorkers <= 0) {
      return "WAITING_FOR_CAPACITY";
    }
    return "QUEUED";
  }

  if (input.hasActiveRun) {
    return "ANALYZING_RUNNING";
  }

  if (input.autonomousStatus === "BLOCKED") {
    return "BLOCKED";
  }

  if (
    input.presentationStatus === "ANALYZING" &&
    input.autonomousStatus === "WAITING"
  ) {
    return "QUEUED";
  }

  return null;
}
