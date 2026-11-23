/** DEV-only server-side verifier for a short-lived, command-scoped operator approval.
 * This module never authenticates the human itself, issues approval, writes grants,
 * acquires a lease or dispatches work. Signing must happen ONLY after application
 * authentication and authorization in a trusted server process.
 */
import { createPublicKey, verify } from "node:crypto";

export type OperatorApprovalProof = {
  version:1; action:"gpt02.resume.grant.review";
  commandId:string;checkpointResponseId:string;blockerResponseId:string;
  workerId:string;operatorId:string;operatorRole:"admin"|"owner";
  issuedAt:string;expiresAt:string;nonce:string;signatureBase64:string;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nonce=/^[a-f0-9]{32,128}$/i;
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==="object"&&!Array.isArray(x);
const canonical=(p:Omit<OperatorApprovalProof,"signatureBase64">)=>[
 "ai-core-dev-operator-approval/v1",p.version,p.action,p.commandId,
 p.checkpointResponseId,p.blockerResponseId,p.workerId,p.operatorId,
 p.operatorRole,p.issuedAt,p.expiresAt,p.nonce,
].join("\n");
export function verifyOperatorApprovalProof(input:{
  proof:unknown;expectedCommandId:string;expectedCheckpointResponseId:string;
  expectedBlockerResponseId:string;expectedWorkerId:string;now:Date;
  /** Dedicated public key; cannot be supplied by the browser or worker. */
  serverPublicKeyDerBase64:string|undefined;
}):{validForReview:boolean;reason:string;mayIssueGrant:false;mayDispatchWorker:false}{
 const deny=(reason:string)=>({validForReview:false,reason,mayIssueGrant:false as const,mayDispatchWorker:false as const});
 try {
  const p=input.proof;
  if(!record(p)||p["version"]!==1||p["action"]!=="gpt02.resume.grant.review")
   return deny("INVALID_PROOF_FORMAT");
  const fields=["commandId","checkpointResponseId","blockerResponseId","workerId","operatorId","operatorRole","issuedAt","expiresAt","nonce","signatureBase64"] as const;
  if(fields.some(k=>typeof p[k]!=="string"||!(p[k] as string).trim()))return deny("MISSING_FIELDS");
  if(Object.keys(p).sort().join(",")!==["version","action",...fields].sort().join(","))
   return deny("UNEXPECTED_PROOF_FIELDS");
  if(p["commandId"]!==input.expectedCommandId||
     p["checkpointResponseId"]!==input.expectedCheckpointResponseId||
     p["blockerResponseId"]!==input.expectedBlockerResponseId||
     p["workerId"]!==input.expectedWorkerId)return deny("BOUND_IDENTITY_MISMATCH");
  if(!uuid.test(p["commandId"] as string)||!uuid.test(p["checkpointResponseId"] as string)||
     !uuid.test(p["blockerResponseId"] as string)||!nonce.test(p["nonce"] as string)||
     !/^[a-zA-Z0-9._:-]{3,128}$/.test(p["operatorId"] as string)||
     !["admin","owner"].includes(p["operatorRole"] as string))return deny("INVALID_PRINCIPAL");
  const issued=Date.parse(p["issuedAt"] as string),expires=Date.parse(p["expiresAt"] as string),now=input.now.getTime();
  if(!Number.isFinite(now)||!Number.isFinite(issued)||!Number.isFinite(expires)||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p["issuedAt"] as string)||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p["expiresAt"] as string)||
     issued>now||expires<=now||expires<=issued||expires-issued>120000)return deny("INVALID_PROOF_TIME");
  if(!input.serverPublicKeyDerBase64)return deny("NO_TRUSTED_KEY");
  const bytes=Buffer.from(input.serverPublicKeyDerBase64,"base64");
  if(bytes.toString("base64")!==input.serverPublicKeyDerBase64)return deny("INVALID_PUBLIC_KEY");
  const key=createPublicKey({key:bytes,format:"der",type:"spki"});
  if(key.asymmetricKeyType!=="ed25519")return deny("INVALID_PUBLIC_KEY");
  const sig=Buffer.from(p["signatureBase64"] as string,"base64");
  if(sig.length!==64||sig.toString("base64")!==p["signatureBase64"])
   return deny("INVALID_SIGNATURE");
  const unsigned=Object.fromEntries(Object.entries(p).filter(([k])=>k!=="signatureBase64")) as Omit<OperatorApprovalProof,"signatureBase64">;
  if(!verify(null,Buffer.from(canonical(unsigned),"utf8"),key,sig))
   return deny("INVALID_SIGNATURE");
  return {validForReview:true,reason:"SIGNED_OPERATOR_PROOF_REVIEW_VALID",
   mayIssueGrant:false,mayDispatchWorker:false};
 }catch{return deny("INVALID_PROOF")}
}
/** Test/helper encoding only. Do not export a signer or use worker-side keys. */
export function operatorApprovalProofPayload(p:Omit<OperatorApprovalProof,"signatureBase64">):string{
 return canonical(p);
}
