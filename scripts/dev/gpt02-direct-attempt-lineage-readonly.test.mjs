import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDirectGpt02AttemptLineage} from './gpt02-direct-attempt-lineage-readonly.mjs';
const commandId='83db99f5-cbda-4e60-be71-3090fb411bbb';
const executionId='4eb75fa9-f9e4-4573-8e00-d3084b4c2c8a';
const fixture=()=>({
 taskId:135,commandId,
 core:{command:{id:commandId,task_id:null,status:'FAILED'},binding_table_present:false,nonce_table_present:false},
 hub:{execution:{id:executionId,task_id:135,company_id:'default',source:'AI_TASK',status:'failed',
 command_id:commandId,assigned_to_id:null,attestation_verified:false,final_ack_verified:false},
 binding_table_present:false,nonce_table_present:false},
});
test('direct execution reference found but not promoted to native proof',()=>{
 const r=assessDirectGpt02AttemptLineage(fixture());
 assert.equal(r.sourceObserved,true);
 assert.equal(r.receiverObserved,true);
 assert.equal(r.directCommandReferenceMatched,true);
 assert.equal(r.referenceObservedNotAttested,true);
 assert.equal(r.executionId,executionId);
 assert.deepEqual([r.mayPersistBinding,r.mayIssueGrant,r.mayDispatchWorker,r.mayResume,r.mayCloseJob],[false,false,false,false,false]);
 for(const x of ['CORE_TASK_ID_MISSING','ACCOUNTABLE_OWNER_ID_MISSING',
 'NATIVE_BINDING_SCHEMA_MISSING','NATIVE_ATTESTATION_UNVERIFIED','NATIVE_FINAL_ACK_UNVERIFIED',
 'TERMINAL_FAILURE','INDEPENDENT_NATIVE_PROVENANCE_NOT_ATTESTED'])assert.ok(r.checks.includes(x),x);
});
test('fabricated callback/ack booleans never grant execution',()=>{
 const f=fixture();
 f.core.command.task_id='169a7492-cfd8-4a56-bb57-18001b6b5968';
 f.core.command.status='COMPLETED';
 f.hub.execution.status='completed';
 f.hub.execution.assigned_to_id=7;
 f.hub.execution.attestation_verified=true;
 f.hub.execution.final_ack_verified=true;
 f.core.binding_table_present=f.core.nonce_table_present=true;
 f.hub.binding_table_present=f.hub.nonce_table_present=true;
 const r=assessDirectGpt02AttemptLineage(f);
 assert.equal(r.directCommandReferenceMatched,true);
 assert.equal(r.releaseDecision,'NO_GO');
 assert.equal(r.mayDispatchWorker,false);
 assert.ok(r.checks.includes('INDEPENDENT_NATIVE_PROVENANCE_NOT_ATTESTED'));
});
test('mismatched command ID or company cannot be interpreted as matching attempt',()=>{
 for(const mutate of [
 f=>{f.hub.execution.command_id='169a7492-cfd8-4a56-bb57-18001b6b5968'},
 f=>{f.hub.execution.company_id='other'},
 f=>{f.hub.execution.source='AI_CORE'},
 f=>{f.hub.execution.task_id=999},
 f=>{f.core.command.id='169a7492-cfd8-4a56-bb57-18001b6b5968'},
 ]){
  const f=fixture();mutate(f);
  const r=assessDirectGpt02AttemptLineage(f);
  assert.equal(r.directCommandReferenceMatched,false);
  assert.equal(r.mayPersistBinding,false);
 }
});
test('missing evidence cannot accidentally clear NO-GO',()=>{
 const r=assessDirectGpt02AttemptLineage({taskId:135,commandId,core:{},hub:{}});
 assert.equal(r.directCommandReferenceMatched,false);
 assert.equal(r.releaseDecision,'NO_GO');
 assert.ok(r.checks.includes('DIRECT_EXECUTION_NOT_OBSERVED'));
});
