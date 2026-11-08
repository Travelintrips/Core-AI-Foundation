/**
 * Disposable test-only Ed25519 signing/verifier handoff.
 * NEVER USE IN A RUNNING API OR AS A TRUSTED WRITER.
 * All keys are ephemeral. Only emits a nonce AFTER the actual proof verifier
 * has accepted a command-bound proof. No credentials or SQL are handled here.
 */
import {generateKeyPairSync,randomBytes,sign} from "node:crypto";
import {execFileSync} from "node:child_process";
import {createIsolatedDevReviewWriterContract} from "../services/jobLifecycleReviewWriterServiceContract.js";
import {operatorApprovalProofPayload,verifyOperatorApprovalProof,type OperatorApprovalProof}
 from "../services/jobLifecycleOperatorApprovalProof.js";

const mode=process.argv[2];
const isContractMode=mode?.startsWith("contract-")??false;
const variant=isContractMode?mode!.slice("contract-".length):mode;
if(variant!=="valid"&&variant!=="tampered"&&variant!=="expired"){
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
if(variant==="tampered") proof.blockerResponseId="70c61ea0-8524-4fba-9da5-a88b2467a6a7";
if(isContractMode){
 const container=process.argv[3];
 if(!container||!/^[a-zA-Z0-9_-]{6,80}$/.test(container)){
  process.stderr.write("INVALID_SYNTHETIC_CONTAINER\n");process.exit(2);
 }
 let adapterCalls=0;
 const contract=createIsolatedDevReviewWriterContract({
  appEnv:"development",nodeEnv:"test",
  publicKeyDerBase64:publicKey.export({format:"der",type:"spki"}).toString("base64"),
  now:()=>variant==="expired"?new Date(now.getTime()+61_000):now,
  verifiedWriterAdapter:async verifiedProof=>{
   adapterCalls++;
   const serialized=Buffer.from(JSON.stringify(verifiedProof),"utf8").toString("base64");
   if(!/^[a-zA-Z0-9+/=]+$/.test(serialized))throw new Error("INVALID_PROOF_ENCODING");
   // The harness is local test code, not an API. The request includes no SQL.
   const sql="SET ROLE verified_service; SELECT isolated.try_append(1,7,10,11,convert_from(decode('"+
    serialized+"','base64'),'UTF8')::jsonb)";
   const result=execFileSync("docker",["exec",container,"psql","-U","postgres","-qAt","-v","ON_ERROR_STOP=1","-c",sql],
     {encoding:"utf8",timeout:15_000});
   return result.trim().split("\n").at(-1)==="t";
  },
 });
 const response=await contract({proof});
 if(variant==="valid"){
  if(!response.recorded||adapterCalls!==1){
   process.stderr.write("ISOLATED_CONTRACT_VALID_FAILED:"+response.reason+"\n");process.exit(5);
  }
  process.stdout.write("CONTRACT_TO_REAL_ISOLATED_POSTGRES_PASS\n");
 }else{
  if(response.recorded||adapterCalls!==0){
   process.stderr.write("ISOLATED_CONTRACT_REJECTION_FAILED\n");process.exit(6);
  }
  process.stdout.write("CONTRACT_"+variant.toUpperCase()+"_PRE_SQL_DENIED_PASS\n");
 }
 process.exit(0);
}
const verified=verifyOperatorApprovalProof({
 proof,expectedCommandId:proofBase.commandId,
 expectedCheckpointResponseId:proofBase.checkpointResponseId,
 expectedBlockerResponseId:proofBase.blockerResponseId,
 expectedWorkerId:proofBase.workerId,
 now:variant==="expired"?new Date(now.getTime()+61_000):now,
 serverPublicKeyDerBase64:publicKey.export({format:"der",type:"spki"}).toString("base64"),
});
if(!verified.validForReview){
 process.stderr.write("PROOF_DENIED:"+verified.reason+"\n");process.exit(3);
}
if(variant!=="valid"){process.stderr.write("UNEXPECTED_PROOF_ACCEPTANCE\n");process.exit(4);}
process.stdout.write(Buffer.from(JSON.stringify(proof),"utf8").toString("base64")+"\n");
