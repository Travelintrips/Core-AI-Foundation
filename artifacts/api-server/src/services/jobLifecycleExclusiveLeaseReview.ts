/** DEV Phase 4 exclusive command lease review. No acquisition, renewal, DB write or dispatch.
 * The caller must get this lease from server-owned database state, never from worker presence.
 */
export type ResumeCommandLease = {
  commandId: string; ownerWorkerId: string; token: string;
  fencingVersion: number; acquiredAt: Date; expiresAt: Date; releasedAt: Date | null;
};
export type LeaseReviewReason =
  | "NO_LEASE" | "UNVERIFIED_LEASE" | "COMMAND_MISMATCH" | "WORKER_MISMATCH"
  | "TOKEN_MISMATCH" | "INVALID_FENCING_VERSION" | "INVALID_TIME"
  | "NOT_YET_ACQUIRED" | "LEASE_EXPIRED" | "LEASE_RELEASED" | "LEASE_REVIEW_VALID";
export function reviewExclusiveResumeLease(input: {
  commandId: string; intendedWorkerId: string; expectedToken: string;
  minimumFencingVersion: number; lease: ResumeCommandLease | null;
  serverRecordVerified: boolean; now: Date;
}): { validForFurtherReview: boolean; reason: LeaseReviewReason;
  mayDispatchWorker: false; mayCloseJob: false } {
  const deny = (reason: LeaseReviewReason) => ({ validForFurtherReview: false, reason,
    mayDispatchWorker: false as const, mayCloseJob: false as const });
  const l = input.lease;
  if (!l) return deny("NO_LEASE");
  if (!input.serverRecordVerified) return deny("UNVERIFIED_LEASE");
  if (!input.commandId || l.commandId !== input.commandId) return deny("COMMAND_MISMATCH");
  if (!input.intendedWorkerId || l.ownerWorkerId !== input.intendedWorkerId) return deny("WORKER_MISMATCH");
  if (!input.expectedToken || l.token !== input.expectedToken) return deny("TOKEN_MISMATCH");
  if (!Number.isSafeInteger(input.minimumFencingVersion) || input.minimumFencingVersion < 1 ||
      !Number.isSafeInteger(l.fencingVersion) || l.fencingVersion < input.minimumFencingVersion)
    return deny("INVALID_FENCING_VERSION");
  const times = [input.now,l.acquiredAt,l.expiresAt];
  if (times.some(t => !(t instanceof Date) || !Number.isFinite(t.getTime())) ||
      l.expiresAt.getTime() <= l.acquiredAt.getTime()) return deny("INVALID_TIME");
  if (l.acquiredAt.getTime() > input.now.getTime()) return deny("NOT_YET_ACQUIRED");
  if (l.releasedAt !== null) return deny("LEASE_RELEASED");
  if (l.expiresAt.getTime() <= input.now.getTime()) return deny("LEASE_EXPIRED");
  return { validForFurtherReview: true, reason: "LEASE_REVIEW_VALID",
    mayDispatchWorker: false, mayCloseJob: false };
}
