import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import {serializeOneJobOwnerApprovalReceipt,
  projectIndependentOneJobOwnerApproval} from "./cst-team-onejob-owner-approval-receipt.mjs";

const keys=generateKeyPairSync("ed25519"),other=generateKeyPairSync("ed25519");
const pem=keys.publicKey.export({type:"spki",format:"pem"});
const pin=createHash("sha256").update(
  keys.publicKey.export({type:"spki",format:"der"})).digest("hex");
const now=new Date("2026-11-20T03:30:00.000Z");
const requestId="cst-ai-team-company1-dev:pilot-"+"a".repeat(20);
const approvalId="3cc31eae-0ef4-42be-8133-67a1ea68e2d2";
const workerName="cst-dev-dell-onejob-20261120-abcdef12";
const sourceSha="a".repeat(40);
const approvedAt="2026-11-20T03:28:00.000Z";
const expiresAt="2026-11-20T03:48:00.000Z";
const trusted={project:"xssrfshdrtdfupgqwfdw",ownerUserId:19,
  publicKeyPem:pem,publicKeySha256:pin};
const job={
  id:483,jobCode:"OLLAMA-A1B2C3D4",jobType:"ollama_model_invocation",
  requiredCapability:"ollama_inference",status:"queued",
  requestId,modelId:"qwen2.5:3b",
};
const approval={
  id:approvalId,purpose:"CST_DEV_ONEJOB_MODEL",status:"APPROVED",
  companyId:"1",modelId:"qwen2.5:3b",approvedByUserId:19,
  jobId:483,requestId,workerName,sourceSha,
  approvedAt,expiresAt,consumedAt:null,
};
const owner={id:19,role:"owner",status:"active",accountType:"internal"};
const payload={
  version:1,type:"CST_DEV_ONEJOB_OWNER_ATTESTATION",
  project:"xssrfshdrtdfupgqwfdw",purpose:"CST_DEV_ONEJOB_MODEL",
  companyId:"1",approvalId,ownerUserId:19,jobId:483,
  jobCode:"OLLAMA-A1B2C3D4",requestId,
  modelId:"qwen2.5:3b",workerName,sourceSha,
  approvedAt,expiresAt,authChallengeSha256:"e".repeat(64),
  nonce:"f".repeat(64),
};
const envelope=(p=payload,key=keys.privateKey)=>({
 payload:p,
 signatureBase64:sign(null,serializeOneJobOwnerApprovalReceipt(p),key).toString("base64")
});
const good={approval,job,owner,receipt:envelope()};
const verdict=(input=good,key=trusted,time=now)=>
  projectIndependentOneJobOwnerApproval(input,key,time);
function reject(changes,reason,trustedKey=trusted,time=now) {
 const x=verdict(changes,trustedKey,time);
 assert.equal(x.signedApprovalLineageConsistent,false,JSON.stringify(x));
 assert.ok(x.blockers.includes(reason),JSON.stringify(x.blockers));
 assert.equal(x.independentOwnerApprovalAttested,false);
 assert.equal(x.pilotAdmissionReady,false);
 assert.equal(x.sideEffects,"NONE");
}
const tamper=fn=>{const x=structuredClone(good);fn(x);return x};

test("independently pinned valid signature is lineage ONLY, never a verified Owner session",()=>{
 const result=verdict();
 assert.deepEqual(result.blockers,[]);
 assert.equal(result.signedApprovalLineageConsistent,true);
 assert.equal(result.ownerSessionAuthenticatorDeployed,false);
 assert.equal(result.ownerAuthenticatedSessionVerified,false);
 assert.equal(result.independentOwnerApprovalAttested,false);
 assert.equal(result.pilotAdmissionReady,false);
 assert.equal(result.subscriberDeliveryVerified,false);
 assert.equal(result.independentFinalAckVerified,false);
});

test("Owner ID in database alone is NOT proof of actual Owner consent",()=>{
 const unlabeled={approval,job,owner};
 reject(unlabeled,"SIGNED_APPROVAL_DB_JOB_LINEAGE_MISMATCH");
 reject(unlabeled,"INDEPENDENT_OWNER_SIGNATURE_NOT_VERIFIED");
 reject({...good,owner:{...owner,role:"super_admin"}},"OWNER_ACCOUNT_CATALOG_NOT_MATCHED");
 reject({...good,owner:{...owner,status:"inactive"}},"OWNER_ACCOUNT_CATALOG_NOT_MATCHED");
 reject({...good,owner:{...owner,id:20}},"OWNER_ACCOUNT_CATALOG_NOT_MATCHED");
});

