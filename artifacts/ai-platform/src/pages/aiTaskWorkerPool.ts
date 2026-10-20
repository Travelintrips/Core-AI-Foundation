/**
 * Read-only view model for the AI Task worker pool.
 *
 * The dashboard cannot allocate jobs: only the backend lease/claim transaction
 * may choose an executor. Never equate an online heartbeat with availability.
 */
export type WorkerPoolRecord = {
  workerName: string;
  status: string;
  leaseValid: boolean;
  availableSlots: number;
  runningJobs: number;
  maxConcurrentJobs: number;
  lastHeartbeat: string;
  capabilities: string[];
};

export type WorkerPoolState = "available" | "busy" | "unavailable" | "unverified";

export type WorkerPoolAssessment = {
  worker: WorkerPoolRecord;
  state: WorkerPoolState;
  reason: string;
};

const HEARTBEAT_MAX_AGE_MS = 120_000;
const FUTURE_CLOCK_SKEW_MS = 30_000;

/**
 * Fail closed on stale data, unknown status, invalid capacity, or missing lease.
 * A BUSY worker remains busy even when it advertises spare capacity: we prefer
 * a truly idle worker when explaining the scheduler's expected behavior.
 */
export function assessPoolWorker(
  worker: WorkerPoolRecord,
  nowMs = Date.now(),
): WorkerPoolAssessment {
  const seenAt = Date.parse(worker.lastHeartbeat);
  if (!Number.isFinite(seenAt) ||
      seenAt > nowMs + FUTURE_CLOCK_SKEW_MS ||
      nowMs - seenAt > HEARTBEAT_MAX_AGE_MS) {
    return { worker, state: "unverified", reason: "Heartbeat missing, stale or clock-skewed" };
  }
  if (["offline", "stale", "maintenance"].includes(worker.status)) {
    return { worker, state: "unavailable", reason: `Worker is ${worker.status}` };
  }
  if (!worker.leaseValid) {
    return { worker, state: "unverified", reason: "No verified active lease" };
  }
  if (!Number.isSafeInteger(worker.maxConcurrentJobs) || worker.maxConcurrentJobs <= 0 ||
      !Number.isSafeInteger(worker.runningJobs) || worker.runningJobs < 0 ||
      !Number.isSafeInteger(worker.availableSlots) || worker.availableSlots < 0 ||
      worker.runningJobs > worker.maxConcurrentJobs ||
      worker.availableSlots > worker.maxConcurrentJobs - worker.runningJobs) {
    return { worker, state: "unverified", reason: "Inconsistent worker capacity" };
  }
  if (worker.status === "busy" || worker.runningJobs > 0) {
    return { worker, state: "busy", reason: "Worker is processing another job" };
  }
  if (worker.status !== "idle") {
    return { worker, state: "unverified", reason: "Online does not prove ready to claim" };
  }
  if (worker.availableSlots === 0) {
    return { worker, state: "unverified", reason: "No available execution slot" };
  }
  return { worker, state: "available", reason: "Idle, lease verified and capacity available" };
}

/** Capability must be explicitly advertised by the runtime, not inferred from an account label. */
export function selectPoolCandidate(
  workers: readonly WorkerPoolRecord[],
  requiredCapability: string,
  nowMs = Date.now(),
): WorkerPoolAssessment | null {
  return workers
    .filter(w => w.capabilities.includes(requiredCapability))
    .map(w => assessPoolWorker(w, nowMs))
    .filter(w => w.state === "available")
    .sort((a, b) => a.worker.workerName.localeCompare(b.worker.workerName))[0] ?? null;
}

export function summarizePool(workers: readonly WorkerPoolRecord[], nowMs = Date.now()) {
  const assessed = workers.map(w => assessPoolWorker(w, nowMs));
  return {
    assessed,
    available: assessed.filter(w => w.state === "available").length,
    busy: assessed.filter(w => w.state === "busy").length,
    unavailable: assessed.filter(w => w.state === "unavailable").length,
    unverified: assessed.filter(w => w.state === "unverified").length,
  };
}


/** Coding dashboard overview has a different, coarser worker contract than the queue registry.
 * Never infer skill or authenticated ChatGPT account from this health snapshot.
 */
export type CodingDashboardWorkerRecord = {
  status: string;
  healthy: boolean;
  runningJobs: number;
  capacity: number;
  lastHeartbeat: string;
  leaseExpiresAt: string | null;
};

export function assessCodingDashboardWorker(
  worker: CodingDashboardWorkerRecord,
  nowMs = Date.now(),
): { state: WorkerPoolState; reason: string } {
  if (["offline", "stale", "maintenance"].includes(worker.status.toLowerCase())) {
    return { state: "unavailable", reason: `Worker status: ${worker.status}` };
  }
  const heartbeatMs = Date.parse(worker.lastHeartbeat);
  const leaseMs = worker.leaseExpiresAt ? Date.parse(worker.leaseExpiresAt) : Number.NaN;
  if (!worker.healthy || !Number.isFinite(heartbeatMs) ||
      heartbeatMs > nowMs + FUTURE_CLOCK_SKEW_MS ||
      nowMs - heartbeatMs > HEARTBEAT_MAX_AGE_MS ||
      !Number.isFinite(leaseMs) || leaseMs <= nowMs) {
    return { state: "unverified", reason: "Healthy heartbeat and active lease not confirmed" };
  }
  if (!Number.isSafeInteger(worker.capacity) || worker.capacity <= 0 ||
      !Number.isSafeInteger(worker.runningJobs) || worker.runningJobs < 0 ||
      worker.runningJobs > worker.capacity) {
    return { state: "unverified", reason: "Inconsistent worker capacity" };
  }
  if (worker.runningJobs > 0 || worker.status.toLowerCase() === "busy") {
    return { state: "busy", reason: "Processing another job" };
  }
  if (!["idle", "online", "active"].includes(worker.status.toLowerCase())) {
    return { state: "unverified", reason: "Unsupported worker status" };
  }
  return { state: "available", reason: "Healthy lease and a free slot (skills not shown here)" };
}
