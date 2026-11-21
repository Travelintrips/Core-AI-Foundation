/**
 * OFFLINE public-key verification of the EXACT signed eight-role VPS release
 * accepted by install_approved_release_batch.py.
 *
 * Does not generate keys, issue approval, use PostgreSQL or activate services.
 * Final operational trust root is deliberately unpinned until independently
 * approved and reconciled with the signed change. The runtime fails closed.
 */
import {createHash,createPublicKey,verify} from "node:crypto";

export const PROJECT="xssrfshdrtdfupgqwfdw";
export const MANIFEST_SHA="c6fcd5a41e3ac64b10ce88d05385e7d7f2fbb0cee9ed7ab4a60bc723a01bc315";
export const APPROVED_OPS_ROOT_FINGERPRINT=null;
const BATCH_DOMAIN="CST_DEV_ONEJOB_VPS_APPROVED_BATCH_V1\n";
const PERMIT_DOMAIN="CST_DEV_ONEJOB_VPS_ONE_SIGNATURE_PERMIT_V1\n";
const BATCH_FIELDS=[
  "schema","project","companyId","changeId","jobId","approvalId",
  "sourceSha","workerName","manifestSha256","issuedAt","expiresAt","permits"
];
const PERMIT_FIELDS=[
  "v","project","companyId","role","purpose","jobId","sourceSha",
  "approvalId","workerName","payloadSha256","nonce","operatorUid",
  "signerUid","publicKeyFingerprint","issuedAt","expiresAt"
];
const H64=/^[0-9a-f]{64}$/,H40=/^[0-9a-f]{40}$/;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const CHANGE=/^CST-DEV-[A-Z0-9-]{6,50}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[0-9a-f]{8}$/;
const UTC=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
/** Public fingerprints from the SHA-pinned 8-role dormant VPS manifest.
 * Any rotation requires independent review and a NEW source commit.
 */
