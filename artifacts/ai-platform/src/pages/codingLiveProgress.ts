export type CodingProgressStage = {
  id?: string;
  label?: string;
  status?: string;
  detail?: string;
  startedAt?: string;
  completedAt?: string;
};

export type CodingProgressOrchestration = {
  status?: string;
  nextAction?: string;
  activeAnalyzerJobId?: number;
  stages?: CodingProgressStage[];
};

export type CodingLiveProgress = {
  phase: string;
  label: string;
  detail: string;
  percent: number;
  blockerJobId: number | null;
  startedAt: string | null;
};

const TASK_PROGRESS: Record<string, { phase: string; label: string; percent: number }> = {
  PENDING: { phase: "QUEUED", label: "Queued for coding", percent: 5 },
  ANALYZING: { phase: "ANALYZING", label: "Analyzing repository", percent: 20 },
  CODING: { phase: "CODING", label: "Implementing changes", percent: 55 },
  TESTING: { phase: "TESTING", label: "Running verification", percent: 75 },
  COMMITTING: { phase: "COMMITTING", label: "Preparing reviewed changes", percent: 88 },
  READY_REVIEW: { phase: "REVIEW", label: "Ready for review", percent: 92 },
  PR_CREATED: { phase: "PR", label: "Pull request created", percent: 96 },
  COMPLETED: { phase: "DONE", label: "Completed", percent: 100 },
  FAILED: { phase: "FAILED", label: "Failed", percent: 100 },
  CANCELLED: { phase: "CANCELLED", label: "Cancelled", percent: 100 },
};

const STAGE_PROGRESS: Record<string, number> = {
  repository_analyzer: 28,
  planner: 42,
  coding: 58,
  testing: 76,
  review: 90,
};

export function deriveCodingLiveProgress(input: {
  taskStatus: string;
  runStatus?: string | null;
  agentName?: string | null;
  runStartedAt?: string | null;
  orchestration?: CodingProgressOrchestration | null;
}): CodingLiveProgress {
  const orchestration = input.orchestration ?? null;
  const nextAction = orchestration?.nextAction ?? null;
  const blockerJobId =
    typeof orchestration?.activeAnalyzerJobId === "number"
      ? orchestration.activeAnalyzerJobId
      : null;

  if (nextAction === "WAIT_REPOSITORY_ANALYZER_SLOT") {
    return {
      phase: "WAITING_FOR_ANALYZER",
      label: "Waiting for Repository Analyzer slot",
      detail: blockerJobId
        ? `Repository Analyzer job #${blockerJobId} currently owns the single-flight slot. This task will retry automatically.`
        : "The Repository Analyzer slot is busy. This task will retry automatically.",
      percent: 12,
      blockerJobId,
      startedAt: input.runStartedAt ?? null,
    };
  }

  const runningStage = orchestration?.stages?.find(
    (stage) => stage.status === "RUNNING",
  );
  if (runningStage) {
    const stageId = runningStage.id ?? "active";
    return {
      phase: stageId.toUpperCase(),
      label: runningStage.label ?? input.agentName ?? "Coding agent running",
      detail:
        runningStage.detail ??
        `${runningStage.label ?? "Current stage"} is running.`,
      percent: STAGE_PROGRESS[stageId] ?? 35,
      blockerJobId: null,
      startedAt: runningStage.startedAt ?? input.runStartedAt ?? null,
    };
  }

  const fallback = TASK_PROGRESS[input.taskStatus] ?? {
    phase: input.taskStatus || "RUNNING",
    label: input.agentName ?? "Coding task running",
    percent: input.runStatus === "RUNNING" ? 35 : 0,
  };

  const detail =
    nextAction
      ? `Current control-plane action: ${nextAction}.`
      : input.runStatus === "RUNNING"
        ? `${input.agentName ?? "Coding agent"} is active. Progress refreshes automatically.`
        : "Waiting for the next control-plane update.";

  return {
    ...fallback,
    detail,
    blockerJobId: null,
    startedAt: input.runStartedAt ?? null,
  };
}

export function formatCodingElapsed(
  startedAt: string | null | undefined,
  nowMs = Date.now(),
): string {
  if (!startedAt) return "—";
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs)) return "—";

  const totalSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
