import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preflightBindingClaim as pre} from './gpt02-binding-writer-preflight.mjs';
const commandId='c43000bf-c952-4e91-9344-02d9256f9768';
const coding='965604aa-9e6b-478b-8e33-cc52a8f0b8ca';
const job='e343ceee-98cb-4f28-9314-e96be590ea82';
const input={source:{commandId,taskId:coding,status:'PROCESSING',devOnly:true,
 capability:'chatgpt:wake',assignedWorker:'openclaw-dell-chatgpt-wake-dev',responses:[]},
 receiver:{source:'AI_CORE',receiverJobId:job,externalId:'bridge-command:'+commandId,
 passiveLedger:true,tenant:'default',timelineCommandId:commandId,workerId:'openclaw-dell-chatgpt-wake-dev',
 status:'processing',progress:34,readOnly:true,taskId:42,
 eventEvidence:{observedEventCount:0,sourceEventCount:0,signedEventCount:0,
 historyTruncated:false,progressProvesCompletion:false,nativeWorkerCompletionVerified:false,
 mayIssueGrant:false,mayDispatchWorker:false}},
 coreTask:{codingTaskId:coding,codingTaskExists:true,codingRunCount:1},
 hubTask:{aiTaskId:42,aiTaskExists:true,tenant:'default',assigneePresent:true},
 attemptId:'93f178a4-444e-48df-8a49-242f0bdf1b51',attemptNumber:1,
 hubExecutionJobId:job,
 actor:{sessionAuthenticated:true,adminVerified:true,userId:301,originVerified:true},
 proof:{sourceObservedAt:'2026-11-09T00:55:00.000Z',receiverObservedAt:'2026-11-09T00:55:00.000Z'}};
const now=Date.parse('2026-11-09T00:56:00.000Z');
test('plausible observations and a caller-claimed admin cannot authorize binding write',()=>{
 const r=pre(input,{now});
 assert.equal(r.checks.identityObserved,true);
 assert.equal(r.checks.attemptIdentityPlausible,true);
 assert.equal(r.checks.sourceAndReceiverFresh,true);
 assert.match(r.evidenceSha256,/^[0-9a-f]{64}$/);
 assert.equal(r.checks.authorizedWriterReady,false);
 assert.equal(r.checks.independentAttestationVerified,false);
 assert.equal(r.reason,'INDEPENDENT_WRITER_AND_ATTESTOR_NOT_DEPLOYED');
 for(const k of ['mayPersistBinding','mayAssign','maySign','mayIssueGrant','mayDispatchWorker','mayCloseJob'])assert.equal(r[k],false);
});
test('same evidence with reordered object keys has identical digest',()=>{
 const r=pre(input,{now});
 const swapped={...input,source:{responses:[],assignedWorker:input.source.assignedWorker,
 devOnly:true,status:'PROCESSING',taskId:coding,commandId,capability:'chatgpt:wake'}};
 assert.equal(pre(swapped,{now}).evidenceSha256,r.evidenceSha256);
});
test('expired or future snapshots rejected',()=>{
 for(const proof of [{...input.proof,receiverObservedAt:'2026-11-09T00:50:00.000Z'},
  {...input.proof,sourceObservedAt:'2026-11-09T00:57:00.000Z'}]){
  const r=pre({...input,proof},{now});assert.equal(r.checks.sourceAndReceiverFresh,false);
  assert.equal(r.evidenceSha256,null);assert.equal(r.releaseDecision,'NO_GO');
 }
});
test('missing tasks, mistaken namespace, wrong receiver and forged grants fail closed',()=>{
 for(const changed of [{coreTask:{...input.coreTask,codingTaskId:job}},
  {receiver:{...input.receiver,tenant:'other'}},
  {receiver:{...input.receiver,taskId:99}},
  {attemptId:commandId,source:{...input.source,commandId:'invalid'}},
  {actor:{...input.actor,adminVerified:false}},
  {receiver:{...input.receiver,eventEvidence:{...input.receiver.eventEvidence,nativeWorkerCompletionVerified:true}}}]){
  const r=pre({...input,...changed},{now});assert.equal(r.mayPersistBinding,false);
  assert.equal(r.mayDispatchWorker,false);assert.equal(r.releaseDecision,'NO_GO');
 }
});
