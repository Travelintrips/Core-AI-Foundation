import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), scopes: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: { execute: mocks.execute, select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  aiAgentServiceTokensTable: new Proxy({}, { get: (_target, property) => ({ name: property, id: property, scopes: property, isActive: property, createdAt: property, lastUsedAt: property, tokenHash: property, updatedAt: property }) }),
}));
vi.mock("../../middleware/agentServiceAuth.js", () => ({
  requireAgentServiceScope: (scope: string) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    mocks.scopes(scope);
    if (req.header("x-test-scope") !== scope) { res.status(401).json({ error: "unauthorized" }); return; }
    next();
  },
  hashAgentServiceToken: vi.fn(),
}));
vi.mock("../../middleware/internalAuth.js", () => ({ requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(), requireInternalRole: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../services/aiSecretService.js", () => ({ getProviderApiKey: vi.fn(() => null) }));
vi.mock("../../lib/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../services/localCodingControlBridgeService.js", () => ({ submitCodingBridgeCommand: vi.fn(), claimCodingBridgeCommand: vi.fn(), completeCodingBridgeCommand: vi.fn(), renewCodingBridgeCommandClaim: vi.fn(), recordClaimedCodingBridgeProgress: vi.fn(), getCodingBridgeCommandExecutionState: vi.fn() }));
vi.mock("../../services/externalAgentRegistryService.js", () => ({ ExternalAgentRegistryError: class extends Error {}, getExternalAgentRegistrySnapshot: vi.fn(), heartbeatExternalAgent: vi.fn(), getExternalAgentRule: vi.fn() }));
vi.mock("../../services/openClawPcLeaderService.js", () => ({ chooseActivePc: vi.fn() }));
vi.mock("../../services/openClawFailoverSelectionService.js", () => ({ OPENCLAW_PC_CLIENT_IDS: [] }));
vi.mock("../../services/externalAgentWorkEventService.js", () => ({ subscribeExternalAgentWork: vi.fn() }));

async function app() {
  const { default: router } = await import("../agent-runtime.js");
  const server = express(); server.use(express.json()); server.use(router); return server;
}

describe("GPT02 read-only health endpoint", () => {
  beforeEach(() => { mocks.execute.mockReset(); mocks.scopes.mockReset(); });

  it("requires agent:presence scope and rejects an unauthenticated request", async () => {
    const server = await app();
    const response = await request(server).get("/ai/agent-runtime/monitor/gpt02-health");
    expect(response.status).toBe(401);
    expect(mocks.scopes).toHaveBeenCalledWith("agent:presence");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns bounded healthy heartbeat and ACK counts without exposing secrets", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ heartbeat_age_seconds: 42, lease_valid: true }] })
      .mockResolvedValueOnce({ rows: [{ pending_ack_over_5m: 0 }] });
    const response = await request(await app()).get("/ai/agent-runtime/monitor/gpt02-health").set("x-test-scope", "agent:presence");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ status: "ok", workerId: "openclaw-dell-chatgpt-wake-dev", heartbeatAgeSeconds: 42, leaseValid: true, pendingAckOver5m: 0 });
    expect(JSON.stringify(response.body)).not.toMatch(/token|secret|commandPayload/i);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("reports degraded for stale heartbeat, invalid lease, or pending ACK", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ heartbeat_age_seconds: 121, lease_valid: false }] })
      .mockResolvedValueOnce({ rows: [{ pending_ack_over_5m: 2 }] });
    const response = await request(await app()).get("/ai/agent-runtime/monitor/gpt02-health").set("x-test-scope", "agent:presence");
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: "degraded", heartbeatAgeSeconds: 121, leaseValid: false, pendingAckOver5m: 2 });
  });

  it("reports degraded when worker presence is missing", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ pending_ack_over_5m: 0 }] });
    const response = await request(await app()).get("/ai/agent-runtime/monitor/gpt02-health").set("x-test-scope", "agent:presence");
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: "degraded", heartbeatAgeSeconds: null, leaseValid: false });
  });
});

it("counts only GPT02 DELL pending ACKs, not unrelated Travelintrips hostname completions", async () => {
  mocks.execute.mockReset();
  mocks.scopes.mockReset();
  mocks.execute.mockResolvedValueOnce({ rows: [{ heartbeat_age_seconds: 20, lease_valid: true }] })
    .mockResolvedValueOnce({ rows: [{ pending_ack_over_5m: 0 }] });
  const response = await request(await app()).get("/ai/agent-runtime/monitor/gpt02-health").set("x-test-scope", "agent:presence");
  expect(response.status).toBe(200);
  expect(response.body.pendingAckOver5m).toBe(0);
  const pendingSql = JSON.stringify(mocks.execute.mock.calls[1][0]);
  expect(pendingSql).toContain("ai_coding_bridge_commands");
  expect(pendingSql).toContain("assignedClientId");
  expect(pendingSql).toContain("openclaw-dell-chatgpt-wake-dev");
});
