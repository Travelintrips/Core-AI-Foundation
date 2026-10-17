import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { createDevCyclicHandshakeRouter } from "../routes/ai-core-cycle-dev.js";

const payload = {
  protocol: "ai-core-cycle/dev-v1",
  session_id: "s1", job_id: "j1", event_id: "h1",
  at: "2026-10-16T12:00:00+07:00",
  device_id: "zfold4-paired-dev-03", environment: "DEV",
  last_ack_event_id: null,
};

async function request(env: string | undefined, enabled: string | undefined, authorize: boolean) {
  const previousEnv = process.env["AI_CORE_RUNTIME_ENV"];
  const previousEnabled = process.env["AI_CORE_CYCLE_DEV_ENABLED"];
  if (env === undefined) delete process.env["AI_CORE_RUNTIME_ENV"];
  else process.env["AI_CORE_RUNTIME_ENV"] = env;
  if (enabled === undefined) delete process.env["AI_CORE_CYCLE_DEV_ENABLED"];
  else process.env["AI_CORE_CYCLE_DEV_ENABLED"] = enabled;
  const coordinator = { handshake: vi.fn(async () => ({ accepted: true })) };
  const app = express();
  app.use(express.json());
  app.use("/api/ai-core-cycle-dev", createDevCyclicHandshakeRouter(
    (req, res, next) => { if (!authorize) { res.sendStatus(401); return; } next(); },
    coordinator as never,
  ));
  const server = createServer(app);
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ai-core-cycle-dev/handshake`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, called: coordinator.handshake.mock.calls.length };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previousEnv === undefined) delete process.env["AI_CORE_RUNTIME_ENV"];
    else process.env["AI_CORE_RUNTIME_ENV"] = previousEnv;
    if (previousEnabled === undefined) delete process.env["AI_CORE_CYCLE_DEV_ENABLED"];
    else process.env["AI_CORE_CYCLE_DEV_ENABLED"] = previousEnabled;
  }
}

describe("DEV cyclic handshake route fail-closed integration", () => {
  it("rejects all requests outside DEV", async () => {
    expect(await request("PROD", "true", true)).toEqual({ status: 404, called: 0 });
  });
  it("rejects requests without explicit feature enablement", async () => {
    expect(await request("DEV", undefined, true)).toEqual({ status: 404, called: 0 });
  });
  it("rejects requests without service authentication", async () => {
    expect(await request("DEV", "true", false)).toEqual({ status: 401, called: 0 });
  });
  it("accepts a DEV authenticated request", async () => {
    expect(await request("DEV", "true", true)).toEqual({ status: 200, called: 1 });
  });
});
