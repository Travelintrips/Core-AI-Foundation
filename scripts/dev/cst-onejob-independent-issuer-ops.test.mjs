import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  PROJECT,sha256,reviewIndependentIssuerEnvironment,
  reviewIndependentIssuerRelease,readRootCustodiedFile
} from "./cst-onejob-independent-issuer-custody.mjs";
import {
  reviewQaBoundCapture,main as qaMain
} from "./cst-onejob-independent-qa-one-shot.mjs";
import {
  reviewCoreReconciliationPackage,main as reconMain
} from "./cst-onejob-core-reconciliation-one-shot.mjs";
import {OFFLINE_TESTS,verifyManifest} from "./cst-onejob-onepass-acceptance.mjs";

const sha="bf1dc7b5c51c61d5c8fcbd7020bbf92748b24a31";
const worker="cst-dev-dell-onejob-20261120-abcdef12",jobId=483;
const approvalId="123e4567-e89b-12d3-a456-426614174000";
const eventId="123e4567-e89b-12d3-a456-426614174001";
const deliveryId="123e4567-e89b-12d3-a456-426614174002";
const subscriberId="cst-onejob-subscriber-pilot";
const requestId="cst-ai-team-company1-dev:pilot-"+"a".repeat(20);
const keys=generateKeyPairSync("ed25519");
const pub=keys.publicKey.export({type:"spki",format:"pem"}).toString();
const fingerprint=createHash("sha256").update(
  keys.publicKey.export({type:"spki",format:"der"})).digest("hex");
const now=Date.parse("2026-11-20T07:05:00.000Z");
const trust={use:"CST_DEV_ONEJOB_QA_PUBLIC_PIN",project:PROJECT,
 verifierId:"cst-independent-qa-disposableonly",publicKeyPem:pub,fingerprint};
const release={
  version:1,purpose:"CST_DEV_ONEJOB_INDEPENDENT_QA",project:PROJECT,
  companyId:"1",jobId,sourceSha:sha,workerName:worker,
  evidenceSha256:"a".repeat(64),signerId:trust.verifierId,
  keyFingerprint:trust.fingerprint,operatorUid:28502,signerUid:28510,
  changeId:"CST-DEV-ONEJOB-20261120",
  issuedAt:"2026-11-20T07:03:00.000Z",expiresAt:"2026-11-20T07:07:00.000Z"
};
const scope={purpose:release.purpose,jobId,sourceSha:sha,workerName:worker,
  evidenceSha256:release.evidenceSha256,signerId:trust.verifierId,trustUse:trust.use};
const qaKey="CST_DEV_ONEJOB_QA_DATABASE_URL",reconKey="CST_DEV_ONEJOB_RECONCILIATION_DATABASE_URL";
const qaFlag="CST_DEV_ONEJOB_INDEPENDENT_QA_ENABLED";
const reconFlag="CST_DEV_ONEJOB_CORE_RECONCILIATION_ENABLED";
const goodEnv={
 APP_ENV:"development",NODE_ENV:"development",
 SUPABASE_URL_DEV:"https://"+PROJECT+".supabase.co",
 AI_DISPATCHER_ENABLED:"false",OLLAMA_WORKER_RUNTIME_ENABLED:"false",
 CST_TEAM_DEV_APPROVED_SOURCE_SHA:sha,CST_TEAM_DEV_APPROVED_WORKER_NAME:worker,
 [qaKey]:"synthetic-credential-not-valid",
 [reconKey]:"synthetic-credential-not-valid",
 [qaFlag]:"true",[reconFlag]:"true"
};
const pre=Buffer.from(JSON.stringify({
  scope:"CST_DEV_ONEJOB_PRE_ADMISSION",project:PROJECT,
  approvalId,jobId,workerName:worker,sourceSha:sha,
  imageId:"sha256:"+"b".repeat(64),
  checks:{isolatedNetwork:true,scopedDevRole:true,eventAuditPath:true,
    subscriberPath:true,independentQaAvailable:true},
  capturedAt:"2026-11-20T07:04:30.000Z"
}));
const preRelease={...release,evidenceSha256:sha256(pre)};
const post=Buffer.from(JSON.stringify({
  eventId,jobId,subscriberId,deliveryId,responseDigest:"d".repeat(64)
}));
const postRelease={...release,evidenceSha256:sha256(post)};
const binding={project:PROJECT,companyId:"1",approvalId,jobId,
  requestId,workerName:worker,sourceSha:sha,imageId:"sha256:"+"b".repeat(64),
  postBinding:{eventId,deliveryId,subscriberId}};

