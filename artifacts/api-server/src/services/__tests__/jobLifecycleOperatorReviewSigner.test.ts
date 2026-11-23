import {describe,it,expect} from "vitest";
import {generateKeyPairSync} from "node:crypto";
import {signDevOperatorReviewIntent,type OperatorReviewSigningInput} from "../jobLifecycleOperatorReviewSigner.js";
import {verifyOperatorApprovalProof} from "../jobLifecycleOperatorApprovalProof.js";
const keys=generateKeyPairSync("ed25519");
const privateKeyDerBase64=keys.privateKey.export({format:"der",type:"pkcs8"}).toString("base64");
const trustedPublicKeyDerBase64=keys.publicKey.export({format:"der",type:"spki"}).toString("base64");
const commandId="169a7492-cfd8-4a56-bb57-18001b6b5968";
const checkpointResponseId="822efca2-7428-428a-ac66-548c0462438e";
const blockerResponseId="08b7b237-7a16-46d0-b79d-029d0363c112";
const workerId="openclaw-dell-chatgpt-wake-dev";
function valid():OperatorReviewSigningInput{return {
 operator:{id:7,role:"admin",status:"active",accountType:"internal",mustChangePassword:false},
 commandId,commandStatus:"PROCESSING",checkpointResponseId,blockerResponseId,workerId,
 now:new Date("2026-11-08T00:00:40.000Z"),
 commandEvidenceVerified:true,checkpointAttested:true,nativeAckVerified:true,
 blockerEvidenceVerified:true,responseSnapshotComplete:true,explicitReviewAcknowledgement:true,
 appEnv:"development",nodeEnv:"test",enabledByServer:true,
 privateKeyDerBase64,trustedPublicKeyDerBase64,
};}
describe("authenticated operator review signer is not a grant issuer",()=>{
 it("produces a self-verified 90s Ed25519 intent, no dispatch authority",()=>{
  const x=signDevOperatorReviewIntent(valid());
  expect(x).toMatchObject({signed:true,reason:"REVIEW_INTENT_SIGNED_NOT_A_GRANT",
   mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false});
  if(!x.proof)throw Error("proof missing");
  expect(x.proof.operatorId).toBe("internal:7");
  expect(x.proof.operatorRole).toBe("admin");
  expect(verifyOperatorApprovalProof({proof:x.proof,expectedCommandId:commandId,
   expectedCheckpointResponseId:checkpointResponseId,expectedBlockerResponseId:blockerResponseId,
   expectedWorkerId:workerId,now:valid().now,serverPublicKeyDerBase64:trustedPublicKeyDerBase64}).validForReview).toBe(true);
 });
 const cases:[string,Partial<OperatorReviewSigningInput>,string][]=[
  ["feature flag off",{enabledByServer:false},"DEV_SIGNER_DISABLED"],
  ["production",{nodeEnv:"production"},"DEV_SIGNER_DISABLED"],
  ["non-development APP_ENV",{appEnv:"production"},"DEV_SIGNER_DISABLED"],
  ["missing explicit operator action",{explicitReviewAcknowledgement:false},"EXPLICIT_REVIEW_ACK_REQUIRED"],
  ["terminal command",{commandStatus:"FAILED"},"PERSISTED_COMMAND_EVIDENCE_DENIED"],
  ["untrusted DB snapshot",{commandEvidenceVerified:false},"PERSISTED_COMMAND_EVIDENCE_DENIED"],
  ["truncated responses",{responseSnapshotComplete:false},"PERSISTED_COMMAND_EVIDENCE_DENIED"],
  ["checkpoint not signed",{checkpointAttested:false},"PERSISTED_COMMAND_EVIDENCE_DENIED"],
  ["native ACK missing",{nativeAckVerified:false},"PERSISTED_COMMAND_EVIDENCE_DENIED"],
  ["BLOCKER missing",{blockerEvidenceVerified:false},"PERSISTED_COMMAND_EVIDENCE_DENIED"],
  ["missing blocker ID",{blockerResponseId:null},"BOUND_IDENTITIES_INVALID"],
  ["wrong worker",{workerId:"other-worker"},"BOUND_IDENTITIES_INVALID"],
  ["missing private key",{privateKeyDerBase64:undefined},"SIGNING_KEY_NOT_CONFIGURED"],
  ["incorrect trusted public key",{trustedPublicKeyDerBase64:"Zm9v"},"SIGNING_KEY_MISMATCH"],
  ["manager role",{operator:{...valid().operator,role:"manager"}},"OPERATOR_NOT_AUTHORIZED"],
  ["suspended account",{operator:{...valid().operator,status:"suspended"}},"OPERATOR_NOT_AUTHORIZED"],
  ["password reset pending",{operator:{...valid().operator,mustChangePassword:true}},"OPERATOR_NOT_AUTHORIZED"],
 ];
 for(const [name,patch,reason] of cases)it("denies "+name,()=>{
  const x=signDevOperatorReviewIntent({...valid(),...patch});
  expect(x.signed).toBe(false);
  expect(x.reason).toBe(reason);
  expect(x.mayIssueGrant).toBe(false);
  expect(x.mayDispatchWorker).toBe(false);
 });
});
