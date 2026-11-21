#!/usr/bin/env node
/** Independently pinned QA receipt -> scoped CST-DEV admission (candidate).
 * Default DENY. No credentials, grants, migrations, dispatch or ACK issued.
 */
import {openSync,readFileSync,closeSync,fstatSync,lstatSync,realpathSync,constants} from "node:fs";
import {createHash} from "node:crypto";
import {reviewSignedIndependentQaReceipt} from
  "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";
import {readRootOwnedQaPublicTrust} from "./cst-onejob-qa-trust-custody.mjs";
import {CST_ONEJOB_DEV_POOLER,createPinnedCstOneJobPgConnection}
  from "../../lib/db/src/cstOneJobPinnedSupabaseCa.ts";
export const PROJECT="xssrfshdrtdfupgqwfdw";
export const LOGIN="cst_onejob_broker_login";
export const ROLE="cst_onejob_admission_broker";
const KEY="CST_DEV_ONEJOB_BROKER_DATABASE_URL";
const INBOX="/var/lib/cst-onejob-qa/pre-admission";
const RELEASE="/etc/cst-onejob-qa/approval/broker-release.json";
const SHA=/^[a-f0-9]{40}$/;
export function reviewBrokerEnvironment(env){
  const blockers=[],require=(ok,name)=>{if(!ok)blockers.push(name)};
  require(env.APP_ENV==="development"&&env.NODE_ENV==="development","DEV_ONLY");
  require(!env.SUPABASE_PROD_DATABASE_URL&&!env.DATABASE_URL_PROD,"PROD_FORBIDDEN");
  require(env.CST_DEV_ONEJOB_BROKER_ENABLED==="true","BROKER_DISABLED");
  require(env.AI_DISPATCHER_ENABLED==="false"&&env.OLLAMA_WORKER_RUNTIME_ENABLED==="false",
    "DISPATCH_NOT_DISABLED");
  require(env.SUPABASE_URL_DEV==="https://"+PROJECT+".supabase.co","WRONG_DEV_PROJECT");
  require(SHA.test(env.CST_TEAM_DEV_APPROVED_SOURCE_SHA||""),"SHA_NOT_PINNED");
  if(!env[KEY])blockers.push("DEDICATED_BROKER_SECRET_MISSING");
  else try{
    const u=new URL(env[KEY]);
    require(["postgres:","postgresql:"].includes(u.protocol),"INVALID_PROTOCOL");
    require(u.hostname===CST_ONEJOB_DEV_POOLER,"WRONG_POOLER");
    require(u.port==="6543"&&u.pathname==="/postgres","TRANSACTION_POOLER_REQUIRED");
    require(decodeURIComponent(u.username)===LOGIN+"."+PROJECT,"BROKER_LOGIN_MISMATCH");
    require(decodeURIComponent(u.password).length>=16,"BROKER_PASSWORD_INVALID");
    require(u.searchParams.size===1&&u.searchParams.get("sslmode")==="verify-full"&&u.hash==="",
      "TLS_VERIFY_FULL_REQUIRED");
  }catch{blockers.push("INVALID_BROKER_CONNECTION")}
  return {ready:blockers.length===0,blockers};
}
// This database capability is NOT installed by this script. A separately
// approved migration must make it available only to the dedicated broker role.
// Its SECURITY DEFINER executor (if approved) owns the row locks and checks.
export const ADMISSION_SQL=
  "SELECT cst_onejob_private.admit_verified_onejob_capability($1::integer,$2::text,$3::text) AS job_id";

/**
 * Detached QA proof and independently collected evidence are verified before
 * ANY database query. There is deliberately no SELECT/FOR UPDATE or table DML
 * in the broker. Database authority is separate: an independent QA writer
 * must persist the PRE receipt, and the narrowly scoped capability must
 * atomically recheck real Owner, job, receipt, nonce, RLS and replay state.
 */
export function reviewAdmissionBeforeDatabase({
  jobId,signedReceipt,evidenceBytes,pinnedTrust,approvedSourceSha
}){
  if(!Number.isSafeInteger(jobId)||jobId<=482)
    throw Error("NEW_JOB_REQUIRED");
  if(!Buffer.isBuffer(evidenceBytes)||evidenceBytes.length<1||evidenceBytes.length>65536)
    throw Error("INDEPENDENT_EVIDENCE_REQUIRED");
  if(!SHA.test(approvedSourceSha||""))throw Error("PINNED_SHA_REQUIRED");
  const c=signedReceipt?.claims;
  if(!c||c.jobId!==jobId||c.sourceSha!==approvedSourceSha)
    throw Error("RELEASE_QA_JOB_OR_SHA_MISMATCH");
  if(!pinnedTrust||pinnedTrust.project!==PROJECT||
     pinnedTrust.verifierId!==c.verifierId)
    throw Error("INDEPENDENT_QA_TRUST_MISMATCH");
  const review=reviewSignedIndependentQaReceipt(signedReceipt,{
    project:PROJECT,approvalId:c.approvalId,jobId,
    requestId:c.requestId,workerName:c.workerName,sourceSha:approvedSourceSha,
    imageId:c.imageId,stage:"PRE_ADMISSION",verifierId:pinnedTrust.verifierId,
    publicKeyPem:pinnedTrust.publicKeyPem,
    trustedFingerprint:pinnedTrust.fingerprint,
    nowIso:new Date().toISOString()
  });
  if(review.status!=="CRYPTOGRAPHIC_BINDING_VALID")
    throw Error("SIGNED_QA_EVIDENCE_DENIED");
  const observedDigest=createHash("sha256").update(evidenceBytes).digest("hex");
  if(observedDigest!==c.evidenceDigest)
    throw Error("INDEPENDENT_EVIDENCE_BYTES_DIGEST_MISMATCH");
  // The digest is deterministic over the full Ed25519-signed canonical claims;
  // DB must match this exact digest AND nonce against an independently written
  // verified PRE receipt, not a row self-asserted by the broker.
  return {jobId,nonce:c.nonce,proofDigest:review.canonicalDigest};
}

