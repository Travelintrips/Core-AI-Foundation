import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockPlannerAuthorityError extends Error {
    constructor(
      readonly code:
        | "AUTHORITY_HELD"
        | "STALE_FENCE"
        | "LEASE_EXPIRED"
        | "NOT_HOLDER",
    ) {
      super(code);
      this.name = "PlannerAuthorityError";
    }
  }

  return {
    acquire: vi.fn(),
    renew: vi.fn(),
    assert: vi.fn(),
    get: vi.fn(),
    MockPlannerAuthorityError,
  };
});

vi.mock("../../services/localCodingPlannerAuthorityService.js", () => ({
  acquirePlannerAuthority: mocks.acquire,
  renewPlannerAuthority: mocks.renew,
  assertPlannerAuthority: mocks.assert,
  getPlannerAuthority: mocks.get,
  PlannerAuthorityError: mocks.MockPlannerAuthorityError,
}));

import router from "../coding-planner-authority.js";

const app = express();
app.use(express.json());
app.use(router);

const LEASE_TOKEN = "11111111-1111-4111-8111-111111111111";

describe("coding planner authority routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquire.mockResolvedValue({
      scope: "coding-task:task-1",
      holderId: "chatgpt-primary",
      holderType: "chatgpt",
      leaseToken: LEASE_TOKEN,
      fencingGeneration: 7,
      state: "PRIMARY_ACTIVE",
    });
    mocks.renew.mockResolvedValue({
      scope: "coding-task:task-1",
      holderId: "chatgpt-primary",
      leaseToken: LEASE_TOKEN,
      fencingGeneration: 7,
      state: "PRIMARY_ACTIVE",
    });
    mocks.assert.mockResolvedValue({
      scope: "coding-task:task-1",
      holderId: "chatgpt-primary",
      leaseToken: LEASE_TOKEN,
      fencingGeneration: 7,
      state: "PRIMARY_ACTIVE",
    });
    mocks.get.mockResolvedValue({
      scope: "global",
      state: "UNCLAIMED",
    });
  });

  it("acquires planner authority with bounded validated input", async () => {
    const response = await request(app)
      .post("/ai/coding/planner-authority/acquire")
      .send({
        scope: "coding-task:task-1",
        holderId: "chatgpt-primary",
        holderType: "chatgpt",
        leaseSeconds: 120,
        metadata: { source: "control-tower" },
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      holderId: "chatgpt-primary",
      fencingGeneration: 7,
      state: "PRIMARY_ACTIVE",
    });
    expect(mocks.acquire).toHaveBeenCalledWith({
      scope: "coding-task:task-1",
      holderId: "chatgpt-primary",
      holderType: "chatgpt",
      leaseSeconds: 120,
      metadata: { source: "control-tower" },
    });
  });

  it("rejects malformed holder input before touching authority state", async () => {
    const response = await request(app)
      .post("/ai/coding/planner-authority/acquire")
      .send({
        holderId: "",
        holderType: "invalid",
      });

    expect(response.status).toBe(400);
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it("maps authority contention and stale fences to HTTP 409", async () => {
    mocks.acquire.mockRejectedValueOnce(
      new mocks.MockPlannerAuthorityError("AUTHORITY_HELD"),
    );
    const held = await request(app)
      .post("/ai/coding/planner-authority/acquire")
      .send({
        holderId: "chatgpt-primary",
        holderType: "chatgpt",
      });
    expect(held.status).toBe(409);
    expect(held.body.code).toBe("AUTHORITY_HELD");

    mocks.assert.mockRejectedValueOnce(
      new mocks.MockPlannerAuthorityError("STALE_FENCE"),
    );
    const stale = await request(app)
      .post("/ai/coding/planner-authority/assert")
      .send({
        holderId: "chatgpt-primary",
        leaseToken: LEASE_TOKEN,
        fencingGeneration: 6,
      });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_FENCE");
  });

  it("renews only with a valid fencing token", async () => {
    const response = await request(app)
      .post("/ai/coding/planner-authority/renew")
      .send({
        scope: "coding-task:task-1",
        holderId: "chatgpt-primary",
        leaseToken: LEASE_TOKEN,
        fencingGeneration: 7,
        leaseSeconds: 180,
      });

    expect(response.status).toBe(200);
    expect(mocks.renew).toHaveBeenCalledWith({
      scope: "coding-task:task-1",
      holderId: "chatgpt-primary",
      leaseToken: LEASE_TOKEN,
      fencingGeneration: 7,
      leaseSeconds: 180,
    });
  });

  it("reads planner authority status with global default scope", async () => {
    const response = await request(app).get(
      "/ai/coding/planner-authority",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      scope: "global",
      state: "UNCLAIMED",
    });
    expect(mocks.get).toHaveBeenCalledWith("global");
  });
});
