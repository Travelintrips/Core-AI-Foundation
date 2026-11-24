import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {isReservedOneJobPilotRequest,CST_ONEJOB_RESERVED_REQUEST_PREFIX}
 from "../../artifacts/api-server/src/lib/cstOneJobPilotEnqueueGuard.ts";

const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const prefix=CST_ONEJOB_RESERVED_REQUEST_PREFIX;
const pilot=prefix+"a".repeat(20);
const isNormal=x=>!isReservedOneJobPilotRequest(x);

test("pilots are not eligible for generic queue management; ordinary jobs keep exact old semantics",()=>{
 assert.equal(prefix,"cst-ai-team-company1-dev:pilot-");
 for(const payload of [
  {requestId:pilot,modelId:"qwen2.5:3b"},
  {requestId:pilot+"-forged"},
  {requestId:prefix},
 ])assert.equal(isNormal(payload),false);
 for(const payload of [
  {},null,{requestId:""}, {requestId:"other-job"},
  {requestId:"cst-ai-team-company3-dev:pilot-abc"}
 ])assert.equal(isNormal(payload),true);
});
test("generic enqueue rejects a reserved namespace before resolving DB priorities",()=>{
 const q=read("artifacts/api-server/src/services/queueManagerService.ts");
 const start=q.indexOf("export async function enqueue(");
 const forbidden=q.indexOf("isReservedOneJobPilotRequest(input.payloadJson)",start);
 const firstQuery=q.indexOf("resolveFactors(input)",start);
 const insert=q.indexOf(".insert(aiJobsTable)",start);
 assert.ok(start>=0&&forbidden>start&&firstQuery>forbidden&&insert>firstQuery);
 assert.match(q,/DEV_ONEJOB_OWNER_APPROVAL_REQUIRED/);
});
test("resume, pause, bulk cancel and reprioritize cannot mutate reserved pilot",()=>{
 const q=read("artifacts/api-server/src/services/queueManagerService.ts");
 // No module-import-time Drizzle SQL/schema evaluation. Previous CI mock
 // imports of queueManagerService must not access missing mock exports.
 assert.match(q,/const nonReservedPilotJob = \(\) => sql/);
 assert.match(q,/COALESCE\([\s\S]{0,110}payloadJson[\s\S]{0,120}requestId/);
 assert.match(q,/CST_ONEJOB_RESERVED_REQUEST_PREFIX \+ '%'/);
 const ranges=[
  ["pauseQueue","resumeQueue"],
  ["resumeQueue","cancelQueue"],
  ["cancelQueue","reprioritize"],
 ];
 for(const [a,b] of ranges){
  const start=q.indexOf("export async function "+a+"(");
  const end=q.indexOf("export async function "+b+"(",start+1);
  const code=q.slice(start,end);
  assert.ok(code.includes("nonReservedPilotJob"),a);
  assert.ok(code.includes("where(and(...conditions))"),a);
 }
 const priority=q.slice(q.indexOf("export async function reprioritize("));
 assert.match(priority,/isReservedOneJobPilotRequest\(existing\.payloadJson\)/);
 assert.match(priority,/where\(and\(eq\(aiJobsTable\.id, jobId\),nonReservedPilotJob\(\)\)\)/);
 assert.match(priority,/if\(!updated\)/);
 assert.match(priority,/DEV_ONEJOB_SIGNED_ADMISSION_REQUIRED/);
});
test("general manual retry and job cancel cannot bypass signed one-job admission",()=>{
 const route=read("artifacts/api-server/src/routes/jobs.ts");
 const start=route.indexOf('router.patch("/ai/jobs/:id/retry"');
 const end=route.indexOf('router.patch("/ai/jobs/:id/priority"',start);
 assert.ok(start>=0&&end>start);
 const retry=route.slice(start,end);
 assert.match(retry,/isReservedOneJobPilotRequest\(job\.payloadJson\)/);
 assert.match(retry,/status\(403\)/);
 assert.match(retry,/COALESCE/);
 assert.match(retry,/CST_ONEJOB_RESERVED_REQUEST_PREFIX/);
 assert.match(retry,/if \(!updated\)/);
 const worker=read("artifacts/api-server/src/services/jobWorkerService.ts");
 const cancel=worker.slice(worker.indexOf("export async function cancelJob("));
 assert.match(cancel,/CST_ONEJOB_RESERVED_REQUEST_PREFIX/);
 assert.match(cancel,/COALESCE/);
 assert.match(cancel,/if \(!cancelled\)/);
});
test("existing coding worker retry behavior untouched, signed admission remains separate",()=>{
 const worker=read("artifacts/api-server/src/services/jobWorkerService.ts");
 const start=worker.indexOf("export async function retryJob(");
 const end=worker.indexOf("export async function cancelJob(",start);
 const retry=worker.slice(start,end);
 assert.match(retry,/maxRetry/);
 assert.match(retry,/workerOwnsRunningJob/);
 assert.doesNotMatch(retry,/DEV_ONEJOB_SIGNED_ADMISSION_REQUIRED/);
 const admission=read("docs/dev/cst-onejob-admission-capability.REVIEW-ONLY.sql");
 assert.match(admission,/CST_DEV_ADMISSION_CAPABILITY_NOT_AUTHORIZED_REVIEW_ONLY/);
 assert.match(admission,/admit_verified_onejob_capability/);
 assert.match(admission,/SECURITY DEFINER/);
});
test("network-none PostgreSQL fixture waits for FINAL TCP and atomically creates synthetic schema",()=>{
 const fixture=read("scripts/dev/cst-onejob-generic-queue-sql.disposable.py");
 assert.match(fixture,/pg_isready","-h","127\.0\.0\.1"/);
 assert.match(fixture,/"-h","127\.0\.0\.1","-U","postgres"/);
 assert.match(fixture,/schema_sql="""BEGIN;/);
 assert.match(fixture,/COMMIT;"""/);
 assert.match(fixture,/psql\(schema_sql\)/);
 assert.doesNotMatch(fixture,/psql\("""CREATE SCHEMA/);
});
