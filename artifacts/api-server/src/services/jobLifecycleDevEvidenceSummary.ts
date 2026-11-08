/**
 * DEV command-scoped, read-only evidence summary. Existing signed native
 * checkpoint/ACK verification is performed by the trusted recovery service.
 * Missing job/attempt/grant/lease/monitoring data stays explicit NOT_VERIFIED.
 * This is diagnostic and NEVER an authority to sign, grant, resume or close.
 */
import {getDevCommandRecoveryReview} from "./jobLifecycleRecoveryReview.js";
import {readDevAiTaskJob} from "./jobLifecycleAiTaskReadback.js";
export type EvidenceState="OBSERVED"|"BLOCKED"|"NOT_VERIFIED";
export type EvidenceCheck={id:string;state:EvidenceState;reason:string};
export type RecoverySummary={found:boolean;commandId:string;commandStatus?:string;
  sourceTaskId:string|null;sourceTaskIdVerifiedAsAiTaskJob:false;
  expectedAiTaskLedgerExternalId:string|null;
  aiTaskLedgerReadbackVerified:boolean;
  aiTaskLedgerReadbackReason:string;
  aiTaskLedgerReceiverJobId?:string;
  aiTaskLedgerReceiverStatus?:string;
  aiTaskLedgerReceiverProgress?:number;
  aiTaskLedgerReceiverEventEvidence?:NonNullable<Awaited<ReturnType<typeof readDevAiTaskJob>>["receiverEventEvidence"]>;
  // Receiver-reported job status/progress are NOT native worker completion.
  aiTaskLedgerStatusAndProgressAuthoritative:false;
  releaseDecision:"NO_GO";snapshotAtomic:false;maySign:false;mayIssueGrant:false;
  mayDispatchWorker:false;mayCloseJob:false;checks:EvidenceCheck[]};
function check(id:string,pass:boolean,positive:string,negative:string):EvidenceCheck{
 return {id,state:pass?"OBSERVED":"BLOCKED",reason:pass?positive:negative};
}
export function summarizeDevRecoveryEvidence(commandId:string,source:{
 found:boolean;commandStatus?:string;responseSnapshotComplete?:boolean;
 checkpointAttested?:boolean;receiverAckVerified?:boolean;
 blockerEvidenceValid?:boolean;workerPresenceHealthy?:boolean;
 commandStatusReviewable?:boolean;checkpointResponseId?:string|null;
 blockingResponseId?:string|null;sourceTaskId?:string|null;
}):RecoverySummary{
 const notVerified=(id:string,reason:string):EvidenceCheck=>({id,state:"NOT_VERIFIED",reason});
 const checks:EvidenceCheck[]=[
  check("command_lineage",source.found&&source.commandStatusReviewable===true,
   "NONTERMINAL_COMMAND_OBSERVED","COMMAND_MISSING_OR_TERMINAL"),
  check("response_snapshot",source.found&&source.responseSnapshotComplete===true,
   "COMPLETE_RESPONSE_HISTORY_OBSERVED","INCOMPLETE_OR_UNAVAILABLE_RESPONSE_HISTORY"),
  check("native_checkpoint",source.found&&!!source.checkpointResponseId&&source.checkpointAttested===true,
   "CHECKPOINT_VERIFIER_REPORTED_VALID","CHECKPOINT_RECEIPT_UNVERIFIED"),
  check("native_receiver_ack",source.found&&source.receiverAckVerified===true,
   "RECEIVER_ACK_VERIFIER_REPORTED_VALID","NATIVE_ACK_UNVERIFIED"),
  check("latest_blocker",source.found&&!!source.blockingResponseId&&source.blockerEvidenceValid===true,
   "BLOCKER_EVIDENCE_VERIFIER_REPORTED_VALID","LATEST_BLOCKER_MISSING_OR_INVALID"),
  check("worker_presence",source.found&&source.workerPresenceHealthy===true,
   "WORKER_HEARTBEAT_HEALTHY","WORKER_HEARTBEAT_UNVERIFIED"),
  notVerified("job_intake","TASK_CENTER_JOB_OWNER_ASSIGNEE_AND_ATTEMPT_UNCORRELATED"),
  notVerified("operator_review","SIGNED_OPERATOR_APPROVAL_NOT_INDEPENDENTLY_VERIFIED"),
  notVerified("writer_attestation","TRUSTED_WRITER_AND_ATTESTOR_NOT_DEPLOYED"),
  notVerified("grant_and_lease","EXCLUSIVE_COMMAND_GRANT_AND_LEASE_NOT_DEPLOYED"),
  notVerified("worker_completion","NATIVE_FENCED_COMPLETION_NOT_VERIFIED"),
  notVerified("task_center_monitoring","EVENT_TIMELINE_CORRELATION_NOT_VERIFIED"),
  notVerified("rollback_and_privileges","LIVE_DEV_ROLLBACK_AND_PRIVILEGES_UNVERIFIED"),
 ];
 return {found:source.found,commandId,
  ...(source.found?{commandStatus:source.commandStatus}:{}),
  sourceTaskId:source.found&&typeof source.sourceTaskId==="string"&&
    source.sourceTaskId.length>0?source.sourceTaskId:null,
  sourceTaskIdVerifiedAsAiTaskJob:false,
  // The passive ledger reconciler registers bridge-command records using
  // this stable source ID; this value is a lookup key, NOT evidence of sync.
  expectedAiTaskLedgerExternalId:source.found?"bridge-command:"+commandId:null,
  aiTaskLedgerReadbackVerified:false,
  aiTaskLedgerReadbackReason:"INDEPENDENT_RECEIVER_READBACK_NOT_PERFORMED",
  aiTaskLedgerStatusAndProgressAuthoritative:false,
  releaseDecision:"NO_GO",snapshotAtomic:false,maySign:false,mayIssueGrant:false,
  mayDispatchWorker:false,mayCloseJob:false,checks};
}
/** Receiver ledger match is observational only, never a worker attestation,
 * complete lifecycle trace, or grant/dispatch authorization. */
