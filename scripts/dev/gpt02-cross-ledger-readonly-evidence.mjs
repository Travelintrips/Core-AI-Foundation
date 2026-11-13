#!/usr/bin/env node
/** Correlate independently obtained, sanitized DEV snapshots. No DB/network calls.
 * This function never grants GPT02 execution, even for agreeing completed rows.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER='openclaw-dell-chatgpt-wake-dev';
const normalize=s=>typeof s==='string'?s.trim().toUpperCase():null;
export function compareDevCommandAndPassiveLedger(source,receiver){
 const commandId=typeof source?.commandId==='string'&&UUID.test(source.commandId)?source.commandId:null;
 const receiverId=typeof receiver?.receiverJobId==='string'&&UUID.test(receiver.receiverJobId)?receiver.receiverJobId:null;
 const identity=Boolean(commandId&&receiverId&&source?.devOnly===true&&
  source?.capability==='chatgpt:wake'&&source?.assignedWorker===WORKER&&
  receiver?.source==='AI_CORE'&&receiver?.passiveLedger===true&&
  receiver?.tenant==='default'&&receiver?.externalId==='bridge-command:'+commandId&&
  receiver?.timelineCommandId===commandId&&receiver?.workerId===WORKER&&
  receiver?.readOnly===true);
 const statusMatch=Boolean(identity&&normalize(source?.status)&&
  normalize(source.status)===normalize(receiver?.status));
 const missingTaskIds=source?.taskId==null&&receiver?.taskId==null;
 // AI Core task_id and AI Task Center task_id refer to distinct tables.
 // Equal numeric/string values are NOT proof of the same task, owner or attempt.
 const taskIdValueMatches=Boolean(identity&&source?.taskId!=null&&receiver?.taskId!=null&&
   String(source.taskId)===String(receiver.taskId));
 const taskIdCorrelated=false;
 const responseRows=Array.isArray(source?.responses)?source.responses:[];
 const events=receiver?.eventEvidence;
 const evidenceShape=Boolean(events&&typeof events==='object'&&
  Number.isSafeInteger(events.observedEventCount)&&events.observedEventCount>=0&&events.observedEventCount<=100&&
  Number.isSafeInteger(events.sourceEventCount)&&events.sourceEventCount>=0&&events.sourceEventCount<=events.observedEventCount&&
  Number.isSafeInteger(events.signedEventCount)&&events.signedEventCount>=0&&events.signedEventCount<=events.observedEventCount&&
  events.historyTruncated===false&&events.progressProvesCompletion===false&&
  events.nativeWorkerCompletionVerified===false&&events.mayIssueGrant===false&&events.mayDispatchWorker===false);
 const sourceFailed=responseRows.some(x=>x?.kind==='FAILED');
 const receiverFailed=events?.lastObservedSourceStatus==='FAILED';
 const failureHistoryAgrees=Boolean(identity&&statusMatch&&normalize(source.status)==='FAILED'&&
  sourceFailed&&receiverFailed&&evidenceShape);
 const nativeCheckpointObserved=responseRows.some(x=>x?.kind==='CHECKPOINT');
 const nativeAcknowledgedCount=responseRows.filter(x=>x?.acknowledgedAt!=null).length;
 const finalAckVerified=receiver?.finalAckVerified===true;
 return {
  commandId,receiverJobId:receiverId,
  checks:[
   {id:'identity',state:identity?'OBSERVED':'NOT_VERIFIED'},
   {id:'status',state:statusMatch?'OBSERVED':'NOT_VERIFIED'},
   {id:'failure_event_correlation',state:failureHistoryAgrees?'OBSERVED':'NOT_VERIFIED'},
   {id:'task_owner_assignee',state:'NOT_VERIFIED'},
   {id:'native_checkpoint',state:nativeCheckpointObserved?'PRESENT_UNVERIFIED':'NOT_VERIFIED'},
   {id:'native_ack',state:nativeAcknowledgedCount>0?'PRESENT_UNVERIFIED':'NOT_VERIFIED'},
   {id:'native_completion',state:'NOT_VERIFIED'},
   {id:'authorization_and_fenced_lease',state:'NOT_VERIFIED'},
  ],
  sourceTerminalFailed:normalize(source?.status)==='FAILED',
  receiverReportedProgress:typeof receiver?.progress==='number'&&Number.isFinite(receiver.progress)?receiver.progress:null,
  failureHistoryAgrees,taskIdCorrelated,taskIdValueMatches,
  taskNamespaceVerified:false,taskIdsBothMissing:missingTaskIds,
  receiverEventEvidenceBounded:evidenceShape,
  nativeAcknowledgedCount,nativeCheckpointObserved,receiverFinalAckFlag:finalAckVerified,
  identityVerified:identity,statusVerified:statusMatch,
  progressProvesCompletion:false,workerCompletionVerified:false,
  ownerAndAssigneeVerified:false,snapshotAtomic:false,
  maySign:false,mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false,
  releaseDecision:'NO_GO',
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let input='';
 for await(const chunk of process.stdin){input+=chunk;if(input.length>32768){process.stderr.write('INPUT_TOO_LARGE\n');process.exit(2)}}
 try{const parsed=JSON.parse(input);const result=compareDevCommandAndPassiveLedger(parsed.source,parsed.receiver);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.identityVerified||!result.statusVerified)process.exitCode=3;
 }catch{process.stderr.write('INVALID_SNAPSHOT\n');process.exitCode=2}
}
