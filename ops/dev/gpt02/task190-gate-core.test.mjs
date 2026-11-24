import {createGateCore,TARGET} from './task190-gate-core.mjs';
import assert from 'node:assert/strict';

const NOW=1795600000000;
const token='Bearer '+'x'.repeat(80);
const owner={ownerSubject:'owner:google_testowner01',companyId:'default'};
const authority={verified:true,environment:'DEV',taskId:190,executionId:TARGET.executionId,
  attemptId:TARGET.attemptId,ownerSubject:owner.ownerSubject,reference:'independent-issuer-proof',
  expiresAt:NOW+30000,dispatchPermitted:false};
const baseReceipt={verified:true,durableCommitVerified:true,
  receiptId:'d0b448c5-bb38-4c78-bbb7-00729af61c94',
  targetExecutionId:TARGET.executionId,targetAttemptId:TARGET.attemptId,
  ownerSubject:owner.ownerSubject,authorityRef:authority.reference,expiresAt:NOW+30000};
const tests=[];
async function test(name,fn){try{await fn();tests.push(true);console.log(name+'=PASS')}catch(e){tests.push(false);console.log(name+'=FAIL:'+e.message)}}
const make=(overrides={})=>{
  const state={record:null,calls:0};
  const create=()=>createGateCore({
    verifyOwner:async()=>owner,
    verifyIndependentAuthority:async()=>authority,
    consumeVerifiedDecision:async({challengeId})=>{
      state.calls++;
      const receipt={...baseReceipt,consumedChallengeId:challengeId};
      state.record=receipt;
      return receipt;
    },
    readVerifiedReceipt:async()=>state.record,
    clock:()=>NOW,...overrides,
  });
  return {state,create};
};
const call=(gate,action,payload=TARGET,auth=token)=>gate.run(action,payload,auth);

