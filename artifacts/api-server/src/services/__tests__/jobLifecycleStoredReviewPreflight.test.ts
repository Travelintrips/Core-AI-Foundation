import {describe,it,expect} from "vitest";
import {generateKeyPairSync,sign} from "node:crypto";
import {operatorApprovalProofPayload,type OperatorApprovalProof} from "../jobLifecycleOperatorApprovalProof.js";
import {assessStoredDevOperatorReview,type StoredReviewSnapshot,type CurrentOperatorSnapshot,type CurrentCommandEvidence} from "../jobLifecycleStoredReviewPreflight.js";

const kp=generateKeyPairSync("ed25519");
const trustedPublicKeyDerBase64=kp.publicKey.export({format:"der",type:"spki"}).toString("base64");
const otherKp=generateKeyPairSync("ed25519");
const commandId="169a7492-cfd8-4a56-bb57-18001b6b5968";
const cp="822efca2-7428-428a-ac66-548c0462438e";
const blocker="08b7b237-7a16-46d0-b79d-029d0363c112";
const worker="openclaw-dell-chatgpt-wake-dev";
const now=new Date("2026-11-08T00:00:45.000Z");
function fixture() {
 const base:Omit<OperatorApprovalProof,"signatureBase64">={
  version:1,action:"gpt02.resume.grant.review",
  commandId,checkpointResponseId:cp,blockerResponseId:blocker,workerId:worker,
  operatorId:"internal:7",operatorRole:"admin",
  issuedAt:"2026-11-08T00:00:30.000Z",expiresAt:"2026-11-08T00:01:30.000Z",
  nonce:"0123456789abcdef".repeat(4),
 };
 const proof:OperatorApprovalProof={...base,signatureBase64:sign(null,
  Buffer.from(operatorApprovalProofPayload(base)),kp.privateKey).toString("base64")};
 const review:StoredReviewSnapshot={
  id:"2e14f3e6-c7b0-41f5-81b8-1c5ff5cd4dc0",
  commandId,checkpointResponseId:cp,blockerResponseId:blocker,workerId:worker,
  operatorUserId:7,operatorRole:"admin",nonce:base.nonce,
  signedAt:new Date(base.issuedAt),expiresAt:new Date(base.expiresAt),proof,
 };
 const operator:CurrentOperatorSnapshot={
  id:7,role:"admin",status:"active",accountType:"internal",mustChangePassword:false,
 };
 const evidence:CurrentCommandEvidence={
  commandId,commandStatus:"PROCESSING",checkpointResponseId:cp,
  blockerResponseId:blocker,workerId:worker,responseSnapshotComplete:true,
  checkpointAttested:true,nativeReceiverAckVerified:true,blockerEvidenceValid:true,
 };
 return {review,operator,evidence,now,trustedPublicKeyDerBase64};
}
describe("DEV stored review cryptographic preflight never issues grant",()=>{
 it("accepts correctly bound signed review for read-only verification only",()=>{
  expect(assessStoredDevOperatorReview(fixture())).toEqual({
   reviewVerified:true,reason:"SIGNED_STORED_REVIEW_VERIFIED_NOT_A_GRANT",
   mayIssueGrant:false,mayDispatchWorker:false});
 });
 it("rejects changed column without changing the signed proof",()=>{
  const f=fixture();f.review.nonce="f".repeat(64);
  expect(assessStoredDevOperatorReview(f).reason).toBe("STORED_PROOF_COLUMN_MISMATCH");
 });
 it("rejects forged signature even when all stored columns match",()=>{
  const f=fixture();const p=f.review.proof as OperatorApprovalProof;
  f.review.proof={...p,signatureBase64:sign(null,
   Buffer.from(operatorApprovalProofPayload({...p,signatureBase64:undefined} as unknown as Omit<OperatorApprovalProof,"signatureBase64">)),
   otherKp.privateKey).toString("base64")};
  const x=assessStoredDevOperatorReview(f);
  expect(x.reviewVerified).toBe(false);
  expect(x.reason).toBe("STORED_PROOF_INVALID_SIGNATURE");
  expect(x.mayIssueGrant).toBe(false);
 });
 it("rejects operator revoked since review was signed",()=>{
  const f=fixture();f.operator.status="inactive";
  expect(assessStoredDevOperatorReview(f).reason).toBe("CURRENT_OPERATOR_NOT_AUTHORIZED");
 });
 it("rejects changed latest BLOCKER/ACK or command status",()=>{
  const f=fixture();f.evidence.blockerResponseId="new-blocker";
  expect(assessStoredDevOperatorReview(f).reason).toBe("CURRENT_COMMAND_EVIDENCE_MISMATCH");
  f.evidence.blockerResponseId=blocker;f.evidence.nativeReceiverAckVerified=false;
  expect(assessStoredDevOperatorReview(f).reason).toBe("CURRENT_COMMAND_EVIDENCE_MISMATCH");
  f.evidence.nativeReceiverAckVerified=true;f.evidence.commandStatus="FAILED";
  expect(assessStoredDevOperatorReview(f).reason).toBe("CURRENT_COMMAND_EVIDENCE_MISMATCH");
 });
 it("rejects expired review regardless of cryptographic signature",()=>{
  const f=fixture();
  expect(assessStoredDevOperatorReview({...f,now:new Date("2026-11-08T00:01:31.000Z")}).reason)
   .toBe("STORED_REVIEW_EXPIRED_OR_INVALID");
 });
 it("rejects missing trusted verification key",()=>{
  const f=fixture();
  expect(assessStoredDevOperatorReview({...f,trustedPublicKeyDerBase64:undefined}).reason)
   .toBe("STORED_PROOF_NO_TRUSTED_KEY");
 });
 it("rejects missing review and never gives resume authority",()=>{
  const f=fixture();const r=assessStoredDevOperatorReview({...f,review:null});
  expect(r).toMatchObject({reviewVerified:false,reason:"STORED_REVIEW_MISSING",
   mayIssueGrant:false,mayDispatchWorker:false});
 });
});
