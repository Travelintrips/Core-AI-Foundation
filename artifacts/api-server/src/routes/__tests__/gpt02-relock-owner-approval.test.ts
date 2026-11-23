import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  createGpt02RelockOwnerChallenge: vi.fn(),
  verifyAndRecordGpt02RelockOwnerApproval: vi.fn(),
}));

vi.mock("../../services/gpt02RelockOwnerApprovalService.js", () => serviceMocks);

import { createGpt02RelockOwnerApprovalRouter } from "../gpt02-relock-owner-approval.js";

const ownerActor = {
  id: "google_owner123456",
  role: "super_admin",
  companyId: "default",
  email: "owner@example.test",
  authSource: "supabase_google_identity",
  authSupabaseId: "11111111-2222-4333-8444-555555555555",
  authVerifiedAt: Date.now(),
};

function makeApp(verifyOwnerSession = vi.fn().mockResolvedValue(ownerActor)) {
  const app = express();
  app.use(express.json({ limit: "8kb" }));
  app.use("/api/gpt02-owner-approval", createGpt02RelockOwnerApprovalRouter({
    verifyOwnerSession,
    verifyOwnerEligibility: vi.fn().mockResolvedValue(true),
  }));
  return { app, verifyOwnerSession };
}

function validHeaders() {
  return {
    Host: "dev-ai-task.cstlogistic.co.id",
    Origin: "https://dev-ai-task.cstlogistic.co.id",
    "Content-Type": "application/json",
    Authorization: `Bearer ${"x".repeat(64)}`,
  };
}

describe("GPT02 Owner approval HTTP boundary", () => {
  beforeEach(() => {
    serviceMocks.createGpt02RelockOwnerChallenge.mockReset();
    serviceMocks.verifyAndRecordGpt02RelockOwnerApproval.mockReset();
  });

  it("requires exactly one authenticated Owner bearer session", async () => {
    const { app, verifyOwnerSession } = makeApp();
    const response = await request(app)
      .post("/api/gpt02-owner-approval/prepare")
      .set({ Host: "dev-ai-task.cstlogistic.co.id", Origin: "https://dev-ai-task.cstlogistic.co.id", "Content-Type": "application/json" })
      .send({ action: "PREPARE_GPT02_RELOCK_OWNER_APPROVAL" });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("GPT02_OWNER_SESSION_REQUIRED");
    expect(verifyOwnerSession).not.toHaveBeenCalled();
    expect(serviceMocks.createGpt02RelockOwnerChallenge).not.toHaveBeenCalled();
  });

  it("rejects a wrong origin and Host before checking the Owner session", async () => {
    const { app, verifyOwnerSession } = makeApp();
    const response = await request(app)
      .post("/api/gpt02-owner-approval/prepare")
      .set({ ...validHeaders(), Host: "attacker.example", Origin: "https://attacker.example" })
      .send({ action: "PREPARE_GPT02_RELOCK_OWNER_APPROVAL" });
    expect(response.status).toBe(404);
    expect(verifyOwnerSession).not.toHaveBeenCalled();
  });

  it("prepares a manifest only after the trusted Hub session and Owner eligibility callbacks pass", async () => {
    const { app, verifyOwnerSession } = makeApp();
    const challenge = {
      challengeId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      manifest: { scope: "GPT02_RELOCK_CST_DEV", environment: "DEV", projectId: "xssrfshdrtdfupgqwfdw" },
      canonicalPayload: "eyJzY29wZSI6IkdQ...",
      manifestSha256: "a".repeat(64),
      approvalMethod: "FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
    serviceMocks.createGpt02RelockOwnerChallenge.mockResolvedValue(challenge);

    const response = await request(app)
      .post("/api/gpt02-owner-approval/prepare")
      .set(validHeaders())
      .send({ action: "PREPARE_GPT02_RELOCK_OWNER_APPROVAL" });

    expect(response.status).toBe(201);
    expect(response.body.challengeId).toBe(challenge.challengeId);
    expect(response.body.manifestSha256).toBe(challenge.manifestSha256);
    expect(response.body.ownerApprovalGranted).toBe(false);
    expect(response.body.executionPermitted).toBe(false);
    expect(verifyOwnerSession).toHaveBeenCalledTimes(1);
    expect(verifyOwnerSession.mock.calls[0][0].bearerToken).toBe("x".repeat(64));
  });

  it("records approval only for explicit APPROVE and the exact manifest digest", async () => {
    const { app } = makeApp();
    serviceMocks.verifyAndRecordGpt02RelockOwnerApproval.mockResolvedValue({
      recorded: true,
      ownerSessionCryptographicallyVerified: true,
      explicitOwnerDecision: "APPROVE",
      executionPermitted: false,
      signingPermitted: false,
      dispatchPermitted: false,
      releaseDecision: "NO_GO",
      manifestSha256: "a".repeat(64),
    });

    const response = await request(app)
      .post("/api/gpt02-owner-approval/approve")
      .set(validHeaders())
      .send({ challengeId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", decision: "APPROVE", manifestSha256: "a".repeat(64) });

    expect(response.status).toBe(200);
    expect(response.body.recorded).toBe(true);
    expect(response.body.executionPermitted).toBe(false);
    expect(response.body.signingPermitted).toBe(false);
    expect(response.body.dispatchPermitted).toBe(false);
    expect(serviceMocks.verifyAndRecordGpt02RelockOwnerApproval).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      manifestSha256: "a".repeat(64),
      signedSessionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("rejects approve requests that include an extra or non-APPROVE field", async () => {
    const { app } = makeApp();
    const response = await request(app)
      .post("/api/gpt02-owner-approval/approve")
      .set(validHeaders())
      .send({ challengeId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", decision: "APPROVE", manifestSha256: "a".repeat(64), execute: true });
    expect(response.status).toBe(400);
    expect(serviceMocks.verifyAndRecordGpt02RelockOwnerApproval).not.toHaveBeenCalled();
  });
});
