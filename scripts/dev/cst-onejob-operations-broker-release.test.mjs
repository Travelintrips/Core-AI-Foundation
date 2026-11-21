import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {
  APPROVED_OPS_ROOT_FINGERPRINT,MANIFEST_SHA,ROLES,canonicalOperationsBatch,
  canonicalOperationsPermit,verifySignedOperationsBrokerRelease,
  canonicalOperationsJobAuthorizationV2,verifySignedOperationsJobAuthorizationV2,
  AUTH_V2_SCHEMA,AUTH_V2_DOMAIN
} from "./cst-onejob-operations-broker-release.mjs";
import {main} from "./cst-onejob-trusted-admission-bridge.mjs";

const keys=generateKeyPairSync("ed25519");
const fingerprint=createHash("sha256")
  .update(keys.publicKey.export({type:"spki",format:"der"})).digest("hex");
const rootPublicKeyPem=keys.publicKey.export({type:"spki",format:"pem"}).toString();
const sig=b=>sign(null,b,keys.privateKey).toString("base64");
const sha="a".repeat(40);
const approvalId="123e4567-e89b-12d3-a456-426614174000";
const workerName="cst-dev-dell-onejob-20261120-abcdef12";
const passwd=Object.entries(ROLES).flatMap(([_,r],i)=>[
  [r.signer,1000+i*2],[r.operator,1001+i*2]
]).map(([name,uid])=>name+":x:"+uid+":1::/var/empty:/usr/sbin/nologin").join("\n")+"\n";
const fixture=()=>{
 const issuedAt=new Date(Date.now()-30000).toISOString();
 const expiresAt=new Date(Date.now()+210000).toISOString();
 const p={
  schema:"cst-onejob-vps-approved-release-batch/v1",project:"xssrfshdrtdfupgqwfdw",
  companyId:"1",changeId:"CST-DEV-20261121-BROKER",jobId:483,
  approvalId,sourceSha:sha,workerName,
  manifestSha256:MANIFEST_SHA,issuedAt,expiresAt,permits:{}
 };
 for(const [role,r] of Object.entries(ROLES)){
   const i=Object.keys(ROLES).indexOf(role);
   const claims={
     v:1,project:p.project,companyId:"1",role,purpose:r.purposes[0],
     jobId:p.jobId,sourceSha:sha,approvalId,workerName,
     payloadSha256:"e".repeat(64),nonce:i.toString(16).padStart(64,"0"),
     operatorUid:1001+i*2,signerUid:1000+i*2,
     publicKeyFingerprint:r.fingerprint,issuedAt,expiresAt
   };
   p.permits[role]={claims,signatureBase64:sig(canonicalOperationsPermit(claims))};
 }
 return {payload:p,signatureBase64:sig(canonicalOperationsBatch(p))};
};
const call=(batch=fixture(),patch={})=>verifySignedOperationsBrokerRelease({
  batch,rootPublicKeyPem,passwdText:passwd,expectedSourceSha:sha,
  approvedRootFingerprint:fingerprint,...patch
});
const resign=b=>{
 for(const permit of Object.values(b.payload.permits))
   permit.signatureBase64=sig(canonicalOperationsPermit(permit.claims));
 b.signatureBase64=sig(canonicalOperationsBatch(b.payload));
 return b;
};
test("synthetic full 8-role Operations release valid only with independent public root pin",()=>{
 const good=call();
 assert.equal(good.verifiedOperationsSignature,true);
 assert.equal(good.signsOperationalOwnerApproval,false);
 assert.equal(good.dispatchPermitted,false);
 assert.equal(good.jobId,483);
 assert.equal(good.approvalId,approvalId);
 assert.equal(Object.keys(ROLES).length,8);
 assert.equal(APPROVED_OPS_ROOT_FINGERPRINT,null,"REAL_ROOT_STILL_NOT_APPROVED");
 assert.throws(()=>call(fixture(),{approvedRootFingerprint:APPROVED_OPS_ROOT_FINGERPRINT}),
   /INDEPENDENT_ROOT_NOT_PINNED/);
});
test("different signer, tampered signed batch, wrong source pin all fail closed",()=>{
 const fake=generateKeyPairSync("ed25519");
 assert.throws(()=>call(fixture(),{rootPublicKeyPem:fake.publicKey.export({
   type:"spki",format:"pem"}).toString()}),/UNTRUSTED_ROOT_FINGERPRINT/);
 const changed=fixture();changed.payload.jobId=484;
 assert.throws(()=>call(changed),/INVALID_OPERATIONS_SIGNATURE/);
 assert.throws(()=>call(fixture(),{expectedSourceSha:"b".repeat(40)}),
   /SIGNED_BATCH_SCOPE_INVALID/);
});
test("signed permit tampering, role omission, duplicate nonce and wrong UID fail",()=>{
 const badPermit=fixture();
 badPermit.payload.permits["reviewer"].claims.jobId=484;
 badPermit.signatureBase64=sig(canonicalOperationsBatch(badPermit.payload));
 assert.throws(()=>call(badPermit),/PERMIT_BOUNDARY_MISMATCH/);
 const absent=fixture();delete absent.payload.permits["agent-coding"];
 assert.throws(()=>call(resign(absent)),/EIGHT_DISTINCT_PERMITS_REQUIRED/);
 const replay=fixture();
 replay.payload.permits["reviewer"].claims.nonce=
   replay.payload.permits["agent-qa"].claims.nonce;
 assert.throws(()=>call(resign(replay)),/DUPLICATE_PERMIT_NONCE/);
 const wrongUid=fixture();wrongUid.payload.permits["reviewer"].claims.signerUid=0;
 assert.throws(()=>call(resign(wrongUid)),/PERMIT_BOUNDARY_MISMATCH/);
});
test("stale future and unbounded signed releases cannot authorize",()=>{
 const stale=fixture();
 stale.payload.issuedAt=new Date(Date.now()-480000).toISOString();
 stale.payload.expiresAt=new Date(Date.now()-180000).toISOString();
 for(const p of Object.values(stale.payload.permits)){
   p.claims.issuedAt=stale.payload.issuedAt;p.claims.expiresAt=stale.payload.expiresAt;
 }
 assert.throws(()=>call(resign(stale)),/BATCH_EXPIRED_OR_UNBOUNDED/);
 const future=fixture();
 future.payload.issuedAt=new Date(Date.now()+100000).toISOString();
 future.payload.expiresAt=new Date(Date.now()+200000).toISOString();
 for(const p of Object.values(future.payload.permits)){
   p.claims.issuedAt=future.payload.issuedAt;p.claims.expiresAt=future.payload.expiresAt;
 }
 assert.throws(()=>call(resign(future)),/BATCH_EXPIRED_OR_UNBOUNDED/);
});
test("broker denies release when missing independent authority; no database connection",async()=>{
 const env={
  APP_ENV:"development",NODE_ENV:"development",
  SUPABASE_URL_DEV:"https://xssrfshdrtdfupgqwfdw.supabase.co",
  CST_DEV_ONEJOB_BROKER_ENABLED:"true",AI_DISPATCHER_ENABLED:"false",
  OLLAMA_WORKER_RUNTIME_ENABLED:"false",CST_TEAM_DEV_APPROVED_SOURCE_SHA:sha,
  CST_DEV_ONEJOB_BROKER_DATABASE_URL:
    "postgresql://cst_onejob_broker_login.xssrfshdrtdfupgqwfdw:"+
    "synthetic-only-not-a-secret-12345@aws-1-ap-southeast-2.pooler.supabase.com:"+
    "6543/postgres?sslmode=verify-full"
 };
 const result=await main(["--execute-approved-dev"],env);
 assert.deepEqual(result.status,"DENIED");
 assert.equal(result.reason,"TRUSTED_BROKER_OR_CUSTODY_UNAVAILABLE");
 assert.equal(result.dispatchPermitted,false);
});



