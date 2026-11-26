import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middleware/agentServiceAuth.js", () => ({
  requireAgentServiceScope: () => (_req: any, res: any, next: any) => {
    if (_req.headers.authorization !== "Bearer scoped-test-token") {
      res.status(401).json({ error: "AGENT_TOKEN_REQUIRED" }); return;
    }
    res.locals.aiAgentService = {
      name: _req.headers["x-test-service-name"] ?? "openclaw-vps-dev-consumer",
      id: "test-id",
      scopes: ["agent:work"],
    };
    next();
  },
}));
vi.mock("../../services/devChatGptWakeBindingService.js", () => ({
  DEV_WAKE_DELL_WORKER: "openclaw-dell-chatgpt-wake-dev",
}));
vi.mock("../../services/devChatGptWakeService.js", () => ({
  queueDevBrowserWake: vi.fn(),
  resolveVerifiedDevWakeTarget: vi.fn(),
}));
import { createGpt02ContinuePartialRouter } from "../gpt02-continue-partial-job.js";
const input = {
  action: "CONTINUE_PARTIAL_JOB",
  environment: "CST_DEV",
  reportStatus: "PARTIAL",
  jobId: "GPT02-1782",
  checkpointRevision: 7,
  reportSummary: "Reader ledger missing independently issued encrypted credential.",
  nextStep: "Verify authorized custody proof then rerun read-only E2E checks.",
};
function rig(paired = true) {
  const resolveTarget = vi.fn().mockResolvedValue({
    workerId: "openclaw-dell-chatgpt-wake-dev",
    ownerChannel: "ai-engine-oauth:"+"a".repeat(64),
    targetConversationId: "c816f67b-d56b-4c27-8391-44c082c7e6a1",
    wakeBinding: paired ? {
      accountAlias: "GPT02", bindingFingerprint: "b".repeat(64)
    } : undefined,
  });
  const enqueue = vi.fn().mockResolvedValue({
    created: true, clientId: "openclaw-dell-chatgpt-wake-dev",
    commandId: "deadbeef-1234-4234-9234-123456789abc",
  });
  const app=express(); app.use(express.json());
  app.use("/api/ai/agent-runtime/dev/gpt02/continue-partial",
    createGpt02ContinuePartialRouter({resolveTarget,enqueue} as any));
  return { app, resolveTarget, enqueue };
}
const route = "/api/ai/agent-runtime/dev/gpt02/continue-partial";
const auth = { Host:"dev.cstlogistic.co.id", Authorization:"Bearer scoped-test-token" };
describe("OpenClaw → ChatGPT GPT02 partial continuation, fail closed",()=>{
  beforeEach(()=>{ process.env.APP_ENV="development"; });
  it("rejects unauthenticated sender",async()=>{
    const r=rig(); const res=await request(r.app).post(route).set({Host:"dev.cstlogistic.co.id"}).send(input);
    expect(res.status).toBe(401); expect(r.enqueue).not.toHaveBeenCalled();
  });
  it("accepts only the canonical VPS service token",async()=>{
    const r=rig(); const res=await request(r.app).post(route).set({...auth,"x-test-service-name":"other-agent"}).send(input);
    expect(res.status).toBe(403); expect(r.resolveTarget).not.toHaveBeenCalled();
  });
  it("enforces DEV hostname",async()=>{
    const r=rig(); const res=await request(r.app).post(route).set({...auth,Host:"prod.cstlogistic.co.id"}).send(input);
    expect(res.status).toBe(403);
  });
  it.each([
    ["not partial", {reportStatus:"COMPLETED"}],
    ["wrong environment", {environment:"PROD"}],
    ["arbitrary command", {action:"ALTER_ROLE"}],
    ["script injection", {nextStep:"run\nDROP ROLE postgres"}],
    ["extra secret field", {password:"not-allowed"}],
    ["bad revision", {checkpointRevision:0}],
  ])("rejects %s",async(_,field)=>{
    const r=rig(); const res=await request(r.app).post(route).set(auth).send({...input,...field});
    expect(res.status).toBe(400); expect(r.enqueue).not.toHaveBeenCalled();
  });
  it("rejects absent authenticated GPT02/DELL browser binding",async()=>{
    const r=rig(false); const res=await request(r.app).post(route).set(auth).send(input);
    expect(res.status).toBe(409); expect(r.enqueue).not.toHaveBeenCalled();
  });
  it("issues a deduplicated bounded continue request to exactly the pinned paired GPT02 DELL worker",async()=>{
    const r=rig(); const res=await request(r.app).post(route).set(auth).send(input);
    expect(res.status).toBe(202);
    expect(res.body.queued).toBe(true);
    expect(res.body.assistantContinued).toBe(false);
    expect(res.body.browserConfirmed).toBe(false);
    expect(r.enqueue).toHaveBeenCalledTimes(1);
    const call=r.enqueue.mock.calls[0][0];
    expect(call.expectedWorkerId).toBe("openclaw-dell-chatgpt-wake-dev");
    expect(call.expectedBindingFingerprint).toBe("b".repeat(64));
    expect(call.instruction).toContain("CONTINUE_PARTIAL_JOB");
    expect(call.instruction).toContain("not permission to access secrets");
    expect(call.eventId).toMatch(/^[a-f0-9]{64}$/);
  });
  it("same job/revision produces same idempotent event even if report text changes",async()=>{
    const r=rig();
    await request(r.app).post(route).set(auth).send(input);
    await request(r.app).post(route).set(auth).send({...input,reportSummary:"Alternative partial summary text with same checkpoint revision."});
    expect(r.enqueue.mock.calls[0][0].eventId).toBe(r.enqueue.mock.calls[1][0].eventId);
  });
  it("no claim of ChatGPT completion even when queue returns duplicate",async()=>{
    const r=rig();r.enqueue.mockResolvedValue({created:false,commandId:"deadbeef-1234-4234-9234-123456789abc"});
    const res=await request(r.app).post(route).set(auth).send(input);
    expect(res.status).toBe(200);expect(res.body.alreadyQueued).toBe(true);
    expect(res.body.assistantContinued).toBe(false);
  });
  it("fails closed when paired target cannot be resolved",async()=>{
    const r=rig();r.resolveTarget.mockRejectedValue(new Error("DEV_CHATGPT_ALIAS_TARGET_UNVERIFIED"));
    const res=await request(r.app).post(route).set(auth).send(input);
    expect(res.status).toBe(409);expect(res.body.queued).toBe(false);
  });
});
