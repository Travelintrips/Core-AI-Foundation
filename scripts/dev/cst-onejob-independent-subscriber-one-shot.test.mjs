import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  reviewIndependentSubscriberGate,
  reviewIndependentSubscriberRelease,
  signViaIndependentSocket,
  main,
} from "./cst-onejob-independent-subscriber-one-shot.mjs";

const PROJECT="xssrfshdrtdfupgqwfdw";
const worker="cst-dev-dell-onejob-20261120-abcdef12";
const sha="2f26d37272d978b2837827a8e0c72247bc8733e8";
const roles={
  APP_ENV:"development",NODE_ENV:"development",
  SUPABASE_URL_DEV:"https://"+PROJECT+".supabase.co",
  CST_DEV_ONEJOB_INDEPENDENT_SUBSCRIBER_ENABLED:"true",
  AI_DISPATCHER_ENABLED:"false",OLLAMA_WORKER_RUNTIME_ENABLED:"false",
  CST_TEAM_DEV_APPROVED_SOURCE_SHA:sha,
  CST_TEAM_DEV_APPROVED_WORKER_NAME:worker,
  CST_DEV_ONEJOB_SUBSCRIBER_DATABASE_URL:
    "postgresql://cst_onejob_subscriber_login."+PROJECT+
    ":synthetic-do-not-use@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=verify-full",
};
const keys=generateKeyPairSync("ed25519");
const pub=keys.publicKey.export({type:"spki",format:"pem"}).toString();
const fingerprint=createHash("sha256").update(
  keys.publicKey.export({type:"spki",format:"der"})).digest("hex");
const trust={use:"CST_DEV_ONEJOB_SUBSCRIBER_PUBLIC_PIN",project:PROJECT,
  subscriberId:"cst-onejob-subscriber-pilot",publicKeyPem:pub,fingerprint};
