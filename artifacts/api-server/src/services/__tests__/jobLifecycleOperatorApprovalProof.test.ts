import {describe,it,expect} from "vitest";
import {generateKeyPairSync,sign} from "node:crypto";
import {operatorApprovalProofPayload,verifyOperatorApprovalProof,type OperatorApprovalProof} from "../jobLifecycleOperatorApprovalProof.js";
const kp=generateKeyPairSync("ed25519");
const publicKey=kp.publicKey.export({format:"der",type:"spki"}).toString("base64");
const cmd="169a7492-cfd8-4a56-bb57-18001b6b5968";
const cp="822efca2-7428-428a-ac66-548c0462438e";
const block="08b7b237-7a16-46d0-b79d-029d0363c112";
const worker="openclaw-dell-chatgpt-wake-dev";
const now=new Date("2026-11-08T00:01:00.000Z");
function proof():OperatorApprovalProof{
 const unsigned:Omit<OperatorApprovalProof,"signatureBase64">={
  version:1,action:"gpt02.resume.grant.review",commandId:cmd,
  checkpointResponseId:cp,blockerResponseId:block,workerId:worker,
  operatorId:"operator-123",operatorRole:"admin",
  issuedAt:"2026-11-08T00:00:30.000Z",expiresAt:"2026-11-08T00:01:30.000Z",
  nonce:"0123456789abcdef0123456789abcdef",
 };
 return {...unsigned,signatureBase64:sign(null,Buffer.from(operatorApprovalProofPayload(unsigned)),kp.privateKey).toString("base64")};
}
function check(p:unknown,overrides:Record<string,unknown>={}) {
 return verifyOperatorApprovalProof({proof:p,expectedCommandId:cmd,
  expectedCheckpointResponseId:cp,expectedBlockerResponseId:block,
  expectedWorkerId:worker,now,serverPublicKeyDerBase64:publicKey,...overrides});
}
describe("DEV operator approval proof is cryptographically bound and never issues grants",()=>{
 it("valid server-side Ed25519 signature only qualifies for review",()=>{
  expect(check(proof())).toMatchObject({validForReview:true,
   reason:"SIGNED_OPERATOR_PROOF_REVIEW_VALID",mayIssueGrant:false,mayDispatchWorker:false});
 });
 for(const [name,patch] of [
  ["wrong command",{commandId:"28e38692-73c0-470e-aaea-51894504a5f0"}],
  ["wrong checkpoint",{checkpointResponseId:"28e38692-73c0-470e-aaea-51894504a5f0"}],
  ["wrong blocker",{blockerResponseId:"28e38692-73c0-470e-aaea-51894504a5f0"}],
  ["wrong worker",{workerId:"worker-attacker"}],
  ["upgraded role",{operatorRole:"owner"}],
  ["forged operator",{operatorId:"operator-999"}],
  ["forged expiry",{expiresAt:"2026-11-08T01:01:30.000Z"}],
 ] as const)it("rejects tampered "+name,()=>{
  const x=check({...proof(),...patch});
  expect(x.validForReview).toBe(false);
  expect(x.mayIssueGrant).toBe(false);
 });
 it("rejects expired proof even with valid signature",()=>{
  expect(check(proof(),{now:new Date("2026-11-08T00:01:31Z")}).validForReview).toBe(false);
 });
 it("rejects future-issued proof even with valid signature",()=>{
  expect(check(proof(),{now:new Date("2026-11-08T00:00:29Z")}).validForReview).toBe(false);
 });
 it("rejects proof not bound to exact requested IDs",()=>{
  expect(check(proof(),{expectedBlockerResponseId:"other"}).validForReview).toBe(false);
 });
 it("rejects missing configured trust key",()=>{
  expect(check(proof(),{serverPublicKeyDerBase64:undefined}).reason).toBe("NO_TRUSTED_KEY");
 });
 it("rejects unknown extra proof fields",()=>{
  expect(check({...proof(),userSupplied:true}).reason).toBe("UNEXPECTED_PROOF_FIELDS");
 });
 it("rejects unsigned untrusted browser fields",()=>{
  expect(check({...proof(),signatureBase64:"x"}).validForReview).toBe(false);
 });
});
