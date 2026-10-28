/** Pure final decision gate. Evidence MUST be obtained from independent server-side
 * verifiers; never pass worker-provided claims as trusted results.
 */
export type VerifiedGate = { verified: boolean; commitSha: string | null; evidenceId: string | null };
export type CompletionDecisionInput = {
  jobId: string; commandId: string; commitSha: string;
  persistedTerminalStatus: string; ackMatchesCommand: boolean;
  ci: VerifiedGate; deployment: VerifiedGate;
  productionHealth: VerifiedGate; e2e: VerifiedGate;
};
export function decideJobCompletion(input: CompletionDecisionInput) {
  const failures: string[] = [];
  if (!input.jobId || !input.commandId || !/^[0-9a-f]{40}$/i.test(input.commitSha)) failures.push("INVALID_IDENTITY");
  if (input.persistedTerminalStatus !== "COMPLETED" || !input.ackMatchesCommand) failures.push("WORKER_NOT_CONFIRMED");
  for (const name of ["ci","deployment","productionHealth","e2e"] as const) {
    const gate = input[name];
    if (!gate.verified || !gate.evidenceId ||
        gate.commitSha?.toLowerCase() !== input.commitSha.toLowerCase()) failures.push(name.toUpperCase() + "_NOT_VERIFIED");
  }
  return { status: failures.length ? "COMPLETED_UNVERIFIED" as const : "E2E_PASS" as const,
    eligibleForNotification: failures.length === 0, failures,
    idempotencyKey: `ai-core-job:${input.jobId}:${input.commandId}:${input.commitSha}:final` };
}