export function attachDevAiTaskReadback(base:RecoverySummary,receiver:Awaited<ReturnType<typeof readDevAiTaskJob>>):RecoverySummary{
 const observed=base.found&&receiver.verified===true&&
   typeof receiver.receiverJobId==="string"&&receiver.receiverJobId.length>0;
 return {...base,
  aiTaskLedgerReadbackVerified:observed,
  aiTaskLedgerStatusAndProgressAuthoritative:false,
  aiTaskLedgerReadbackReason:observed?receiver.reason:
   receiver.verified?"RECEIVER_ID_MISSING":receiver.reason,
  ...(observed?{
   aiTaskLedgerReceiverJobId:receiver.receiverJobId,
   aiTaskLedgerReceiverStatus:receiver.receiverStatus,
   ...(receiver.receiverProgress!==undefined?{aiTaskLedgerReceiverProgress:receiver.receiverProgress}:{}),
   ...(receiver.receiverEventEvidence?{aiTaskLedgerReceiverEventEvidence:receiver.receiverEventEvidence}:{})
  }:{}),
  checks:[...base.checks,{
   id:"ai_task_ledger_identity",state:observed?"OBSERVED" as const:"NOT_VERIFIED" as const,
   reason:observed?"CORRELATED_DEV_RECEIVER_JOB_OBSERVED_NOT_E2E":
    receiver.verified?"RECEIVER_ID_MISSING":receiver.reason,
  }],
  // Ledger metadata does not prove operator approval, latest blocker,
  // native worker completion, owner/assignee or progress event history.
  releaseDecision:"NO_GO" as const,snapshotAtomic:false as const,
  maySign:false as const,mayIssueGrant:false as const,
  mayDispatchWorker:false as const,mayCloseJob:false as const};
}
export async function getDevCommandEvidenceSummary(commandId:string):Promise<RecoverySummary>{
 if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]==="production"){
  return summarizeDevRecoveryEvidence(commandId,{found:false});
 }
 const evidence=await getDevCommandRecoveryReview(commandId);
 const base=summarizeDevRecoveryEvidence(commandId,evidence);
 if(!base.found)return base;
 const receiver=await readDevAiTaskJob(commandId);
 return attachDevAiTaskReadback(base,receiver);
}
