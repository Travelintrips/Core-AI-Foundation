import test from 'node:test';
import assert from 'node:assert/strict';
import { DevContinuityRuntime } from './continuity-runtime.mjs';
import { RecoveryInbox } from './recovery-inbox.mjs';
const baseline={environment:'DEV',jobId:'j',correlationId:'c',acceptanceContract:'DEV_FULL_CONTINUITY_V1',criteria:[{id:'a',pass:true,evidenceId:'trusted-1',verifier:'trusted'}],callbackVerified:true,leaseFinalized:true};
test('runtime rejects premature completion if required evidence missing',()=>{
 const inbox=new RecoveryInbox(':memory:');
 try {
  const runtime=new DevContinuityRuntime({registry:{},dispatcher:{},checkpoints:{},inbox,sopSender:{}});
  const actual=runtime.terminal(baseline,{environment:'DEV',jobId:'j',eventId:'e',status:'COMPLETED'});
  assert.equal(actual.accepted,false);
  assert.equal(actual.status,'RUNNING');
  assert.equal(actual.reason,'evidence_incomplete');
  assert.equal(inbox.pending().length,0);
 } finally { inbox.close(); }
});
test('existing job type maintains existing gate behavior',()=>{
 const inbox=new RecoveryInbox(':memory:');
 try {
  const runtime=new DevContinuityRuntime({registry:{},dispatcher:{},checkpoints:{},inbox,sopSender:{}});
  const actual=runtime.terminal({...baseline,acceptanceContract:undefined},{environment:'DEV',jobId:'j',eventId:'e',status:'COMPLETED'});
  assert.equal(actual.accepted,true);
 } finally { inbox.close(); }
});
