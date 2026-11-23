import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  qaCanonicalBytes,QA_DOMAIN
} from "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
import {
  reviewOneJobSignedHandoff
} from "./cst-onejob-signed-handoff-review.ts";

const trusted=generateKeyPairSync("ed25519");
const forged=generateKeyPairSync("ed25519");
const evidence=Buffer.from("isolated-QA-independent-evidence-fixture-v1","utf8");
const sha="a".repeat(40),image="sha256:"+"f".repeat(64);
const pub=trusted.publicKey.export({type:"spki",format:"pem"}).toString();
const fingerprint=createHash("sha256").update(
  trusted.publicKey.export({type:"spki",format:"der"})).digest("hex");
const project="xssrfshdrtdfupgqwfdw";
const id="123e4567-e89b-12d3-a456-426614174000";
const requestId="cst-ai-team-company1-dev:pilot-"+"b".repeat(20);
const workerName="cst-dev-dell-onejob-20261119-abcdef12";
const verifierId="cst-independent-qa-disposableonly";
const now=Date.now(), iso=(ms)=>new Date(ms).toISOString();
const claims={
  domain:QA_DOMAIN,stage:"PRE_ADMISSION",project,companyId:"1",
  approvalId:id,jobId:483,requestId,workerName,sourceSha:sha,
  imageId:image,verifierId,nonce:"c".repeat(64),
  verifiedAt:iso(now-60_000),expiresAt:iso(now+180_000),
  evidenceDigest:createHash("sha256").update(evidence).digest("hex"),
};
const publicKey={project,verifierId,publicKeyPem:pub,fingerprint};
const signReceipt=(c=claims,key=trusted.privateKey)=>({
  claims:c,signatureBase64:sign(null,qaCanonicalBytes(c),key).toString("base64"),
  publicKeyFingerprint:fingerprint,
});
const approval={
  id,jobId:483,approvedByUserId:1,status:"APPROVED",
  purpose:"CST_DEV_ONEJOB_MODEL",companyId:"1",modelId:"qwen2.5:3b",
  requestId,workerName,sourceSha:sha,
  approvedAt:iso(now-120_000),expiresAt:iso(now+18*60_000),
  consumedAt:null,
};
const job={
  id:483,status:"waiting",jobType:"ollama_model_invocation",
  requiredCapability:"ollama_inference",modelId:"qwen2.5:3b",
  requestId,maxRetry:0,
};
const receiptRow={
  approvalId:id,jobId:483,companyId:"1",requestId,
  workerName,imageSourceSha:sha,imageId:image,verifierId,
  nonce:claims.nonce,
  proofDigest:createHash("sha256").update(qaCanonicalBytes(claims)).digest("hex"),
  verifiedAt:claims.verifiedAt,expiresAt:claims.expiresAt,consumedAt:null,
};
const baseline={approval,job,receiptRow,
  signedReceipt:signReceipt(),qaPublicKey:publicKey,
  independentlyCapturedEvidence:evidence};
