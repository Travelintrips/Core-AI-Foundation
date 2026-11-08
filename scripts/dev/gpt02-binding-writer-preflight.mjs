/** DEV-only offline prototype: never persists, grants, signs, or dispatches.
 * Caller assertions and untrusted event progress never certify source ownership.
 */
import {createHash} from 'node:crypto';
import {compareDevCommandAndPassiveLedger} from './gpt02-cross-ledger-readonly-evidence.mjs';
import {assessGpt02TaskLineage} from './gpt02-task-lineage-ownership.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=x=>typeof x==='string'&&UUID.test(x);
const validTime=(x,now)=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&
 Date.parse(x)<=now+5000&&Date.parse(x)>=now-120000;
function stable(v){
 if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
 if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
 return JSON.stringify(v);
}
export function preflightBindingClaim(input,{now=Date.now()}={}){
 const src=input?.source,recv=input?.receiver,actor=input?.actor,proof=input?.proof;
 const observed=compareDevCommandAndPassiveLedger(src,recv);
 const lineage=assessGpt02TaskLineage(input?.coreTask,input?.hubTask);
 const actorPresent=actor?.sessionAuthenticated===true&&actor?.adminVerified===true&&
  Number.isSafeInteger(actor?.userId)&&actor.userId>0&&actor?.originVerified===true;
 const identityPresent=ID(input?.attemptId)&&Number.isSafeInteger(input?.attemptNumber)&&input.attemptNumber>0&&
  ID(input?.coreTask?.codingTaskId)&&ID(src?.taskId)&&
  input.coreTask.codingTaskId===src.taskId&&
  Number.isSafeInteger(input?.hubTask?.aiTaskId)&&input.hubTask.aiTaskId>0&&
  input.hubTask.aiTaskId===recv?.taskId&&
  recv?.receiverJobId===input?.hubExecutionJobId;
 const fresh=validTime(proof?.sourceObservedAt,now)&&validTime(proof?.receiverObservedAt,now);
 const digest=observed.identityVerified&&observed.statusVerified&&observed.receiverEventEvidenceBounded&&
  fresh?createHash('sha256').update(stable({source:src,receiver:recv,
   sourceObservedAt:proof.sourceObservedAt,receiverObservedAt:proof.receiverObservedAt})).digest('hex'):null;
 // No independent signature, role verifier, trusted clock, DB transaction or
 // provenance attestor is deployed. A caller cannot assert these into existence.
 const independentAttestationVerified=false;
 const authorizedWriterReady=false;
 const checks={identityObserved:observed.identityVerified,statusAgrees:observed.statusVerified,
  sourceTaskObserved:lineage.sourceTaskObserved,hubTaskObserved:lineage.receiverTaskObserved,
  actorSessionClaimPresent:actorPresent,attemptIdentityPlausible:identityPresent,
  sourceAndReceiverFresh:fresh,digestComputable:!!digest,
  independentAttestationVerified,authorizedWriterReady};
 return {checks,evidenceSha256:digest,
  previewOnly:true,mayPersistBinding:false,mayAssign:false,maySign:false,
  mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false,
  releaseDecision:'NO_GO',reason:!identityPresent?'MISSING_TASK_OR_ATTEMPT_LINEAGE':
   !fresh?'STALE_OR_MALFORMED_SOURCE_SNAPSHOT':
   !actorPresent?'UNVERIFIED_OPERATOR_SESSION':
   !observed.identityVerified?'COMMAND_RECEIVER_MISMATCH':
   'INDEPENDENT_WRITER_AND_ATTESTOR_NOT_DEPLOYED'};
}
