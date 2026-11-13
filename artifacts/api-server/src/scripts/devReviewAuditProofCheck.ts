/** Ephemeral test-only independently re-checks persisted audit Ed25519. */
import {verifyOperatorApprovalProof} from "../services/jobLifecycleOperatorApprovalProof.js";
const publicKey=process.argv[2];
const proofEncoded=process.argv[3];
if(!publicKey||!proofEncoded||!/^[-_+/=a-zA-Z0-9]+$/.test(proofEncoded))process.exit(2);
try{
 const p=JSON.parse(Buffer.from(proofEncoded,"base64").toString("utf8"));
 const verified=verifyOperatorApprovalProof({
  proof:p,expectedCommandId:"169a7492-cfd8-4a56-bb57-18001b6b5968",
  expectedCheckpointResponseId:"822efca2-7428-428a-ac66-548c0462438e",
  expectedBlockerResponseId:"08b7b237-7a16-46d0-b79d-029d0363c112",
  expectedWorkerId:"openclaw-dell-chatgpt-wake-dev",now:new Date(),
  serverPublicKeyDerBase64:publicKey,
 });
 if(!verified.validForReview)process.exit(3);
 process.stdout.write("PERSISTED_AUDIT_ED25519_VERIFIED_PASS\n");
}catch{process.exit(4);}
