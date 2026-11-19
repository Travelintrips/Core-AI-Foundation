/** Phase 4 DEV: read-only validation of an explicit server-owned resume grant.
 * This function does not issue grants, obtain leases, dispatch workers or mutate state.
 * A successful review is NEVER a dispatch authorization on its own.
 */
export type ResumeGrantRecord = {
  commandId: string;
  blockerResponseId: string;
  checkpointResponseId: string;
  workerId: string;
  status: "APPROVED" | "REVOKED" | "PENDING" | "CONSUMED";
  approvedBy: string;
  approvedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};
export type ResumeAuthorizationReason =
  | "NO_GRANT" | "UNVERIFIED_SERVER_RECORD" | "COMMAND_MISMATCH"
  | "BLOCKER_MISMATCH" | "CHECKPOINT_MISMATCH" | "WORKER_MISMATCH"
  | "NOT_APPROVED" | "INVALID_APPROVER" | "INVALID_TIME"
  | "NOT_YET_APPROVED" | "EXPIRED" | "ALREADY_CONSUMED" | "GRANT_REVIEW_VALID";

export function reviewResumeAuthorization(input: {
  commandId: string;
  blockerResponseId: string | null;
  checkpointResponseId: string | null;
  intendedWorkerId: string;
  grant: ResumeGrantRecord | null;
  /** True only after an authenticated server-owned database read; never use worker payload. */
  serverRecordVerified: boolean;
  now: Date;
}): { validForFurtherReview: boolean; reason: ResumeAuthorizationReason;
  mayDispatchWorker: false; mayCloseJob: false } {
  const deny = (reason: ResumeAuthorizationReason) => ({
    validForFurtherReview: false, reason, mayDispatchWorker: false as const, mayCloseJob: false as const,
  });
  const g = input.grant;
  if (!g) return deny("NO_GRANT");
  if (!input.serverRecordVerified) return deny("UNVERIFIED_SERVER_RECORD");
  if (!input.commandId || g.commandId !== input.commandId) return deny("COMMAND_MISMATCH");
  if (!input.blockerResponseId || g.blockerResponseId !== input.blockerResponseId) return deny("BLOCKER_MISMATCH");
  if (!input.checkpointResponseId || g.checkpointResponseId !== input.checkpointResponseId)
    return deny("CHECKPOINT_MISMATCH");
  if (!input.intendedWorkerId || g.workerId !== input.intendedWorkerId) return deny("WORKER_MISMATCH");
  if (g.status !== "APPROVED") return deny("NOT_APPROVED");
  if (!g.approvedBy.trim()) return deny("INVALID_APPROVER");
  const times = [input.now, g.approvedAt, g.expiresAt];
  if (times.some(t => !(t instanceof Date) || !Number.isFinite(t.getTime())) ||
      g.expiresAt.getTime() <= g.approvedAt.getTime()) return deny("INVALID_TIME");
  if (g.approvedAt.getTime() > input.now.getTime()) return deny("NOT_YET_APPROVED");
  if (g.expiresAt.getTime() <= input.now.getTime()) return deny("EXPIRED");
  if (g.consumedAt !== null) return deny("ALREADY_CONSUMED");
  return { validForFurtherReview: true, reason: "GRANT_REVIEW_VALID",
    mayDispatchWorker: false, mayCloseJob: false };
}
