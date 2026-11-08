/** Offline trust-boundary design; only the actual server's session middleware
 * may construct the trusted principal. No route, listener, signer, DB access.
 */
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).sort().join('|')===keys.slice().sort().join('|');
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const requestKeys=['commandId','receiverJobId','attemptId','attestation'];
const deny=reason=>({principalObserved:false,reason,operatorUserId:null,previewOnly:true,
 mayPersistBinding:false,mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false,releaseDecision:'NO_GO'});
export function inspectServerOperatorBoundary(request,serverContext){
 if(!exact(request,requestKeys))return deny('REQUEST_FIELDS_NOT_ALLOWLISTED');
 if(![request.commandId,request.receiverJobId,request.attemptId].every(x=>typeof x==='string'&&ID.test(x)))
  return deny('INVALID_REQUEST_IDS');
 if(!request.attestation||typeof request.attestation!=='object'||Array.isArray(request.attestation))
  return deny('INVALID_ATTESTATION');
 // Only trusted middleware can provide the context. This offline helper cannot
 // prove its provenance; hence even a plausible context is never authorization.
 if(!serverContext||serverContext.env!=='development'||serverContext.nodeEnv==='production')
  return deny('DEV_ONLY');
 const p=serverContext.principal;
 if(!p||!Number.isSafeInteger(p.id)||p.id<=0||p.accountType!=='internal'||
  p.status!=='active'||!['owner','admin'].includes(p.role)||p.mustChangePassword!==false)
  return deny('UNTRUSTED_OR_INACTIVE_PRINCIPAL');
 if(serverContext.sessionVerifiedByMiddleware!==true||
  serverContext.userReReadFromDatabase!==true||serverContext.originAcceptedByServer!==true)
  return deny('SERVER_SESSION_AND_ORIGIN_NOT_VERIFIED');
 if(request.attestation?.payload?.operatorUserId!==p.id)
  return deny('SIGNED_PAYLOAD_OPERATOR_MISMATCH');
 if(request.attestation?.payload?.commandId!==request.commandId||
  request.attestation?.payload?.receiverJobId!==request.receiverJobId||
  request.attestation?.payload?.attemptId!==request.attemptId)
  return deny('ATTESTATION_REQUEST_IDENTITY_MISMATCH');
 return {principalObserved:true,operatorUserId:p.id,
  reason:'SERVER_PRINCIPAL_SHAPE_OBSERVED_NOT_TRUSTED_WRITER',previewOnly:true,
  mayPersistBinding:false,mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false,
  releaseDecision:'NO_GO'};
}
