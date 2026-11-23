/** DEV-only: server signing of an operator's review intent, never a resume grant.
 * The caller MUST authenticate an internal owner/admin from DB on this request
 * and MUST fetch evidence independently from the trusted database.
 * Do not expose the private key, or allow this to dispatch/issue grants.
 */
import { createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import { operatorApprovalProofPayload, verifyOperatorApprovalProof, type OperatorApprovalProof } from "./jobLifecycleOperatorApprovalProof.js";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type OperatorReviewSigningInput={
 operator:{id:number;role:string;status:string;accountType:string;mustChangePassword:boolean};
 commandId:string;commandStatus:string;checkpointResponseId:string|null;
 blockerResponseId:string|null;workerId:string;now:Date;
 commandEvidenceVerified:boolean;checkpointAttested:boolean;
 nativeAckVerified:boolean;blockerEvidenceVerified:boolean;
 responseSnapshotComplete:boolean;explicitReviewAcknowledgement:boolean;
 appEnv:string|undefined;nodeEnv:string|undefined;
 enabledByServer:boolean;privateKeyDerBase64:string|undefined;
 trustedPublicKeyDerBase64:string|undefined;
};
export function signDevOperatorReviewIntent(input:OperatorReviewSigningInput):{
 signed:boolean;reason:string;proof?:OperatorApprovalProof;
 mayIssueGrant:false;mayDispatchWorker:false;mayCloseJob:false;
}{
 const deny=(reason:string)=>({signed:false,reason,mayIssueGrant:false as const,
  mayDispatchWorker:false as const,mayCloseJob:false as const});
 if(input.appEnv!=="development"||input.nodeEnv==="production"||!input.enabledByServer)
  return deny("DEV_SIGNER_DISABLED");
 const operator=input.operator;
 if(!Number.isSafeInteger(operator.id)||operator.id<1||operator.status!=="active"||
    operator.accountType!=="internal"||operator.mustChangePassword||
    (operator.role!=="owner"&&operator.role!=="admin"))
  return deny("OPERATOR_NOT_AUTHORIZED");
 if(!input.explicitReviewAcknowledgement)return deny("EXPLICIT_REVIEW_ACK_REQUIRED");
 if(!input.commandEvidenceVerified||!input.responseSnapshotComplete||
    input.commandStatus!=="PROCESSING"||
    !input.checkpointAttested||!input.nativeAckVerified||
    !input.blockerEvidenceVerified)return deny("PERSISTED_COMMAND_EVIDENCE_DENIED");
 if(!uuid.test(input.commandId)||!input.checkpointResponseId||!uuid.test(input.checkpointResponseId)||
    !input.blockerResponseId||!uuid.test(input.blockerResponseId)||
    !input.workerId||input.workerId!=="openclaw-dell-chatgpt-wake-dev")
  return deny("BOUND_IDENTITIES_INVALID");
 if(!(input.now instanceof Date)||!Number.isFinite(input.now.getTime()))
  return deny("INVALID_TIME");
 if(!input.privateKeyDerBase64||!input.trustedPublicKeyDerBase64)
  return deny("SIGNING_KEY_NOT_CONFIGURED");
 try{
  const keyBytes=Buffer.from(input.privateKeyDerBase64,"base64");
  if(keyBytes.toString("base64")!==input.privateKeyDerBase64)return deny("INVALID_PRIVATE_KEY");
  const privateKey=createPrivateKey({key:keyBytes,format:"der",type:"pkcs8"});
  if(privateKey.asymmetricKeyType!=="ed25519")return deny("INVALID_PRIVATE_KEY");
  const publicKey=createPublicKey(privateKey).export({format:"der",type:"spki"}).toString("base64");
  if(publicKey!==input.trustedPublicKeyDerBase64)return deny("SIGNING_KEY_MISMATCH");
  const issuedAt=input.now.toISOString();
  const unsigned:Omit<OperatorApprovalProof,"signatureBase64">={
   version:1,action:"gpt02.resume.grant.review",
   commandId:input.commandId,checkpointResponseId:input.checkpointResponseId,
   blockerResponseId:input.blockerResponseId,workerId:input.workerId,
   operatorId:"internal:"+operator.id,operatorRole:operator.role,
   issuedAt,expiresAt:new Date(input.now.getTime()+90_000).toISOString(),
   nonce:randomBytes(32).toString("hex"),
  };
  const signatureBase64=sign(null,Buffer.from(operatorApprovalProofPayload(unsigned),"utf8"),privateKey).toString("base64");
  const proof:OperatorApprovalProof={...unsigned,signatureBase64};
  const checked=verifyOperatorApprovalProof({proof,expectedCommandId:input.commandId,
   expectedCheckpointResponseId:input.checkpointResponseId,
   expectedBlockerResponseId:input.blockerResponseId,expectedWorkerId:input.workerId,
   now:input.now,serverPublicKeyDerBase64:input.trustedPublicKeyDerBase64});
  if(!checked.validForReview)return deny("SIGNED_PROOF_SELF_VERIFICATION_FAILED");
  return {signed:true,reason:"REVIEW_INTENT_SIGNED_NOT_A_GRANT",proof,
   mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false};
 }catch{return deny("SIGNING_FAILED")}
}
