import { recoveryDecision, terminalGate, sopDecision, inboxRecord } from './continuity-policy.mjs';
import { RecoveryInbox } from './recovery-inbox.mjs';
import { evaluateDevFullContinuityAcceptance } from './dev-full-continuity-acceptance.mjs';
// Adapter connects authenticated registry and dispatcher ports. All effects are injected;
// never invents a ChatGPT conversation binding or acknowledges on behalf of ChatGPT.
export class DevContinuityRuntime {
 constructor({registry, dispatcher, checkpoints, inbox, sopSender}) {
  Object.assign(this,{registry,dispatcher,checkpoints,inbox,sopSender});
 }
 async recover({sourceWorkerId,job,now=Date.now()}) {
  if(job?.environment!=='DEV') return {action:'BLOCKED',reason:'environment'};
  const source=await this.registry.get(sourceWorkerId);
  const candidates=await this.registry.list();
  const decision=recoveryDecision({worker:source,candidates,job,now});
  if(decision.action!=='RECOVER') return decision;
  const lease=this.checkpoints.claimResume(job.jobId,decision.targetWorkerId);
  if(!lease || lease.checkpointSha!==job.commitSha) return {action:'WAIT',reason:'checkpoint_lease'};
  // Dispatcher must authenticate the target and return an auditable command reference.
  const dispatched=await this.dispatcher.dispatch({jobId:job.jobId,targetWorkerId:decision.targetWorkerId,checkpointSha:job.commitSha,leaseOwner:decision.targetWorkerId});
  return {action:'DISPATCHED',jobId:job.jobId,commandId:dispatched.commandId,targetWorkerId:decision.targetWorkerId};
 }
 async blocker(event) {
  const decision=sopDecision(event);
  if(!decision.send) return {sent:false};
  const receipt=await this.sopSender.send({...decision,event});
  return {sent:Boolean(receipt?.deliveryId),deliveryId:receipt?.deliveryId??null,ackVerified:receipt?.ackVerified===true};
 }
 terminal(job,event) {
  if(event?.environment!=='DEV'||event.jobId!==job.jobId) return {accepted:false,reason:'environment_or_job_mismatch'};
  if(event.status==='COMPLETED') {
   const gate=terminalGate(job);
   if(!gate.allowed)return {accepted:false,reason:gate.reason};
   if(job.acceptanceContract==='DEV_FULL_CONTINUITY_V1') {
    const full=evaluateDevFullContinuityAcceptance(job);
    if(!full.allowed)return {accepted:false,reason:full.reason,missing:full.missing,status:'RUNNING'};
   }
  }
  const item=inboxRecord(event);
  if(!item)return {accepted:false,reason:'invalid_terminal_event'};
  const stored=this.inbox.enqueue(event);
  return {accepted:true,key:stored.dedupe_key,deliveryVerified:Boolean(stored.delivered_at),ackVerified:Boolean(stored.acked_at)};
 }
 acknowledge(key,binding) {
  if(!binding?.verified || !binding?.attestationVerified || binding?.environment!=='DEV' || !binding.conversationId) return false;
  return this.inbox.ack(key,binding.conversationId);
 }
}