test("wrong company, DB job, worker or historic #482 must fail",()=>{
 reject(tamper(x=>x.job.id=482),"FRESH_QUEUED_MODEL_JOB_NOT_VERIFIED");
 reject(tamper(x=>x.job.status="completed"),"FRESH_QUEUED_MODEL_JOB_NOT_VERIFIED");
 reject(tamper(x=>x.job.requestId="cst-ai-team-company3-dev:pilot-"+"a".repeat(20)),"FRESH_QUEUED_MODEL_JOB_NOT_VERIFIED");
 reject(tamper(x=>x.approval.companyId="3"),"PERSISTED_APPROVAL_ROW_SCOPE_INVALID");
 reject(tamper(x=>x.approval.workerName="cst-dev-dell-onejob-20261120-deadbeef"),"SIGNED_APPROVAL_DB_JOB_LINEAGE_MISMATCH");
 reject(tamper(x=>x.approval.sourceSha="b".repeat(40)),"SIGNED_APPROVAL_DB_JOB_LINEAGE_MISMATCH");
 reject(tamper(x=>x.approval.consumedAt="2026-11-20T03:29:00.000Z"),"PERSISTED_APPROVAL_ROW_SCOPE_INVALID");
});

test("Owner consent signature cannot be forged or use self-declared public key",()=>{
 const forged={...good,receipt:envelope(payload,other.privateKey)};
 reject(forged,"INDEPENDENT_OWNER_SIGNATURE_NOT_VERIFIED");
 reject(good,"INDEPENDENT_OWNER_TRUST_ROOT_NOT_PINNED",
   {...trusted,publicKeySha256:"f".repeat(64)});
 reject(good,"INDEPENDENT_OWNER_TRUST_ROOT_NOT_PINNED",
   {...trusted,publicKeyPem:other.publicKey.export({type:"spki",format:"pem"})});
 reject(good,"INDEPENDENT_OWNER_TRUST_ROOT_NOT_PINNED",
   {...trusted,ownerUserId:999});
 reject(tamper(x=>x.receipt.payload.publicKeyPem=pem),"INDEPENDENT_OWNER_SIGNATURE_NOT_VERIFIED");
});

test("receipt must cryptographically bind owner, request, worker, source and job",()=>{
 for(const [field,value] of [
  ["project","nzdweipzckfszczzqtuw"],["ownerUserId",20],
  ["jobId",484],["jobCode","OLLAMA-DEADBEEF"],["companyId","3"],
  ["requestId","cst-ai-team-company1-dev:pilot-"+"b".repeat(20)],
  ["sourceSha","b".repeat(40)],
  ["workerName","cst-dev-dell-onejob-20261120-deadbeef"],
 ]) reject(tamper(x=>x.receipt.payload[field]=value),"SIGNED_APPROVAL_DB_JOB_LINEAGE_MISMATCH");
});

test("approval TTL, future clock, replay, missing/extended expiry fail closed",()=>{
 reject(good,"APPROVAL_EXPIRED_OR_REPLAYED",trusted,new Date("2026-11-20T04:00:00.000Z"));
 reject(good,"APPROVAL_EXPIRED_OR_REPLAYED",trusted,new Date("2026-11-20T03:00:00.000Z"));
 reject(tamper(x=>x.approval.expiresAt="2026-11-20T04:30:00.000Z"),"APPROVAL_EXPIRED_OR_REPLAYED");
 reject(tamper(x=>x.approval.approvedAt="2026-11-20T03:50:00.000Z"),"APPROVAL_EXPIRED_OR_REPLAYED");
 reject(tamper(x=>x.receipt.payload.nonce="BAD"),"INDEPENDENT_OWNER_SIGNATURE_NOT_VERIFIED");
});

test("fixed field serialization ignores object insertion order, rejects extra auth claims",()=>{
 const reordered=Object.fromEntries(Object.entries(payload).reverse());
 assert.deepEqual(serializeOneJobOwnerApprovalReceipt(payload),
   serializeOneJobOwnerApprovalReceipt(reordered));
 for(const field of ["verifiedOwner","authToken","password","role","bypassrls"]){
  const changed=tamper(x=>x.receipt.payload[field]=true);
  reject(changed,"INDEPENDENT_OWNER_SIGNATURE_NOT_VERIFIED");
 }
});

test("verifier has no network, SQL, signing or independent authority side effects",()=>{
 const source=readFileSync(new URL("./cst-team-onejob-owner-approval-receipt.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/node:child_process|@workspace\/db|node:net|node:http/);
 assert.doesNotMatch(source,/\bfetch\(|\bconnect\(|\bspawn\(|\bexecFile\(/);
 assert.doesNotMatch(source,/\b(?:INSERT INTO|DELETE FROM|UPDATE ai_platform)\b/i);
 assert.match(source,/ownerAuthenticatedSessionVerified:false/);
 assert.match(source,/independentOwnerApprovalAttested:false/);
 assert.match(source,/pilotAdmissionReady:false/);
});
