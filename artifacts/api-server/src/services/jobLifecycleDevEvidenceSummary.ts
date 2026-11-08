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
  releaseDecision:"NO_GO",snapshotAtomic:false,maySign:false,mayIssueGrant:false,
  mayDispatchWorker:false,mayCloseJob:false,checks};
}
export async function getDevCommandEvidenceSummary(commandId:string):Promise<RecoverySummary>{
 if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]==="production"){
  return summarizeDevRecoveryEvidence(commandId,{found:false});
 }
 const evidence=await getDevCommandRecoveryReview(commandId);
 const base=summarizeDevRecoveryEvidence(commandId,evidence);
 if(!base.found)return base;
 const receiver=await readDevAiTaskJob(commandId);
 return {...base,aiTaskLedgerReadbackVerified:receiver.verified,
  aiTaskLedgerReadbackReason:receiver.reason,
  ...(receiver.verified?{
    aiTaskLedgerReceiverJobId:receiver.receiverJobId,
    aiTaskLedgerReceiverStatus:receiver.receiverStatus,
    ...(receiver.receiverProgress!==undefined?{aiTaskLedgerReceiverProgress:receiver.receiverProgress}:{})
  }:{}),
  // A matched receiver ID is not a native ACK, approval, attempt lineage,
  // terminal E2E verification, nor an authorization for anything.
  releaseDecision:"NO_GO" as const,maySign:false as const,
  mayIssueGrant:false as const,mayDispatchWorker:false as const,mayCloseJob:false as const};
}
