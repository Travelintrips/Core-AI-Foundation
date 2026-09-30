import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const {
  mockGetAutonomousRuntimeStatus,
  mockRunAutonomousCodingCycle,
} = vi.hoisted(() => ({
  mockGetAutonomousRuntimeStatus: vi.fn(),
  mockRunAutonomousCodingCycle: vi.fn(),
}));

vi.mock("../../middleware/agentServiceAuth.js", () => ({
  requireAgentServiceScope:
    () =>
    (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));

vi.mock("../../services/localCodingControlBridgeService.js", () => ({
  getCodingBridgeAvailability: vi.fn(),
  renewCodingBridgePresence: vi.fn(),
}));

vi.mock("../../services/localCodingAutonomousRepairService.js", () => ({
  TEMPORAL_CODING_ORCHESTRATOR_CLIENT_ID: "gcp-temporal-coding-orchestrator",
  getAutonomousCodingTaskStatus: vi.fn(),
  getAutonomousRuntimeStatus: mockGetAutonomousRuntimeStatus,
  listActiveAutonomousCodingTasks: vi.fn(),
  runAutonomousCodingCycle: mockRunAutonomousCodingCycle,
}));

async function buildApp() {
  const { default: router } = await import("../temporal-coding-worker.js");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

describe("Temporal coding takeover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a wait result while the local autonomous tick is draining", async () => {
    mockGetAutonomousRuntimeStatus.mockReturnValue({ tickRunning: true });
    const app = await buildApp();
    const taskId = "5e6e17aa-9c35-42a0-99d3-3da9f1fba63d";

    const res = await request(app)
      .post(`/ai/temporal-coding/tasks/${taskId}/run-once`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      taskId,
      status: "WAITING",
      action: "LOCAL_TICK_DRAINING",
    });
    expect(mockRunAutonomousCodingCycle).not.toHaveBeenCalled();
  });
});
