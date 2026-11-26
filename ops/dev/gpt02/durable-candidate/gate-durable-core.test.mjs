import {createDurableGateCore} from './gate-durable-core.mjs';
import {createDurableStore} from './durable-store.mjs';
import {TARGET} from '../task190-gate-core.mjs';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {strict as assert} from 'node:assert';
const d=mkdtempSync(join(tmpdir(),'gpt02-gate-test-'));const db=join(d,'ledger.sqlite3');
const now=1795600000000,token='Bearer '+'x'.repeat(80),owner={ownerSubject:'owner:google_candidate01',companyId:'default'},uuid='d0b448c5-bb38-4c78-bbb7-00729af61c94';
const authority={verified:true,environment:'DEV',taskId:190,executionId:TARGET.executionId,attemptId:TARGET.attemptId,ownerSubject:owner.ownerSubject,expiresAt:now+30000,dispatchPermitted:false,reference:'proof-test-one'};
const receipt={verified:true,receiptId:uuid,targetExecutionId:TARGET.executionId,targetAttemptId:TARGET.attemptId,ownerSubject:owner.ownerSubject};
let consumes=0;
const store=createDurableStore({dbPath:db});
const mk=(extra={})=>createDurableGateCore({verifyOwner:async()=>owner,verifyIndependentAuthority:async()=>authority,consumeVerifiedDecision:async()=>{consumes++;return receipt},verifyCompletedReceipt:async()=>({verified:true,receiptId:uuid,ownerSubject:owner.ownerSubject,executionId:TARGET.executionId,attemptId:TARGET.attemptId,environment:'DEV',authorizationExpiresAt:now+30000}),store,clock:()=>now,...extra});
const tests=[];async function check(name,fn){try{await fn();console.log('PASS:'+name);tests.push(true)}catch(e){console.log('FAIL:'+name+':'+e.message);tests.push(false)}}
try{
 let g=mk();
 await check('NO_OWNER',async()=>assert.equal((await g.run('status',TARGET,'')).blocker,'OWNER_AUTH_REQUIRED'));
 await check('INVALID_TASK',async()=>assert.equal((await g.run('status',{...TARGET,taskId:191},token)).blocker,'INVALID_TARGET'));
 await check('NO_ISSUER_ADAPTER',async()=>assert.throws(()=>createDurableGateCore({verifyOwner:async()=>owner,store}),/EXTERNAL_ADAPTERS_REQUIRED/));
 let expired=mk({verifyIndependentAuthority:async()=>({...authority,expiresAt:now-1})});
 await check('EXPIRED_AUTHORITY',async()=>assert.equal((await expired.run('status',TARGET,token)).blocker,'INDEPENDENT_AUTHORITY_UNVERIFIED'));
 let ready=await g.run('status',TARGET,token);
 await check('READY_AND_PRIVATE_LEDGER',async()=>{assert.equal(ready.state,'ready');assert.equal(statSync(db).mode&0o077,0)});
 g=mk();
 await check('RESTART_RETURNS_SAME_CHALLENGE',async()=>assert.equal((await g.run('status',TARGET,token)).challengeId,ready.challengeId));
 await check('WRONG_CHALLENGE',async()=>assert.equal((await g.run('submit',{...TARGET,challengeId:'11111111-1111-4111-8111-111111111111'},token)).blocker,'CHALLENGE_MISMATCH'));
 await check('FIRST_ATOMIC_COMPLETION',async()=>assert.equal((await g.run('submit',{...TARGET,challengeId:ready.challengeId},token)).state,'accepted'));
 g=mk();
 await check('RESTART_READBACK_NO_RESUBMIT',async()=>{assert.equal((await g.run('submit',{...TARGET,challengeId:ready.challengeId},token)).state,'accepted');assert.equal(consumes,1)});
 const key=owner.ownerSubject+'|'+TARGET.attemptId+'-uncertain';
 // Another isolated DB for ambiguous-after-claim crash path.
 const db2=join(d,'ledger-uncertain.sqlite3'),s2=createDurableStore({dbPath:db2});
 let calls=0;let uncertain=createDurableGateCore({verifyOwner:async()=>owner,verifyIndependentAuthority:async()=>authority,consumeVerifiedDecision:async()=>{calls++;throw Error('ISSUER_TIMEOUT')},verifyCompletedReceipt:async()=>({verified:true}),store:s2,clock:()=>now});
 let c=await uncertain.run('status',TARGET,token);
 await check('ISSUER_ERROR_FAIL_CLOSED',async()=>assert.equal((await uncertain.run('submit',{...TARGET,challengeId:c.challengeId},token)).blocker,'INDEPENDENT_CONSUMPTION_UNCERTAIN'));
 uncertain=createDurableGateCore({verifyOwner:async()=>owner,verifyIndependentAuthority:async()=>authority,consumeVerifiedDecision:async()=>{calls++;return receipt},verifyCompletedReceipt:async()=>({verified:true}),store:s2,clock:()=>now});
 await check('UNCERTAIN_RESTART_DOES_NOT_REPLAY',async()=>{assert.equal((await uncertain.run('status',TARGET,token)).blocker,'AMBIGUOUS_ISSUER_ATTEMPT_REQUIRES_RECONCILIATION');assert.equal(calls,1)});
 console.log('RESULT='+tests.filter(Boolean).length+'/'+tests.length+' PASS');
 if(tests.some(x=>!x))process.exitCode=1;
}finally{rmSync(d,{recursive:true,force:true})}
// Concurrency regression uses distinct persistent DB and two overlapping gate callers.
{
 const cdir=mkdtempSync(join(tmpdir(),'gpt02-gate-concurrency-'));
 try{
  const durable=createDurableStore({dbPath:join(cdir,'ledger.sqlite3')});
  let externalCalls=0;
  const make=()=>createDurableGateCore({
   verifyOwner:async()=>owner,verifyIndependentAuthority:async()=>authority,store:durable,clock:()=>now,
   consumeVerifiedDecision:async()=>{externalCalls++;await new Promise(done=>setTimeout(done,50));return receipt},
   verifyCompletedReceipt:async()=>({verified:true,receiptId:uuid,ownerSubject:owner.ownerSubject,executionId:TARGET.executionId,attemptId:TARGET.attemptId,environment:'DEV',authorizationExpiresAt:now+30000})
  });
  const ga=make(),gb=make();
  const ready=await ga.run('status',TARGET,token);
  const submits=await Promise.all([
   ga.run('submit',{...TARGET,challengeId:ready.challengeId},token),
   gb.run('submit',{...TARGET,challengeId:ready.challengeId},token)
  ]);
  assert.equal(externalCalls,1,'concurrent duplicate issuer call');
  assert.equal(submits.filter(x=>x.state==='accepted').length,1);
  console.log('PASS:CONCURRENT_SINGLE_ISSUER_CALL');
 }finally{rmSync(cdir,{recursive:true,force:true})}
}
// Completed readback must never trust a local SQLite receipt without independent verification.
{
 const dir=mkdtempSync(join(tmpdir(),'gpt02-receipt-check-'));
 try {
  const st=createDurableStore({dbPath:join(dir,'ledger.sqlite3')});
  const mk=(verifier)=>createDurableGateCore({verifyOwner:async()=>owner,verifyIndependentAuthority:async()=>authority,
    consumeVerifiedDecision:async()=>receipt,verifyCompletedReceipt:verifier,store:st,clock:()=>now});
  const gate=mk(async()=>({verified:true}));
  const ready=await gate.run('status',TARGET,token);
  assert.equal((await gate.run('submit',{...TARGET,challengeId:ready.challengeId},token)).blocker,'COMPLETED_RECEIPT_NOT_VERIFIED');
  const renewed=mk(async()=>{throw Error('ISSUER_DOWN')});
  assert.equal((await renewed.run('status',TARGET,token)).blocker,'COMPLETED_RECEIPT_REVALIDATION_UNAVAILABLE');
  const invalid=mk(async()=>({verified:false}));
  assert.equal((await invalid.run('status',TARGET,token)).blocker,'COMPLETED_RECEIPT_NOT_VERIFIED');
  console.log('PASS:COMPLETED_RECEIPT_FAIL_CLOSED');
 }finally{rmSync(dir,{recursive:true,force:true})}
}
// Historical receipt with expired or absent issuer-proven expiry must not
// authorize a fresh execution even when the local ledger says COMPLETED.
{
 const dir=mkdtempSync(join(tmpdir(),'gpt02-expired-receipt-'));
 try {
  const storage=createDurableStore({dbPath:join(dir,'ledger.sqlite3')});
  const newGate=(proof)=>createDurableGateCore({verifyOwner:async()=>owner,verifyIndependentAuthority:async()=>authority,
   consumeVerifiedDecision:async()=>receipt,verifyCompletedReceipt:async()=>proof,store:storage,clock:()=>now});
  const receiptProof=(expiry)=>({verified:true,receiptId:uuid,ownerSubject:owner.ownerSubject,
   executionId:TARGET.executionId,attemptId:TARGET.attemptId,environment:'DEV',authorizationExpiresAt:expiry});
  const first=newGate(receiptProof(now+30000));
  const challenge=await first.run('status',TARGET,token);
  assert.equal((await first.run('submit',{...TARGET,challengeId:challenge.challengeId},token)).state,'accepted');
  assert.equal((await newGate(receiptProof(now-1)).run('status',TARGET,token)).blocker,'COMPLETED_RECEIPT_NOT_VERIFIED');
  assert.equal((await newGate(receiptProof(undefined)).run('status',TARGET,token)).blocker,'COMPLETED_RECEIPT_NOT_VERIFIED');
  assert.equal((await newGate(receiptProof(now+30000)).run('status',TARGET,token)).state,'accepted');
  console.log('PASS:EXPIRED_AND_MISSING_RECEIPT_EXPIRY_REJECTED');
 }finally{rmSync(dir,{recursive:true,force:true})}
}

