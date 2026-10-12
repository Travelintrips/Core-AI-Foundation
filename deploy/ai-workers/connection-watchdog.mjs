// Durable coding-job watchdog decision engine. Does not control ChatGPT UI.
// Only a registered authenticated runner may execute a resume command.
export const POLICY = Object.freeze({ pollMs: 30_000, suspectMs: 120_000, recoverMs: 180_000, retryMs: 120_000, maxAttempts: 3 });
export function evaluate(job, now = Date.now(), policy = POLICY) {
  if (!job || !job.jobId || !job.commitSha) return { action: 'INVALID', reason: 'missing durable job identity' };
  if (['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(job.status)) return { action: 'NONE', reason: 'terminal' };
  if (job.status !== 'RUNNING' && job.status !== 'STALLED') return { action: 'NONE', reason: 'not active' };
  if (job.ciRunning || job.approvalPending) return { action: 'NONE', reason: 'legitimate wait' };
  const last = Number(job.lastProgressAt);
  if (!Number.isFinite(last) || last <= 0 || now < last) return { action: 'INVALID', reason: 'invalid heartbeat' };
  const age = now - last;
  if (age < policy.suspectMs) return { action: 'NONE', reason: 'heartbeat recent' };
  if (age < policy.recoverMs) return { action: 'SUSPECT', reason: 'progress stalled' };
  if (!job.connectionHealthy || !job.runnerAuthenticated || !job.runnerHealthy) return { action: 'WAIT', reason: 'connection or authenticated runner unavailable' };
  if (!job.checkpointVerified || job.checkpointSha !== job.commitSha) return { action: 'BLOCKED', reason: 'checkpoint missing or SHA mismatch' };
  const attempts = Number(job.resumeAttempts || 0);
  if (attempts >= policy.maxAttempts) return { action: 'BLOCKED', reason: 'retry budget exhausted' };
  if (job.activeLeaseUntil && Number(job.activeLeaseUntil) > now) return { action: 'NONE', reason: 'active execution lease' };
  if (job.lastResumeAt && now - Number(job.lastResumeAt) < policy.retryMs) return { action: 'WAIT', reason: 'retry backoff' };
  return { action: 'RESUME_ELIGIBLE', key: job.jobId + ':' + job.commitSha + ':' + attempts, reason: 'runner must atomically claim lease before resuming' };
}