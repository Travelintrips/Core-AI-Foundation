// DEV continuity policy primitives. No device commands, session claims or PROD side effects.
export const TERMINAL = new Set(['COMPLETED','FAILED','BLOCKED','CANCELLED']);
export function workerHealth(worker, now = Date.now(), staleMs = 120000) {
  if (!worker?.workerId || !worker?.environment || !Number.isFinite(worker?.lastHeartbeatAt)) return 'UNKNOWN';
  if (worker.environment !== 'DEV') return 'OUT_OF_SCOPE';
  return now - worker.lastHeartbeatAt > staleMs ? 'DISCONNECTED' : 'CONNECTED';
}
export function recoveryDecision({worker, candidates = [], job, now = Date.now()}) {
  if (workerHealth(worker, now) !== 'DISCONNECTED') return {action:'NONE'};
  if (job?.approvalPending || job?.criticalAction) return {action:'BLOCKED', reason:'approval_required'};
  if (!job?.checkpointVerified || !job?.jobId || !job?.checkpointSha || job.checkpointSha !== job.commitSha) return {action:'BLOCKED', reason:'checkpoint_unverified'};
  const eligible = candidates.find(c => c.environment === 'DEV' && c.workerId !== worker.workerId && c.authorized === true && c.capabilities?.includes(job.capability) && workerHealth(c,now) === 'CONNECTED');
  return eligible ? {action:'RECOVER', targetWorkerId: eligible.workerId, jobId:job.jobId, requireLease:true, verifyCallback:true} : {action:'WAIT',reason:'no_authorized_healthy_worker'};
}
export function terminalGate(job) {
  if (!job?.jobId || !Array.isArray(job.criteria) || !job.criteria.length) return {allowed:false,reason:'missing_acceptance_criteria'};
  if (!job.criteria.every(c => c.id && c.pass === true && c.evidenceId && c.verifier === 'trusted')) return {allowed:false,reason:'evidence_incomplete'};
  if (!job.callbackVerified || !job.leaseFinalized) return {allowed:false,reason:'execution_unverified'};
  return {allowed:true};
}
export function sopDecision(event) {
  return event?.type === 'BLOCKER' && event.blockerId && event.environment === 'DEV'
    ? {send:true,idempotencyKey:'sop:'+event.blockerId, requireDeliveryAck:true} : {send:false};
}
export function inboxRecord(event) {
  if (!event?.jobId || !TERMINAL.has(event.status) || !event.eventId || !event.environment) return null;
  return {key:event.environment+':'+event.jobId+':terminal',eventId:event.eventId,jobId:event.jobId,status:event.status,conversationVerified:false,delivered:false,acked:false};
}
export function canDeliverToConversation(record,binding) {
  return Boolean(record && binding?.verified === true && binding?.attestationVerified === true && binding?.environment === 'DEV' && !record.delivered);
}
