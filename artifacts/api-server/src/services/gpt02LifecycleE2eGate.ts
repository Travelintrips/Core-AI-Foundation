/**
 * DEV diagnostic-only, fail-closed integrated GPT02 Job lifecycle evidence.
 * Never issue commands, reserve attempts, acquire leases or authorize dispatch.
 * Each gate is independently bound to the same job, parent and candidate.
 */
export type LifecycleGateName =
  | "humanApproval" | "prototypeIntegrity" | "legacyAttemptsExcluded"
  | "durableParentLink" | "reservationReadback" | "exclusiveFencingLease"
  | "workerHealth" | "rateLimitClear" | "issuerAuthorization"
  | "nativeAck" | "resultVerified";

export const requiredLifecycleGates: readonly LifecycleGateName[] = [
  "humanApproval", "prototypeIntegrity", "legacyAttemptsExcluded",
  "durableParentLink", "reservationReadback", "exclusiveFencingLease",
  "workerHealth", "rateLimitClear", "issuerAuthorization",
  "nativeAck", "resultVerified",
] as const;

export type GateEvidence = {
  gate: LifecycleGateName;
  jobId: number;
  parentCommandId: string;
  candidateCommandId: string;
  verified: boolean;
  evidenceId: string;
  recordedAt: string;
};

export type LifecycleEvidenceInput = {
  jobId: number;
  parentCommandId: string;
  candidateCommandId: string;
  observations: readonly GateEvidence[];
};

export function assessGpt02LifecycleE2e(input: LifecycleEvidenceInput) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const subjectValid = Number.isSafeInteger(input.jobId) && input.jobId > 0 &&
    uuid.test(input.parentCommandId) && uuid.test(input.candidateCommandId) &&
    input.parentCommandId.toLowerCase() !== input.candidateCommandId.toLowerCase();

  const gates = requiredLifecycleGates.map(gate => {
    const rows = input.observations.filter(x => x.gate === gate);
    const valid = subjectValid && rows.length === 1 &&
      rows[0]?.jobId === input.jobId &&
      rows[0]?.parentCommandId.toLowerCase() === input.parentCommandId.toLowerCase() &&
      rows[0]?.candidateCommandId.toLowerCase() === input.candidateCommandId.toLowerCase() &&
      rows[0]?.verified === true &&
      typeof rows[0]?.evidenceId === "string" && rows[0].evidenceId.trim().length > 0 &&
      typeof rows[0]?.recordedAt === "string" &&
      Number.isFinite(Date.parse(rows[0].recordedAt)) &&
      !Number.isNaN(new Date(rows[0].recordedAt).getTime());
    return { gate, verified: Boolean(valid),
      reason: !subjectValid ? "INVALID_SUBJECT" :
        rows.length === 0 ? "EVIDENCE_MISSING" :
        rows.length > 1 ? "AMBIGUOUS_EVIDENCE" :
        valid ? "EVIDENCE_RECORDED" : "UNVERIFIED_OR_UNBOUND" };
  });
  const readyForHumanReview = subjectValid && gates.every(x => x.verified);

  // A snapshot is never dispatch permission even if all evidence is present.
  return {
    jobId: input.jobId,
    parentCommandId: input.parentCommandId,
    candidateCommandId: input.candidateCommandId,
    gates,
    missingOrUnverified: gates.filter(x => !x.verified).map(x => x.gate),
    readyForHumanReview,
    reviewOnly: true as const,
    mayCreateCommand: false as const,
    mayDispatchWorker: false as const,
    mayCloseJob: false as const,
  };
}
