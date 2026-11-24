import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {verifyOneJobPreapproval,readIndependentlySignedPreapproval} from
 "../../artifacts/api-server/src/lib/cstOneJobPreapprovalReadiness.ts";

const h=b=>createHash("sha256").update(b).digest("hex");
const keys=generateKeyPairSync("ed25519");
const root={
 use:"CST_DEV_ONEJOB_QA_PUBLIC_PIN",project:"xssrfshdrtdfupgqwfdw",
 verifierId:"cst-independent-qa-readiness-20261120",
 publicKeyPem:keys.publicKey.export({type:"spki",format:"pem"}),
 fingerprint:h(keys.publicKey.export({type:"spki",format:"der"})),
};
const expected={sourceSha:"a".repeat(40),workerName:"cst-dev-dell-onejob-20261120-abcdef12"};
const now=new Date("2026-11-20T06:00:00.000Z");
const claims=Object.freeze({
 version:1,purpose:"CST_DEV_ONEJOB_ONE_OWNER_PREPARED",
 project:"xssrfshdrtdfupgqwfdw",companyId:"1",
 sourceSha:expected.sourceSha,workerName:expected.workerName,
 imageDigest:"sha256:"+"b".repeat(64),
 brokerAclVerified:true,dedicatedTransportVerified:true,subscriberArmed:true,
 independentAgentsReachable:true,finalAckIssuerArmed:true,
 operatorChangeId:"CST-DEV-ONEJOB-20261120",nonce:"c".repeat(64),
 issuedAt:"2026-11-20T05:58:00.000Z",expiresAt:"2026-11-20T06:03:00.000Z",
 verifierId:root.verifierId
});
const domain="CST_DEV_ONEJOB_PRE_OWNER_READINESS_V1\n";
const signed=(value=claims,key=keys.privateKey)=>({
 claims:value,signatureBase64:sign(null,Buffer.from(domain+JSON.stringify(value)),key).toString("base64")
});
function deny(envelope,trust=root,scope=expected,at=now){
 const x=verifyOneJobPreapproval(envelope,trust,scope,at);
 assert.equal(x.verified,false,JSON.stringify(x));
 assert.equal(x.queueTransitionAuthorized,false);
 assert.equal(x.dispatchPermitted,false);
 assert.equal(x.ownerConsentRecorded,false);
}
test("separate pinned Ed25519 root validates one fresh pre-Owner receipt but grants no job authority",()=>{
 const x=verifyOneJobPreapproval(signed(),root,expected,now);
 assert.equal(x.verified,true,JSON.stringify(x));
 assert.equal(x.ownerConsentRecorded,false);
 assert.equal(x.queueTransitionAuthorized,false);
 assert.equal(x.dispatchPermitted,false);
 assert.equal(x.finalAckVerified,false);
});
test("wrong project, worker, source, expiry, and extra fields deny the one-click readiness",()=>{
 for(const change of [
  {project:"nzdweipzckfszczzqtuw"},{companyId:"3"},
  {sourceSha:"f".repeat(40)},{workerName:"unexpected-worker"},
  {brokerAclVerified:false},{subscriberArmed:false},
  {independentAgentsReachable:false},{finalAckIssuerArmed:false},
  {dedicatedTransportVerified:false},{nonce:"0".repeat(63)},
  {expiresAt:"2026-11-20T07:00:00.000Z"},{unexpected:true}
 ])deny(signed({...claims,...change}));
 deny(signed(),root,{...expected,sourceSha:"e".repeat(40)});
 deny(signed(),root,expected,new Date("2026-11-20T06:03:00.000Z"));
});
test("forged public key, signature, trust fingerprint and envelope are rejected",()=>{
 const other=generateKeyPairSync("ed25519");
 deny(signed(claims,other.privateKey));
 deny(signed(),{...root,fingerprint:"d".repeat(64)});
 deny({...signed(),signatureBase64:"A".repeat(86)+"=="});
 deny({...signed(),publicKeyPem:root.publicKeyPem});
 deny({claims,signatureBase64:"not-base64"});
});
test("missing real custody fails closed; no credentials or release side effects",()=>{
 const x=readIndependentlySignedPreapproval(expected);
 assert.equal(x.verified,false);
 assert.equal(x.dispatchPermitted,false);
 const code=readFileSync(new URL("../../artifacts/api-server/src/lib/cstOneJobPreapprovalReadiness.ts",import.meta.url),"utf8");
 assert.match(code,/O_NOFOLLOW/);
 assert.match(code,/rootOwnedJson/);
 assert.doesNotMatch(code,/CREATE ROLE|UPDATE ai_platform|INSERT INTO|DELETE FROM|service_role/);
});