test("canonical batch JSON is byte-identical to Python signer importer",()=>{
 const payload=fixture().payload;
 const py="import json,sys; x=json.loads(sys.stdin.buffer.read());"+
  "sys.stdout.buffer.write(b'CST_DEV_ONEJOB_VPS_APPROVED_BATCH_V1' + bytes([10]) +"+
  "json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())";
 const result=spawnSync("python3",["-c",py],{
   input:Buffer.from(JSON.stringify(payload)),maxBuffer:65536
 });
 assert.equal(result.status,0,result.stderr?.toString());
 assert.deepEqual(result.stdout,canonicalOperationsBatch(payload));
});
test("broker has NO fallback from a plain root-owned JSON release",()=>{
 const s=readFileSync(new URL("./cst-onejob-trusted-admission-bridge.mjs",import.meta.url),"utf8");
 assert.match(s,/verifySignedOperationsJobAuthorizationV2/);
 assert.equal(s.includes("pinnedFile(OPS_BATCH,"),false);
 assert.match(s,/OPS_AUTH/);
 assert.match(s,/APPROVED_OPS_ROOT_FINGERPRINT/);
 assert.equal(s.includes("pinnedFile(RELEASE,"),false);
 assert.equal(s.includes('const RELEASE="/etc/cst-onejob-qa/approval/broker-release.json"'),false);
});