export const ROLES=Object.freeze({
  "qa-evidence":{
    signer:"cst1j-sig-qa-evidence",operator:"cst1j-op-qa",
    purposes:["QA_PRE_ADMISSION","QA_POST_EXECUTION"],
    fingerprint:"1eae96e32b2fd417825c92295f13f2bc2e5f551f8d7608371bfbc31b4706118c"
  },
  "subscriber-ack":{
    signer:"cst1j-sig-subscriber",operator:"cst-onejob-subscriber",
    purposes:["SUBSCRIBER_DELIVERY_ACK"],
    fingerprint:"65c2b20d402e5e8df904ebebf79d8a6360e8c0dc20317d021a88ef182a47645b"
  },
  "core-reconciliation":{
    signer:"cst1j-sig-core",operator:"cst1j-op-core",
    purposes:["CORE_RECONCILIATION"],
    fingerprint:"47cbeb19ebb53f7e8068d4f5ea6fce0c4bb9026290d6172c09c633f08b08aacb"
  },
  "agent-coding":{
    signer:"cst1j-sig-coding",operator:"cst1j-op-coding",
    purposes:["HUB_AGENT_CODING"],
    fingerprint:"18f22d189ebb45a8bf59684abfb495392f38ad86d11fa01b002dcd5a7041b108"
  },
  "agent-infrastructure":{
    signer:"cst1j-sig-infra",operator:"cst1j-op-infra",
    purposes:["HUB_AGENT_INFRASTRUCTURE"],
    fingerprint:"d7163a7fe90fc4a1dacb86a634caefea29676bd75ab3f493ac8bd2deb4970738"
  },
  "agent-security":{
    signer:"cst1j-sig-security",operator:"cst1j-op-security",
    purposes:["HUB_AGENT_SECURITY"],
    fingerprint:"b34f04aa828194db902b3e1a4c130eae8df2ae722a3f8a585df2bef28e2736a0"
  },
  "agent-qa":{
    signer:"cst1j-sig-agentqa",operator:"cst1j-op-agentqa",
    purposes:["HUB_AGENT_QA"],
    fingerprint:"6825420312bd46e99e2e96d18cbc832b2c232c565e1f1cec1554405dc4ec4631"
  },
  "reviewer":{
    signer:"cst1j-sig-reviewer",operator:"cst1j-op-reviewer",
    purposes:["HUB_REVIEWER_FINAL_ACK"],
    fingerprint:"60ea3c1ed63b80f00fcb7d9def304f528c5850e006640d14a830aa043afaadd0"
  }
});
const fail=(x)=>{throw Error("OPERATIONS_RELEASE_"+x)};
const requireOk=(ok,code)=>{if(!ok)fail(code)};
function exactKeys(o,keys){
  return o!==null&&typeof o==="object"&&!Array.isArray(o)&&
    Object.keys(o).length===keys.length&&
    keys.every(k=>Object.prototype.hasOwnProperty.call(o,k));
}
function sortedObject(x){
  if(Array.isArray(x))return x.map(sortedObject);
  if(x&&typeof x==="object")return Object.fromEntries(
    Object.keys(x).sort().map(k=>[k,sortedObject(x[k])]));
  return x;
}
export function canonicalOperationsBatch(payload){
  return Buffer.from(BATCH_DOMAIN+JSON.stringify(sortedObject(payload)),"utf8");
}
export function canonicalOperationsPermit(claims){
  return Buffer.from(PERMIT_DOMAIN+JSON.stringify(
    Object.fromEntries(PERMIT_FIELDS.map(k=>[k,claims[k]]))),"utf8");
}
function strictSignature(value){
  requireOk(typeof value==="string"&&
    /^[A-Za-z0-9+/]{86}==$/.test(value),"INVALID_SIGNATURE_ENCODING");
  const buf=Buffer.from(value,"base64");
  requireOk(buf.length===64&&buf.toString("base64")===value,"INVALID_SIGNATURE_LENGTH");
  return buf;
}
function verifySignature(key,signature,bytes){
  requireOk(verify(null,bytes,key,strictSignature(signature)),"INVALID_OPERATIONS_SIGNATURE");
}
function parsePasswd(passwdText){
  requireOk(typeof passwdText==="string"&&passwdText.length<131072,"PASSWD_UNAVAILABLE");
  const uids=new Map();
  for(const line of passwdText.split("\n")){
    const fields=line.split(":");
    if(fields.length!==7)continue;
    const [user,,uid]=fields;
    if(!/^[0-9]+$/.test(uid))continue;
    requireOk(!uids.has(user),"PASSWD_DUPLICATE_NAME");
    uids.set(user,Number(uid));
  }
  return uids;
}
function timestamp(v){
  requireOk(typeof v==="string"&&UTC.test(v),"UTC_DATE_INVALID");
  const n=Date.parse(v);
  requireOk(Number.isFinite(n)&&new Date(n).toISOString()===v,"UTC_DATE_INVALID");
  return n;
}
export function verifySignedOperationsBrokerRelease({
  batch,rootPublicKeyPem,passwdText,expectedSourceSha,
  approvedRootFingerprint,nowMs=Date.now()
}){
  // Unavailable until independent Operations custody and change approval
  // provides an immutable Ed25519 PUBLIC fingerprint pinned into source.
  requireOk(H64.test(approvedRootFingerprint||""),"INDEPENDENT_ROOT_NOT_PINNED");
  requireOk(typeof rootPublicKeyPem==="string","ROOT_PUBLIC_KEY_MISSING");
  let key;
  try {key=createPublicKey(rootPublicKeyPem)}catch {fail("INVALID_ROOT_KEY")}
  requireOk(key.asymmetricKeyType==="ed25519","ROOT_NOT_ED25519");
  const fp=createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex");
  requireOk(fp===approvedRootFingerprint,"UNTRUSTED_ROOT_FINGERPRINT");
  requireOk(exactKeys(batch,["payload","signatureBase64"]),"BATCH_SHAPE_INVALID");
  const p=batch.payload;
  requireOk(exactKeys(p,BATCH_FIELDS),"BATCH_FIELDS_INVALID");
  requireOk(
    p.schema==="cst-onejob-vps-approved-release-batch/v1"&&p.project===PROJECT&&
    p.companyId==="1"&&typeof p.changeId==="string"&&CHANGE.test(p.changeId)&&
    Number.isSafeInteger(p.jobId)&&p.jobId>482&&p.jobId<=2147483647&&
    typeof p.approvalId==="string"&&UUID.test(p.approvalId)&&
    typeof p.sourceSha==="string"&&H40.test(p.sourceSha)&&
    p.sourceSha===expectedSourceSha&&
    typeof p.workerName==="string"&&WORKER.test(p.workerName)&&
    p.manifestSha256===MANIFEST_SHA,"SIGNED_BATCH_SCOPE_INVALID"
  );
  const start=timestamp(p.issuedAt),end=timestamp(p.expiresAt);
  requireOk(Number.isFinite(nowMs)&&start<=nowMs&&nowMs<end&&
    end-start>0&&end-start<=300000&&nowMs-start<=300000,
    "BATCH_EXPIRED_OR_UNBOUNDED");
  requireOk(exactKeys(p.permits,Object.keys(ROLES)),"EIGHT_DISTINCT_PERMITS_REQUIRED");
  // Canonicalization exactly follows Python importer: sort_keys=True for batch;
  // fixed insertion order for permit claims; no whitespace or escaped Unicode.
  verifySignature(key,batch.signatureBase64,canonicalOperationsBatch(p));
  const uidMap=parsePasswd(passwdText),nonces=new Set();
  for(const [role,expected] of Object.entries(ROLES)){
    const permit=p.permits[role];
    requireOk(exactKeys(permit,["claims","signatureBase64"]),"PERMIT_ENVELOPE_INVALID");
    const c=permit.claims;
    requireOk(exactKeys(c,PERMIT_FIELDS),"PERMIT_CLAIMS_INVALID");
    requireOk(
      c.v===1&&c.project===PROJECT&&c.companyId==="1"&&c.role===role&&
      expected.purposes.includes(c.purpose)&&
      c.jobId===p.jobId&&c.sourceSha===p.sourceSha&&
      c.approvalId===p.approvalId&&c.workerName===p.workerName&&
      c.issuedAt===p.issuedAt&&c.expiresAt===p.expiresAt&&
      H64.test(c.payloadSha256||"")&&H64.test(c.nonce||"")&&
      c.publicKeyFingerprint===expected.fingerprint&&
      Number.isSafeInteger(c.signerUid)&&Number.isSafeInteger(c.operatorUid)&&
      c.signerUid===uidMap.get(expected.signer)&&
      c.operatorUid===uidMap.get(expected.operator)&&
      c.signerUid!==c.operatorUid&&c.signerUid>0&&c.operatorUid>0,
      "PERMIT_BOUNDARY_MISMATCH"
    );
    requireOk(!nonces.has(c.nonce),"DUPLICATE_PERMIT_NONCE");
    nonces.add(c.nonce);
    verifySignature(key,permit.signatureBase64,canonicalOperationsPermit(c));
  }
  return Object.freeze({
    changeId:p.changeId,project:PROJECT,companyId:"1",jobId:p.jobId,
    approvalId:p.approvalId,sourceSha:p.sourceSha,workerName:p.workerName,
    expiresAt:p.expiresAt,verifiedOperationsSignature:true,
    signsOperationalOwnerApproval:false,dispatchPermitted:false
  });
}


