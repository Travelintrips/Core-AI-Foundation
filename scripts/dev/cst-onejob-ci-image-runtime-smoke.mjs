#!/usr/bin/env node
/** Offline QA: boot actual matched API + UI inside GitHub Docker --network none.
 * No real database credentials, Owner session, signer, dispatch or PROD.
 */
import {spawn} from "node:child_process";
import {readFileSync} from "node:fs";
import {setTimeout as sleep} from "node:timers/promises";

const guard=process.env.CST_ONEJOB_IMAGE_SMOKE_QA==="true" &&
  process.env.APP_ENV==="development" &&
  process.env.NODE_ENV==="development" &&
  process.env.AI_DISPATCHER_ENABLED==="false" &&
  process.env.OLLAMA_WORKER_RUNTIME_ENABLED==="false" &&
  process.env.CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED==="false" &&
  process.env.CST_DEV_ONEJOB_BROKER_ENABLED==="false" &&
  !process.env.SUPABASE_DATABASE_URL_PROD && !process.env.DATABASE_URL_PROD;
if(!guard){
 console.log("CI_RUNTIME_SMOKE_DENIED_INVALID_SCOPE");
 process.exit(2);
}
const expected=process.env.QA_SOURCE_SHA||"";
const actual=readFileSync("/app/.cst-build-sha","utf8").trim();
if(!/^[a-f0-9]{40}$/.test(expected)||expected!==actual){
 console.log("CI_RUNTIME_SMOKE_DENIED_SOURCE_MISMATCH");
 process.exit(2);
}
const local="http://127.0.0.1:3000";
const env={
 ...process.env,
 PORT:"3000",
 SERVE_STATIC_FRONTEND:"true",
 HOSTINGER_FRONTEND:"ai-platform",
 // Required DEV project pin. This is public URL data, not a credential.
 SUPABASE_URL_DEV:"https://xssrfshdrtdfupgqwfdw.supabase.co",
 AI_DEV_BACKGROUND_RUNTIME_ENABLED:"false",
 AI_SCHEDULER_ENABLED:"false",
 AI_INCIDENT_WATCHER_ENABLED:"false",
 AI_PROVIDER_BILLING_MONITOR_ENABLED:"false",
 AI_DISPATCHER_ENABLED:"false",
 OLLAMA_WORKER_RUNTIME_ENABLED:"false",
 CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED:"false",
 CST_DEV_ONEJOB_BROKER_ENABLED:"false",
 // Deliberately synthetic hostname; no networking permitted by CI Docker.
 SUPABASE_DEV_DATABASE_URL:
   "postgresql://aicore_dev_runtime.xssrfshdrtdfupgqwfdw:synthetic-test-only@" +
   "aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=verify-full",
};
let stopped=false,output="";
const server=spawn(process.execPath,["/app/artifacts/api-server/dist/index.mjs"],{
 env,stdio:["ignore","pipe","pipe"]
});
const collect=chunk=>{output=(output+String(chunk)).slice(-16000)};
server.stdout.on("data",collect);
server.stderr.on("data",collect);
server.on("close",()=>{stopped=true});
async function request(path,options={}){
 const res=await fetch(local+path,{...options,signal:AbortSignal.timeout(1000)});
 const body=await res.text();
 return {status:res.status,body};
}
const assert=(ok,why)=>{if(!ok)throw Error(why)};
try{
 let ready=false,lastError="";
 for(let n=0;n<50;n++){
  if(stopped)throw Error("CORE_CI_API_EXITED_BEFORE_READINESS");
  try{
   const health=await request("/api/readyz");
   if(health.status===200){ready=true;break}
   lastError="READY_HTTP_"+health.status;
  }catch(e){lastError=e instanceof Error?e.name:"UNREACHABLE"}
  await sleep(250);
 }
 assert(ready,"CORE_CI_API_NOT_READY_"+lastError);
 const get=await request("/api/ai/dev/onejob/owner-stage-readiness");
 assert(get.status===401,"ANONYMOUS_OWNER_GET_NOT_DENIED");
 const post=await request("/api/ai/dev/onejob/owner-approve-and-stage",{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({intent:"APPROVE_ONE_NEW_CST_DEV_MODEL_JOB"})
 });
 assert(post.status===401,"ANONYMOUS_SUPER_ADMIN_POST_NOT_DENIED");
 const page=await request("/dev-onejob");
 assert(page.status===200 && /<html/i.test(page.body),
   "ONEJOB_UI_ROUTE_NOT_SERVED_BY_MATCHED_IMAGE");
 const meta=await request("/build-meta.json");
 assert(meta.status===200,"ONEJOB_UI_BUILD_META_MISSING");
 let info;try{info=JSON.parse(meta.body)}catch{throw Error("BUILD_META_INVALID_JSON")}
 assert(info.commitSha===expected,"ONEJOB_UI_API_SOURCE_NOT_MATCHED");
 console.log(JSON.stringify({
  status:"CI_IMAGE_RUNTIME_SMOKE_PASS_NO_AUTHORITY",
  project:"xssrfshdrtdfupgqwfdw",sha:expected,
  apiReadyz:200,anonymousOwnerGet:401,anonymousOwnerPost:401,
  spaDevOnejob:200,buildMetaMatches:true,
  ownerSessionAuthenticated:false,ownerApprovalCreated:false,
  dispatchPermitted:false,signerActivated:false,realE2EPass:false,
  releaseDecision:"NO_GO",
 }));
}catch(e){
 const reason=e instanceof Error?e.message:"UNKNOWN";
 console.log(JSON.stringify({
  status:"CI_IMAGE_RUNTIME_SMOKE_FAILED",reason,
  crashSigns:(output.slice(0,550)+"\n"+output.slice(-900))
    .replaceAll(/postgres(?:ql)?:\/\/\S+/g,"REDACTED"),
  releaseDecision:"NO_GO",
 }));
 process.exitCode=1;
}finally{
 if(!stopped)server.kill("SIGTERM");
 await Promise.race([
  new Promise(resolve=>server.once("close",resolve)),
  sleep(1800)
 ]);
 if(!stopped)server.kill("SIGKILL");
}
