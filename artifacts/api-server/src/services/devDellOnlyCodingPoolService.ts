/**
 * DELL-only DEV routing policy for ChatGPT coding accounts.
 *
 * This is a pure preview policy. It does not alter the existing GPT-02 DELL
 * worker, add a consumer, bind another account, or claim a task.
 * The control plane must authenticate the host and recheck the facts in an
 * atomic lease + project-lock claim before any browser delivery.
 */
import {
  planDevChatGptCodingWorker,
  type DevChatGptPoolJob,
  type DevChatGptPoolPlan,
  type DevChatGptPoolWorker,
} from "./devChatGptCodingPoolPlanner.js";

export const DEV_GPT_WORKER_HOST = "DELL" as const;
/** Existing administrative and legacy GPT-01 profiles are not worker slots. */
const RESERVED_DELL_PROFILES = new Set(["openclaw", "admcst001-dev"]);

export type DevDellAccountWorker = DevChatGptPoolWorker & {
  /** Authenticated, server-derived host identity; never use an arbitrary browser label. */
  hostId: string;
  hostAttested: boolean;
  /** Runtime evidence that this profile belongs to the indicated account. */
  profileSessionIsolated: boolean;
  /** Independently leased worker process ID, not the OpenClaw gateway PID. */
  distinctExecutorAttested: boolean;
};

export function planDevDellOnlyCodingWorker(input: {
  job: DevChatGptPoolJob;
  workers: readonly DevDellAccountWorker[];
  occupiedExecutors: readonly string[];
  nowMs?: number;
  /** Defaults to two independently verified executors on the same DELL. */
  maxHostExecutors?: number;
}): DevChatGptPoolPlan {
  const maxHostExecutors = input.maxHostExecutors ?? 2;
  if (!Number.isSafeInteger(maxHostExecutors) || maxHostExecutors < 1 || maxHostExecutors > 2) {
    return { outcome: "BLOCK", reason: "INVALID_JOB" };
  }

  // A worker from Travelintrips/VPS cannot be promoted into the DELL account pool.
  // A configured-but-unverified DELL browser is not dispatchable.
  const dell = input.workers.filter(w =>
    w.hostId === DEV_GPT_WORKER_HOST &&
    w.hostAttested &&
    w.profileSessionIsolated &&
    w.distinctExecutorAttested &&
    !RESERVED_DELL_PROFILES.has(w.browserProfile.toLowerCase()),
  );

  const occupied = new Set(input.occupiedExecutors);
  for (const worker of dell) {
    if (!Number.isSafeInteger(worker.activeJobs) || worker.activeJobs !== 0) {
      occupied.add(worker.executorId);
    }
  }
  // Count even occupied DELL executor IDs not represented in the current
  // candidate list; caller supplies the authoritative host occupancy snapshot.
  if (occupied.size >= maxHostExecutors) {
    // Preserve existing job-level block decisions before presenting capacity WAIT.
    const baseline = planDevChatGptCodingWorker({
      job: input.job, workers: [], occupiedExecutors: [], nowMs: input.nowMs,
    });
    return baseline.outcome === "BLOCK" ? baseline : {
      outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER",
    };
  }

  return planDevChatGptCodingWorker({
    job: input.job,
    workers: dell,
    occupiedExecutors: [...occupied],
    nowMs: input.nowMs,
  });
}
