/** Offline composition of three independent checks; not a trusted writer.
 * Never accepts authorization from an HTTP request or deploys an endpoint.
 */
import {inspectServerOperatorBoundary} from './gpt02-binding-trusted-operator-boundary.mjs';
import {preflightBindingClaim} from './gpt02-binding-writer-preflight.mjs';
import {verifyOfflineBindingAttestation} from './gpt02-binding-attestation-verifier.mjs';
const deny=(reason,checks)=>({reason,checks,
 bindingEvidenceReadyForReview:false,previewOnly:true,
 mayPersistBinding:false,mayIssueGrant:false,mayDispatchWorker:false,
 mayCloseJob:false,releaseDecision:'NO_GO'});
export function evaluateOfflineBindingEvidence({request,serverContext,independentReadbacks,proofVerification},
 {now=Date.now()}={}){
 const operator=inspectServerOperatorBoundary(request,serverContext);
 if(!operator.principalObserved)return deny('OPERATOR_'+operator.reason,{operator:operator.reason});
 if(!independentReadbacks||typeof independentReadbacks!=='object')
  return deny('INDEPENDENT_READBACKS_MISSING',{operator:operator.reason});
 const source=independentReadbacks.source,receiver=independentReadbacks.receiver;
 const observed=preflightBindingClaim({
  source,receiver,coreTask:independentReadbacks.coreTask,hubTask:independentReadbacks.hubTask,
  attemptId:request.attemptId,attemptNumber:independentReadbacks.attemptNumber,
  hubExecutionJobId:request.receiverJobId,
  // Derived from trusted server context ONLY, never the request body.
  actor:{sessionAuthenticated:true,adminVerified:true,userId:operator.operatorUserId,originVerified:true},
  proof:independentReadbacks.captureTimes,
 },{now});
 if(!observed.checks.identityObserved||!observed.checks.statusAgrees||
   !observed.checks.sourceTaskObserved||!observed.checks.hubTaskObserved||
   !observed.checks.attemptIdentityPlausible||!observed.checks.sourceAndReceiverFresh||
   !observed.evidenceSha256)
  return deny('INDEPENDENT_READBACKS_INCOMPLETE',{operator:operator.reason,readbacks:observed.reason});
 if(!proofVerification||typeof proofVerification!=='object'||
  proofVerification.trustedPublicKeyDerBase64==null||proofVerification.nonceUnused!==true)
  return deny('TRUSTED_PROOF_CONTEXT_MISSING',{operator:operator.reason,readbacks:'SHAPE_OBSERVED'});
 const signature=verifyOfflineBindingAttestation(request.attestation,{
  commandId:request.commandId,receiverJobId:request.receiverJobId,
  attemptId:request.attemptId,evidenceSha256:observed.evidenceSha256,
  operatorUserId:operator.operatorUserId,now,nonceUnused:proofVerification.nonceUnused,
  trustedPublicKeyDerBase64:proofVerification.trustedPublicKeyDerBase64,
 });
 if(!signature.signatureValid)
  return deny('ATTESTATION_'+signature.reason,{operator:operator.reason,readbacks:'SHAPE_OBSERVED',signature:signature.reason});
 // ALL offline evidence agrees. Still not proof it came from separate DBs,
 // server session, nonce ledger or isolated signer in any real deployment.
 return {...deny('OFFLINE_CORRELATION_ONLY_NO_TRUSTED_WRITER',{
  operator:'SHAPE_OBSERVED',sourceReceiver:'SHAPE_OBSERVED',signature:'VALID_SYNTHETIC_SIGNATURE',
  nonce:'CLAIMED_UNUSED_NOT_ATOMICALLY_RESERVED'}),
  evidenceSha256:observed.evidenceSha256};
}
