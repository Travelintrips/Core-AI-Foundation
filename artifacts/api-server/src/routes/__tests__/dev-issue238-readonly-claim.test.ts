import express from "express";
import request from "supertest";
import {beforeEach,describe,expect,it,vi} from "vitest";
const auth=vi.hoisted(()=>({name:"openclaw-vps-dev-consumer",enabled:true}));
vi.mock("@workspace/db",()=>({db:{execute:vi.fn()},}));
vi.mock("../../middleware/agentServiceAuth.js",()=>({
  requireAgentServiceScope:()=> (_req:any,res:any,next:any)=>{
    if(_req.header("authorization")!=="Bearer qa-test-only"){res.status(401).json({error:"TOKEN_REQUIRED"});return;}
    res.locals.aiAgentService={id:"fixture-token-id",name:auth.name,
      scopes:auth.enabled?["agent:work"]:["agent:presence"]};
    next();
  },
}));
import {createIssue238ReadonlyClaimRouter} from "../dev-issue238-readonly-claim.js";
const command="11111111-1111-4111-8111-111111111111";
const token="33333333-3333-4333-8333-333333333333";
const task="22222222-2222-4222-8222-222222222222";
const path="/api/ai/agent-runtime/dev/issue238/claim-readiness/"+command;
const headers={Host:"dev.cstlogistic.co.id",Authorization:"Bearer qa-test-only",
  "x-ai-claim-token":token};
function rig(result:{commandId:string;jobId:string;leaseExpiresAt:string}|null=null){
 const lookup=vi.fn().mockResolvedValue(result);
 const app=express();app.use("/api/ai/agent-runtime/dev/issue238/claim-readiness",
   createIssue238ReadonlyClaimRouter(lookup));return {app,lookup};
}
describe("Issue238 exact active AI Core claim read-only",()=>{
 beforeEach(()=>{vi.stubEnv("APP_ENV","development");auth.name="openclaw-vps-dev-consumer";auth.enabled=true;});
 it("refuses missing auth",async()=>{const r=rig();await request(r.app).get(path)
   .set({Host:headers.Host,"x-ai-claim-token":token}).expect(401);expect(r.lookup).not.toHaveBeenCalled();});
 it("refuses other credential or wrong scope",async()=>{
  for(const mode of ["name","scope"]){
   const r=rig();if(mode==="name")auth.name="other-worker";else auth.enabled=false;
   await request(r.app).get(path).set(headers).expect(403);
   expect(r.lookup).not.toHaveBeenCalled();auth.name="openclaw-vps-dev-consumer";auth.enabled=true;
  }
 });
 it("rejects non-DEV hostname and environment",async()=>{
   const r=rig();await request(r.app).get(path).set({...headers,Host:"prod.cstlogistic.co.id"}).expect(403);
   vi.stubEnv("APP_ENV","production");await request(r.app).get(path).set(headers).expect(403);
   expect(r.lookup).not.toHaveBeenCalled();
 });
 it("fails closed on missing/malformed claim token or command UUID",async()=>{
   const r=rig();await request(r.app).get(path).set({Host:headers.Host,Authorization:headers.Authorization}).expect(400);
   await request(r.app).get(path).set({...headers,"x-ai-claim-token":"not-uuid"}).expect(400);
   await request(r.app).get(path.replace(command,"bad-command")).set(headers).expect(400);
   expect(r.lookup).not.toHaveBeenCalled();
 });
 it("no matching authoritative DB claim returns no readiness and no approval",async()=>{
   const r=rig();const response=await request(r.app).get(path).set(headers).expect(404);
   expect(response.body.error).toBe("NO_VERIFIED_ACTIVE_ISSUE238_CLAIM");
   expect(r.lookup).toHaveBeenCalledWith(command,token);
 });
 it("only verified DB result exposes bound IDs, never a permit",async()=>{
   const r=rig({commandId:command,jobId:task,leaseExpiresAt:"2026-11-26 07:30:00+00"});
   const response=await request(r.app).get(path).set(headers).expect(200);
   expect(response.body).toMatchObject({commandId:command,jobId:task,
     purpose:"issue238-pg17-disposable-qa",approvalIssued:false,
     permitIssued:false,qaExecuted:false});
   expect(response.body).not.toHaveProperty("claimToken");
 });
 it("DB failure never claims readiness",async()=>{
   const r=rig();r.lookup.mockRejectedValue(new Error("database unavailable"));
   await request(r.app).get(path).set(headers).expect(503);
 });
});