await test('MISSING_INDEPENDENT_READBACK_ADAPTER_DENY',async()=>{
  assert.throws(()=>createGateCore({verifyOwner:async()=>owner,
    verifyIndependentAuthority:async()=>authority,consumeVerifiedDecision:async()=>baseReceipt}),
  /INDEPENDENT_AUTHORITY_ADAPTER_REQUIRED/);
});
await test('NO_OWNER_DENY',async()=>{
  const {create}=make();assert.equal((await call(create(),'status',TARGET,'')).blocker,'OWNER_AUTH_REQUIRED');
});
await test('INJECTED_SCOPE_DENY',async()=>{
  const {create}=make();assert.equal((await call(create(),'status',{...TARGET,superuser:true})).blocker,'TARGET_NOT_VERIFIED');
});
await test('WRONG_TARGET_DENY',async()=>{
  const {create}=make();assert.equal((await call(create(),'status',{...TARGET,taskId:191})).blocker,'TARGET_NOT_VERIFIED');
});
await test('EXPIRED_AUTHORITY_DENY',async()=>{
  const {create}=make({verifyIndependentAuthority:async()=>({...authority,expiresAt:NOW-1})});
  assert.equal((await call(create(),'status')).blocker,'INDEPENDENT_AUTHORITY_UNVERIFIED');
});
await test('SUCCESS_REQUIRES_DURABLE_READBACK',async()=>{
  const {state,create}=make();const gate=create();
  const ready=await call(gate,'status');assert.equal(ready.state,'ready');
  const accepted=await call(gate,'submit',{...TARGET,challengeId:ready.challengeId});
  assert.equal(accepted.state,'accepted');assert.equal(state.calls,1);
  assert.equal((await call(gate,'status')).receiptId,accepted.receiptId);
});
await test('RESTART_READBACK_NO_SECOND_CONSUME',async()=>{
  const {state,create}=make();const first=create();
  const ready=await call(first,'status');
  assert.equal((await call(first,'submit',{...TARGET,challengeId:ready.challengeId})).state,'accepted');
  const restarted=create();
  const replay=await call(restarted,'status');
  assert.equal(replay.state,'accepted');assert.equal(state.calls,1);
});
await test('MISSING_DURABLE_RECORD_AFTER_WRITE_DENY',async()=>{
  let calls=0;
  const {create}=make({consumeVerifiedDecision:async({challengeId})=>{
    calls++;return {...baseReceipt,consumedChallengeId:challengeId};
  },readVerifiedReceipt:async()=>null});
  const gate=create();const ready=await call(gate,'status');
  assert.equal((await call(gate,'submit',{...TARGET,challengeId:ready.challengeId})).blocker,'DURABLE_READBACK_NOT_VERIFIED');
  assert.equal(calls,1);
});
await test('REPLAY_WITH_UNAVAILABLE_CUSTODIAN_FAILS_CLOSED',async()=>{
  const {state,create}=make();const gate=create();const ready=await call(gate,'status');
  assert.equal((await call(gate,'submit',{...TARGET,challengeId:ready.challengeId})).state,'accepted');
  state.record=null;
  // Never return "accepted" just because this same process once saw it.
  assert.notEqual((await call(gate,'status')).state,'accepted');
});
await test('READBACK_EXPIRED_OR_WRONG_OWNER_DENY',async()=>{
  for(const variant of [{expiresAt:NOW-1},{ownerSubject:'owner:google_notowner01'},
    {targetAttemptId:'11111111-1111-4111-8111-111111111111'},{durableCommitVerified:false}]){
    const {create}=make({readVerifiedReceipt:async()=>({...baseReceipt,
      consumedChallengeId:'d0b448c5-bb38-4c78-bbb7-00729af61c94',...variant})});
    assert.notEqual((await call(create(),'status')).state,'accepted');
  }
});
await test('WRONG_AUTHORITY_OR_CHALLENGE_COMMIT_DENY',async()=>{
  for(const variant of [{authorityRef:'wrong-ref'},
    {consumedChallengeId:'11111111-1111-4111-8111-111111111111'}]){
    const {create}=make({consumeVerifiedDecision:async({challengeId})=>
      ({...baseReceipt,consumedChallengeId:challengeId,...variant}),
      readVerifiedReceipt:async()=>null});
    const gate=create();const ready=await call(gate,'status');
    assert.equal((await call(gate,'submit',{...TARGET,challengeId:ready.challengeId})).blocker,
      variant.authorityRef?'VERIFIED_RECEIPT_MISSING':'VERIFIED_RECEIPT_MISSING');
  }
});
await test('PARALLEL_SUBMIT_SINGLE_FLIGHT',async()=>{
  let calls=0,stored=null;
  const {create}=make({
    consumeVerifiedDecision:async({challengeId})=>{
      calls++;
      await new Promise(resolve=>setTimeout(resolve,35));
      stored={...baseReceipt,consumedChallengeId:challengeId};return stored;
    },
    readVerifiedReceipt:async()=>stored,
  });
  const gate=create();const ready=await call(gate,'status');
  const attempts=await Promise.all([
    call(gate,'submit',{...TARGET,challengeId:ready.challengeId}),
    call(gate,'submit',{...TARGET,challengeId:ready.challengeId}),
  ]);
  assert.equal(calls,1);
  assert.equal(attempts.filter(x=>x.state==='accepted').length,1);
  assert.equal(attempts.filter(x=>x.blocker==='CONCURRENT_CONSUMPTION_IN_PROGRESS').length,1);
});
await test('SEPARATE_PROCESS_ADAPTER_MUST_ENFORCE_ATOMIC_CONSUME',async()=>{
  // The real external custodian must enforce cross-process atomic semantics.
  // Here a synthetic shared durable store is used, not a DB credential.
  let stored=null,calls=0;
  const shared={
    consumeVerifiedDecision:async({challengeId})=>{
      if(stored)return stored;
      calls++;
      stored={...baseReceipt,consumedChallengeId:challengeId};return stored;
    },
    readVerifiedReceipt:async()=>stored,
  };
  const a=make(shared).create(),b=make(shared).create();
  const ready=await call(a,'status');
  assert.equal((await call(a,'submit',{...TARGET,challengeId:ready.challengeId})).state,'accepted');
  assert.equal((await call(b,'status')).state,'accepted');
  assert.equal(calls,1);
});
console.log('RESULT='+tests.filter(Boolean).length+'/'+tests.length+' PASS');
if(tests.some(x=>!x))process.exitCode=1;
