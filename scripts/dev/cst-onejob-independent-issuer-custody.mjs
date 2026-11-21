/**
 * CST-DEV one-job: shared source-only custody gate for independently operated
 * QA and Core reconciliation processes. This is not a provisioner.
 * No secrets, signers, access grants, dispatch, migrations, or PROD calls.
 */
import {createHash,createPublicKey} from "node:crypto";
import {openSync,readFileSync,closeSync,fstatSync,lstatSync,realpathSync,constants} from "node:fs";
import {dirname} from "node:path";
import {createPinnedCstOneJobPgConnection} from "../../lib/db/src/cstOneJobPinnedSupabaseCa.ts";
import {signViaIndependentSocket} from "./cst-onejob-independent-subscriber-one-shot.mjs";

export const PROJECT="xssrfshdrtdfupgqwfdw";
const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const ID=/^cst-[a-z0-9_-]{8,80}$/;
const CHANGE=/^CST-DEV-[A-Z0-9-]{6,50}$/;
const FIELDS=["version","purpose","project","companyId","jobId","sourceSha",
  "workerName","evidenceSha256","signerId","keyFingerprint","operatorUid",
  "signerUid","changeId","issuedAt","expiresAt"];
const exact=(value,fields)=>value&&typeof value==="object"&&!Array.isArray(value)&&
  Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k));
const strictTime=value=>typeof value==="string"&&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&
  Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
// Refuse caller-selected filenames, even under an otherwise valid prefix.
const AUTHORIZED_SOURCE_FILES=new Set([
 "/etc/cst-onejob-qa/approval/qa-release.json",
 "/etc/cst-onejob-qa/approval/core-reconciliation-release.json",
 "/etc/cst-onejob-qa/trust/public-root.json",
 "/etc/cst-onejob-subscriber/trust/public-root.json",
 "/etc/cst-onejob-core-reconciliation/trust/public-root.json",
 "/var/lib/cst-onejob-qa/pre-admission/evidence.bin",
 "/var/lib/cst-onejob-qa/post-execution/evidence.bin",
 "/var/lib/cst-onejob-qa/post-execution/binding.json",
 "/var/lib/cst-onejob-core-reconciliation/evidence/package.json",
]);

export function reviewIndependentIssuerEnvironment(
  env,jobId,purpose,credentialKey,flag,requireDedicatedDatabase=true
){
  const blockers=[],need=(ok,code)=>{if(!ok)blockers.push(code)};
  need(env.APP_ENV==="development"&&env.NODE_ENV==="development","DEV_ONLY");
  need(env.SUPABASE_URL_DEV==="https://"+PROJECT+".supabase.co","PROJECT_NOT_PINNED");
  need(env[flag]==="true","ISSUER_DISABLED");
  need(env.AI_DISPATCHER_ENABLED==="false"&&env.OLLAMA_WORKER_RUNTIME_ENABLED==="false",
    "DISPATCH_NOT_DISABLED");
  need(!env.SUPABASE_PROD_DATABASE_URL&&!env.DATABASE_URL_PROD&&
    !env.DATABASE_URL&&!env.SUPABASE_DEV_DATABASE_URL,
    "SHARED_OR_PROD_DATABASE_FORBIDDEN");
  need(SHA40.test(env.CST_TEAM_DEV_APPROVED_SOURCE_SHA||""),"SOURCE_SHA_INVALID");
  need(WORKER.test(env.CST_TEAM_DEV_APPROVED_WORKER_NAME||""),"WORKER_SCOPE_INVALID");
  need(Number.isSafeInteger(jobId)&&jobId>482,"NEW_ONEJOB_REQUIRED");
  if(requireDedicatedDatabase)
    need(typeof env[credentialKey]==="string"&&env[credentialKey].length>0,
      "DEDICATED_ISSUER_CREDENTIAL_NOT_AVAILABLE");
  need(purpose==="CST_DEV_ONEJOB_INDEPENDENT_QA"||
    purpose==="CST_DEV_ONEJOB_CORE_RECONCILIATION","ISSUER_PURPOSE_INVALID");
  return {ready:blockers.length===0,blockers,releaseDecision:"NO_GO",
    dispatchPermitted:false,finalAckIssued:false};
}

