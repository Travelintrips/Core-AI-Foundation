import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createGpt02OwnerLedgerReadRouter } from "../gpt02-owner-ledger-read.js";

const CHALLENGE = "9c4f21e1-48af-4f7f-9830-931b84e3e846";
const TOKEN = "x".repeat(70);
const HOST = "dev-ai-task.cstlogistic.co.id";
const ACTOR = {
  id: "google_103728868378401731050",
  role: "super_admin",
  companyId: "default",
  email: "admcst001@gmail.com",
  authSource: "supabase_google_identity",
  authSupabaseId: "11111111-2222-4333-8444-555555555555",
  authVerifiedAt: Date.now(),
};
const RECEIPT = {
  challengeId: CHALLENGE,
  scope: "GPT02_RELOCK_CST_DEV" as const,
  status: "CONSUMED" as const,
  decision: "APPROVED" as const,
  manifestSha256: "a".repeat(64),
  decidedAt: "2026-11-24T07:25:16.637Z",
};

function makeApp() {
  const verifyOwnerSession = vi.fn().mockResolvedValue(ACTOR);
  const verifyOwnerEligibility = vi.fn().mockResolvedValue(true);
  const readReceipt = vi.fn().mockResolvedValue(RECEIPT);
  const app = express();
  app.use("/api/gpt02-owner-ledger", createGpt02OwnerLedgerReadRouter({
    verifyOwnerSession, verifyOwnerEligibility, readReceipt,
  }));
  const endpoint = `/api/gpt02-owner-ledger/decision/${CHALLENGE}`;
  const get = () => request(app).get(endpoint).set({
    Host: HOST, Origin: `https://${HOST}`, Authorization: `Bearer ${TOKEN}`,
  });
  return { app, get, verifyOwnerSession, verifyOwnerEligibility, readReceipt };
}

describe("GPT02 Super Admin Owner ledger read-only HTTP boundary", () => {
  it("returns a bounded read-only receipt with no execution authority", async () => {
    const { get, readReceipt, verifyOwnerSession, verifyOwnerEligibility } = makeApp();
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ...RECEIPT, readOnly: true, executionPermitted: false,
      signingPermitted: false, dispatchPermitted: false, releaseDecision: "NO_GO",
    });
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(readReceipt).toHaveBeenCalledOnce();
    expect(verifyOwnerSession).toHaveBeenCalledOnce();
    expect(verifyOwnerEligibility).toHaveBeenCalledOnce();
  });

  it("requires explicit fresh bearer rather than cookies", async () => {
    const { app, readReceipt, verifyOwnerSession } = makeApp();
    const result = await request(app).get(`/api/gpt02-owner-ledger/decision/${CHALLENGE}`)
      .set({ Host: HOST, Cookie: "session=legacy" });
    expect(result.status).toBe(404);
    expect(readReceipt).not.toHaveBeenCalled();
    expect(verifyOwnerSession).not.toHaveBeenCalled();
  });

  it("rejects missing token", async () => {
    const { app, readReceipt } = makeApp();
    const result = await request(app).get(`/api/gpt02-owner-ledger/decision/${CHALLENGE}`)
      .set({ Host: HOST });
    expect(result.status).toBe(401);
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it("rejects mismatched Host or Origin", async () => {
    const { app, readReceipt } = makeApp();
    const result = await request(app).get(`/api/gpt02-owner-ledger/decision/${CHALLENGE}`)
      .set({ Host: "evil.example", Origin: "https://evil.example", Authorization: `Bearer ${TOKEN}` });
    expect(result.status).toBe(404);
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it("denies an operator who is not Super Admin or linked Owner", async () => {
    const { get, verifyOwnerSession, readReceipt } = makeApp();
    verifyOwnerSession.mockResolvedValue({ ...ACTOR, role: "admin" });
    const result = await get();
    expect(result.status).toBe(403);
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it("denies other Super Admin emails", async () => {
    const { get, verifyOwnerSession, readReceipt } = makeApp();
    verifyOwnerSession.mockResolvedValue({ ...ACTOR, email: "other@example.test" });
    expect((await get()).status).toBe(403);
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it("denies unlinked Super Admin", async () => {
    const { get, verifyOwnerEligibility, readReceipt } = makeApp();
    verifyOwnerEligibility.mockResolvedValue(false);
    expect((await get()).status).toBe(403);
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it("denies malformed challenge before all auth/db calls", async () => {
    const { app, verifyOwnerSession, readReceipt } = makeApp();
    const result = await request(app).get("/api/gpt02-owner-ledger/decision/not-uuid")
      .set({ Host: HOST, Authorization: `Bearer ${TOKEN}` });
    expect(result.status).toBe(400);
    expect(verifyOwnerSession).not.toHaveBeenCalled();
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it("does not permit POST or mutating methods", async () => {
    const { app, readReceipt } = makeApp();
    const result = await request(app).post(`/api/gpt02-owner-ledger/decision/${CHALLENGE}`)
      .set({ Host: HOST, Authorization: `Bearer ${TOKEN}` });
    expect(result.status).toBe(404);
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it("fails closed if separate reader credentials are not provisioned", async () => {
    const { get, readReceipt } = makeApp();
    readReceipt.mockRejectedValue(new Error("secret unavailable (should never be echoed)"));
    const result = await get();
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("GPT02_LEDGER_READER_OR_SESSION_UNAVAILABLE");
    expect(JSON.stringify(result.body)).not.toContain("secret unavailable");
  });

  it("rejects a receipt not matched to the requested challenge", async () => {
    const { get, readReceipt } = makeApp();
    readReceipt.mockResolvedValue({ ...RECEIPT, challengeId: "00000000-0000-4000-8000-000000000000" });
    expect((await get()).status).toBe(503);
  });
});
