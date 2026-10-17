// Fail-closed contract for the integrated DEV continuity acceptance evidence.
// This module validates evidence only; it never fabricates live test results.
export const REQUIRED_SCENARIOS = Object.freeze([
  'CHATGPT_TIMEOUT', 'DC_DISCONNECT_RECOVERY', 'PR_CI_WAIT_RESUME',
  'CI_FAILURE_GITHUB_REPAIR', 'OPENCLAW_OFFLINE_RECOVERY',
  'BLOCKER_SOP_DELIVERY_ACK', 'LATE_DUPLICATE_CALLBACK',
  'PREMATURE_REPORT_REJECTED', 'UNRECOVERABLE_CONNECTION_PERSISTED'
]);
export function evaluateDevFullContinuityAcceptance(input) {
  if (!input || input.environment !== 'DEV' || !input.jobId || !input.correlationId) {
    return {status:'RUNNING',allowed:false,reason:'invalid_dev_job',missing:[...REQUIRED_SCENARIOS]};
  }
  const events=Array.isArray(input.evidence)?input.evidence:[];
  const accepted=new Map();
  for (const e of events) {
    if (!e || !REQUIRED_SCENARIOS.includes(e.scenario) || e.jobId!==input.jobId ||
        e.correlationId!==input.correlationId || e.environment!=='DEV' ||
        e.result!=='PASS' || e.verifier!=='trusted' || !e.evidenceId ||
        e.source==='simulated' || e.source==='self_report') continue;
    accepted.set(e.scenario,e);
  }
  const missing=REQUIRED_SCENARIOS.filter(s=>!accepted.has(s));
  const finals=events.filter(e=>e?.type==='FINAL_NOTIFICATION' && e.jobId===input.jobId &&
    e.correlationId===input.correlationId && e.environment==='DEV');
  const safety=Boolean(input.checkpointPersisted && input.callbackVerified &&
    input.executionExactlyOnceVerified && input.notificationExactlyOnceVerified &&
    input.productionUnchangedVerified && input.releaseGatePassed);
  const uniqueFinals=new Set(finals.map(e=>e.idempotencyKey));
  const notificationsValid=finals.length<=1 && uniqueFinals.size===finals.length;
  if (missing.length || !safety || !notificationsValid) {
    return {status:'RUNNING',allowed:false,reason:missing.length?'evidence_incomplete':
      !safety?'safety_gate_incomplete':'duplicate_final_notification',missing,
      verified:REQUIRED_SCENARIOS.filter(s=>accepted.has(s))};
  }
  return {status:'COMPLETED',allowed:true,reason:'all_dev_evidence_verified',missing:[],verified:[...REQUIRED_SCENARIOS]};
}
