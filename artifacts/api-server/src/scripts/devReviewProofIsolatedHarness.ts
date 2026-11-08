/**
 * Disposable test-only Ed25519 signing/verifier handoff.
 * NEVER USE IN A RUNNING API OR AS A TRUSTED WRITER.
 * All keys are ephemeral. Only emits a nonce AFTER the actual proof verifier
 * has accepted a command-bound proof. No credentials or SQL are handled here.
 */
import {generateKeyPairSync,randomBytes,sign} from "node:crypto";
import {operatorApprovalProofPayload,verifyOperatorApprovalProof,type OperatorApprovalProof}
 from "../services/jobLifecycleOperatorApprovalProof.js";

const mode=process.argv[2];
if(mode!=="valid"&&mode!=="tampered"&&mode!=="expired"){
  process.stderr.write("INVALID_TEST_MODE\n");process.exit(2);
}
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const now=new Date();
const proofBase:Omit<OperatorApprovalProof,"signatureBase64">={
 version:1,action:"gpt02.resume.grant.review",
 commandId:"169a7492-cfd8-4a56-bb57-18001b6b5968",
 checkpointResponseId:"822efca2-7428-428a-ac66-548c0462438e",
 blockerResponseId:"08b7b237-7a16-46d0-b79d-029d0363c112",
 workerId:"openclaw-dell-chatgpt-wake-dev",
 operatorId:"internal:7",operatorRole:"admin",
 issuedAt:new Date(now.getTime()-1_000).toISOString(),
 expiresAt:new Date(now.getTime()+60_000).toISOString(),
 nonce:randomBytes(32).toString("hex"),
};
const proof:OperatorApprovalProof={
 ...proofBase,
 signatureBase64:sign(null,Buffer.from(operatorApprovalProofPayload(proofBase)),privateKey).toString("base64"),
};
if(mode==="tampered") proof.blockerResponseId="70c61ea0-8524-4fba-9da5-a88b2467a6a7";
const verified=verifyOperatorApprovalProof({
 proof,expectedCommandId:proofBase.commandId,
 expectedCheckpointResponseId:proofBase.checkpointResponseId,
 expectedBlockerResponseId:proofBase.blockerResponseId,
 expectedWorkerId:proofBase.workerId,
 now:mode==="expired"?new Date(now.getTime()+61_000):now,
 serverPublicKeyDerBase64:publicKey.export({format:"der",type:"spki"}).toString("base64"),
});
if(!verified.validForReview){
 process.stderr.write("PROOF_DENIED:"+verified.reason+"\n");process.exit(3);
}
if(mode!=="valid"){process.stderr.write("UNEXPECTED_PROOF_ACCEPTANCE\n");process.exit(4);}
process.stdout.write(Buffer.from(JSON.stringify(proof),"utf8").toString("base64")+"\n");
