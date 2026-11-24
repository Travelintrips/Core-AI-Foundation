import { randomUUID } from 'node:crypto';
const TARGET=Object.freeze({environment:'DEV',companyId:'default',taskId:190,purpose:'execute',executionId:'8e3e0809-9e34-413a-bff5-3bac6d9a42c7',attemptId:'26ab49fb-6d4e-4889-b000-d0633555c3b6'});
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const validTarget=(r)=>r && typeof r==='object' && !Array.isArray(r) && Object.keys(r).every(k=>Object.hasOwn(TARGET,k)||k==='challengeId') && Object.entries(TARGET).every(([k,v])=>r[k]===v);
const fail=(error)=>Object.freeze({state:'waiting',blocker:error,...TARGET});
export function createGateCore({verifyOwner,verifyIndependentAuthority,consumeVerifiedDecision,clock=Date.now}) {
 if (![verifyOwner,verifyIndependentAuthority,consumeVerifiedDecision].every(x=>typeof x==='function')) throw Error('INDEPENDENT_AUTHORITY_ADAPTER_REQUIRED');
 const outstanding=new Map(),completed=new Map(),inFlight=new Set();
 async function run(action,request,authorization){
  if(!['status','submit'].includes(action)|| !validTarget(request))return fail('TARGET_NOT_VERIFIED');
  if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9_.-]{48,4096}$/.test(authorization))return fail('OWNER_AUTH_REQUIRED');
  let owner;
  try{owner=await verifyOwner(authorization);}catch{return fail('OWNER_IDENTITY_UNVERIFIED');}
  if(!owner||!/^owner:google_[A-Za-z0-9_-]{6,120}$/.test(owner.ownerSubject)||owner.companyId!=='default') return fail('OWNER_IDENTITY_UNVERIFIED');
  const key=owner.ownerSubject+'|'+TARGET.attemptId;
  const prior=completed.get(key);
  if(prior) return Object.freeze({...TARGET,ownerSubject:owner.ownerSubject,state:'accepted',receiptVerified:true,receiptId:prior});
  let authority;
  try{authority=await verifyIndependentAuthority({...TARGET,ownerSubject:owner.ownerSubject});}catch{return fail('INDEPENDENT_AUTHORITY_UNAVAILABLE');}
  const now=clock();
  if(!authority || authority.verified!==true || authority.environment!=='DEV' || authority.taskId!==190 ||
     authority.executionId!==TARGET.executionId || authority.attemptId!==TARGET.attemptId ||
     authority.ownerSubject!==owner.ownerSubject || !Number.isSafeInteger(authority.expiresAt) ||
     authority.expiresAt<=now || authority.expiresAt>now+120000 || authority.dispatchPermitted!==false)
     return fail('INDEPENDENT_AUTHORITY_UNVERIFIED');
  let challenge=outstanding.get(key);
  if(!challenge || challenge.expiresAt<=now || challenge.authorityRef!==authority.reference){
    challenge={id:randomUUID(),expiresAt:Math.min(authority.expiresAt,now+120000),authorityRef:authority.reference};
    outstanding.set(key,challenge);
  }
  if(action==='status')return Object.freeze({...TARGET,ownerSubject:owner.ownerSubject,state:'ready',executionGateVerified:true,challengeId:challenge.id,expiresAt:challenge.expiresAt});
  if(request.challengeId!==challenge.id || !UUID.test(request.challengeId))return fail('CHALLENGE_MISMATCH');
  // External independent custodian MUST atomically verify and consume the decision.
  // No local self-issuance, signing, database role grant, dispatch or fallback.
  // Local single-flight is necessary but not sufficient: the independent
  // custodian must additionally enforce atomic, durable consumption across
  // processes, service restarts and hosts.
  if(inFlight.has(key))return fail('CONCURRENT_CONSUMPTION_IN_PROGRESS');
  inFlight.add(key);
  let receipt;
  try{
    receipt=await consumeVerifiedDecision({...TARGET,ownerSubject:owner.ownerSubject,authorityRef:authority.reference,challengeId:challenge.id});
  }catch{return fail('INDEPENDENT_CONSUMPTION_FAILED');}
  finally{inFlight.delete(key);}
  if(!receipt||receipt.verified!==true||!UUID.test(receipt.receiptId)||receipt.targetExecutionId!==TARGET.executionId||
     receipt.targetAttemptId!==TARGET.attemptId||receipt.ownerSubject!==owner.ownerSubject)
     return fail('VERIFIED_RECEIPT_MISSING');
  outstanding.delete(key);completed.set(key,receipt.receiptId);
  return Object.freeze({...TARGET,ownerSubject:owner.ownerSubject,state:'accepted',receiptVerified:true,receiptId:receipt.receiptId});
 }
 return {run};
}
export {TARGET};
