import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";

const fake = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn(), wake: null as null | ((id:string)=>void), lost: null as null | (()=>void) }));
vi.mock("../../services/externalAgentWorkEventService.js", () => ({ subscribeExternalAgentWork: fake.subscribe }));
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