export async function executeTrustedAdmissionTransaction({
  client,jobId,signedReceipt,evidenceBytes,pinnedTrust,approvedSourceSha
}){
  const preflight=reviewAdmissionBeforeDatabase({
    jobId,signedReceipt,evidenceBytes,pinnedTrust,approvedSourceSha
  });
  let begun=false;
  try{
    await client.query("BEGIN");begun=true;
    await client.query("SET TRANSACTION READ WRITE");
    await client.query("SET LOCAL ROLE "+ROLE);
    const identity=await client.query(
      "SELECT current_user AS role_name,session_user AS login_name,current_database() AS db");
    const i=identity.rows?.[0];
    if(identity.rows?.length!==1||i?.role_name!==ROLE||
       i?.login_name!==LOGIN||i?.db!=="postgres")
      throw Error("BROKER_SESSION_NOT_BOUND");
    const admitted=await client.query(ADMISSION_SQL,[
      preflight.jobId,preflight.nonce,preflight.proofDigest
    ]);
    if(admitted.rows?.length!==1||Number(admitted.rows[0].job_id)!==jobId)
      throw Error("ATOMIC_JOB_ADMISSION_NOT_CONFIRMED");
    await client.query("COMMIT");begun=false;
    return {status:"ADMISSION_COMMITTED",jobId,queueTransitionCompleted:true,
      dispatchPermitted:false,signerActivationPermitted:false,finalAckIssued:false};
  }catch(error){
    if(begun)try{await client.query("ROLLBACK")}catch{}
    throw error;
  }
}
function pinnedFile(path,max){
  const dirs=path.startsWith(INBOX)?
    ["/var","/var/lib","/var/lib/cst-onejob-qa",INBOX]:
    ["/etc","/etc/cst-onejob-qa","/etc/cst-onejob-qa/approval"];
  for(const d of dirs){
    const s=lstatSync(d);
    if(s.uid!==0||(s.mode&0o022)!==0||!s.isDirectory()||
       s.isSymbolicLink()||realpathSync(d)!==d)throw Error("QA_PARENT_UNSAFE");
  }
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=fstatSync(fd);
    if(s.uid!==0||(s.mode&0o022)!==0||!s.isFile()||s.nlink!==1||
       s.size<1||s.size>max)throw Error("QA_FILE_UNSAFE");
    return readFileSync(fd);
  }finally{closeSync(fd)}
}
export async function main(args=process.argv.slice(2),env=process.env){
  if(args.length!==1||args[0]!=="--execute-approved-dev")
    return {status:"DENIED",reason:"EXPLICIT_APPROVED_DEV_MODE_REQUIRED"};
  const gate=reviewBrokerEnvironment(env);
  if(!gate.ready)return {status:"DENIED",reason:"BROKER_NOT_PROVISIONED",blockers:gate.blockers};
  try{
    const release=JSON.parse(pinnedFile(RELEASE,8192).toString("utf8"));
    if(release.project!==PROJECT||release.authorization!=="ONEJOB_DEV_ONLY"||
       release.sourceSha!==env.CST_TEAM_DEV_APPROVED_SOURCE_SHA||
       typeof release.changeId!=="string"||
       !/^CST-DEV-[A-Z0-9-]{6,50}$/.test(release.changeId)||
       typeof release.expiresAt!=="string"||
       !(Date.now()<Date.parse(release.expiresAt))||
       !(Date.parse(release.expiresAt)-Date.now()<=1800000))
      return {status:"DENIED",reason:"RELEASE_CUSTODY_INVALID"};
    const pinnedTrust=readRootOwnedQaPublicTrust().document;
    const signedReceipt=JSON.parse(pinnedFile(INBOX+"/receipt.json",16384).toString("utf8"));
    const evidenceBytes=pinnedFile(INBOX+"/evidence.bin",65536);
    const {default:pg}=await import("pg");
    // Explicit CA and exact regional hostname; never let URL sslmode
    // replace the pinned CA on a live connection.
    const client=new pg.Client({...createPinnedCstOneJobPgConnection(env[KEY],LOGIN),
      connectionTimeoutMillis:3500,statement_timeout:4000,
      application_name:"cst-dev-onejob-independent-broker"});
    let connected=false;
    try{
      await client.connect();connected=true;
      return {...await executeTrustedAdmissionTransaction({
        client,jobId:signedReceipt?.claims?.jobId,signedReceipt,evidenceBytes,
        pinnedTrust,approvedSourceSha:release.sourceSha
      }),changeId:release.changeId};
    }finally{if(connected)await client.end().catch(()=>{})}
  }catch{
    return {status:"DENIED",reason:"TRUSTED_BROKER_OR_CUSTODY_UNAVAILABLE",
      dispatchPermitted:false,finalAckIssued:false};
  }
}
if(import.meta.url==="file://"+process.argv[1]){
  const report=await main();
  console.log(JSON.stringify(report));
  if(report.status!=="ADMISSION_COMMITTED")process.exitCode=2;
}
