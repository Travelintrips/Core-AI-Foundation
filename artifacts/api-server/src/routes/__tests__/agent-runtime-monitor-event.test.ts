import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  chooseActivePc: vi.fn(),
  registry: vi.fn(),
}));

vi.mock("../../middleware/agentServiceAuth.js", () => ({
  requireAgentServiceScope: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  hashAgentServiceToken: vi.fn(),
}));
vi.mock("../../services/aiSecretService.js", () => ({
  getProviderApiKey: vi.fn(() => null),
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("../../services/localCodingControlBridgeService.js", () => ({
  submitCodingBridgeCommand: mocks.submit,
  claimCodingBridgeCommand: vi.fn(),
  completeCodingBridgeCommand: vi.fn(),
  renewCodingBridgeCommandClaim: vi.fn(),
  getCodingBridgeCommandExecutionState: vi.fn(),
}));
vi.mock("../../services/externalAgentRegistryService.js", () => ({
  ExternalAgentRegistryError: class ExternalAgentRegistryError extends Error {},
  getExternalAgentRegistrySnapshot: mocks.registry,
  heartbeatExternalAgent: vi.fn(),
  getExternalAgentRule: vi.fn(),
}));
vi.mock("../../services/openClawPcLeaderService.js", () => ({
  chooseActivePc: mocks.chooseActivePc,
}));

async function buildApp() {
  const { default: router } = await import("../agent-runtime.js");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

const event = {
  eventId: "githubci-39021000877-1-success",
  source: "github",
  resource: "Travelintrips/Core-AI-Foundation/actions/runs/39021000877@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  status: "COMPLETED",
  summary: "CI Verify succeeded; not authorization to merge or deploy.",
  observedAt: "2026-10-17T09:26:00Z",
};

describe("unbound GitHub monitor event", () => {
  beforeEach(() => {
    mocks.submit.mockReset().mockResolvedValue({
      created: true,
      command: { id: "84af12ba-6fe5-41e8-a225-3b98e882a66c" },
    });
    mocks.chooseActivePc.mockReset();
    mocks.registry.mockReset();
  });

  it("persists without dispatching OpenClaw to an unverified ChatGPT conversation", async () => {
    const app = await buildApp();
    const result = await request(app).post("/ai/agent-runtime/monitor/events").send(event);
    expect(result.status).toBe(202);
    expect(result.body).toEqual(expect.objectContaining({
      accepted: true,
      created: true,
      communicator: null,
      browserConfirmed: false,
      handoff: "PENDING_SESSION_BINDING",
    }));
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      externalCommandId: "monitor-unbound:" + event.eventId,
      commandType: "EVENT_BINDING",
      source: "cst-vps-infrastructure-monitor",
      metadata: expect.objectContaining({
        monitor: true,
        handoff: "PENDING_SESSION_BINDING",
        manualApprovalRequiredForMutations: true,
      }),
    }));
    expect(mocks.chooseActivePc).not.toHaveBeenCalled();
    expect(mocks.registry).not.toHaveBeenCalled();
  });

  it("reports an already recorded duplicate without claiming another execution", async () => {
    mocks.submit.mockResolvedValueOnce({
      created: false,
      command: { id: "84af12ba-6fe5-41e8-a225-3b98e882a66c" },
    });
    const app = await buildApp();
    const result = await request(app).post("/ai/agent-runtime/monitor/events").send(event);
    expect(result.status).toBe(200);
    expect(result.body.created).toBe(false);
    expect(result.body.browserConfirmed).toBe(false);
    expect(mocks.chooseActivePc).not.toHaveBeenCalled();
  });

  it("rejects invalid event data before persisting a command", async () => {
    const app = await buildApp();
    const result = await request(app).post("/ai/agent-runtime/monitor/events").send({
      ...event, eventId: "no", status: "MERGED",
    });
    expect(result.status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
