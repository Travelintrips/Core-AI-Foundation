import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isReservedOneJobPilotRequest } from "../../artifacts/api-server/src/lib/cstOneJobPilotEnqueueGuard.ts";

const pilotId="cst-ai-team-company1-dev:pilot-"+"a".repeat(20);

test("general job enqueue rejects reserved one-job request across all job types",()=>{
  assert.equal(isReservedOneJobPilotRequest({requestId:pilotId,modelId:"qwen2.5:3b"}),true);
  assert.equal(isReservedOneJobPilotRequest({requestId:pilotId,jobType:"ollama_powershell_execution"}),true);
  assert.equal(isReservedOneJobPilotRequest({requestId:pilotId+"-duplicate"}),true);
});
test("nonpilot jobs retain existing generic enqueue behavior",()=>{
  assert.equal(isReservedOneJobPilotRequest({requestId:"ordinary-work"}),false);
  assert.equal(isReservedOneJobPilotRequest({requestId:"cst-ai-team-company3-dev:pilot-other"}),false);
  assert.equal(isReservedOneJobPilotRequest({}),false);
  assert.equal(isReservedOneJobPilotRequest(null),false);
  assert.equal(isReservedOneJobPilotRequest("string"),false);
});
test("API and model service both reject before database inserts",()=>{
  const root=new URL("../../artifacts/api-server/src/",import.meta.url);
  const route=readFileSync(new URL("routes/jobs.ts",root),"utf8");
  const service=readFileSync(new URL("services/remoteOllamaWorkerService.ts",root),"utf8");
  const routeCheck=route.indexOf("isReservedOneJobPilotRequest(d.payloadJson)");
  const routeEnqueue=route.indexOf("const job = await enqueue(",routeCheck);
  assert.ok(routeCheck>0 && routeEnqueue>routeCheck);
  assert.match(route,/DEV_ONEJOB_OWNER_APPROVAL_REQUIRED/);
  const start=service.indexOf("export async function enqueueRemoteOllamaInvocation");
  const check=service.indexOf("isReservedOneJobPilotRequest(payload)",start);
  const dbInsert=service.indexOf("db.insert(aiJobsTable)",start);
  assert.ok(start>0 && check>start && dbInsert>check);
  assert.match(service,/DEV_ONEJOB_OWNER_APPROVAL_REQUIRED/);
});
