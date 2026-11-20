import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createOneWaitingJobWithLimitedRole} from "./cst-team-onejob-prestage-once.mjs";
const scope={
 jobCode:"OLLAMA-A1B2C3D4",
 requestId:"cst-ai-team-company1-dev:pilot-"+"a".repeat(20),
 sourceSha:"b".repeat(40),
 workerName:"cst-dev-dell-onejob-20261120-abcdef12",
};
function connection({role="cst_team_onejob_prestage_20261120_abcdef12",
  db="postgres",error=null,rows=null}={}){
 const calls=[];
 const client={async query(query,params=[]){
  calls.push({query,params});
  if(query==="BEGIN"||query==="ROLLBACK"||query==="COMMIT")return{rowCount:0};
  if(query.includes("current_user AS role"))
    return{rows:[{role,database_name:db}]};
  if(query.includes("INSERT INTO ai_platform.ai_jobs")){
   if(error)throw error;
   return{rowCount:1,rows:rows??[{
     id:483,job_code:scope.jobCode,status:"waiting",
     payload_json:{requestId:scope.requestId,modelId:"qwen2.5:3b"}
   }]};
  }
  throw Error("UNEXPECTED_DATABASE_QUERY");
 }};
 return {client,calls};
}
test("one bounded WAITING job inserted and read back without approval/dispatch",async()=>{
 const a=connection(),out=await createOneWaitingJobWithLimitedRole(a.client,scope);
 assert.equal(out.status,"waiting");
 assert.equal(out.ownerApprovalVerified,false);
 assert.equal(out.dispatchPermitted,false);
 assert.equal(out.newJobQueued,false);
 assert.deepEqual(a.calls.map(x=>x.query.split(" ")[0]),
  ["BEGIN","SELECT","INSERT","COMMIT"]);
 const p=JSON.parse(a.calls[2].params[1]);
 assert.equal(p.modelId,"qwen2.5:3b");
 assert.equal(p.maxOutputTokens,24);
 assert.deepEqual(JSON.parse(p.input),{
  version:1,
  system:"DEV-only model liveness check. Reply exactly with the requested token.",
  user:"Reply CST_DEV_ONEJOB_PROBE_OK",
 });
 assert.equal(p.responseFormat.type,"text");
});
test("wrong role, wrong database or rejected RLS always rolls back",async()=>{
 for(const changes of [
  {role:"aicore_dev_runtime"},{role:"postgres"},
  {role:"cst_team_model_pilot_writer"},
  {db:"prod"},{error:Object.assign(Error("RLS"),{code:"42501"})},
  {rows:[{id:482,job_code:scope.jobCode,status:"waiting",
    payload_json:{requestId:scope.requestId,modelId:"qwen2.5:3b"}}]},
 ]){
  const fixture=connection(changes);
  await assert.rejects(
    createOneWaitingJobWithLimitedRole(fixture.client,scope));
  assert.equal(fixture.calls.at(-1).query,"ROLLBACK");
 }
});
test("duplicate active job SQLSTATE 23505 is fail-closed and never an idempotent fake PASS",async()=>{
 const a=connection({error:Object.assign(Error("unique"),{code:"23505"})});
 await assert.rejects(createOneWaitingJobWithLimitedRole(a.client,scope),
  /CST_PRESTAGE_SECOND_ACTIVE_JOB_OR_DUPLICATE_REQUEST/);
 assert.equal(a.calls.at(-1).query,"ROLLBACK");
});
test("Company 3, historic #482, wrong source and extra payload are rejected before transaction",async()=>{
 for(const patch of [
  {requestId:"cst-ai-team-company3-dev:pilot-"+"a".repeat(20)},
  {requestId:"other"},
  {sourceSha:"INVALID"},
  {workerName:"openclaw-vps-main"},
  {jobCode:"OLLAMA-DEAD"},
  {arbitrary:true},
 ]){
  const a=connection();
  await assert.rejects(createOneWaitingJobWithLimitedRole(a.client,{...scope,...patch}),
    /CST_PRESTAGE_EXACT_SCOPE_REQUIRED/);
  assert.equal(a.calls.length,0);
 }
});
test("CLI is fixed DEV only, scoped cert pin, nonroot and rejects shared credentials",()=>{
 const src=readFileSync(new URL("./cst-team-onejob-prestage-once.mjs",import.meta.url),"utf8");
 assert.match(src,/CST_ONEJOB_PRESTAGE_ENABLED!=="true"/);
 assert.match(src,/process\.getuid\?\.\(\)===0/);
 assert.match(src,/SUPABASE_URL_DEV!==/);
 assert.match(src,/SUPABASE_PROD_DATABASE_URL/);
 assert.match(src,/loadPinnedCstDevSupabaseRootCa\(\)/);
 assert.match(src,/rejectUnauthorized:true,ca,servername:HOST/);
 assert.match(src,/credential\.json/);
 assert.match(src,/info\.mode&0o077/);
 assert.doesNotMatch(src,/startOperationalCstDevBroker|sign\(|execFile\(|spawn\(/);
 assert.doesNotMatch(src,/INSERT INTO ai_platform\.cst_onejob_owner_approvals/);
 assert.match(src,/dispatchPermitted:false/);
});
