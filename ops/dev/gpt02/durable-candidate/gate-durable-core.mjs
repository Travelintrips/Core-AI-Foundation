import {TARGET} from '../task190-gate-core.mjs';
const allowed=new Set(['environment','companyId','taskId','purpose','executionId','attemptId','challengeId']);
const valid=(r)=>r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>allowed.has(k))&&Object.entries(TARGET).every(([k,v])=>r[k]===v);
const waiting=(blocker)=>({...TARGET,state:'waiting',blocker});
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export function createDurableGateCore({verifyOwner,verifyIndependentAuthority,consumeVerifiedDecision,verifyCompletedReceipt,store,clock=Date.now}){
 if([verifyOwner,verifyIndependentAuthority,consumeVerifiedDecision,verifyCompletedReceipt,store].some(f=>typeof f!=='function'))throw Error('EXTERNAL_ADAPTERS_REQUIRED');
 return {run:async(action,r,authorization)=>{
  if(!['status','submit'].includes(action)||!valid(r))return waiting('INVALID_TARGET');
  if(!/^Bearer [A-Za-z0-9_.-]{48,4096}$/.test(authorization??''))return waiting('OWNER_AUTH_REQUIRED');
  let owner;
  try{owner=await verifyOwner(authorization)}catch{return waiting('OWNER_UNVERIFIED')}
  if(owner?.companyId!=='default'||!/^owner:google_[A-Za-z0-9_-]{6,120}$/.test(owner?.ownerSubject??''))return waiting('OWNER_UNVERIFIED');
  const key=owner.ownerSubject+'|'+TARGET.attemptId,now=clock();
  let old;
  try{old=store('read',{key,now})}catch{return waiting('DURABLE_STORE_UNAVAILABLE')}
  if(old.state==='COMPLETED'){
   if(!UUID.test(old.receipt??''))return waiting('DURABLE_RECEIPT_INVALID');
   let proof;
   try{proof=await verifyCompletedReceipt({...TARGET,ownerSubject:owner.ownerSubject,receiptId:old.receipt});}
   catch{return waiting('COMPLETED_RECEIPT_REVALIDATION_UNAVAILABLE');}
   if(proof?.verified!==true || proof.receiptId!==old.receipt || proof.ownerSubject!==owner.ownerSubject ||
      proof.executionId!==TARGET.executionId || proof.attemptId!==TARGET.attemptId ||
      proof.environment!=='DEV' || !Number.isSafeInteger(proof.authorizationExpiresAt) ||
      proof.authorizationExpiresAt<=now || proof.authorizationExpiresAt>now+120000)
      return waiting('COMPLETED_RECEIPT_NOT_VERIFIED');
   return {...TARGET,ownerSubject:owner.ownerSubject,state:'accepted',receiptVerified:true,receiptId:old.receipt};
  }
  if(old.state==='CLAIMED')return waiting('AMBIGUOUS_ISSUER_ATTEMPT_REQUIRES_RECONCILIATION');
  let auth;
  try{auth=await verifyIndependentAuthority({...TARGET,ownerSubject:owner.ownerSubject})}catch{return waiting('INDEPENDENT_AUTHORITY_UNAVAILABLE')}
  if(auth?.verified!==true||auth.environment!=='DEV'||auth.taskId!==190||
     auth.executionId!==TARGET.executionId||auth.attemptId!==TARGET.attemptId||auth.ownerSubject!==owner.ownerSubject||
     !Number.isSafeInteger(auth.expiresAt)||auth.expiresAt<=now||auth.expiresAt>now+120000||
     typeof auth.reference!=='string'||!auth.reference||auth.dispatchPermitted!==false)return waiting('INDEPENDENT_AUTHORITY_UNVERIFIED');
  let record;
  try{record=store('ensure',{key,now,authority:auth.reference,expiresAt:auth.expiresAt})}catch{return waiting('DURABLE_STORE_UNAVAILABLE')}
  if(record.state==='CLAIMED')return waiting('AMBIGUOUS_ISSUER_ATTEMPT_REQUIRES_RECONCILIATION');
  if(record.state==='COMPLETED')return waiting('RECEIPT_REVALIDATION_REQUIRED');
  if(record.state!=='READY'||!UUID.test(record.challenge)||!Number.isSafeInteger(record.expiresAt)||record.expiresAt<=now)return waiting('CHALLENGE_UNAVAILABLE');
  if(action==='status')return {...TARGET,ownerSubject:owner.ownerSubject,state:'ready',executionGateVerified:true,challengeId:record.challenge,expiresAt:record.expiresAt};
  if(r.challengeId!==record.challenge)return waiting('CHALLENGE_MISMATCH');
  let claimed;
  try{claimed=store('claim',{key,now,authority:auth.reference,challenge:r.challengeId})}catch{return waiting('DURABLE_STORE_UNAVAILABLE')}
  if(claimed.state!=='CLAIMED')return waiting('ALREADY_CLAIMED_OR_EXPIRED');
  // Persist CLAIMED before external call. Crash/timeout fails closed; no automatic replay.
  let receipt;
  try{receipt=await consumeVerifiedDecision({...TARGET,ownerSubject:owner.ownerSubject,authorityRef:auth.reference,challengeId:r.challengeId})}
  catch{return waiting('INDEPENDENT_CONSUMPTION_UNCERTAIN')}
  if(receipt?.verified!==true||!UUID.test(receipt.receiptId??'')||
     receipt.targetExecutionId!==TARGET.executionId||receipt.targetAttemptId!==TARGET.attemptId||
     receipt.ownerSubject!==owner.ownerSubject)return waiting('INDEPENDENT_RECEIPT_UNVERIFIED');
  try{
   const complete=store('complete',{key,now,receipt:receipt.receiptId});
   if(complete.state!=='COMPLETED'||complete.receipt!==receipt.receiptId)return waiting('DURABLE_COMPLETION_NOT_VERIFIED');
  }catch{return waiting('DURABLE_STORE_UNAVAILABLE')}
  // Completion in the local durable store does not prove the independent issuer
  // committed a matching, still-valid receipt. Verify independently on this
  // first submission, just as on a later readback after a process restart.
  let proof;
  try{proof=await verifyCompletedReceipt({...TARGET,ownerSubject:owner.ownerSubject,receiptId:receipt.receiptId})}
  catch{return waiting('COMPLETED_RECEIPT_REVALIDATION_UNAVAILABLE')}
  const afterVerify=clock();
  if(proof?.verified!==true||proof.receiptId!==receipt.receiptId||
     proof.ownerSubject!==owner.ownerSubject||proof.executionId!==TARGET.executionId||
     proof.attemptId!==TARGET.attemptId||proof.environment!=='DEV'||
     !Number.isSafeInteger(proof.authorizationExpiresAt)||
     proof.authorizationExpiresAt<=afterVerify||proof.authorizationExpiresAt>afterVerify+120000)
    return waiting('COMPLETED_RECEIPT_NOT_VERIFIED');
  return {...TARGET,ownerSubject:owner.ownerSubject,state:'accepted',receiptVerified:true,receiptId:receipt.receiptId};
 }}
}