test("both independent executors default DENY and keep dispatch/Final ACK false",()=>{
  const a=reviewIndependentIssuerEnvironment(goodEnv,jobId,
    release.purpose,qaKey,qaFlag);
  const b=reviewIndependentIssuerEnvironment(goodEnv,jobId,
    "CST_DEV_ONEJOB_CORE_RECONCILIATION",reconKey,reconFlag);
  assert.equal(a.ready,true);assert.equal(b.ready,true);
  assert.equal(a.releaseDecision,"NO_GO");assert.equal(b.finalAckIssued,false);
  for(const [change,code] of [
    [{APP_ENV:"production"},"DEV_ONLY"],
    [{NODE_ENV:"production"},"DEV_ONLY"],
    [{SUPABASE_URL_DEV:"https://nzdweipzckfszczzqtuw.supabase.co"},"PROJECT_NOT_PINNED"],
    [{AI_DISPATCHER_ENABLED:"true"},"DISPATCH_NOT_DISABLED"],
    [{DATABASE_URL:"shared"}, "SHARED_OR_PROD_DATABASE_FORBIDDEN"],
    [{SUPABASE_PROD_DATABASE_URL:"prod"},"SHARED_OR_PROD_DATABASE_FORBIDDEN"],
    [{CST_TEAM_DEV_APPROVED_SOURCE_SHA:"f".repeat(39)},"SOURCE_SHA_INVALID"],
    [{CST_TEAM_DEV_APPROVED_WORKER_NAME:"shared-worker"},"WORKER_SCOPE_INVALID"],
    [{[qaFlag]:"false"},"ISSUER_DISABLED"],
    [{[qaKey]:""},"DEDICATED_ISSUER_CREDENTIAL_NOT_AVAILABLE"],
  ]) {
    const result=reviewIndependentIssuerEnvironment({...goodEnv,...change},jobId,
      release.purpose,qaKey,qaFlag);
    assert.equal(result.ready,false);
    assert.ok(result.blockers.includes(code),JSON.stringify(result));
    assert.doesNotMatch(JSON.stringify(result),/synthetic-credential-not-valid/);
  }
  assert.equal(reviewIndependentIssuerEnvironment(goodEnv,482,release.purpose,qaKey,qaFlag).ready,false);
  assert.equal(reviewIndependentIssuerEnvironment(
    {...goodEnv,[qaKey]:""},jobId,release.purpose,qaKey,qaFlag,false).ready,true,
    "POST_QA_SIGNER_MUST_NOT_REQUIRE_DB_SECRET");
});

test("only exact, recent, independently custodied release is accepted; stale, wrong key and self-signing refused",()=>{
  const ok=reviewIndependentIssuerRelease(release,trust,scope,now);
  assert.equal(ok.ready,true,JSON.stringify(ok));
  for(const [patch,code] of [
    [{companyId:"3"},"AUTHORIZED_SOURCE_AND_JOB_NOT_BOUND"],
    [{project:"nzdweipzckfszczzqtuw"},"AUTHORIZED_SOURCE_AND_JOB_NOT_BOUND"],
    [{jobId:482},"AUTHORIZED_SOURCE_AND_JOB_NOT_BOUND"],
    [{sourceSha:"c".repeat(40)},"AUTHORIZED_SOURCE_AND_JOB_NOT_BOUND"],
    [{signerUid:28502},"INDEPENDENT_CUSTODY_IDENTITY_INVALID"],
    [{operatorUid:0},"INDEPENDENT_CUSTODY_IDENTITY_INVALID"],
    [{keyFingerprint:"f".repeat(64)},"INDEPENDENT_SIGNER_PIN_NOT_BOUND"],
    [{evidenceSha256:"f".repeat(64)},"AUTHORIZED_SOURCE_AND_JOB_NOT_BOUND"],
    [{expiresAt:"2026-11-20T07:11:00.000Z"},"ISSUER_RELEASE_TIME_INVALID"],
    [{unexpected:true},"ISSUER_RELEASE_SHAPE_INVALID"],
  ]){
    const out=reviewIndependentIssuerRelease({...release,...patch},trust,scope,now);
    assert.equal(out.ready,false,JSON.stringify(out));
    assert.ok(out.blockers.includes(code),JSON.stringify(out));
  }
  assert.equal(reviewIndependentIssuerRelease(release,trust,scope,
    Date.parse(release.expiresAt)).ready,false);
  assert.equal(reviewIndependentIssuerRelease(release,{...trust,fingerprint:"f".repeat(64)},scope,now).ready,false);
});

test("PRE QA can only sign exact Owner-approved source capture and never grant queue",()=>{
  const valid=reviewQaBoundCapture("PRE_ADMISSION",jobId,preRelease,pre,null);
  assert.equal(valid.ready,true,JSON.stringify(valid));
  assert.equal(valid.dispatchPermitted,false);
  assert.equal(valid.finalAckIssued,false);
  for(const b of [
    Buffer.from(pre.toString().replace('"isolatedNetwork":true','"isolatedNetwork":false')),
    Buffer.from(pre.toString().replace(sha,"f".repeat(40))),
    Buffer.from(pre.toString().replace(PROJECT,"nzdweipzckfszczzqtuw"))
  ])assert.equal(reviewQaBoundCapture("PRE_ADMISSION",jobId,preRelease,b,null).ready,false);
  assert.equal(reviewQaBoundCapture("PRE_ADMISSION",482,preRelease,pre,null).ready,false);
});

