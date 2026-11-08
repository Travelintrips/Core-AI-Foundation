import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareDevCommandAndPassiveLedger as compare} from './gpt02-cross-ledger-readonly-evidence.mjs';
const id='c43000bf-c952-4e91-9344-02d9256f9768';
const source={commandId:id,status:'FAILED',devOnly:true,capability:'chatgpt:wake',assignedWorker:'openclaw-dell-chatgpt-wake-dev',taskId:null,responses:[{kind:'ACK',acknowledgedAt:null},{kind:'FAILED',acknowledgedAt:null}]};
const eventEvidence={observedEventCount:2,sourceEventCount:1,signedEventCount:0,historyTruncated:false,lastObservedSourceStatus:'FAILED',progressProvesCompletion:false,nativeWorkerCompletionVerified:false,mayIssueGrant:false,mayDispatchWorker:false};
const receiver={receiverJobId:'e343ceee-98cb-4f28-9314-e96be590ea82',source:'AI_CORE',passiveLedger:true,tenant:'default',externalId:'bridge-command:'+id,timelineCommandId:id,workerId:'openclaw-dell-chatgpt-wake-dev',status:'failed',progress:100,readOnly:true,finalAckVerified:false,taskId:null,eventEvidence};
test('observed failed command correlation does not authorize any lifecycle activity',()=>{
 const r=compare(source,receiver);
 assert.equal(r.identityVerified,true);assert.equal(r.statusVerified,true);assert.equal(r.failureHistoryAgrees,true);
 assert.equal(r.taskIdsBothMissing,true);assert.equal(r.nativeCheckpointObserved,false);
 assert.equal(r.nativeAcknowledgedCount,0);
 for(const field of ['progressProvesCompletion','workerCompletionVerified','ownerAndAssigneeVerified','maySign','mayIssueGrant','mayDispatchWorker','mayCloseJob','snapshotAtomic'])assert.equal(r[field],false);
 assert.equal(r.releaseDecision,'NO_GO');
});
test('wrong ID, tenant, worker or assignment never matches identity',()=>{
 for(const patch of [{tenant:'other'},{workerId:'other'},{externalId:'bridge-command:wrong'},{passiveLedger:false},{readOnly:false}]){
  const r=compare(source,{...receiver,...patch});assert.equal(r.identityVerified,false);assert.equal(r.releaseDecision,'NO_GO');
 }
});
test('100 percent completed self-report cannot prove native completion or owner',()=>{
 const r=compare({...source,status:'COMPLETED',taskId:42}, {...receiver,status:'completed',taskId:42,progress:100,finalAckVerified:true,eventEvidence:{...eventEvidence,lastObservedSourceStatus:'COMPLETED'}});
 assert.equal(r.identityVerified,true);assert.equal(r.taskIdValueMatches,true);
 assert.equal(r.taskIdCorrelated,false);assert.equal(r.taskNamespaceVerified,false);
 assert.equal(r.checks.find(x=>x.id==='task_owner_assignee')?.state,'NOT_VERIFIED');
 assert.equal(r.ownerAndAssigneeVerified,false);assert.equal(r.workerCompletionVerified,false);
 assert.equal(r.mayDispatchWorker,false);assert.equal(r.releaseDecision,'NO_GO');
});
test('truncated or suspect receiver event history is not independently correlated',()=>{
 for(const patch of [{historyTruncated:true},{nativeWorkerCompletionVerified:true},{signedEventCount:101},{observedEventCount:101}]){
  const r=compare(source,{...receiver,eventEvidence:{...eventEvidence,...patch}});
  assert.equal(r.failureHistoryAgrees,false);assert.equal(r.workerCompletionVerified,false);
 }
});

test('different task namespaces never become verified from coincident IDs',()=>{
 const r=compare({...source,taskId:'42'},{...receiver,taskId:42});
 assert.equal(r.taskIdValueMatches,true);
 assert.equal(r.taskIdCorrelated,false);
 assert.equal(r.ownerAndAssigneeVerified,false);
 assert.equal(r.releaseDecision,'NO_GO');
});
