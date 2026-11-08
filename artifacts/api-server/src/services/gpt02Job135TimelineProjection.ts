/**
 * Pure read-only status projection of server-persisted response evidence.
 * No fabricated progress percentages; worker output is informational until
 * independently authenticated, native-ACKed, and result-verified.
 */
export type TimelineResponse = {
  id: string;
  commandId: string;
  kind: "ACK" | "PROGRESS" | "CHECKPOINT" | "BLOCKER" | "COMPLETED" | "FAILED";
  createdAt: Date | null;
  nativeAttestationVerified: boolean;
  receiverAckVerified: boolean;
  resultVerified: boolean;
};

export type JobTimelineInput = {
  jobId: number;
  parentCommandId: string;
  candidateCommandId: string | null;
  assignedWorkerId: string | null;
  accountableOwner: string | null;
  reviewAccepted: boolean;
  responses: readonly TimelineResponse[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function projectGpt02Job135Timeline(input: JobTimelineInput) {
  const validJob = Number.isSafeInteger(input.jobId) && input.jobId > 0;
  const validParent = uuid.test(input.parentCommandId);
  const target = input.candidateCommandId;
  const validChild = target !== null && uuid.test(target) &&
    target.toLowerCase() !== input.parentCommandId.toLowerCase();
  const relevant = input.responses.filter(x => validParent &&
    (x.commandId.toLowerCase() === input.parentCommandId.toLowerCase() ||
      (validChild && x.commandId.toLowerCase() === target.toLowerCase())));
  const duplicates = new Set(relevant.map(x => x.id)).size !== relevant.length;
  const invalidRows = relevant.some(x => !x.id || !(x.createdAt instanceof Date) ||
    !Number.isFinite(x.createdAt.getTime()));
  const valid = validJob && validParent && !duplicates && !invalidRows;
  const ordered = valid
    ? [...relevant].sort((a,b) => a.createdAt!.getTime()-b.createdAt!.getTime() ||
      a.id.localeCompare(b.id))
    : [];
  const last = ordered.at(-1);
  const blocker = [...ordered].reverse().find(x => x.kind === "BLOCKER");
  const terminal = last && (last.kind === "COMPLETED" || last.kind === "FAILED");
  const finalProof = validChild && last?.commandId.toLowerCase() === target.toLowerCase() &&
    last?.kind === "COMPLETED" && last.nativeAttestationVerified &&
    last.receiverAckVerified && last.resultVerified;
  // Worker activity is evidence of a persisted response, NOT proof that a
  // process is currently running. Only an independently verified terminal
  // result can clear the final-result gate.
  const candidateHasNonterminalActivity = validChild &&
    last?.commandId.toLowerCase() === target.toLowerCase() &&
    (last.kind === "ACK" || last.kind === "PROGRESS" || last.kind === "CHECKPOINT");
  const blocked = !valid || !validChild || Boolean(blocker && !terminal) ||
    last?.kind === "FAILED" || last?.kind === "COMPLETED";

  return {
    jobId: input.jobId,
    parentCommandId: input.parentCommandId,
    candidateCommandId: input.candidateCommandId,
    accountableOwner: typeof input.accountableOwner === "string" &&
      input.accountableOwner.trim() ? input.accountableOwner : null,
    assignedWorkerId: typeof input.assignedWorkerId === "string" &&
      input.assignedWorkerId.trim() ? input.assignedWorkerId : null,
    reviewAccepted: input.reviewAccepted,
    // Event count is grounded; completion percentage is unavailable without
    // an approved task decomposition and server-owned progress denominator.
    observedEventCount: ordered.length,
    progressPercent: null as null,
    lastEventId: last?.id ?? null,
    lastEventKind: last?.kind ?? null,
    lastEventAt: last?.createdAt?.toISOString() ?? null,
    lastNativeAckVerified: last?.nativeAttestationVerified === true &&
      last?.receiverAckVerified === true,
    blockerResponseId: blocker && !terminal ? blocker.id : null,
    status: !valid ? "EVIDENCE_INVALID" as const :
      !validChild ? "ISSUER_NOT_VERIFIED" as const :
      finalProof ? "RESULT_EVIDENCE_RECORDED" as const :
      blocked ? "BLOCKED_OR_UNVERIFIED" as const :
      candidateHasNonterminalActivity ? "ACTIVITY_RECORDED_UNVERIFIED" as const :
      "BLOCKED_OR_UNVERIFIED" as const,
    // A read-only projection cannot grant completion. Even the strongest
    // observed proof still requires a separate authorized finalization.
    eligibleForCompletionReview: Boolean(finalProof && input.reviewAccepted),
    mayDispatchWorker: false as const,
    mayCloseJob: false as const,
  };
}
