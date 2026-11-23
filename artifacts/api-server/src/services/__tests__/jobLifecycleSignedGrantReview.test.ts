import {describe,it,expect} from "vitest";
import {generateKeyPairSync,sign} from "node:crypto";
import {reviewSignedDevResumeGrant} from "../jobLifecycleSignedGrantReview.js";
import {operatorApprovalProofPayload,type OperatorApprovalProof} from "../jobLifecycleOperatorApprovalProof.js";
import type {LifecycleEvidenceRow} from "../jobLifecycleReadinessService.js";
import type {ResumeGrantRecord} from "../jobLifecycleResumeAuthorization.js";
const keys=generateKeyPairSync("ed25519");
const publicKey=keys.publicKey.export({format:"der",type:"spki"}).toString("base64");
const commandId="169a7492-cfd8-4a56-bb57-18001b6b5968";
const cp="822efca2-7428-428a-ac66-548c0462438e";
const blocker="08b7b237-7a16-46d0-b79d-029d0363c112";
const worker="openclaw-dell-chatgpt-wake-dev";
const operator="operator-123";
const when=(s:string)=>new Date("2026-11-08T00:00:"+s+"Z");
const now=when("40");
function proof():OperatorApprovalProof {
 const unsigned:Omit<OperatorApprovalProof,"signatureBase64">={
  version:1,action:"gpt02.resume.grant.review",
  commandId,checkpointResponseId:cp,blockerResponseId:blocker,workerId:worker,
  operatorId:operator,operatorRole:"admin",
  issuedAt:"2026-11-08T00:00:20.000Z",
  expiresAt:"2026-11-08T00:01:20.000Z",
  nonce:"0123456789abcdef0123456789abcdef"};
 return {...unsigned,signatureBase64:sign(null,Buffer.from(operatorApprovalProofPayload(unsigned)),keys.privateKey).toString("base64")};
}
function fixture(){
 const rows:LifecycleEvidenceRow[]=[
  {id:cp,commandId,kind:"CHECKPOINT",createdAt:when("10"),acknowledgedAt:when("11"),checkpointAttested:true,receiverAckVerified:true},
  {id:blocker,commandId,kind:"BLOCKER",createdAt:when("15"),acknowledgedAt:null}];
 const grant:ResumeGrantRecord={commandId,checkpointResponseId:cp,blockerResponseId:blocker,
  workerId:worker,approvedBy:operator,approvedAt:when("21"),expiresAt:new Date("2026-11-08T00:01:30Z"),
  consumedAt:null,status:"APPROVED"};
 return {commandId,commandStatus:"PROCESSING",workerId:worker,now,persistedRows:rows,
  databaseSnapshotVerified:true,responseHistoryComplete:true,signedCheckpointAndNativeAckVerified:true,
  grant,grantRecordVerified:true,approvalProof:proof(),trustedApprovalPublicKey:publicKey};
}
describe("signed operator approval and server-owned grant integration, review only",()=>{
 it("valid signed approval and exact grant may only proceed to review",()=>{
  expect(reviewSignedDevResumeGrant(fixture())).toMatchObject({
   eligibleForFurtherReview:true,reason:"SIGNED_GRANT_REVIEW_VALID",
   checkpointResponseId:cp,blockerResponseId:blocker,
   mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false});
 });
 const cases:[string,(f:ReturnType<typeof fixture>)=>ReturnType<typeof fixture>,string][]=[
  ["missing trusted signer",f=>({...f,trustedApprovalPublicKey:undefined as unknown as string}),"OPERATOR_PROOF_NO_TRUSTED_KEY"],
  ["tampered operator",f=>({...f,approvalProof:{...proof(),operatorId:"forged"}}),"OPERATOR_PROOF_INVALID_SIGNATURE"],
  ["wrong blocker binding",f=>({...f,approvalProof:{...proof(),blockerResponseId:cp}}),"OPERATOR_PROOF_BOUND_IDENTITY_MISMATCH"],
  ["grant attributed to another operator",f=>({...f,grant:{...f.grant,approvedBy:"other"}}),"APPROVER_ATTRIBUTION_MISMATCH"],
  ["grant before signed proof",f=>({...f,grant:{...f.grant,approvedAt:when("10")}}),"APPROVAL_PRECEDES_SIGNED_PROOF"],
  ["unverified native ack",f=>({...f,signedCheckpointAndNativeAckVerified:false}),"MISSING_SIGNED_EVIDENCE"],
  ["terminal command",f=>({...f,commandStatus:"FAILED"}),"TERMINAL_OR_UNKNOWN_COMMAND"],
  ["untrusted grant",f=>({...f,grantRecordVerified:false}),"GRANT_REVIEW_DENIED"],
  ["truncated history",f=>({...f,responseHistoryComplete:false}),"INCOMPLETE_HISTORY"],
 ];
 for(const [name,patch,reason] of cases)it("denies "+name,()=>{
  const x=reviewSignedDevResumeGrant(patch(fixture()));
  expect(x.reason).toBe(reason);
  expect(x.eligibleForFurtherReview).toBe(false);
  expect(x.mayIssueGrant).toBe(false);
  expect(x.mayDispatchWorker).toBe(false);
  expect(x.mayCloseJob).toBe(false);
 });
});