// A first-time successful local commit must be independently reverified before
// returning 'accepted'; a forged/missing issuer receipt cannot become PASS.
{
 const dir=mkdtempSync(join(tmpdir(),'gpt02-first-submit-verification-'));
 try{
  const good=(x={})=>({verified:true,receiptId:uuid,ownerSubject:owner.ownerSubject,
    executionId:TARGET.executionId,attemptId:TARGET.attemptId,
    environment:'DEV',authorizationExpiresAt:now+30000,...x});
  for(const [name,verifier,expected] of [
   ['WRONG_RECEIPT',async()=>good({receiptId:'11111111-1111-4111-8111-111111111111'}),'COMPLETED_RECEIPT_NOT_VERIFIED'],
   ['EXPIRED_RECEIPT',async()=>good({authorizationExpiresAt:now-1}),'COMPLETED_RECEIPT_NOT_VERIFIED'],
   ['ISSUER_UNAVAILABLE',async()=>{throw Error('offline')},'COMPLETED_RECEIPT_REVALIDATION_UNAVAILABLE']
  ]){
   const st=createDurableStore({dbPath:join(dir,name+'.sqlite3')});
   const gate=createDurableGateCore({verifyOwner:async()=>owner,verifyIndependentAuthority:async()=>authority,
      consumeVerifiedDecision:async()=>receipt,verifyCompletedReceipt:verifier,store:st,clock:()=>now});
   const ready=await gate.run('status',TARGET,token);
   const result=await gate.run('submit',{...TARGET,challengeId:ready.challengeId},token);
   assert.equal(result.blocker,expected,name);
   assert.equal(result.state,'waiting',name);
   assert.equal(result.receiptVerified,undefined,name);
  }
  console.log('PASS:FIRST_SUBMISSION_REQUIRES_INDEPENDENT_RECEIPT_VERIFICATION');
 }finally{rmSync(dir,{recursive:true,force:true})}
}
