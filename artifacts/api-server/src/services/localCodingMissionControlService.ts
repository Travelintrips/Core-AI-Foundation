import {
  getLatestCodingTaskGraph,
  type CodingTaskGraphSnapshot,
} from "./localCodingTaskGraphService.js";

export interface CodingMissionControlSnapshot {
  taskId: string;
  graphId: string;
  graphVersion: number;
  graphStatus: string;
  objective: string;
  planHash: string;
  progressPercent: number;
  totals: {
    workstreams: number;
    completed: number;
    running: number;
    waiting: number;
    reviewRequired: number;
    failed: number;
    ready: number;
  };
  active: Array<{
    id: string;
    key: string;
    title: string;
    role: string;
    status: string;
    workerId: string | null;
    branchName: string | null;
    attemptCount: number;
    dependencies: string[];
    errorMessage: string | null;
  }>;
  blockers: Array<{
    key: string;
    title: string;
    status: string;
    dependencies: string[];
    errorMessage: string | null;
  }>;
  nextActions: string[];
}

const RUNNING = new Set(["CLAIMED", "RUNNING"]);
const WAITING = new Set(["PENDING"]);
const READY = new Set(["READY"]);
const REVIEW = new Set(["REVIEW_REQUIRED"]);
const FAILED = new Set(["FAILED"]);

export function summarizeCodingMissionControl(
  taskId: string,
  snapshot: CodingTaskGraphSnapshot,
): CodingMissionControlSnapshot {
  const workstreams = snapshot.workstreams;
  const total = workstreams.length;
  const count = (statuses: Set<string>) =>
    workstreams.filter((item) => statuses.has(item.status)).length;
  const completed = workstreams.filter((item) => item.status === "COMPLETED").length;
  const running = count(RUNNING);
  const waiting = count(WAITING);
  const ready = count(READY);
  const reviewRequired = count(REVIEW);
  const failed = count(FAILED);

  const active = workstreams
    .filter((item) => item.status !== "COMPLETED")
    .map((item) => ({
      id: item.id,
      key: item.key,
      title: item.title,
      role: item.role,
      status: item.status,
      workerId: item.workerId,
      branchName: item.branchName,
      attemptCount: item.attemptCount,
      dependencies: item.dependencies,
      errorMessage: item.errorMessage,
    }));

  const blockers = workstreams
    .filter((item) => FAILED.has(item.status) || WAITING.has(item.status))
    .map((item) => ({
      key: item.key,
      title: item.title,
      status: item.status,
      dependencies: item.dependencies,
      errorMessage: item.errorMessage,
    }));

  const nextActions: string[] = [];
  if (failed > 0) nextActions.push("RESOLVE_FAILED_WORKSTREAMS");
  if (reviewRequired > 0) nextActions.push("REVIEW_WORKSTREAMS");
  if (ready > 0) nextActions.push("DISPATCH_READY_WORKSTREAMS");
  if (running > 0) nextActions.push("MONITOR_ACTIVE_LEASES");
  if (total > 0 && completed === total) {
    nextActions.push("REVIEW_INTEGRATION_MANIFEST");
  }
  if (nextActions.length === 0 && waiting > 0) nextActions.push("WAIT_FOR_DEPENDENCIES");

  return {
    taskId,
    graphId: snapshot.graph.id,
    graphVersion: snapshot.graph.version,
    graphStatus: snapshot.graph.status,
    objective: snapshot.graph.objective,
    planHash: snapshot.graph.planHash,
    progressPercent: total === 0 ? 0 : Math.round((completed / total) * 100),
    totals: {
      workstreams: total,
      completed,
      running,
      waiting,
      reviewRequired,
      failed,
      ready,
    },
    active,
    blockers,
    nextActions,
  };
}

export async function getCodingMissionControlSnapshot(
  taskId: string,
): Promise<CodingMissionControlSnapshot | null> {
  const snapshot = await getLatestCodingTaskGraph(taskId);
  return snapshot ? summarizeCodingMissionControl(taskId, snapshot) : null;
}
