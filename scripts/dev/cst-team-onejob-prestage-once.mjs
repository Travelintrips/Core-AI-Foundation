/**
 * CST-DEV ONE-JOB PRE-STAGING ONLY.
 *
 * One ephemeral machine role creates exactly one Company-1 WAITING job; does
 * NOT sign Owner approval, queue, dispatch, execute, or produce a receipt.
 * Runtime credential is supplied from a dedicated 0400 file on an authorized
 * DEV operator, never from chat or shared Core DEV credentials.
 *
 * The model candidate itself MUST still use independently verified broker,
 * encrypted pooler TLS, short-lived model role and Owner approval.
 */
import {createHash,randomBytes} from "node:crypto";
import {lstatSync,readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {loadPinnedCstDevSupabaseRootCa} from "../../lib/db/src/cstOneJobPinnedSupabaseCa.ts";

const ROOT_URL=new URL("../../lib/db/package.json",import.meta.url);
const HOST="aws-1-ap-southeast-2.pooler.supabase.com";
const PROJECT="xssrfshdrtdfupgqwfdw";
const ROLE=/^cst_team_onejob_prestage_[0-9]{8}_[a-f0-9]{8}$/;
const REQ=/^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const JOB=/^OLLAMA-[A-F0-9]{8}$/;
const SHA=/^[a-f0-9]{40}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const INPUT=Object.freeze({
 version:1,
 system:"DEV-only model liveness check. Reply exactly with the requested token.",
 user:"Reply CST_DEV_ONEJOB_PROBE_OK",
});
const PAYLOAD=(requestId)=>Object.freeze({
 requestId,modelId:"qwen2.5:3b",
 responseFormat:{type:"text"},
 maxOutputTokens:24,
 input:JSON.stringify(INPUT),
});
const deny=(s)=>{throw Error("CST_PRESTAGE_"+s)};
function checkScope(s){
 if(!s || typeof s!=="object" || Array.isArray(s) ||
   Object.keys(s).sort().join(",")!=="jobCode,requestId,sourceSha,workerName" ||
   !REQ.test(s.requestId)||!JOB.test(s.jobCode)||
   !SHA.test(s.sourceSha)||!WORKER.test(s.workerName))
    deny("EXACT_SCOPE_REQUIRED");
 return s;
}
export async function createOneWaitingJobWithLimitedRole(client,scope){
 const s=checkScope(scope);
 if(!client || typeof client.query!=="function")deny("CLIENT_REQUIRED");
 let started=false;
 try {
  await client.query("BEGIN");
  started=true;
  const session=await client.query(
   "SELECT current_user AS role, current_database() AS database_name");
  const role=session.rows?.[0]?.role;
  if(!ROLE.test(role||"")||session.rows?.[0]?.database_name!=="postgres")
    deny("DEDICATED_STAGING_ROLE_NOT_VERIFIED");
  // The PostgreSQL RLS policy authorizes one exact pending request, and
  // a persistent partial UNIQUE index forbids a second waiting/queued/running
  // Company-1 model job even with another requestId (cross-session race).
  const result=await client.query(
   "INSERT INTO ai_platform.ai_jobs"+
   "(job_code,job_type,required_capability,status,max_retry,"+
   "retry_strategy,priority,priority_score,payload_json)"+
   " VALUES ($1,'ollama_model_invocation','ollama_inference',"+
   "'waiting',0,'immediate',70,70,$2::jsonb)"+
   " RETURNING id,job_code,status,payload_json",
   [s.jobCode,JSON.stringify(PAYLOAD(s.requestId))]);
  const row=result.rows?.[0];
  if(result.rowCount!==1 || !Number.isSafeInteger(row?.id) ||
     row.id<=0||row.id===482 ||
     row.job_code!==s.jobCode||row.status!=="waiting" ||
     row.payload_json?.requestId!==s.requestId ||
     row.payload_json?.modelId!=="qwen2.5:3b")
    deny("WAITING_JOB_WRITE_READBACK_MISMATCH");
  await client.query("COMMIT");
  started=false;
  return Object.freeze({
    check:"CST_DEV_ONE_JOB_WAITING_PRESTAGE",
    jobId:row.id,jobCode:row.job_code,
    requestId:s.requestId,sourceSha:s.sourceSha,
    workerName:s.workerName,status:"waiting",
    ownerApprovalVerified:false,
    newJobQueued:false,dispatchPermitted:false,
    nextRequiredAction:"RELOCK_PRESTAGE_ROLE_AND_READ_AUTHENTICATED_OWNER_INTENT",
    operationalE2EVerified:false,
  });
 } catch(e){
  if(started){await client.query("ROLLBACK").catch(()=>{})}
  if(e?.code==="23505")deny("SECOND_ACTIVE_JOB_OR_DUPLICATE_REQUEST");
  throw e;
 }
}
function loadStageCredential(){
 const path="/run/cst-onejob-prestage/credential.json";
 let info;
 try{info=lstatSync(path)}catch{deny("DEDICATED_CREDENTIAL_NOT_MOUNTED")}
 if(!info.isFile()||info.isSymbolicLink()||
    (info.mode&0o077)!==0 ||
    info.size<75 ||info.size>1024 ||
    info.uid!==process.getuid())
   deny("CREDENTIAL_FILE_INSECURE");
 let data;
 try{data=JSON.parse(readFileSync(path,"utf8"))}catch{deny("CREDENTIAL_JSON_INVALID")}
 if(!data || typeof data!=="object" || Array.isArray(data) ||
   Object.keys(data).sort().join(",")!=="password,role" ||
   !ROLE.test(data.role)||
   typeof data.password!=="string"||data.password.length<32||
   data.password.length>256)
  deny("CREDENTIAL_SCOPE_INVALID");
 return data;
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=="--stage-one-waiting")
   deny("NO_RUN_MODE_OTHER_THAN_WAITING");
 if(process.env.NODE_ENV!=="development"||
    process.env.APP_ENV!=="development"||
    process.env.CST_ONEJOB_PRESTAGE_ENABLED!=="true"||
    process.env.SUPABASE_URL_DEV!=="https://"+PROJECT+".supabase.co"||
    Boolean(process.env.SUPABASE_PROD_DATABASE_URL)||
    process.getuid?.()===0)
   deny("DEV_PRESTAGE_ENVIRONMENT_UNVERIFIED");
 const scope=checkScope({
  jobCode:process.env.CST_ONEJOB_PRESTAGE_JOB_CODE,
  requestId:process.env.CST_ONEJOB_PRESTAGE_REQUEST_ID,
  sourceSha:process.env.CST_ONEJOB_PRESTAGE_SOURCE_SHA,
  workerName:process.env.CST_ONEJOB_PRESTAGE_WORKER_NAME,
 });
 const {role,password}=loadStageCredential();
 const ca=loadPinnedCstDevSupabaseRootCa();
 const {Client}=createRequire(ROOT_URL)("pg");
 const url=new URL("postgresql://"+encodeURIComponent(role+"."+PROJECT)+
   ":"+encodeURIComponent(password)+"@"+HOST+":6543/postgres");
 const client=new Client({
   connectionString:url.toString(),
   ssl:{rejectUnauthorized:true,ca,servername:HOST},
   connectionTimeoutMillis:4000,query_timeout:5000,
 });
 try{
  await client.connect();
  const result=await createOneWaitingJobWithLimitedRole(client,scope);
  console.log(JSON.stringify(result));
 } finally {await client.end().catch(()=>{})}
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(e=>{
   // Do not reveal Postgres DSN, credentials, SQL or source DB details.
   const safe=(typeof e?.message==="string"&&e.message.startsWith("CST_PRESTAGE_"))?
     e.message:"CST_PRESTAGE_FAILED_CLOSED";
   console.error(safe);process.exitCode=2;
 });
}