const authV2=()=>{
 const issuedAt=new Date(Date.now()-25000).toISOString();
 const expiresAt=new Date(Date.now()+195000).toISOString();
 const payload={
   schema:AUTH_V2_SCHEMA,project:"xssrfshdrtdfupgqwfdw",companyId:"1",
   changeId:"CST-DEV-20261121-STAGED",jobId:483,approvalId,
   sourceSha:sha,workerName,manifestSha256:MANIFEST_SHA,
   issuedAt,expiresAt,roles:Object.fromEntries(Object.entries(ROLES)
     .map(([role,info])=>[role,info.fingerprint]))
 };
 return {payload,signatureBase64:sig(canonicalOperationsJobAuthorizationV2(payload))};
};
const verifyV2=(authorization=authV2(),patch={})=>
 verifySignedOperationsJobAuthorizationV2({
  authorization,rootPublicKeyPem,expectedSourceSha:sha,
  approvedRootFingerprint:fingerprint,...patch
 });
test("v2 one Owner job authorizes eight static roles, not unknown future payloads",()=>{
 const a=authV2();
 assert.equal(Object.keys(a.payload.roles).length,8);
 assert.equal(Object.hasOwn(a.payload,"permits"),false);
 assert.equal(Object.hasOwn(a.payload,"payloadSha256"),false);
 const verified=verifyV2(a);
 assert.equal(verified.operationsAuthorizationVerified,true);
 assert.equal(verified.ownerApprovalVerified,false);
 assert.equal(verified.futurePayloadsPreApproved,false);
 assert.equal(verified.finalAckIssued,false);
 assert.equal(verified.dispatchPermitted,false);
 assert.equal(verified.jobId,483);
});
test("v2 root not pinned and tampered authorization fail before broker SQL",()=>{
 assert.throws(()=>verifyV2(authV2(),{approvedRootFingerprint:null}),
  /INDEPENDENT_ROOT_NOT_PINNED/);
 const changed=authV2();changed.payload.jobId=484;
 assert.throws(()=>verifyV2(changed),/INVALID_OPERATIONS_SIGNATURE/);
 const missing=authV2();delete missing.payload.roles.reviewer;
 missing.signatureBase64=sig(canonicalOperationsJobAuthorizationV2(missing.payload));
 assert.throws(()=>verifyV2(missing),/AUTH_ROLES_INVALID/);
 assert.throws(()=>verifyV2(authV2(),{expectedSourceSha:"b".repeat(40)}),
  /AUTH_SCOPE_INVALID/);
});
test("v2 authorization canonical bytes match Python independent stage verifier",()=>{
 const p=authV2().payload;
 const py="import json,sys; x=json.loads(sys.stdin.buffer.read());"+
  "sys.stdout.buffer.write(b'CST_DEV_ONEJOB_VPS_JOB_AUTHORIZATION_V2' + bytes([10]) +"+
  "json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())";
 const result=spawnSync("python3",["-c",py],{
  input:Buffer.from(JSON.stringify(p)),maxBuffer:65536
 });
 assert.equal(result.status,0,result.stderr?.toString());
 assert.deepEqual(result.stdout,canonicalOperationsJobAuthorizationV2(p));
 assert.equal(AUTH_V2_DOMAIN.endsWith("\n"),true);
});
