import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";

const fake = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn(), backlog: vi.fn(), wake: null as null | ((id:string)=>void), lost: null as null | (()=>void) }));
vi.mock("../../services/externalAgentWorkEventService.js", () => ({ subscribeExternalAgentWork: fake.subscribe }));
vi.mock("../../services/gpt02DevQueuedWakeService.js", () => ({ DEV_DELL_WAKE_CLIENT_ID: "openclaw-dell-chatgpt-wake-dev", listDevDellQueuedWakeCommandIds: fake.backlog }));
vi.mock("../../middleware/agentServiceAuth.js", () => ({
  hashAgentServiceToken: vi.fn(),
  requireAgentServiceScope: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers.authorization !== "Bearer test") {res.status(401).end();return;} next();
  },
}));

describe("authenticated external-agent SSE", () => {
  let server: Server;
  let base: string;
  beforeEach(async () => {
    fake.subscribe.mockReset(); fake.unsubscribe.mockReset();
    fake.backlog.mockReset(); fake.backlog.mockResolvedValue([]);
    fake.subscribe.mockImplementation(async (_clientId, wake, lost) => {
      fake.wake=wake;fake.lost=lost;return fake.unsubscribe;
    });
    const {default: router}=await import("../agent-runtime.js");
    const app=express();app.use(router);server=createServer(app);
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const address=server.address();
    if(!address || typeof address==="string")throw Error("missing test port");
    base="http://127.0.0.1:"+address.port;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  });
  it("replays only DEV DELL queued UUIDs once after ready without claiming work",async()=>{
    const previous=process.env["PUBLIC_APP_URL"];
    process.env["PUBLIC_APP_URL"]="https://dev.cstlogistic.co.id";
    const commandId="f9081674-7575-4cb3-a627-d51c264f7ef5";
    fake.backlog.mockResolvedValue([commandId]);
    try {
      const response=await fetch(base+"/ai/agent-runtime/work/stream?clientId=openclaw-dell-chatgpt-wake-dev",
        {headers:{authorization:"Bearer test"}});
      expect(response.status).toBe(200);
      const reader=response.body!.getReader();
      const decoder=new TextDecoder();
      let streamed="";
      for(let i=0;i<3&&!streamed.includes("event: work_available");i++){
        const part=await reader.read();
        if(part.done)break;
        streamed+=decoder.decode(part.value);
      }
      expect(streamed).toContain("event: ready");
      expect(streamed).toContain("event: work_available");
      expect(streamed).toContain(`id: ${commandId}`);
      expect(streamed).toContain(JSON.stringify({clientId:"openclaw-dell-chatgpt-wake-dev",commandId}));
      expect(fake.subscribe).toHaveBeenCalledTimes(1);
      expect(fake.backlog).toHaveBeenCalledTimes(1);
      expect(fake.backlog).toHaveBeenCalledWith("openclaw-dell-chatgpt-wake-dev");
      await reader.cancel();
    } finally {
      if(previous===undefined)delete process.env["PUBLIC_APP_URL"];
      else process.env["PUBLIC_APP_URL"]=previous;
    }
  });
  it("does not replay DEV DELL backlog when server is configured for PROD",async()=>{
    const previous=process.env["PUBLIC_APP_URL"];
    process.env["PUBLIC_APP_URL"]="https://aicore.cstlogistic.co.id";
    try {
      const response=await fetch(base+"/ai/agent-runtime/work/stream?clientId=openclaw-dell-chatgpt-wake-dev",
        {headers:{authorization:"Bearer test"}});
      expect(response.status).toBe(200);
      const reader=response.body!.getReader();
      const part=await reader.read();
      expect(new TextDecoder().decode(part.value)).toContain("event: ready");
      expect(fake.backlog).not.toHaveBeenCalled();
      await reader.cancel();
    } finally {
      if(previous===undefined)delete process.env["PUBLIC_APP_URL"];
      else process.env["PUBLIC_APP_URL"]=previous;
    }
  });
  it("requires authentication and rejects an unknown worker",async()=>{
    expect((await fetch(base+"/ai/agent-runtime/work/stream?clientId=openclaw-vps-main")).status).toBe(401);
    expect((await fetch(base+"/ai/agent-runtime/work/stream?clientId=unknown",{headers:{authorization:"Bearer test"}})).status).toBe(400);
    expect(fake.subscribe).not.toHaveBeenCalled();
  });
  it("subscribes before ready, streams hints and cleans up after listener loss",async()=>{
    const response=await fetch(base+"/ai/agent-runtime/work/stream?clientId=openclaw-vps-main",{headers:{authorization:"Bearer test"}});
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const reader=response.body!.getReader();const decoder=new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    fake.wake!("11111111-1111-4111-8111-111111111111");
    const message=decoder.decode((await reader.read()).value);
    expect(message).toContain("event: work_available");
    expect(message).not.toContain("instruction");
    fake.lost!();
    expect((await reader.read()).done).toBe(true);
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
