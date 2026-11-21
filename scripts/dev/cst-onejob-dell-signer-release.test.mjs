import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {
  PROJECT, canonicalReleaseBytes, reviewCstDevDellSignerRelease
} from "./cst-onejob-dell-signer-release.mjs";

// The only private key is an ephemeral in-memory TEST key, never DEV custody.
const NOW=Date.parse("2026-11-21T02:00:00.000Z");
const date=ms=>new Date(ms).toISOString();
function fixture() {
  const keys=generateKeyPairSync("ed25519");
  const pem=keys.publicKey.export({type:"spki",format:"pem"}).toString();
  const fingerprint=createHash("sha256").update(
    keys.publicKey.export({type:"spki",format:"der"})).digest("hex");
  const trust={
    use:"CST_DEV_DELL_SIGNER_QA_PUBLIC_PIN",project:PROJECT,
    verifierId:"cst-independent-qa-disposableonly",
    publicKeyPem:pem,fingerprint
  };
  const claims={
    version:1,domain:"cst-onejob-dell-signer-release/v1",
    purpose:"CST_DEV_DELL_SIGNER_SINGLE_JOB",
    project:PROJECT,companyId:"1",jobId:483,role:"coding",
    workerName:"cst-dev-dell-onejob-20261121-12345678",
    sourceSha:"a".repeat(40),
    approvalId:"123e4567-e89b-12d3-a456-426614174000",
    eventId:"123e4567-e89b-12d3-a456-426614174001",
    payloadSha256:"b".repeat(64),
    signerSid:"S-1-5-21-100-200-300-1001",
    clientSid:"S-1-5-21-100-200-300-1002",
    changeId:"CST-DEV-ONEJOB-20261121",
    nonce:"c".repeat(64),
    verifierId:trust.verifierId,
    issuedAt:date(NOW-5_000),
    expiresAt:date(NOW+45_000)
  };
  const expected={
    project:claims.project,companyId:claims.companyId,jobId:claims.jobId,
    role:claims.role,workerName:claims.workerName,sourceSha:claims.sourceSha,
    approvalId:claims.approvalId,eventId:claims.eventId,
    payloadSha256:claims.payloadSha256,signerSid:claims.signerSid,
    clientSid:claims.clientSid,changeId:claims.changeId,
    qaRootFingerprint:fingerprint
  };
  const signature=key=>sign(null,canonicalReleaseBytes(claims),key).toString("base64");
  return {keys,claims,trust,expected,signature};
}
function verdict(options={}) {
  const f=fixture();
  const claims={...f.claims,...(options.claims||{})};
  const envelope=Object.hasOwn(options,"envelope") ? options.envelope : {
    claims,signatureBase64:options.signatureBase64 ??
      sign(null,canonicalReleaseBytes(claims),f.keys.privateKey).toString("base64")
  };
  const trust=options.trust===undefined?f.trust:options.trust;
  const expected={...f.expected,...(options.expected||{})};
  return reviewCstDevDellSignerRelease({
    envelope,trustedQaRoot:trust,expected,now:options.now??NOW
  });
}
function denied(label,code,config) {
  test(label,()=>{
    const result=verdict(config);
    assert.equal(result.status,"DENIED");
    assert.ok(result.blockers.includes(code),
      "Expected code "+code+", got "+result.blockers.join(","));
    assert.equal(result.signingPermitted,false);
    assert.equal(result.signatureIssued,false);
    assert.equal(result.releaseDecision,"NO_GO");
  });
}
test("valid synthetic Ed25519 release is EVIDENCE ONLY, never signing permit",()=>{
  const r=verdict();
  assert.equal(r.status,"SIGNED_RELEASE_EVIDENCE_VALID_ONLY");
  assert.equal(r.signedReleaseEvidenceVerified,true);
  assert.deepEqual(r.blockers,[]);
  for(const k of ["signingPermitted","signatureIssued","dispatchPermitted",
    "finalAckIssued","ownerApprovalDbReadbackVerified",
    "durableNonceConsumed","signerRuntimeIdentityVerified",
    "independentKeyCustodyVerified"]) assert.equal(r[k],false,k);
  assert.equal(r.releaseDecision,"NO_GO");
});
test("canonical bytes reject unknown claim fields",()=>{
  const f=fixture();
  assert.throws(()=>canonicalReleaseBytes({...f.claims,approve:true}),
    /SIGNER_RELEASE_CLAIMS_NOT_EXACT/);
});
test("canonical bytes reject missing claim fields",()=>{
  const f=fixture();
  const c={...f.claims};delete c.role;
  assert.throws(()=>canonicalReleaseBytes(c),/SIGNER_RELEASE_CLAIMS_NOT_EXACT/);
});
const cases=[
 ["wrong project","RELEASE_CLAIM_SCOPE_INVALID",{project:"nzdweipzckfszczzqtuw"}],
 ["wrong company","RELEASE_CLAIM_SCOPE_INVALID",{companyId:"3"}],
 ["historic job cannot replay","RELEASE_CLAIM_SCOPE_INVALID",{jobId:482}],
 ["role mismatch","RELEASE_INDEPENDENT_FACTS_MISMATCH",{role:"qa"}],
 ["wrong worker name","RELEASE_CLAIM_SCOPE_INVALID",{workerName:"generic-worker"}],
 ["wrong SHA length","RELEASE_CLAIM_SCOPE_INVALID",{sourceSha:"d".repeat(39)}],
 ["different exact source","RELEASE_INDEPENDENT_FACTS_MISMATCH",{sourceSha:"d".repeat(40)}],
 ["different approval ID","RELEASE_INDEPENDENT_FACTS_MISMATCH",{approvalId:"123e4567-e89b-12d3-a456-426614174009"}],
 ["different event ID","RELEASE_INDEPENDENT_FACTS_MISMATCH",{eventId:"123e4567-e89b-12d3-a456-426614174009"}],
 ["different payload digest","RELEASE_INDEPENDENT_FACTS_MISMATCH",{payloadSha256:"d".repeat(64)}],
 ["forged signer SID","RELEASE_INDEPENDENT_FACTS_MISMATCH",{signerSid:"S-1-5-21-100-200-300-1111"}],
 ["same signer and client SID","RELEASE_CLAIM_SCOPE_INVALID",{clientSid:"S-1-5-21-100-200-300-1001"}],
 ["different client SID","RELEASE_INDEPENDENT_FACTS_MISMATCH",{clientSid:"S-1-5-21-100-200-300-1111"}],
 ["invalid SID","RELEASE_CLAIM_SCOPE_INVALID",{signerSid:"EVERYONE"}],
 ["unapproved change record","RELEASE_INDEPENDENT_FACTS_MISMATCH",{changeId:"CST-DEV-OTHER-20261121"}],
 ["invalid nonce","RELEASE_CLAIM_SCOPE_INVALID",{nonce:"0".repeat(63)}],
 ["untrusted QA issuer ID","RELEASE_CLAIM_SCOPE_INVALID",{verifierId:"cst-independent-qa-fakekey"}],
 ["expired","RELEASE_TIME_INVALID",{expiresAt:date(NOW-1)}],
 ["future-issued","RELEASE_TIME_INVALID",{issuedAt:date(NOW+100)}],
 ["expiry more than five minutes","RELEASE_TIME_INVALID",{expiresAt:date(NOW+301000)}],
 ["issue more than five minutes ago","RELEASE_TIME_INVALID",{issuedAt:date(NOW-301000)}],
 ["noncanonical time","RELEASE_TIME_INVALID",{issuedAt:"2026-11-21T02:00:00Z"}],
 ["wrong purpose","RELEASE_CLAIM_SCOPE_INVALID",{purpose:"CST_DEV_SIGN_ANYTHING"}],
 ["wrong signing domain","RELEASE_CLAIM_SCOPE_INVALID",{domain:"another/v1"}],
 ["noninteger job ID","RELEASE_CLAIM_SCOPE_INVALID",{jobId:"483"}],
 ["invalid Windows SID type","RELEASE_CLAIM_SCOPE_INVALID",{signerSid:null}]
];
for (const [label,code,claims] of cases)
  denied(label,code,{claims});