const now=Date.parse("2026-11-20T11:10:00.000Z");
const release={
  version:1,purpose:"CST_DEV_ONEJOB_SIGNED_SUBSCRIBER",
  project:PROJECT,companyId:"1",jobId:483,sourceSha:sha,
  workerName:worker,subscriberId:trust.subscriberId,
  publicKeyFingerprint:fingerprint,operatorUid:28502,signerUid:28510,
  changeId:"CST-DEV-ONEJOB-20261120",
  issuedAt:"2026-11-20T11:08:00.000Z",
  expiresAt:"2026-11-20T11:12:00.000Z",
};
function rejected(mods,code){
  const x=reviewIndependentSubscriberGate({...roles,...mods},483);
  assert.equal(x.ready,false,JSON.stringify(x));
  assert.ok(x.blockers.includes(code),JSON.stringify(x));
  assert.equal(x.releaseDecision,"NO_GO");
  assert.doesNotMatch(JSON.stringify(x),/synthetic-do-not-use|postgresql:\/\//);
}
test("dedicated subscriber gate is disabled by default, one job only and never a dispatch permit",()=>{
  const x=reviewIndependentSubscriberGate(roles,483);
  assert.equal(x.ready,true,JSON.stringify(x));
  assert.equal(x.dispatchPermitted,false);
  assert.equal(x.finalAckIssued,false);
  assert.equal(x.releaseDecision,"NO_GO");
  assert.equal(reviewIndependentSubscriberGate(roles,482).ready,false);
  assert.equal(reviewIndependentSubscriberGate(roles,1).ready,false);
  rejected({CST_DEV_ONEJOB_INDEPENDENT_SUBSCRIBER_ENABLED:""},"SUBSCRIBER_DISABLED");
  rejected({CST_DEV_ONEJOB_SUBSCRIBER_DATABASE_URL:""},"DEDICATED_SUBSCRIBER_CREDENTIAL_MISSING");
});
test("no production/shared role, wrong project, source or dispatcher can be accepted",()=>{
  rejected({APP_ENV:"production"},"DEV_ONLY");
  rejected({NODE_ENV:"production"},"DEV_ONLY");
  rejected({SUPABASE_URL_DEV:"https://nzdweipzckfszczzqtuw.supabase.co"},"PROJECT_MISMATCH");
  rejected({SUPABASE_PROD_DATABASE_URL:"exists"},"SHARED_OR_PROD_CONNECTION_FORBIDDEN");
  rejected({DATABASE_URL:"shared"},"SHARED_OR_PROD_CONNECTION_FORBIDDEN");
  rejected({SUPABASE_DEV_DATABASE_URL:"shared"},"SHARED_OR_PROD_CONNECTION_FORBIDDEN");
  rejected({AI_DISPATCHER_ENABLED:"true"},"GENERIC_DISPATCH_NOT_DISABLED");
  rejected({OLLAMA_WORKER_RUNTIME_ENABLED:"true"},"GENERIC_DISPATCH_NOT_DISABLED");
  rejected({CST_TEAM_DEV_APPROVED_SOURCE_SHA:"e".repeat(39)},"SOURCE_SHA_NOT_PINNED");
  rejected({CST_TEAM_DEV_APPROVED_WORKER_NAME:"old-worker"},"WORKER_NOT_PINNED");
});
test("root-owned independent release still requires separately pinned signer and fresh exact job",()=>{
  const scope={jobId:483,sourceSha:sha,workerName:worker};
  const valid=reviewIndependentSubscriberRelease(release,trust,scope,now);
  assert.equal(valid.ready,true,JSON.stringify(valid));
  assert.equal(valid.releaseDecision,"NO_GO");
  assert.equal(valid.finalAckIssued,false);
  const denied=(change,root=trust,at=now,expected="")=>{
    const x=reviewIndependentSubscriberRelease({...release,...change},root,scope,at);
    assert.equal(x.ready,false,JSON.stringify(x));
    if(expected)assert.ok(x.blockers.includes(expected),JSON.stringify(x));
  };
  denied({companyId:"3"},trust,now,"AUTHORIZED_JOB_SCOPE_INVALID");
  denied({project:"nzdweipzckfszczzqtuw"},trust,now,"AUTHORIZED_JOB_SCOPE_INVALID");
  denied({jobId:482},trust,now,"AUTHORIZED_JOB_SCOPE_INVALID");
  denied({sourceSha:"f".repeat(40)},trust,now,"AUTHORIZED_JOB_SCOPE_INVALID");
  denied({workerName:"wrong-worker"},trust,now,"AUTHORIZED_JOB_SCOPE_INVALID");
  denied({signerUid:0},trust,now,"INDEPENDENT_CHANGE_OR_SIGNER_UID_MISSING");
  denied({operatorUid:0},trust,now,"INDEPENDENT_CHANGE_OR_SIGNER_UID_MISSING");
  denied({operatorUid:28510},trust,now,"INDEPENDENT_CHANGE_OR_SIGNER_UID_MISSING");
  denied({publicKeyFingerprint:"e".repeat(64)},trust,now,"SUBSCRIBER_SIGNER_TRUST_MISMATCH");
  denied({expiresAt:"2026-11-20T11:20:00.000Z"},trust,now,"RELEASE_EXPIRED_OR_UNBOUNDED");
  denied({},trust,Date.parse(release.expiresAt),"RELEASE_EXPIRED_OR_UNBOUNDED");
  denied({unexpected:"not-reviewed"},trust,now,"RELEASE_SHAPE_INVALID");
  denied({}, {...trust,fingerprint:"e".repeat(64)},now,"SUBSCRIBER_PUBLIC_PIN_INVALID");
  denied({}, {...trust,subscriberId:"different-signer"},now,"SUBSCRIBER_SIGNER_TRUST_MISMATCH");
});
test("the actual CLI fails closed without credential, release file, signer, and external custody",async()=>{
  const invalid=await main([]);
  assert.equal(invalid.status,"DENIED");
  const locked=await main(["--consume-approved-dev","483"],{
    APP_ENV:"development",NODE_ENV:"development",
    SUPABASE_URL_DEV:"https://"+PROJECT+".supabase.co",
    CST_DEV_ONEJOB_INDEPENDENT_SUBSCRIBER_ENABLED:"false",
  });
  assert.equal(locked.status,"DENIED");
  assert.equal(locked.finalAckIssued,false);
  const missing=await main(["--consume-approved-dev","483"],roles);
  assert.equal(missing.status,"DENIED");
  assert.ok(["INDEPENDENT_NONROOT_PROCESS_REQUIRED",
    "AUTHORIZED_CUSTODY_OR_SIGNED_SUBSCRIBER_UNAVAILABLE"].includes(missing.reason));
  assert.equal(missing.dispatchPermitted,false);
  assert.equal(missing.independentFinalAckVerified,false);
  assert.doesNotMatch(JSON.stringify(missing),/synthetic-do-not-use|postgresql:/);
});
test("external signer never accepts the same OS user identity or a private key path",async()=>{
  const uid=typeof process.getuid==="function"?process.getuid():0;
  await assert.rejects(
    signViaIndependentSocket(Buffer.alloc(128),"/tmp/untrusted.sock",uid),
    /SIGNER_INDEPENDENT_IDENTITY_DENIED/);
  await assert.rejects(
    signViaIndependentSocket(Buffer.alloc(0),"/tmp/untrusted.sock",28510),
    /SIGNER_INDEPENDENT_IDENTITY_DENIED/);
  const src=readFileSync(new URL("./cst-onejob-independent-subscriber-one-shot.mjs",import.meta.url),"utf8");
  assert.match(src,/O_NOFOLLOW/);
  assert.match(src,/signerUid===process\.getuid\(\)/);
  assert.match(src,/CST_DEV_ONEJOB_INDEPENDENT_SUBSCRIBER_ENABLED/);
  assert.match(src,/createPinnedCstOneJobPgConnection\(env\[DB_KEY\],LOGIN\)/);
  assert.match(src,/pullExactlyOneCstJobCompletion/);
  assert.doesNotMatch(src,/generateKeyPairSync|createPrivateKey|secrets versions access|service_role/);
  assert.doesNotMatch(src,/createServer|createPublicURL|role\.superuser|CREATE ROLE/);
});