function denied(patch,expectedBlocker) {
  const result=reviewOneJobSignedHandoff({...baseline,...patch});
  assert.equal(result.status,"DENIED",JSON.stringify(result));
  assert.ok(result.blockers.includes(expectedBlocker),JSON.stringify(result));
  assert.equal(result.queueTransitionAuthorized,false);
  assert.equal(result.dispatchPermitted,false);
  assert.equal(result.finalAckVerified,false);
}
test("synthetic signature + locked row + independently rehashed evidence match, STILL NO AUTHORITY",()=>{
 const result=reviewOneJobSignedHandoff(baseline);
 assert.equal(result.status,"BOUND_CRYPTO_REVIEW_ONLY",JSON.stringify(result));
 assert.equal(result.cryptographicStatus,"CRYPTOGRAPHIC_BINDING_VALID");
 assert.deepEqual(result.blockers,[]);
 assert.equal(result.queueTransitionAuthorized,false);
 assert.equal(result.dispatchPermitted,false);
 assert.equal(result.finalAckVerified,false);
});
test("forged, wrong-stage, wrong-project, stale QA proof do not authorize",()=>{
 denied({signedReceipt:signReceipt(claims,forged.privateKey)},
   "INDEPENDENT_QA_SIGNATURE_NOT_VALID");
 denied({signedReceipt:signReceipt({...claims,stage:"POST_EXECUTION"})},
   "INDEPENDENT_QA_SIGNATURE_NOT_VALID");
 denied({signedReceipt:signReceipt({...claims,project:"nzdweipzckfszczzqtuw"})},
   "INDEPENDENT_QA_SIGNATURE_NOT_VALID");
 denied({signedReceipt:signReceipt({...claims,expiresAt:iso(now-1_000)})},
   "INDEPENDENT_QA_SIGNATURE_NOT_VALID");
 denied({qaPublicKey:{...publicKey,verifierId:"bad-verifier"}},
   "QA_TRUST_PROJECT_OR_VERIFIER_INVALID");
});
test("locked approval, waiting job, model, worker and SHA are immutable scope",()=>{
 denied({approval:{...approval,jobId:484}},
   "WAITING_JOB_NOT_BOUND_TO_APPROVAL");
 denied({approval:{...approval,companyId:"3"}},
   "OWNER_APPROVAL_NOT_ACTIVE_OR_SCOPED");
 denied({approval:{...approval,status:"EXPIRED"}},
   "OWNER_APPROVAL_NOT_ACTIVE_OR_SCOPED");
 denied({approval:{...approval,expiresAt:iso(now-1_000)}},
   "OWNER_APPROVAL_EXPIRED");
 denied({job:{...job,status:"queued"}},
   "WAITING_JOB_NOT_BOUND_TO_APPROVAL");
 denied({job:{...job,id:482}},
   "WAITING_JOB_NOT_BOUND_TO_APPROVAL");
 denied({job:{...job,modelId:"qwen2.5:72b"}},
   "WAITING_JOB_NOT_BOUND_TO_APPROVAL");
 denied({receiptRow:{...receiptRow,workerName:"cst-dev-dell-onejob-20261119-deadbeef"}},
   "PERSISTED_RECEIPT_SCOPE_MISMATCH_OR_CONSUMED");
 denied({receiptRow:{...receiptRow,imageSourceSha:"e".repeat(40)}},
   "PERSISTED_RECEIPT_SCOPE_MISMATCH_OR_CONSUMED");
});
test("replay, wrong nonce, wrong canonical proof digest, invalid evidence bytes denied",()=>{
 denied({receiptRow:{...receiptRow,consumedAt:iso(now-2_000)}},
   "PERSISTED_RECEIPT_SCOPE_MISMATCH_OR_CONSUMED");
 denied({receiptRow:{...receiptRow,nonce:"d".repeat(64)}},
   "SIGNED_RECEIPT_NOT_BOUND_TO_PERSISTED_NONCE_AND_DIGEST");
 denied({receiptRow:{...receiptRow,proofDigest:"e".repeat(64)}},
   "SIGNED_RECEIPT_NOT_BOUND_TO_PERSISTED_NONCE_AND_DIGEST");
 denied({receiptRow:{...receiptRow,verifiedAt:iso(now-2_000)}},
   "SIGNED_RECEIPT_NOT_BOUND_TO_PERSISTED_NONCE_AND_DIGEST");
 denied({independentlyCapturedEvidence:Buffer.from("changed-by-worker")},
   "INDEPENDENT_EVIDENCE_BYTES_DIGEST_MISMATCH");
 denied({independentlyCapturedEvidence:Buffer.alloc(0)},
   "INDEPENDENT_EVIDENCE_BYTES_DIGEST_MISMATCH");
 denied({independentlyCapturedEvidence:Buffer.alloc(65*1024)},
   "INDEPENDENT_EVIDENCE_BYTES_DIGEST_MISMATCH");
});
test("review requires authoritative data, never changes the DB or mints a queue permit",()=>{
 denied({receiptRow:null},"LOCKED_DB_AND_RECEIPT_EVIDENCE_REQUIRED");
 denied({approval:null},"LOCKED_DB_AND_RECEIPT_EVIDENCE_REQUIRED");
 denied({job:null},"LOCKED_DB_AND_RECEIPT_EVIDENCE_REQUIRED");
 const s=readFileSync(new URL("./cst-onejob-signed-handoff-review.ts",import.meta.url),"utf8");
 assert.match(s,/new Date\(now\)\.toISOString\(\)/);
 assert.match(s,/independentlyCapturedEvidence/);
 assert.match(s,/queueTransitionAuthorized:false/);
 assert.doesNotMatch(s,/\bINSERT INTO\b|\bUPDATE ai_platform\b|\bCREATE ROLE\b|\bSET ROLE\b|\bfetch\(/);
});
