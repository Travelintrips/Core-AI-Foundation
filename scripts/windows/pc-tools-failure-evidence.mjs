// Diagnostic projection for the existing role-scoped PC tools path only.
// This is observational, not execution permission, a receipt, or a retry.
export function scopedPcToolsWork(work, workerId) {
  const m = work?.metadata;
  return workerId === 'openclaw-pc-worker-dev' &&
    work?.commandType === 'EXTERNAL_AGENT_WORK' &&
    m?.assignedClientId === workerId &&
    m?.requiredCapability === 'tools:bounded' &&
    m?.openClawExecutionProfile === 'pc-tools' &&
    m?.executionBoundary === 'role-scoped' &&
    m?.capability !== 'chatgpt:wake' &&
    m?.explicitWorkerTarget !== true &&
    !m?.assistantAttestationChallenge &&
    !m?.gpt02TaskId;
}
const messages = Object.freeze({
  PC_SUBPROCESS_TIMEOUT: 'PC process exceeded its time limit; outcome unknown. Reconcile before repeating.',
  PC_TOOL_EXECUTION_TIMEOUT: 'PC tool reported timeout; outcome unknown. Reconcile before repeating.',
  PC_AUTH_PROFILE_UNAVAILABLE: 'PC agent reported an unavailable authentication profile. No verified result.',
  PC_SUBPROCESS_OUTPUT_LIMIT: 'PC process output exceeded its limit; outcome unknown. Reconcile before repeating.',
  PC_SUBPROCESS_START_ERROR: 'PC process reported a startup error. No verified result.',
  PC_SUBPROCESS_SIGNAL: 'PC process ended by signal; outcome unknown. Reconcile before repeating.',
  PC_FAILURE_MULTIPLE_SIGNALS: 'PC process reported multiple failure signals. Reconciliation required.',
  PC_SUBPROCESS_FAILED: 'PC process failed without a recognized diagnostic. Reconciliation required.',
});
export function pcToolsFailureEvidence(work, workerId, run) {
  if (!scopedPcToolsWork(work, workerId) || !run || run.status === 0) return null;
  // Inspect the existing bounded spawnSync output before taking any display tail.
  // Never serialize arbitrary output, auth profile identifiers, or instructions.
  const out = [run.stdout, run.stderr, run.error?.message].filter(v => typeof v === 'string').join('\n');
  const toolTimeout = /\btool execution (?:timeout|timed out)\b/i.test(out);
  const authUnavailable = /\b(?:no auth profile (?:configured|found|available)|auth(?:entication)? profile (?:is )?(?:not configured|unavailable|missing)|no auth configured)\b/i.test(out);
  let reason;
  if (run.error?.code === 'ETIMEDOUT') reason = 'PC_SUBPROCESS_TIMEOUT';
  else if (run.error?.code === 'ENOBUFS') reason = 'PC_SUBPROCESS_OUTPUT_LIMIT';
  else if (toolTimeout && authUnavailable) reason = 'PC_FAILURE_MULTIPLE_SIGNALS';
  else if (toolTimeout) reason = 'PC_TOOL_EXECUTION_TIMEOUT';
  else if (authUnavailable) reason = 'PC_AUTH_PROFILE_UNAVAILABLE';
  else if (run.signal) reason = 'PC_SUBPROCESS_SIGNAL';
  else if (['ENOENT','EACCES','EPERM'].includes(run.error?.code)) reason = 'PC_SUBPROCESS_START_ERROR';
  else reason = 'PC_SUBPROCESS_FAILED';
  return {
    message: messages[reason],
    details: {
      runtime: 'openclaw-pc2',
      exitCode: Number.isInteger(run.status) ? run.status : null,
      reason,
      executionOutcome: 'UNKNOWN_UNVERIFIED',
      reconciliationRequired: true,
      retryAllowed: false,
      failureDiagnosticVersion: 1,
    },
  };
}
