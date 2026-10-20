import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createPairingApprovalApp, PAIRING_APPROVAL_PATH } from "../pairingApprovalApp.js";
import oauthRouter from "../routes/ai-core-mcp-oauth.js";
import { getInternalUserById, verifySessionToken } from "../services/internalAuthService.js";
import { approveMcpOauthPairing } from "../services/aiCoreMcpPairingService.js";

vi.mock("../services/internalAuthService.js", () => ({
  SESSION_COOKIE_NAME: "internal_session",
  verifySessionToken: vi.fn(),
  getInternalUserById: vi.fn(),
}));
vi.mock("../services/aiCoreMcpPairingService.js", () => ({
  approveMcpOauthPairing: vi.fn(),
  createMcpOauthPairing: vi.fn(),
  getMcpOauthPairing: vi.fn(),
}));

const publicOrigin = "https://aiengine.cstlogistic.co.id";
const navigation = {
  Origin: "null",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Dest": "document",
};
function makeApp() {
  return createPairingApprovalApp({
    oauthRouter,
    publicOrigin,
    identityEnvironment: "development",
    buildSha: "a".repeat(40),
  });
}

describe("Pairing approval isolated application", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reports identity configuration without claiming operational DEV or touching the DB", async () => {
    const res = await request(makeApp()).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      service: "mcp-pairing-approval",
      scope: "PAIRING_APPROVAL_ONLY",
      identityEnvironment: "development",
      backgroundControllers: false,
      buildSha: "a".repeat(40),
    });
    expect(res.body.executionEnvironment).toBeUndefined();
    expect(getInternalUserById).not.toHaveBeenCalled();
    expect(approveMcpOauthPairing).not.toHaveBeenCalled();
  });

  it.each(["get", "post"] as const)("keeps %s approval behind the real session check", async (method) => {
    const res = await request(makeApp())[method](PAIRING_APPROVAL_PATH)
      .set(method === "post" ? navigation : {}).type("form").send({ code: "12345678" });
    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(getInternalUserById).not.toHaveBeenCalled();
    expect(approveMcpOauthPairing).not.toHaveBeenCalled();
  });

  it("does not grant CORS response access to an opaque form", async () => {
    const res = await request(makeApp()).post(PAIRING_APPROVAL_PATH)
      .set(navigation).type("form").send({ code: "12345678" });
    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("rejects cross-site opaque approval before session or pairing lookup", async () => {
    const res = await request(makeApp()).post(PAIRING_APPROVAL_PATH)
      .set({ ...navigation, "Sec-Fetch-Site": "cross-site" })
      .type("form").send({ code: "12345678" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("origin_not_allowed");
    expect(verifySessionToken).not.toHaveBeenCalled();
    expect(getInternalUserById).not.toHaveBeenCalled();
    expect(approveMcpOauthPairing).not.toHaveBeenCalled();
  });

  it.each([
    ["post", "/api/ai/core-chat/oauth/token"],
    ["get", "/api/ai/core-chat/oauth/authorize"],
    ["get", "/api/ai/core-chat/oauth/login"],
    ["get", "/api/ai/core-chat/oauth/pair/wait"],
    ["post", "/api/internal/auth/login"],
    ["post", "/api/ai/core-chat/mcp"],
    ["get", "/.well-known/oauth-authorization-server"],
    ["get", "/"],
    ["get", PAIRING_APPROVAL_PATH + "/"],
    ["options", PAIRING_APPROVAL_PATH],
    ["head", PAIRING_APPROVAL_PATH],
    ["put", PAIRING_APPROVAL_PATH],
    ["post", "/api/healthz"],
  ] as const)("does not expose %s %s", async (method, path) => {
    const res = await request(makeApp())[method](path).set(navigation);
    expect(res.status).toBe(404);
    expect(verifySessionToken).not.toHaveBeenCalled();
    expect(getInternalUserById).not.toHaveBeenCalled();
    expect(approveMcpOauthPairing).not.toHaveBeenCalled();
  });

  it("preserves signed-session verification for an invalid cookie", async () => {
    vi.mocked(verifySessionToken).mockReturnValue(null);
    const res = await request(makeApp()).post(PAIRING_APPROVAL_PATH)
      .set(navigation).set("Cookie", "internal_session=invalid-test-cookie")
      .type("form").send({ code: "12345678" });
    expect(res.status).toBe(401);
    expect(verifySessionToken).toHaveBeenCalledWith("invalid-test-cookie");
    expect(getInternalUserById).not.toHaveBeenCalled();
    expect(approveMcpOauthPairing).not.toHaveBeenCalled();
  });

  it("retains JSON body parsing and existing pairing verification for a trusted-origin request", async () => {
    vi.mocked(verifySessionToken).mockReturnValue({ sub: 7 });
    vi.mocked(getInternalUserById).mockResolvedValue({
      id: 7, email: "fixture@example.invalid", status: "active", accountType: "internal",
    } as NonNullable<Awaited<ReturnType<typeof getInternalUserById>>>);
    vi.mocked(approveMcpOauthPairing).mockResolvedValue(false);
    const res = await request(makeApp()).post(PAIRING_APPROVAL_PATH)
      .set("Origin", publicOrigin).set("Cookie", "internal_session=signed-fixture")
      .send({ code: "12345678" });
    expect(res.status).toBe(400);
    expect(verifySessionToken).toHaveBeenCalledWith("signed-fixture");
    expect(getInternalUserById).toHaveBeenCalledWith(7);
    expect(approveMcpOauthPairing).toHaveBeenCalledWith("12345678", 7);
  });
});
