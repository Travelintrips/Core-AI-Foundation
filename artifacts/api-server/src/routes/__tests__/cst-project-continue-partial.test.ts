import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middleware/agentServiceAuth.js",()=>({
  requireAgentServiceScope:()=> (req:any,res:any,next:any)=>{
    if(req.headers.authorization!=="Bearer scoped-dev-token"){res.status(401).json({error:"TOKEN_REQUIRED"});return;}
    res.locals.aiAgentService={
      id:"worker-credential-1",name:req.headers["x-test-service"]??"openclaw-vps-dev-consumer",
      scopes:["agent:work"],
    };next();
  },
}));
vi.mock("../../services/devChatGptWakeService.js",()=>({
  resolveVerifiedDevWakeTarget:vi.fn(),
  queueDevBrowserWake:vi.fn(),
}));
const {createCstProjectContinuePartialRouter,CST_CONTINUATION_PROJECTS}=await import("../cst-project-continue-partial.js");
const body={
 action:"CONTINUE_PARTIAL_JOB",environment:"CST_DEV",reportStatus:"PARTIAL",
 project:"sport-center",jobId:"SC-1902",checkpointRevision:2,
 reportSummary:"Booking admin PIN and visitor suspension need verified E2E evidence.",
 nextStep:"Review read-only booking and device ACK before reporting PASS.",
};
const h={Host:"dev.cstlogistic.co.id",Authorization:"Bearer scoped-dev-token"};
function setup(configured=true){
 const routeForProject=vi.fn(async (_project:string)=>configured?{accountAlias:"GPT02",expectedWorkerId:"openclaw-dell-chatgpt-wake-dev"}:null);
 const resolveTarget=vi.fn(async()=>({
  ownerChannel:"ai-engine-oauth:"+"a".repeat(64),
  targetConversationId:"6ae4dd6b-a5f4-83ec-8fbc-dc9526e21a96",
  workerId:"openclaw-dell-chatgpt-wake-dev",
  wakeBinding:{accountAlias:"GPT02",workerId:"openclaw-dell-chatgpt-wake-dev",bindingFingerprint:"b".repeat(64)},
 }));
 const enqueue=vi.fn(async()=>({created:true,commandId:"a9ad04aa-8ba9-4e87-b72b-8b6202be5cb3",clientId:"openclaw-dell-chatgpt-wake-dev"}));
 const app=express();app.use(express.json());app.use("/api/ai/agent-runtime/dev/projects/continue-partial",
 createCstProjectContinuePartialRouter({routeForProject,resolveTarget,enqueue} as any));
 return{app,routeForProject,resolveTarget,enqueue};
}
const endpoint="/api/ai/agent-runtime/dev/projects/continue-partial";
describe("CST multiproject partial continuation",()=>{
 beforeEach(()=>{process.env.NODE_ENV="test";process.env.APP_ENV="development";});
 it("supports the company's eight named projects without inventing sessions",()=>{
  expect(Object.keys(CST_CONTINUATION_PROJECTS)).toEqual([
   "sport-center","bizportal","fleet-intelligence","wa-gateway",
   "ai-core","ai-task-hub","tenant-pos","customer-portal"
  ]);
 });
 it("requires real service token",async()=>{
  const s=setup();await request(s.app).post(endpoint).set({Host:h.Host}).send(body).expect(401);
  expect(s.enqueue).not.toHaveBeenCalled();
 });
 it("rejects wrong service",async()=>{
  const s=setup();await request(s.app).post(endpoint).set({...h,"x-test-service":"other-agent"}).send(body).expect(403);
  expect(s.resolveTarget).not.toHaveBeenCalled();
 });
 it("fails closed for configured project without verified target binding",async()=>{
  const s=setup(false);const r=await request(s.app).post(endpoint).set(h).send(body).expect(409);
  expect(r.body.error).toBe("PROJECT_VERIFIED_CONVERSATION_NOT_CONFIGURED");
  expect(s.enqueue).not.toHaveBeenCalled();
 });
 it.each([
  ["PROD",{environment:"PROD"}],["wrong action",{action:"ALTER_ROLE"}],
  ["complete job",{reportStatus:"PASS"}],["unknown project",{project:"new-unknown-project"}],
  ["extra password",{password:"blocked"}],["control chars",{nextStep:"bad\ncommand"}],
 ])("rejects %s",async(_label,patch)=>{
  const s=setup();await request(s.app).post(endpoint).set(h).send({...body,...patch}).expect(400);
  expect(s.enqueue).not.toHaveBeenCalled();
 });
 it("denies target not matched to scoped worker",async()=>{
  const s=setup();s.resolveTarget.mockResolvedValue({
   workerId:"openclaw-dell-chatgpt-wake-dev",
   wakeBinding:{accountAlias:"GPT01",workerId:"openclaw-dell-chatgpt-wake-dev",bindingFingerprint:"b".repeat(64)}
  });
  await request(s.app).post(endpoint).set(h).send(body).expect(409);
  expect(s.enqueue).not.toHaveBeenCalled();
 });
 it("routes each project through its explicitly configured verified account only",async()=>{
  const s=setup();const r=await request(s.app).post(endpoint).set(h).send(body).expect(202);
  expect(r.body.project).toBe("sport-center");
  expect(r.body.browserConfirmed).toBe(false);
  expect(r.body.assistantContinued).toBe(false);
  expect(s.routeForProject).toHaveBeenCalledWith("sport-center");
  const queued=s.enqueue.mock.calls[0][0];
  expect(queued.instruction).toContain("Project: sport-center");
  expect(queued.expectedBindingFingerprint).toBe("b".repeat(64));
 });
 it("deduplicates by project + job + checkpoint",async()=>{
  const s=setup();
  await request(s.app).post(endpoint).set(h).send(body).expect(202);
  await request(s.app).post(endpoint).set(h).send({...body,reportSummary:"Another partial report with the same registered checkpoint."}).expect(202);
  expect(s.enqueue.mock.calls[0][0].eventId).toBe(s.enqueue.mock.calls[1][0].eventId);
  await request(s.app).post(endpoint).set(h).send({...body,project:"bizportal"}).expect(202);
  expect(s.enqueue.mock.calls[2][0].eventId).not.toBe(s.enqueue.mock.calls[0][0].eventId);
 });
 it("GET returns project coverage without confidential chat IDs",async()=>{
  const s=setup(false);const r=await request(s.app).get(endpoint+"/projects").set(h).expect(200);
  expect(r.body.projects).toHaveLength(8);
  expect(r.body.projects.every((x:any)=>x.configured===false)).toBe(true);
  expect(JSON.stringify(r.body)).not.toContain("targetConversationId");
 });
 it("rejects production request host",async()=>{
  const s=setup();await request(s.app).post(endpoint).set({...h,Host:"aicore.cstlogistic.co.id"}).send(body).expect(403);
 });
});