export function reviewIndependentIssuerRelease(release,trust,scope,now=Date.now()){
  const blockers=[],need=(ok,code)=>{if(!ok)blockers.push(code)};
  need(exact(release,FIELDS),"ISSUER_RELEASE_SHAPE_INVALID");
  need(release?.version===1&&release?.purpose===scope.purpose&&
    release.project===PROJECT&&release.companyId==="1"&&
    Number.isSafeInteger(release.jobId)&&release.jobId>482&&
    release.jobId===scope.jobId&&release.sourceSha===scope.sourceSha&&
    release.workerName===scope.workerName&&
    SHA40.test(release.sourceSha||"")&&WORKER.test(release.workerName||"")&&
    SHA64.test(release.evidenceSha256||"")&&
    release.evidenceSha256===scope.evidenceSha256,
    "AUTHORIZED_SOURCE_AND_JOB_NOT_BOUND");
  need(release?.signerId===scope.signerId&&
    release?.keyFingerprint===trust?.fingerprint&&
    SHA64.test(release?.keyFingerprint||"")&&
    ID.test(release?.signerId||"")&&
    trust?.project===PROJECT&&
    trust?.use===scope.trustUse,
    "INDEPENDENT_SIGNER_PIN_NOT_BOUND");
  let keyOk=false;
  try{
    const key=createPublicKey(trust.publicKeyPem);
    keyOk=key.asymmetricKeyType==="ed25519"&&
      sha256(key.export({type:"spki",format:"der"}))===trust.fingerprint;
  }catch{}
  need(keyOk,"INDEPENDENT_PUBLIC_KEY_INVALID");
  const a=Date.parse(release?.issuedAt),b=Date.parse(release?.expiresAt);
  need(strictTime(release?.issuedAt)&&strictTime(release?.expiresAt)&&
    Number.isFinite(now)&&a<=now&&now<b&&b>a&&b-a<=5*60*1000,
    "ISSUER_RELEASE_TIME_INVALID");
  need(CHANGE.test(release?.changeId||"")&&
    Number.isSafeInteger(release?.operatorUid)&&release.operatorUid>0&&
    Number.isSafeInteger(release?.signerUid)&&release.signerUid>0&&
    release.operatorUid!==release.signerUid,
    "INDEPENDENT_CUSTODY_IDENTITY_INVALID");
  return {ready:blockers.length===0,blockers,releaseDecision:"NO_GO",
    dispatchPermitted:false,finalAckIssued:false};
}

/** Read only a preselected absolute path; all parents and file root-owned. */
export function readRootCustodiedFile(path,maxBytes=65536){
  if(!AUTHORIZED_SOURCE_FILES.has(path))
    throw Error("UNAPPROVED_ARTIFACT_PATH");
  const parents=[];
  let d=dirname(path);
  while(d!=="/"){
    parents.push(d);d=dirname(d);
  }
  for(const dir of ["/",...parents.reverse()]){
    const s=lstatSync(dir);
    if(s.uid!==0||!s.isDirectory()||s.isSymbolicLink()||
       (s.mode&0o022)!==0||realpathSync(dir)!==dir)
      throw Error("ARTIFACT_PARENT_CUSTODY_INVALID");
  }
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const f=fstatSync(fd);
    if(f.uid!==0||!f.isFile()||f.nlink!==1||
       (f.mode&0o022)!==0||f.size<1||f.size>maxBytes||
       realpathSync(path)!==path)
      throw Error("ARTIFACT_CUSTODY_INVALID");
    return readFileSync(fd);
  }finally{closeSync(fd)}
}
export function readRootCustodiedJson(path,maxBytes=8192){
  return JSON.parse(readRootCustodiedFile(path,maxBytes).toString("utf8"));
}
export async function openDedicatedIssuerClient(url,login,label){
  // Never pass raw connectionString: tls sslmode must not override pinned CA.
  const options=createPinnedCstOneJobPgConnection(url,login);
  const {default:pg}=await import("pg");
  const client=new pg.Client({...options,connectionTimeoutMillis:3500,
    statement_timeout:4500,application_name:label});
  await client.connect();
  return client;
}
export async function independentlySign(data,uid,path){
  return signViaIndependentSocket(data,path,uid);
}
export function nonRootAuthorizedOperator(release){
  return typeof process.getuid==="function"&&process.getuid()>0&&
    process.getuid()===release.operatorUid&&
    process.getuid()!==release.signerUid;
}
