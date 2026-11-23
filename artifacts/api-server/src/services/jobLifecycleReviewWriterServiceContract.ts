/**
 * TEST-ONLY design contract for a future independently deployed review writer.
 * No HTTP listener, credentials, DB pool, or deployment wiring is provided.
 * Do not import this into the running API: the signed-review writer remains NO-GO.
 *
 * Arbitrary SQL is deliberately absent from the request surface. The trusted
 * adapter is supplied at construction by the future isolated service, never
 * by a caller or browser. The adapter MUST independently lock and recheck
 * command, operator, ACK, BLOCKER, expiry and nonce inside PostgreSQL.
 */
import {verifyOperatorApprovalProof,type OperatorApprovalProof}
 from "./jobLifecycleOperatorApprovalProof.js";

export type DevReviewWriterRequest={
 proof:unknown;
};
export type DevReviewWriterResult={
 recorded:boolean;reason:string;mayIssueGrant:false;mayDispatchWorker:false;
};
type TrustedWriterAdapter=(proof:OperatorApprovalProof)=>Promise<boolean>;

export function createIsolatedDevReviewWriterContract(dependencies:{
 appEnv:string|undefined;
 nodeEnv:string|undefined;
 publicKeyDerBase64:string|undefined;
 verifiedWriterAdapter:TrustedWriterAdapter;
 now:()=>Date;
}): (request:DevReviewWriterRequest)=>Promise<DevReviewWriterResult>{
 const deny=(reason:string):DevReviewWriterResult=>({
  recorded:false,reason,mayIssueGrant:false,mayDispatchWorker:false,
 });
 return async(request)=>{
  if(dependencies.appEnv!=="development"||dependencies.nodeEnv==="production")
   return deny("DEV_ONLY");
  if(!request||typeof request!=="object"||Array.isArray(request)||
    Object.keys(request).sort().join(",")!=="proof")
   return deny("INVALID_REQUEST");
  const proof=request.proof;
  if(!proof||typeof proof!=="object"||Array.isArray(proof))
   return deny("INVALID_PROOF");
  const p=proof as Record<string,unknown>;
  // Do not trust IDs as authorization: each is cryptographically bound by
  // the verifier. The future writer must recheck all against fresh DB facts.
  const verified=verifyOperatorApprovalProof({
   proof,
   expectedCommandId:typeof p["commandId"]==="string"?p["commandId"]:"",
   expectedCheckpointResponseId:typeof p["checkpointResponseId"]==="string"?p["checkpointResponseId"]:"",
   expectedBlockerResponseId:typeof p["blockerResponseId"]==="string"?p["blockerResponseId"]:"",
   expectedWorkerId:"openclaw-dell-chatgpt-wake-dev",
   now:dependencies.now(),
   serverPublicKeyDerBase64:dependencies.publicKeyDerBase64,
  });
  if(!verified.validForReview)return deny("PROOF_"+verified.reason);
  try{
   const recorded=await dependencies.verifiedWriterAdapter(proof as OperatorApprovalProof);
   if(recorded!==true)return deny("ATOMIC_DATABASE_EVIDENCE_DENIED");
   return {recorded:true,reason:"SYNTHETIC_REVIEW_AUDITED_NOT_A_GRANT",
    mayIssueGrant:false,mayDispatchWorker:false};
  }catch{return deny("WRITER_UNAVAILABLE");}
 };
}
