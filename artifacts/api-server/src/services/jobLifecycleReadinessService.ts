/** Read-only lifecycle readiness from persisted bridge responses.
 * This is NOT an authorization to resume a worker or close a job.
 */
export type LifecycleEvidenceRow = {
  id: string;
  commandId: string;
  kind: string;
  acknowledgedAt: Date | null;
  createdAt?: Date | null;
  /** Verified by the server against the checkpoint issuer signature. */
  checkpointAttested?: boolean;
  /** Exact response ID confirmed by an authenticated conversation ACK. */
  receiverAckVerified?: boolean;
};

export type LifecycleReadiness = {
  phase: "NO_RESPONSES" | "IN_PROGRESS" | "BLOCKED" | "TERMINAL_REPORTED";
  latestCheckpointResponseId: string | null;
  latestCheckpointAcknowledged: boolean;
  latestCheckpointAttested: boolean;
  latestCheckpointReceiverAckVerified: boolean;
  blockingResponseId: string | null;
  needsWorkerHealthAndAuthorization: boolean;
  mayAutoResume: false;
  mayAutoClose: false;
};

export function assessJobLifecycleReadiness(rows: readonly LifecycleEvidenceRow[]): LifecycleReadiness {
  // Checkpoints and terminal responses must be tied to the same command.
  // Sort deterministically to avoid dependency on query planner ordering.
  const eventTime = (row: LifecycleEvidenceRow) => row.createdAt instanceof Date &&
    Number.isFinite(row.createdAt.getTime()) ? row.createdAt.getTime() : 0;
  const ordered = [...rows].sort((a, b) =>
    eventTime(a) - eventTime(b));
  const latest = ordered.at(-1);
  const latestCheckpoint = [...ordered].reverse().find(row => row.kind === "CHECKPOINT");
  const blocked = latest?.kind === "BLOCKER" ? latest : null;
  const terminal = latest?.kind === "COMPLETED" || latest?.kind === "FAILED";
  const ackedCheckpoint = Boolean(latestCheckpoint?.acknowledgedAt);
  return {
    phase: !latest ? "NO_RESPONSES" : terminal ? "TERMINAL_REPORTED" : blocked ? "BLOCKED" : "IN_PROGRESS",
    latestCheckpointResponseId: latestCheckpoint?.id ?? null,
    latestCheckpointAcknowledged: ackedCheckpoint,
    latestCheckpointAttested: latestCheckpoint?.checkpointAttested === true,
    latestCheckpointReceiverAckVerified: latestCheckpoint?.receiverAckVerified === true,
    blockingResponseId: blocked?.id ?? null,
    // Even if the checkpoint was ACKed, worker health, permission, lease,
    // retry budget and human safety approval remain external requirements.
    needsWorkerHealthAndAuthorization: Boolean(blocked && latestCheckpoint &&
      latestCheckpoint.commandId === blocked.commandId && ackedCheckpoint &&
      latestCheckpoint.checkpointAttested === true && latestCheckpoint.receiverAckVerified === true),
    mayAutoResume: false,
    mayAutoClose: false,
  };
}
