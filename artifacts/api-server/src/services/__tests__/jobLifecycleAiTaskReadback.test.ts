import {it,expect,vi} from "vitest";
import {readDevAiTaskJob} from "../jobLifecycleAiTaskReadback.js";
const id="169a7492-cfd8-4a56-bb57-18001b6b5968";
const job="238e0ad4-3c74-4469-908a-cd49ac6515f2";
const env={APP_ENV:"development",NODE_ENV:"test",AI_TASK_LEDGER_READBACK_ENABLED:"true",
 AI_TASK_LEDGER_URL:"https://dev-ai-task.cstlogistic.co.id",AI_TASK_BRIDGE_TOKEN:"synthetic-bridge-key-for-offline-tests"};
const body={found:true,source:"AI_CORE",external_id:"bridge-command:"+id,
 id:job,status:"processing",progress:34,timeline:{commandId:id},readOnly:true};
const mock=(value:unknown,status=200)=>vi.fn(async()=>({status,ok:status===200,json:async()=>value})) as unknown as typeof fetch;
it("matching DEV ledger response is only identity evidence",async()=>{
 const fetcher=mock(body);
 const result=await readDevAiTaskJob(id,env,fetcher);
 expect(result).toMatchObject({verified:true,receiverJobId:job,receiverStatus:"processing"});
 expect(fetcher).toHaveBeenCalledOnce();
});
it("wrong source and correlation are denied",async()=>{
 for(const changed of [{source:"OTHER"},{external_id:"wrong"},{timeline:{commandId:"wrong"}},{readOnly:false}]){
  const result=await readDevAiTaskJob(id,env,mock({...body,...changed}));
  expect(result.verified).toBe(false);
 }
});
it("release defaults cannot contact PROD or unconfigured endpoint",async()=>{
 for(const config of [{APP_ENV:"production"},{AI_TASK_LEDGER_READBACK_ENABLED:"false"},
  {AI_TASK_LEDGER_URL:"https://ai-task.cstlogistic.co.id"},{AI_TASK_BRIDGE_TOKEN:"short"}]){
  const fetcher=mock(body);
  expect((await readDevAiTaskJob(id,{...env,...config},fetcher)).verified).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
 }
});
it("404 and network failure remain unverified",async()=>{
 expect((await readDevAiTaskJob(id,env,mock({},404))).verified).toBe(false);
 const offline=vi.fn(async()=>{throw Error("offline")});
 expect((await readDevAiTaskJob(id,env,offline as typeof fetch)).verified).toBe(false);
});
