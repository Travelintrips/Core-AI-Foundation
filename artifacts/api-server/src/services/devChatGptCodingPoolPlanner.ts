/**
 * DEV-only GPT browser-account coding pool admission policy.
 *
 * IMPORTANT: this produces an eligibility decision, NOT a job claim or browser
 * instruction. The caller must recheck all evidence inside the existing
 * atomic claim/lease/fencing transaction before queuing work. Never
 * infer an account login or browser ownership from a healthy process.
 */
export type DevChatGptPoolWorker = {
  accountAlias: string;
  executorId: string;
  browserProfile: string;
  capabilities: readonly string[];
  bindingEnabled: boolean;
  accountSessionAttested: boolean;
  signedDestinationReceiptVerified: boolean;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  activeJobs: number;
  availableSlots: number;
  maxConcurrentJobs: number;
};

export type DevChatGptPoolJob = {
  jobId: string;
  capability: "coding" | "testing";
  approvedForDev: boolean;
  status: "QUEUED" | "WAITING_FOR_WORKER" | "CLAIMED" | "RUNNING" | "COMPLETED";
  claimedByExecutorId?: string | null;
  codingAccountAlias?: string | null;
  projectLockHeldBy?: string | null;
};

export type DevChatGptPoolPlan =
  | { outcome: "CANDIDATE"; accountAlias: string; executorId: string; browserProfile: string;
      evidence: "VERIFIED_IDLE_SESSION"; requiresAtomicClaim: true }
  | { outcome: "WAIT"; reason: "NO_VERIFIED_IDLE_WORKER" | "PROJECT_LOCKED" }
  | { outcome: "BLOCK"; reason: "INVALID_JOB" | "JOB_ALREADY_CLAIMED" | "APPROVAL_REQUIRED" | "DUPLICATE_BINDING" };

const ACCOUNT = /^GPT[0-9]{2,4}$/;
const MAX_HEARTBEAT_AGE_MS = 90_000;
const FUTURE_SKEW_MS = 30_000;

/** Distinct ChatGPT accounts sharing one serial OpenClaw executor cannot work concurrently. */
export function planDevChatGptCodingWorker(input: {
  job: DevChatGptPoolJob;
  workers: readonly DevChatGptPoolWorker[];
  occupiedExecutors: readonly string[];
  nowMs?: number;
}): DevChatGptPoolPlan {
  const { job, workers, occupiedExecutors } = input;
  const now = input.nowMs ?? Date.now();
  if (!job || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(job.jobId) ||
      !["coding", "testing"].includes(job.capability)) {
    return { outcome: "BLOCK", reason: "INVALID_JOB" };
  }
  if (!job.approvedForDev) return { outcome: "BLOCK", reason: "APPROVAL_REQUIRED" };
  if (!["QUEUED", "WAITING_FOR_WORKER"].includes(job.status) ||
      job.claimedByExecutorId) {
    return { outcome: "BLOCK", reason: "JOB_ALREADY_CLAIMED" };
  }
  if (job.projectLockHeldBy) return { outcome: "WAIT", reason: "PROJECT_LOCKED" };

  const seenAliases = new Set<string>();
  const seenProfiles = new Set<string>();
  for (const w of workers) {
    if (!ACCOUNT.test(w.accountAlias) || w.accountAlias === "GPT01" ||
        !w.executorId || !w.browserProfile ||
        seenAliases.has(w.accountAlias) || seenProfiles.has(w.browserProfile.toLowerCase())) {
      return { outcome: "BLOCK", reason: "DUPLICATE_BINDING" };
    }
    seenAliases.add(w.accountAlias);
    seenProfiles.add(w.browserProfile.toLowerCase());
  }

  const busyExecutors = new Set(occupiedExecutors);
  for (const w of workers) {
    // A sibling with unknown utilization cannot prove its shared serial executor is idle.
    // Fail closed for that executor rather than choosing another profile under it.
    if (!Number.isSafeInteger(w.activeJobs) || w.activeJobs !== 0) {
      busyExecutors.add(w.executorId);
    }
  }

  const ready = workers.filter(w => {
    const heartbeat = w.heartbeatAt ? Date.parse(w.heartbeatAt) : NaN;
    const expires = w.leaseExpiresAt ? Date.parse(w.leaseExpiresAt) : NaN;
    return w.bindingEnabled && w.accountSessionAttested &&
      w.signedDestinationReceiptVerified &&
      w.capabilities.includes(job.capability) &&
      Number.isFinite(heartbeat) && heartbeat <= now + FUTURE_SKEW_MS &&
      now - heartbeat <= MAX_HEARTBEAT_AGE_MS &&
      Number.isFinite(expires) && expires > now &&
      Number.isSafeInteger(w.activeJobs) && w.activeJobs === 0 &&
      Number.isSafeInteger(w.availableSlots) && w.availableSlots > 0 &&
      Number.isSafeInteger(w.maxConcurrentJobs) && w.maxConcurrentJobs > 0 &&
      w.availableSlots <= w.maxConcurrentJobs &&
      !busyExecutors.has(w.executorId) &&
      !(job.capability === "testing" && job.codingAccountAlias === w.accountAlias);
  });

  // Deterministic selection for the preview; no atomic reservation happens here.
  ready.sort((a, b) => a.accountAlias.localeCompare(b.accountAlias));
  const selected = ready[0];
  return selected
    ? { outcome: "CANDIDATE", accountAlias: selected.accountAlias,
        executorId: selected.executorId, browserProfile: selected.browserProfile,
        evidence: "VERIFIED_IDLE_SESSION", requiresAtomicClaim: true }
    : { outcome: "WAIT", reason: "NO_VERIFIED_IDLE_WORKER" };
}
