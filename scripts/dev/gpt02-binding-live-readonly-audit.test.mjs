import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditLiveBindingPrerequisites as audit} from './gpt02-binding-live-readonly-audit.mjs';
const commandId='c43000bf-c952-4e91-9344-02d9256f9768';
const fixture={source:{system:'AI_CORE_DEV',command:{id:commandId,task_id:null,status:'FAILED'},proposedTables:{binding:null,nonce:null}},
 receiver:{system:'AI_TASK_DEV',receiver:{external_id:'bridge-command:'+commandId,task_id:null,status:'failed',progress:100},proposedTables:{binding:null,nonce:null}}};
test('realistic failed terminal command with 100% progress is never completed or owner-verified',()=>{
 const r=audit(fixture,commandId);assert.equal(r.sameIdentity,true);
 assert.equal(r.terminalFailed,true);assert.equal(r.taskLinkMissing,true);
 assert.equal(r.receiverReportedProgress,100);assert.equal(r.reportedProgressProvesCompletion,false);
 assert.equal(r.nativeCompletionVerified,false);assert.equal(r.accountableOwnerVerified,false);
 assert.equal(r.sourceBindingAbsent,true);assert.equal(r.receiverBindingAbsent,true);
 assert.equal(r.releaseDecision,'NO_GO');
});
test('cross-system ID mismatch fails closed without asserting linkage',()=>{
 for(const changed of [{source:{...fixture.source,command:{...fixture.source.command,id:'96a69d6b-c70b-43a8-830a-3c92e902978d'}}},
 {receiver:{...fixture.receiver,receiver:{...fixture.receiver.receiver,external_id:'bridge-command:other'}}},
 {source:{...fixture.source,system:'AI_TASK_DEV'}},
 {receiver:{...fixture.receiver,receiver:null}}]){
  const r=audit({...fixture,...changed},commandId);
  assert.equal(r.sameIdentity,false);assert.equal(r.releaseDecision,'NO_GO');
 }
});
test('even claimed task IDs or success status do not imply cross-db assignment or verified completion',()=>{
 const changed={source:{...fixture.source,command:{...fixture.source.command,task_id:commandId,status:'COMPLETED'}},
 receiver:{...fixture.receiver,receiver:{...fixture.receiver.receiver,task_id:42,status:'completed',progress:100}}};
 const r=audit(changed,commandId);assert.equal(r.sourceHubBindingVerified,false);
 assert.equal(r.accountableOwnerVerified,false);assert.equal(r.nativeCompletionVerified,false);
 assert.equal(r.mayDispatchWorker,false);assert.equal(r.releaseDecision,'NO_GO');
});
