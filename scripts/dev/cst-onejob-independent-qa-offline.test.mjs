import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,createHash} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {qaCanonicalBytes,QA_DOMAIN} from "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
import {assessIndependentQaOffline} from "./cst-onejob-independent-qa-offline.mjs";

const keys=generateKeyPairSync("ed25519"),wrong=generateKeyPairSync("ed25519");
const publicKeyPem=keys.publicKey.export({format:"pem",type:"spki"}).toString();
const fingerprint=createHash("sha256").update(keys.publicKey.export({format:"der",type:"spki"})).digest("hex");
const verifierId="cst-independent-qa-testonly01",sourceSha="a".repeat(40),imageId="sha256:"+"f".repeat(64);
const claims={domain:QA_DOMAIN,stage:"PRE_ADMISSION",project:"xssrfshdrtdfupgqwfdw",
 companyId:"1",approvalId:"123e4567-e89b-12d3-a456-426614174000",
 jobId:483,requestId:"cst-ai-team-company1-dev:pilot-"+"b".repeat(20),
 workerName:"cst-dev-dell-onejob-20261119-abcdef12",
 sourceSha,imageId,verifierId,nonce:"c".repeat(64),
 verifiedAt:"2026-11-19T17:00:00.000Z",
 expiresAt:"2026-11-19T17:04:00.000Z",evidenceDigest:"d".repeat(64)};
const expected={project:claims.project,approvalId:claims.approvalId,
 jobId:claims.jobId,requestId:claims.requestId,workerName:claims.workerName,
 sourceSha,imageId,verifierId,stage:"PRE_ADMISSION",
 nowIso:"2026-11-19T17:02:00.000Z"};
const trust={use:"CST_DEV_ONEJOB_QA_PUBLIC_PIN",project:claims.project,verifierId,
 publicKeyPem,fingerprint};
const receipt={claims,signatureBase64:sign(null,qaCanonicalBytes(claims),keys.privateKey).toString("base64"),
 publicKeyFingerprint:fingerprint};
function deny(r,e,t,code){
 const x=assessIndependentQaOffline(r,e,t);
 assert.equal(x.status,"DENIED",JSON.stringify(x));
 assert.ok(x.reasons.includes(code),JSON.stringify(x));
 assert.equal(x.dispatchPermitted,false);
}
test("offline verifier uses pinned public key, returns integrity but never queue/ACK",()=>{
 const result=assessIndependentQaOffline(receipt,expected,trust);
 assert.equal(result.status,"CRYPTOGRAPHIC_BINDING_VALID");
 assert.equal(result.dispatchPermitted,false);
 assert.equal(result.queueTransitionAuthorized,false);
 assert.equal(result.finalAckVerified,false);
});
test("wrong trust pin, injected trust in expected, counterfeit proof all denied",()=>{
 deny(receipt,expected,{...trust,verifierId:"cst-independent-qa-wrong000"},"PUBLIC_TRUST_MANIFEST_INVALID");
 deny(receipt,{...expected,publicKeyPem},trust,"EXPECTED_CANNOT_OVERRIDE_TRUST_ROOT");
 deny(receipt,{...expected,trustedFingerprint:fingerprint},trust,"EXPECTED_CANNOT_OVERRIDE_TRUST_ROOT");
 const wrongPin={...trust,publicKeyPem:wrong.publicKey.export({format:"pem",type:"spki"}).toString()};
 deny(receipt,expected,wrongPin,"PINNED_KEY_NOT_ED25519_OR_FINGERPRINT_MISMATCH");
 deny({...receipt,claims:{...claims,jobId:484}},expected,trust,"APPROVAL_OR_JOB_MISMATCH");
 deny(receipt,{...expected,nowIso:"2026-11-19T17:05:00.000Z"},trust,"RECEIPT_EXPIRED_OR_UNBOUNDED");
 deny(receipt,{...expected,project:"nzdweipzckfszczzqtuw"},trust,"EXPECTED_PROJECT_OR_STAGE_INVALID");
});
test("separate QA CLI runs without credentials, files fail closed",()=>{
 const dir=mkdtempSync(join(tmpdir(),"cst-onejob-qa-"));
 try{
   for(const [name,obj] of [["receipt.json",receipt],["expected.json",expected],["trusted.json",trust]]){
     writeFileSync(join(dir,name),JSON.stringify(obj),{mode:0o600});
   }
   const cmd=join(process.cwd(),"scripts/dev/cst-onejob-independent-qa-offline.mjs");
   const run=(receiptPath)=>spawnSync(process.execPath,["--experimental-strip-types",cmd,
      receiptPath,join(dir,"expected.json"),join(dir,"trusted.json")],
      {cwd:process.cwd(),encoding:"utf8",env:{PATH:process.env.PATH,HOME:dir},timeout:10000});
   const ok=run(join(dir,"receipt.json"));
   assert.equal(ok.status,0,ok.stderr+" "+ok.stdout);
   assert.equal(JSON.parse(ok.stdout).status,"CRYPTOGRAPHIC_BINDING_VALID");
   assert.equal(JSON.parse(ok.stdout).dispatchPermitted,false);
   const bad=run(join(dir,"missing.json"));
   assert.equal(bad.status,2);
   assert.equal(JSON.parse(bad.stdout).status,"DENIED");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