denied("independent expected source is wrong","RELEASE_INDEPENDENT_FACTS_MISMATCH",
  {expected:{sourceSha:"f".repeat(40)}});
denied("independent expected role is wrong","RELEASE_INDEPENDENT_FACTS_MISMATCH",
  {expected:{role:"security"}});
denied("independent root pin differs","QA_ROOT_NOT_INDEPENDENTLY_PINNED",
  {expected:{qaRootFingerprint:"0".repeat(64)}});
denied("trust missing","QA_TRUST_SHAPE_INVALID",{trust:null});
denied("envelope missing","RELEASE_ENVELOPE_SHAPE_INVALID",{envelope:null});
denied("signature malformed","INDEPENDENT_QA_RELEASE_SIGNATURE_INVALID",
  {signatureBase64:"invalid"});
test("tampering after a valid signature is cryptographically denied",()=>{
  const f=fixture();
  const envelope={claims:{...f.claims},
    signatureBase64:f.signature(f.keys.privateKey)};
  envelope.claims.payloadSha256="e".repeat(64);
  const result=reviewCstDevDellSignerRelease({
    envelope,trustedQaRoot:f.trust,expected:f.expected,now:NOW});
  assert.ok(result.blockers.includes("INDEPENDENT_QA_RELEASE_SIGNATURE_INVALID"));
  assert.equal(result.signedReleaseEvidenceVerified,false);
});
test("wrong Ed25519 public key and fingerprint cannot satisfy independent pin",()=>{
  const f=fixture(), other=fixture();
  const r=reviewCstDevDellSignerRelease({
    envelope:{claims:f.claims,signatureBase64:f.signature(f.keys.privateKey)},
    trustedQaRoot:other.trust,expected:f.expected,now:NOW
  });
  assert.ok(r.blockers.includes("QA_ROOT_NOT_INDEPENDENTLY_PINNED"));
  assert.ok(r.blockers.includes("INDEPENDENT_QA_RELEASE_SIGNATURE_INVALID"));
  assert.equal(r.signingPermitted,false);
});
test("claim injection is rejected even if a signature is present",()=>{
  const f=fixture();
  const r=reviewCstDevDellSignerRelease({
    envelope:{claims:{...f.claims,issuePrivateKey:true},
      signatureBase64:f.signature(f.keys.privateKey)},
    trustedQaRoot:f.trust,expected:f.expected,now:NOW
  });
  assert.ok(r.blockers.includes("RELEASE_CLAIMS_SHAPE_INVALID"));
  assert.equal(r.signatureIssued,false);
});
