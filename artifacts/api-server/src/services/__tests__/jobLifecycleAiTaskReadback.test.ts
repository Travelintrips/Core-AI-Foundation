import {it,expect,vi} from "vitest";
import {readDevAiTaskJob} from "../jobLifecycleAiTaskReadback.js";
const id="169a7492-cfd8-4a56-bb57-18001b6b5968";
const job="238e0ad4-3c74-4469-908a-cd49ac6515f2";
const env={APP_ENV:"development",NODE_ENV:"test",AI_TASK_LEDGER_READBACK_ENABLED:"true",
 AI_TASK_LEDGER_URL:"https://dev-ai-task.cstlogistic.co.id",AI_TASK_BRIDGE_TOKEN:"synthetic-bridge-key-for-offline-tests"};
const body={found:true,source:"AI_CORE",external_id:"bridge-command:"+id,
 id:job,status:"processing",progress:34,timeline:{commandId:id},readOnly:true,passiveLedger:true,
 verifiedExecution:false,mayIssueGrant:false,mayDispatchWorker:false};
const mock=(value:unknown,status=200)=>vi.fn(async()=>new Response(JSON.stringify(value),{
 status,headers:{"Content-Type":"application/json"},
})) as unknown as typeof fetch;
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
it("wrong worker attribution fails without upgrading absent worker identity",async()=>{
 for(const workerId of ["other-worker", "", null, 42]){
  const result=await readDevAiTaskJob(id,env,mock({...body,timeline:{commandId:id,workerId}}));
  expect(result).toEqual({verified:false,reason:"RECEIVER_WORKER_CORRELATION_MISMATCH"});
 }
 const legitimate=await readDevAiTaskJob(id,env,mock({...body,
  timeline:{commandId:id,workerId:"openclaw-dell-chatgpt-wake-dev"}}));
 expect(legitimate.verified).toBe(true);
 const absent=await readDevAiTaskJob(id,env,mock(body));
 expect(absent.verified).toBe(true);
});
it("non-passive or omitted provenance is rejected",async()=>{
 for(const passiveLedger of [false,undefined,null,"true"]){
  expect(await readDevAiTaskJob(id,env,mock({...body,passiveLedger}))).toEqual({
   verified:false,reason:"RECEIVER_NOT_PASSIVE_LEDGER"});
 }
});
it("receiver cannot promote ledger identity into execution approval",async()=>{
 for(const changed of [{verifiedExecution:true},{mayIssueGrant:true},{mayDispatchWorker:true},
  {verifiedExecution:undefined},{mayIssueGrant:undefined},{mayDispatchWorker:undefined}]){
  const result=await readDevAiTaskJob(id,env,mock({...body,...changed}));
  expect(result).toEqual({verified:false,reason:"RECEIVER_AUTHORITY_CONTRACT_MISMATCH"});
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
it("oversized, invalid-type, truncated and malformed receiver responses fail closed",async()=>{
 const badResponse=(data:string,headers:Record<string,string>)=>
  vi.fn(async()=>new Response(data,{status:200,headers})) as unknown as typeof fetch;
 const oversized=JSON.stringify({...body,padding:"a".repeat(35000)});
 for(const fetcher of [
  badResponse(oversized,{"Content-Type":"application/json"}),
  badResponse(JSON.stringify(body),{"Content-Type":"text/html"}),
  badResponse(JSON.stringify(body),{"Content-Type":"application/json","Content-Length":"999999"}),
  badResponse('{"found":true',{ "Content-Type":"application/json"}),
 ]){
  const result=await readDevAiTaskJob(id,env,fetcher);
  expect(result.verified).toBe(false);
 }
});
it("a real streaming receiver is consumed with no-store GET and bearer authentication",async()=>{
 const fetcher=mock(body);
 const result=await readDevAiTaskJob(id,env,fetcher);
 expect(result.verified).toBe(true);
 const [url,options]=vi.mocked(fetcher).mock.calls[0]!;
 expect(String(url)).toContain("bridge-command%3A"+id);
 expect(options?.method).toBe("GET");
 expect(options?.redirect).toBe("error");
 expect((options?.headers as Record<string,string>)["Cache-Control"]).toBe("no-store");
 expect((options?.headers as Record<string,string>).Authorization).toMatch(/^Bearer /);
});
it("404 and network failure remain unverified",async()=>{
 expect((await readDevAiTaskJob(id,env,mock({},404))).verified).toBe(false);
 const offline=vi.fn(async()=>{throw Error("offline")});
 expect((await readDevAiTaskJob(id,env,offline as typeof fetch)).verified).toBe(false);
});
