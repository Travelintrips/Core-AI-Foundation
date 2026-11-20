#!/usr/bin/env node
/** Independently pinned QA receipt -> locked CST-DEV admission (candidate).
 * Default DENY. No credentials, grants, migrations, dispatch or ACK issued.
 */
import {openSync,readFileSync,closeSync,fstatSync,lstatSync,realpathSync,constants} from "node:fs";
import {reviewOneJobSignedHandoff} from "./cst-onejob-signed-handoff-review.ts";
import {readRootOwnedQaPublicTrust} from "./cst-onejob-qa-trust-custody.mjs";
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
    require(/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname),"WRONG_POOLER");
    require(u.port==="6543"&&u.pathname==="/postgres","TRANSACTION_POOLER_REQUIRED");
    require(decodeURIComponent(u.username)===LOGIN+"."+PROJECT,"BROKER_LOGIN_MISMATCH");
    require(decodeURIComponent(u.password).length>=16,"BROKER_PASSWORD_INVALID");
    require(u.searchParams.size===1&&u.searchParams.get("sslmode")==="verify-full"&&u.hash==="",
      "TLS_VERIFY_FULL_REQUIRED");
  }catch{blockers.push("INVALID_BROKER_CONNECTION")}
  return {ready:blockers.length===0,blockers};
}
const date=x=>x instanceof Date?x.toISOString():typeof x==="string"?x:"";
export const LOCK_SQL=[
 "SELECT a.id::text a_id,a.job_id a_job_id,a.approved_by_user_id a_owner_id,",
 "a.status a_status,a.purpose a_purpose,a.company_id a_company_id,a.model_id a_model_id,",
 "a.request_id a_request_id,a.worker_name a_worker_name,a.source_sha a_source_sha,",
 "a.approved_at a_approved_at,a.expires_at a_expires_at,a.consumed_at a_consumed_at,",
 "j.id j_id,j.status j_status,j.job_type j_type,j.required_capability j_capability,",
 "j.max_retry j_max_retry,j.payload_json->>'modelId' j_model_id,",
 "j.payload_json->>'requestId' j_request_id,",
 "r.approval_id::text r_approval_id,r.job_id r_job_id,r.company_id r_company_id,",
 "r.request_id r_request_id,r.worker_name r_worker_name,",
 "r.image_source_sha r_source_sha,r.image_id r_image_id,r.verifier_id r_verifier_id,",
 "r.nonce r_nonce,r.proof_digest r_proof_digest,r.verified_at r_verified_at,",
 "r.expires_at r_expires_at,r.consumed_at r_consumed_at",
 "FROM ai_platform.cst_onejob_owner_approvals a",
 "JOIN ai_platform.ai_jobs j ON j.id=a.job_id",
 "JOIN cst_onejob_private.verified_admission_receipts r ON r.approval_id=a.id AND r.job_id=j.id",
 "WHERE j.id=$1 FOR UPDATE OF a,j,r"
].join(" ");
export function mappedLockedRows(x){
  return {
    approval:{id:x.a_id,jobId:Number(x.a_job_id),approvedByUserId:Number(x.a_owner_id),
      status:x.a_status,purpose:x.a_purpose,companyId:x.a_company_id,modelId:x.a_model_id,
      requestId:x.a_request_id,workerName:x.a_worker_name,sourceSha:x.a_source_sha,
      approvedAt:date(x.a_approved_at),expiresAt:date(x.a_expires_at),
      consumedAt:x.a_consumed_at===null?null:date(x.a_consumed_at)},
    job:{id:Number(x.j_id),status:x.j_status,jobType:x.j_type,
      requiredCapability:x.j_capability,maxRetry:Number(x.j_max_retry),
      requestId:x.j_request_id,modelId:x.j_model_id},
    receiptRow:{approvalId:x.r_approval_id,jobId:Number(x.r_job_id),
      companyId:x.r_company_id,requestId:x.r_request_id,workerName:x.r_worker_name,
      imageSourceSha:x.r_source_sha,imageId:x.r_image_id,verifierId:x.r_verifier_id,
      nonce:x.r_nonce,proofDigest:x.r_proof_digest,
      verifiedAt:date(x.r_verified_at),expiresAt:date(x.r_expires_at),
      consumedAt:x.r_consumed_at===null?null:date(x.r_consumed_at)}
  };
}
export async function executeTrustedAdmissionTransaction({
  client,jobId,signedReceipt,evidenceBytes,pinnedTrust,approvedSourceSha
}){
  if(!Number.isSafeInteger(jobId)||jobId<1||jobId===482)
    throw Error("NEW_JOB_REQUIRED");
  if(!Buffer.isBuffer(evidenceBytes)||evidenceBytes.length<1||evidenceBytes.length>65536)
    throw Error("INDEPENDENT_EVIDENCE_REQUIRED");
  if(!SHA.test(approvedSourceSha||""))throw Error("PINNED_SHA_REQUIRED");
  let begun=false;
  try{
    await client.query("BEGIN");begun=true;
    await client.query("SET TRANSACTION READ WRITE");
    await client.query("SET LOCAL ROLE "+ROLE);
    const identity=await client.query("SELECT current_user AS role_name,session_user AS login_name,current_database() AS db");
    const i=identity.rows?.[0];
    if(identity.rows?.length!==1||i?.role_name!==ROLE||
       i?.login_name!==LOGIN||i?.db!=="postgres")
      throw Error("BROKER_SESSION_NOT_BOUND");
    const result=await client.query(LOCK_SQL,[jobId]);
    if(result.rows?.length!==1)throw Error("AUTHORITATIVE_LOCKED_ROWS_MISSING");
    const data=mappedLockedRows(result.rows[0]);
    if(data.approval.sourceSha!==approvedSourceSha)throw Error("IMAGE_SHA_NOT_APPROVED");
    const review=reviewOneJobSignedHandoff({...data,signedReceipt,
      qaPublicKey:pinnedTrust,independentlyCapturedEvidence:evidenceBytes});
    if(review.status!=="BOUND_CRYPTO_REVIEW_ONLY")
      throw Error("SIGNED_QA_EVIDENCE_DENIED");
    const admitted=await client.query(
      "SELECT cst_onejob_private.admit_verified_onejob($1::integer,$2::text,$3::text) AS job_id",
      [jobId,data.receiptRow.nonce,data.receiptRow.proofDigest]
    );
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
    const client=new pg.Client({connectionString:env[KEY],
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