test("POST QA is stage-scoped to exact event, job, subscriber and delivery",()=>{
  const ok=reviewQaBoundCapture("POST_EXECUTION",jobId,postRelease,post,binding);
  assert.equal(ok.ready,true,JSON.stringify(ok));
  assert.equal(ok.releaseDecision,"NO_GO");
  const wrong={...binding,postBinding:{...binding.postBinding,deliveryId:approvalId}};
  assert.equal(reviewQaBoundCapture("POST_EXECUTION",jobId,postRelease,post,wrong).ready,false);
  assert.equal(reviewQaBoundCapture("POST_EXECUTION",jobId,preRelease,post,binding).ready,false);
  assert.equal(reviewQaBoundCapture("POST_EXECUTION",484,postRelease,post,binding).ready,false);
});

test("Core reconciliation package binds fixed event, source, subscriber and exact proof bytes",()=>{
  const pack={
    jobId,eventId,sourceSha:sha,expectedSubscriberId:subscriberId,
    signedPostReceipt:{claims:{jobId,sourceSha:sha}},
    signedSubscriberAck:{claims:{jobId,eventId,subscriberId}},
    deliveryBase64:Buffer.from("delivery-proof").toString("base64"),
    qaEvidenceBase64:post.toString("base64"),
    responseBase64:Buffer.from("CST_DEV_ONEJOB_PROBE_OK").toString("base64")
  };
  const raw=Buffer.from(JSON.stringify(pack));
  const r={...release,evidenceSha256:sha256(raw)};
  const tr={subscriber:{subscriberId}};
  const ok=reviewCoreReconciliationPackage(pack,r,tr,jobId,eventId,raw);
  assert.equal(ok.ready,true,JSON.stringify(ok));
  assert.equal(ok.finalAckIssued,false);
  assert.equal(ok.independentFinalAckVerified,false);
  for(const patch of [
    {jobId:482},{eventId:approvalId},{sourceSha:"f".repeat(40)},
    {expectedSubscriberId:"cst-onejob-subscriber-different"},
    {responseBase64:Buffer.from("NOT_THE_PROBE").toString("base64")},
    {deliveryBase64:"not base64"}, {unverified:true}
  ]){
    const bad={...pack,...patch};
    const check=reviewCoreReconciliationPackage(bad,r,tr,jobId,eventId,raw);
    assert.equal(check.ready,false,JSON.stringify({patch,check}));
  }
  assert.equal(reviewCoreReconciliationPackage(pack,r,tr,jobId,eventId,
    Buffer.from(JSON.stringify({...pack,unverified:1}))).ready,false);
});

test("real CLI modules reject commands and missing custody without calling DEV database",async()=>{
  for(const outcome of [
    await qaMain([]),
    await qaMain(["--pre-admission","482"],goodEnv),
    await qaMain(["--pre-admission","483"],{...goodEnv,[qaFlag]:"false"}),
    await reconMain([]),
    await reconMain(["--reconcile-approved-dev","483","invalid"],goodEnv),
    await reconMain(["--reconcile-approved-dev","483",eventId],
      {...goodEnv,[reconFlag]:"false"}),
  ]){
    assert.equal(outcome.status,"DENIED");
    assert.equal(outcome.releaseDecision,"NO_GO");
    assert.equal(outcome.dispatchPermitted,false);
    assert.equal(outcome.finalAckIssued,false);
    assert.doesNotMatch(JSON.stringify(outcome),/synthetic-credential-not-valid/);
  }
  assert.throws(()=>readRootCustodiedFile("/tmp/attacker.json"),/UNAPPROVED_ARTIFACT_PATH/);
  assert.throws(()=>readRootCustodiedFile("/etc/cst-onejob-qa/approval/arbitrary.json"),
    /UNAPPROVED_ARTIFACT_PATH/);
});

test("source is inert, never contains a credential bootstrap or asserts a Hub Final ACK",()=>{
  const paths=["cst-onejob-independent-issuer-custody.mjs",
    "cst-onejob-independent-qa-one-shot.mjs",
    "cst-onejob-core-reconciliation-one-shot.mjs"];
  for(const path of paths){
    const source=readFileSync(new URL("./"+path,import.meta.url),"utf8");
    assert.doesNotMatch(source,/generateKeyPairSync|createPrivateKey|CREATE ROLE|ALTER ROLE|security\.setSecret/);
    assert.doesNotMatch(source,/nzdweipzckfszczzqtuw|SUPABASE_PROD_DATABASE_URL\s*\)|dispatchSafe\(/);
    assert.match(source,/NO_GO/);
  }
  const runner=OFFLINE_TESTS.map(x=>x.id);
  assert.ok(runner.includes("independent_qa_and_core_reconciliation_ops"));
  assert.equal(verifyManifest().valid,true);
});
