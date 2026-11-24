import {createGateCore,TARGET} from './task190-gate-core.mjs';
import {strict as assert} from 'node:assert';
const now=1795600000000;
const owner={ownerSubject:'owner:google_testowner01',companyId:'default'};
const validAuthority={verified:true,environment:'DEV',taskId:190,executionId:TARGET.executionId,attemptId:TARGET.attemptId,ownerSubject:owner.ownerSubject,expiresAt:now+30000,dispatchPermitted:false,reference:'test-auth-1'};
let count=0;
const receipt={verified:true,durableCommitVerified:true,authorityRef:'test-auth-1',receiptId:'d0b448c5-bb38-4c78-bbb7-00729af61c94',targetExecutionId:TARGET.executionId,targetAttemptId:TARGET.attemptId,ownerSubject:owner.ownerSubject};
const gate=createGateCore({verifyOwner:async()=>owner,verifyIndependentAuthority:async()=>validAuthority,consumeVerifiedDecision:async({challengeId})=>{count++;return {...receipt,consumedChallengeId:challengeId};},clock:()=>now});
const token='Bearer '+'x'.repeat(80);
const run=(action,payload=TARGET,auth=token)=>gate.run(action,payload,auth);
const tests=[];
async function test(name,fn){try{await fn();tests.push(true);console.log(name+'=PASS')}catch(e){tests.push(false);console.log(name+'=FAIL:'+e.message)}}
await test('NO_OWNER_DENY',async()=>assert.equal((await run('status',TARGET,'' )).blocker,'OWNER_AUTH_REQUIRED'));
await test('INJECTED_SCOPE_FIELD_DENY',async()=>assert.equal((await run('status',{...TARGET,extraAuthorization:true})).blocker,'TARGET_NOT_VERIFIED'));
await test('WRONG_TARGET_DENY',async()=>assert.equal((await run('status',{...TARGET,taskId:191})).blocker,'TARGET_NOT_VERIFIED'));
const bad=createGateCore({verifyOwner:async()=>owner,verifyIndependentAuthority:async()=>({...validAuthority,expiresAt:now-1}),consumeVerifiedDecision:async()=>receipt,clock:()=>now});
await test('EXPIRED_AUTHORITY_DENY',async()=>assert.equal((await bad.run('status',TARGET,token)).blocker,'INDEPENDENT_AUTHORITY_UNVERIFIED'));
await test('MISSING_ISSUER_DENY',async()=>assert.throws(()=>createGateCore({verifyOwner:async()=>owner}),/ADAPTER_REQUIRED/));
let challenge;
await test('READY_WITH_INDEPENDENT_PROOF',async()=>{const r=await run('status');assert.equal(r.state,'ready');challenge=r.challengeId});
await test('WRONG_CHALLENGE_DENY',async()=>{const r=await run('submit',{...TARGET,challengeId:'11111111-1111-4111-8111-111111111111'});assert.equal(r.blocker,'CHALLENGE_MISMATCH');assert.equal(count,0)});
await test('VERIFIED_ONCE',async()=>{const r=await run('submit',{...TARGET,challengeId:challenge});assert.equal(r.state,'accepted');assert.equal(count,1)});
await test('REPLAY_READBACK',async()=>{const r=await run('submit',{...TARGET,challengeId:challenge});assert.equal(r.state,'accepted');assert.equal(count,1)});
console.log('RESULT='+tests.filter(Boolean).length+'/'+tests.length+' PASS');
if(tests.some(x=>!x))process.exitCode=1;

// A real race: verification/receipt consumption has asynchronous I/O.
// Two simultaneous submits must not cross the local one-shot boundary.
await test('PARALLEL_SUBMITS_SINGLE_FLIGHT',async()=>{
  const concurrentOwner={ownerSubject:'owner:google_concurrent01',companyId:'default'};
  const now2=1795600000000;
  const auth2={...validAuthority,ownerSubject:concurrentOwner.ownerSubject,reference:'different-independent-reference'};
  const receipt2={...receipt,ownerSubject:concurrentOwner.ownerSubject,authorityRef:auth2.reference};
  let calls=0;
  const subject=createGateCore({verifyOwner:async()=>concurrentOwner,
    verifyIndependentAuthority:async()=>auth2,
    consumeVerifiedDecision:async({challengeId})=>{calls++;await new Promise(resolve=>setTimeout(resolve,30));return {...receipt2,consumedChallengeId:challengeId};},
    clock:()=>now2});
  const token2='Bearer '+'x'.repeat(80);
  const ready=await subject.run('status',TARGET,token2);
  const attempts=await Promise.all([
    subject.run('submit',{...TARGET,challengeId:ready.challengeId},token2),
    subject.run('submit',{...TARGET,challengeId:ready.challengeId},token2),
  ]);
  assert.equal(calls,1,'A local gate must issue at most one custodian consume call');
  assert.equal(attempts.filter(x=>x.state==='accepted').length,1);
  assert.equal(attempts.filter(x=>x.blocker==='CONCURRENT_CONSUMPTION_IN_PROGRESS').length,1);
});

await test('NO_DURABLE_COMMIT_DENY',async()=>{
  const candidate=createGateCore({verifyOwner:async()=>owner,verifyIndependentAuthority:async()=>validAuthority,
    consumeVerifiedDecision:async({challengeId})=>({...receipt,consumedChallengeId:challengeId,durableCommitVerified:false}),clock:()=>now});
  const ready=await candidate.run('status',TARGET,token);
  const outcome=await candidate.run('submit',{...TARGET,challengeId:ready.challengeId},token);
  assert.equal(outcome.blocker,'VERIFIED_RECEIPT_MISSING');
});
await test('WRONG_AUTHORITY_OR_CHALLENGE_RECEIPT_DENY',async()=>{
  for(const variant of [
    {authorityRef:'wrong-independent-issuer'},
    {consumedChallengeId:'11111111-1111-4111-8111-111111111111'},
  ]){
    const candidate=createGateCore({verifyOwner:async()=>owner,verifyIndependentAuthority:async()=>validAuthority,
      consumeVerifiedDecision:async({challengeId})=>({...receipt,consumedChallengeId:challengeId,...variant}),clock:()=>now});
    const ready=await candidate.run('status',TARGET,token);
    const outcome=await candidate.run('submit',{...TARGET,challengeId:ready.challengeId},token);
    assert.equal(outcome.blocker,'VERIFIED_RECEIPT_MISSING');
  }
});