// V2 job authorization intentionally contains NO future payload hashes.
// One Owner business approval; nine technical signings across eight roles.
// Every stage receives its own short-lived v1-compatible Ed25519 permit
// *after* independently captured actual payload bytes exist.
export const AUTH_V2_SCHEMA="cst-onejob-vps-job-authorization/v2";
export const AUTH_V2_DOMAIN="CST_DEV_ONEJOB_VPS_JOB_AUTHORIZATION_V2\n";
const AUTH_V2_KEYS=[
  "schema","project","companyId","changeId","jobId","approvalId",
  "sourceSha","workerName","manifestSha256","issuedAt","expiresAt","roles"
];
export function canonicalOperationsJobAuthorizationV2(payload){
  return Buffer.from(AUTH_V2_DOMAIN+JSON.stringify(sortedObject(payload)),"utf8");
}
export function verifySignedOperationsJobAuthorizationV2({
  authorization,rootPublicKeyPem,expectedSourceSha,
  approvedRootFingerprint,nowMs=Date.now()
}){
  requireOk(H64.test(approvedRootFingerprint||""),
    "INDEPENDENT_ROOT_NOT_PINNED");
  requireOk(typeof rootPublicKeyPem==="string","ROOT_PUBLIC_KEY_MISSING");
  let key;
  try{key=createPublicKey(rootPublicKeyPem)}catch{fail("INVALID_ROOT_KEY")}
  requireOk(key.asymmetricKeyType==="ed25519","ROOT_NOT_ED25519");
  const fingerprint=createHash("sha256").update(
    key.export({type:"spki",format:"der"})).digest("hex");
  requireOk(fingerprint===approvedRootFingerprint,"UNTRUSTED_ROOT_FINGERPRINT");
  requireOk(exactKeys(authorization,["payload","signatureBase64"]),
    "AUTH_ENVELOPE_INVALID");
  const p=authorization.payload;
  requireOk(exactKeys(p,AUTH_V2_KEYS),"AUTH_FIELDS_INVALID");
  requireOk(
    p.schema===AUTH_V2_SCHEMA&&p.project===PROJECT&&p.companyId==="1"&&
    typeof p.changeId==="string"&&CHANGE.test(p.changeId)&&
    Number.isSafeInteger(p.jobId)&&p.jobId>482&&p.jobId<=2147483647&&
    typeof p.approvalId==="string"&&UUID.test(p.approvalId)&&
    typeof p.sourceSha==="string"&&H40.test(p.sourceSha)&&
    p.sourceSha===expectedSourceSha&&
    typeof p.workerName==="string"&&WORKER.test(p.workerName)&&
    p.manifestSha256===MANIFEST_SHA,"AUTH_SCOPE_INVALID");
  requireOk(exactKeys(p.roles,Object.keys(ROLES)),"AUTH_ROLES_INVALID");
  for(const [role,row] of Object.entries(ROLES))
    requireOk(p.roles[role]===row.fingerprint,"AUTH_ROLE_FINGERPRINT_MISMATCH");
  const t0=timestamp(p.issuedAt),t1=timestamp(p.expiresAt);
  requireOk(Number.isFinite(nowMs)&&t0<=nowMs&&nowMs<t1&&
    t1-t0>0&&t1-t0<=3600000&&nowMs-t0<=3600000,
    "AUTH_EXPIRED_OR_UNBOUNDED");
  verifySignature(key,authorization.signatureBase64,
    canonicalOperationsJobAuthorizationV2(p));
  return Object.freeze({
    project:p.project,companyId:p.companyId,changeId:p.changeId,
    jobId:p.jobId,approvalId:p.approvalId,sourceSha:p.sourceSha,
    workerName:p.workerName,expiresAt:p.expiresAt,
    operationsAuthorizationVerified:true,
    futurePayloadsPreApproved:false,ownerApprovalVerified:false,
    dispatchPermitted:false,finalAckIssued:false
  });
}
