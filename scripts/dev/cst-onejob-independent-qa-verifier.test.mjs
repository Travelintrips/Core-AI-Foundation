import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,createHash,createPublicKey} from "node:crypto";
import {readFileSync} from "node:fs";
import {qaCanonicalBytes,reviewSignedIndependentQaReceipt,QA_DOMAIN}
 from "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const {privateKey:forgedPrivate}=generateKeyPairSync("ed25519");
const pem=publicKey.export({type:"spki",format:"pem"}).toString();
const fingerprint=createHash("sha256").update(publicKey.export({type:"spki",format:"der"})).digest("hex");
const sha="a".repeat(40),imageId="sha256:"+"f".repeat(64);
const claims={
 domain:QA_DOMAIN,stage:"PRE_ADMISSION",project:"xssrfshdrtdfupgqwfdw",companyId:"1",
 approvalId:"123e4567-e89b-12d3-a456-426614174000",jobId:483,
 requestId:"cst-ai-team-company1-dev:pilot-"+"b".repeat(20),
 workerName:"cst-dev-dell-onejob-20261119-abcdef12",
 sourceSha:sha,imageId,verifierId:"cst-independent-qa-disposableonly",
 nonce:"c".repeat(64),verifiedAt:"2026-11-19T17:00:00.000Z",
 expiresAt:"2026-11-19T17:04:00.000Z",evidenceDigest:"d".repeat(64)
};
const expected={
 project:claims.project,approvalId:claims.approvalId,jobId:483,
 requestId:claims.requestId,workerName:claims.workerName,sourceSha:sha,
 imageId,stage:"PRE_ADMISSION",verifierId:claims.verifierId,
 publicKeyPem:pem,trustedFingerprint:fingerprint,
 nowIso:"2026-11-19T17:02:00.000Z",
};
function receipt(c=claims,key=privateKey){
 return {claims:c,signatureBase64:sign(null,qaCanonicalBytes(c),key).toString("base64"),
   publicKeyFingerprint:fingerprint};
}
function deny(c,e,reason){
 const result=reviewSignedIndependentQaReceipt(c,e);
 assert.equal(result.status,"DENIED",JSON.stringify(result));
 assert.ok(result.failures.includes(reason),JSON.stringify(result));
 assert.equal(result.dispatchPermitted,false);
 assert.equal(result.finalAckVerified,false);
}
test("valid synthetic Ed25519 receipt is cryptographic binding, NOT authority",()=>{
 const r=reviewSignedIndependentQaReceipt(receipt(),expected);
 assert.equal(r.status,"CRYPTOGRAPHIC_BINDING_VALID");
 assert.deepEqual(r.failures,[]);
 assert.equal(r.dispatchPermitted,false);
 assert.equal(r.queueTransitionAuthorized,false);
 assert.equal(r.finalAckVerified,false);
});
test("reject bad signature, foreign key, tampering and wrong verifier",()=>{
 deny(receipt({...claims,jobId:484}),expected,"APPROVAL_OR_JOB_MISMATCH");
 deny(receipt({...claims,project:"nzdweipzckfszczzqtuw"}),expected,"WRONG_DEV_PROJECT_OR_COMPANY");
 deny(receipt({...claims,stage:"POST_EXECUTION"}),expected,"WRONG_DOMAIN_OR_STAGE");
 deny(receipt({...claims,workerName:"bad-worker"}),expected,"REQUEST_OR_WORKER_MISMATCH");
 deny(receipt({...claims,sourceSha:"e".repeat(40)}),expected,"IMAGE_SOURCE_MISMATCH");
 deny(receipt({...claims,evidenceDigest:"bad"}),expected,"NONCE_OR_EVIDENCE_DIGEST_INVALID");
 deny(receipt({...claims,verifierId:"openclaw-worker"}),expected,"UNTRUSTED_VERIFIER_ID");
 deny(receipt({...claims,extra:"hidden"}),expected,"CANONICAL_CLAIMS_SHAPE_INVALID");
 deny(receipt(claims,forgedPrivate),expected,"SIGNATURE_NOT_VERIFIED");
 deny({...receipt(),signatureBase64:"AA=="},expected,"SIGNATURE_NOT_VERIFIED");
 deny({...receipt(),publicKeyFingerprint:"e".repeat(64)},expected,"UNTRUSTED_PUBLIC_KEY_FINGERPRINT");
});
test("reject expired receipts, oversize TTL, reused historical job and mismatched stage",()=>{
 deny(receipt(),{...expected,nowIso:"2026-11-19T17:05:00.000Z"},"RECEIPT_EXPIRED_OR_UNBOUNDED");
 deny(receipt({...claims,expiresAt:"2026-11-19T17:07:00.000Z"}),expected,"RECEIPT_EXPIRED_OR_UNBOUNDED");
 deny(receipt({...claims,jobId:482}),{...expected,jobId:482},"APPROVAL_OR_JOB_MISMATCH");
 deny(receipt(),{...expected,stage:"POST_EXECUTION"},"WRONG_DOMAIN_OR_STAGE");
});
test("verifier has no signer private key, DB mutation, HTTP route or dispatch",()=>{
 const s=readFileSync(new URL("../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts",import.meta.url),"utf8");
 assert.match(s,/createPublicKey/);
 assert.match(s,/verify\(null/);
 assert.doesNotMatch(s,/generateKeyPairSync|createPrivateKey|INSERT INTO|UPDATE ai_platform|CREATE ROLE|router\.post|fetch\(|sign\(null/);
});
