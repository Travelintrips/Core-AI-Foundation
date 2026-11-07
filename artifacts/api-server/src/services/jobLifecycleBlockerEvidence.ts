/** DEV Phase 4: evidence-only BLOCKER validation. No persistence, authorization or dispatch. */
import { assessJobLifecycleReadiness, type LifecycleEvidenceRow } from "./jobLifecycleReadinessService.js";

export type BlockerEvidenceReason =
  | "COMMAND_MISMATCH" | "DUPLICATE_RESPONSE_ID" | "INVALID_EVENT_TIME"
  | "NO_BLOCKER" | "CHECKPOINT_NOT_VERIFIED" | "CHECKPOINT_AFTER_BLOCKER"
  | "TERMINAL_AFTER_CHECKPOINT" | "BLOCKER_EVIDENCE_VALID";

export function reviewBlockerEvidence(commandId: string, rows: readonly LifecycleEvidenceRow[]): {
  valid: boolean; reason: BlockerEvidenceReason; checkpointResponseId: string | null;
  blockerResponseId: string | null; mayDispatchWorker: false; mayCloseJob: false;
} {
  const deny = (reason: BlockerEvidenceReason, cp: string | null = null, blocker: string | null = null) =>
    ({ valid: false, reason, checkpointResponseId: cp, blockerResponseId: blocker,
      mayDispatchWorker: false as const, mayCloseJob: false as const });
  if (!commandId || rows.some(r => r.commandId !== commandId)) return deny("COMMAND_MISMATCH");
  if (new Set(rows.map(r => r.id)).size !== rows.length || rows.some(r => !r.id))
    return deny("DUPLICATE_RESPONSE_ID");
  if (rows.some(r => !(r.createdAt instanceof Date) || !Number.isFinite(r.createdAt.getTime())))
    return deny("INVALID_EVENT_TIME");
  const ordered = [...rows].sort((a,b) => a.createdAt!.getTime() - b.createdAt!.getTime() || a.id.localeCompare(b.id));
  const readiness = assessJobLifecycleReadiness(ordered);
  const cp = readiness.latestCheckpointResponseId;
  const blocker = readiness.blockingResponseId;
  if (readiness.phase !== "BLOCKED" || !blocker) return deny("NO_BLOCKER", cp, blocker);
  if (!cp || !readiness.latestCheckpointAcknowledged ||
      !readiness.latestCheckpointAttested || !readiness.latestCheckpointReceiverAckVerified)
    return deny("CHECKPOINT_NOT_VERIFIED", cp, blocker);
  const cpIndex = ordered.findIndex(r => r.id === cp);
  const blockerIndex = ordered.findIndex(r => r.id === blocker);
  if (cpIndex < 0 || blockerIndex <= cpIndex) return deny("CHECKPOINT_AFTER_BLOCKER", cp, blocker);
  if (ordered.slice(cpIndex + 1).some(r => r.kind === "COMPLETED" || r.kind === "FAILED"))
    return deny("TERMINAL_AFTER_CHECKPOINT", cp, blocker);
  return { valid: true, reason: "BLOCKER_EVIDENCE_VALID", checkpointResponseId: cp,
    blockerResponseId: blocker, mayDispatchWorker: false, mayCloseJob: false };
}
