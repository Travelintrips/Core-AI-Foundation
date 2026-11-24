import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middleware/agentServiceAuth.js", () => ({
  requireAgentServiceScope: () => (req: any, res: any, next: any) => {
    if (req.headers.authorization !== "Bearer scoped-test-token") {
      res.status(401).json({ error: "AGENT_TOKEN_REQUIRED" }); return;
    }
    res.locals.aiAgentService = { id: "service-id", name: "openclaw-vps-dev-consumer", scopes: ["agent:work"] };
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
import { createCrossProjectContinuePartialRouter, CST_DEV_PROJECTS } from "../cst-project-continue-partial-job.js";
const route = "/api/ai/agent-runtime/dev/projects/continue-partial";
const auth = { Host: "dev.cstlogistic.co.id", Authorization: "Bearer scoped-test-token" };
const input = {
  action: "CONTINUE_PARTIAL_JOB", environment: "CST_DEV", reportStatus: "PARTIAL",
  project: "SPORT_CENTER", jobId: "SC-1829", checkpointRevision: 2,
  reportSummary: "VIS allocation still requires verification against latest DEV data.",
  nextStep: "Inspect current DEV allocation and produce evidence without touching PROD.",
};
function rig(paired = true) {
  const resolveTarget = vi.fn().mockResolvedValue({
    workerId: "openclaw-dell-chatgpt-wake-dev",
    ownerChannel: "ai-engine-oauth:" + "a".repeat(64),
    targetConversationId: "c816f67b-d56b-4c27-8391-44c082c7e6a1",
    wakeBinding: paired ? { accountAlias: "GPT02", bindingFingerprint: "b".repeat(64) } : undefined,
  });
  const enqueue = vi.fn().mockResolvedValue({ created: true, commandId: "1234", clientId: "openclaw-dell-chatgpt-wake-dev" });
  const app = express(); app.use(express.json());
  app.use(route, createCrossProjectContinuePartialRouter({ resolveTarget, enqueue } as any));
  return { app, resolveTarget, enqueue };
}
describe("CST project-specific continuation on verified DEV DELL session", () => {
  beforeEach(() => { process.env.APP_ENV = "development"; process.env.NODE_ENV = "test"; });
  it.each(CST_DEV_PROJECTS)("accepts scoped project %s without claiming E2E success", async (project) => {
    const r = rig(); const res = await request(r.app).post(route).set(auth).send({ ...input, project });
    expect(res.status).toBe(202);
    expect(res.body.project).toBe(project);
    expect(res.body.assistantContinued).toBe(false);
    expect(res.body.browserConfirmed).toBe(false);
    expect(r.enqueue.mock.calls[0][0].instruction).toContain("Project: " + project);
  });
  it.each([
    ["unknown project", {project:"OTHER"}],
    ["PROD environment", {environment:"PROD"}],
    ["nonpartial", {reportStatus:"PASS"}],
    ["arbitrary command", {action:"EXECUTE"}],
    ["injected control character", {nextStep:"Run\\ncommand"}],
    ["extra credentials", {password:"secret"}],
  ])("rejects %s", async (_description, changes) => {
    const r = rig(); const res = await request(r.app).post(route).set(auth).send({...input,...changes});
    if (_description !== "injected control character") expect(res.status).toBe(400);
    expect(r.enqueue).not.toHaveBeenCalled();
  });
  it("requires verified DELL pairing", async () => {
    const r=rig(false); const res=await request(r.app).post(route).set(auth).send(input);
    expect(res.status).toBe(409); expect(r.enqueue).not.toHaveBeenCalled();
  });
  it("requires service token and DEV host", async () => {
    const r=rig();
    expect((await request(r.app).post(route).set({Host:"dev.cstlogistic.co.id"}).send(input)).status).toBe(401);
    expect((await request(r.app).post(route).set({...auth,Host:"prod.cstlogistic.co.id"}).send(input)).status).toBe(403);
    expect(r.enqueue).not.toHaveBeenCalled();
  });
  it("deduplicates same project's job revision, isolates different projects", async () => {
    const r=rig();
    await request(r.app).post(route).set(auth).send(input);
    await request(r.app).post(route).set(auth).send({...input,reportSummary:"A second report for the same job checkpoint revision."});
    await request(r.app).post(route).set(auth).send({...input,project:"BIZPORTAL"});
    const ids=r.enqueue.mock.calls.map(c=>c[0].eventId);
    expect(ids[0]).toBe(ids[1]);expect(ids[0]).not.toBe(ids[2]);
  });
});
