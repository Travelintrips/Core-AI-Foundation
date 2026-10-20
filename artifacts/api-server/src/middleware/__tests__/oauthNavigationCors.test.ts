import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cors from "cors";
import request from "supertest";
import { oauthNavigationCors } from "../oauthNavigationCors.js";
import cookieParser from "cookie-parser";
import aiCoreMcpOauthRouter from "../../routes/ai-core-mcp-oauth.js";
import { getInternalUserById } from "../../services/internalAuthService.js";
import { approveMcpOauthPairing } from "../../services/aiCoreMcpPairingService.js";

vi.mock("../../services/internalAuthService.js", () => ({
  SESSION_COOKIE_NAME: "internal_session",
  verifySessionToken: vi.fn(() => null),
  getInternalUserById: vi.fn(),
}));
vi.mock("../../services/aiCoreMcpPairingService.js", () => ({
  approveMcpOauthPairing: vi.fn(),
  createMcpOauthPairing: vi.fn(),
  getMcpOauthPairing: vi.fn(),
}));


function makeApp() {
  const app = express();
  app.use(oauthNavigationCors(cors({
    origin(origin, callback) {
      if (!origin || origin === "https://aicore.cstlogistic.co.id") {
        callback(null, true);
      } else {
        callback(new Error("Origin not allowed"));
      }
    },
    credentials: true,
  })));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.post("/api/ai/core-chat/oauth/authorize", (req, res) => {
    if (req.body.response_type !== "code") {
      res.status(400).json({ error: "unsupported_response_type" });
      return;
    }
    res.redirect(302, "/pairing");
  });
  app.get("/api/ai/core-chat/oauth/authorize", (_req, res) => res.send("Consent"));
  app.post("/api/ai/core-chat/oauth/token", (_req, res) => res.sendStatus(200));
  app.post("/api/internal/auth/request-magic-link", (_req, res) => res.json({ ok: true }));
  app.use(aiCoreMcpOauthRouter);
  return app;
}

describe("OAuth browser navigation CORS", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["null", "https://chatgpt.com"])(
    "allows consent form navigation with Origin %s without granting CORS access",
    async (origin) => {
      const res = await request(makeApp())
        .post("/api/ai/core-chat/oauth/authorize")
        .set("Origin", origin).type("form").send({ response_type: "code" });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/pairing");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    },
  );

  it("allows same-site opaque magic-link form without granting CORS access", async () => {
    const res = await request(makeApp()).post("/api/internal/auth/request-magic-link")
      .set("Origin", "null").set("Sec-Fetch-Site", "same-origin")
      .set("Sec-Fetch-Mode", "navigate").type("form").send({ email: "invalid-format" });
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects opaque-origin cross-site magic-link form", async () => {
    const res = await request(makeApp()).post("/api/internal/auth/request-magic-link")
      .set("Origin", "null").set("Sec-Fetch-Site", "cross-site")
      .set("Sec-Fetch-Mode", "navigate").type("form").send({ email: "invalid-format" });
    expect(res.status).toBe(500);
  });

  it("still reaches OAuth request validation for an opaque-origin form", async () => {
    const res = await request(makeApp()).post("/api/ai/core-chat/oauth/authorize")
      .set("Origin", "null").type("form").send({ response_type: "token" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_response_type");
  });

  it("allows GET consent navigation", async () => {
    const res = await request(makeApp()).get("/api/ai/core-chat/oauth/authorize")
      .set("Origin", "null");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("keeps token API CORS restrictions", async () => {
    const res = await request(makeApp()).post("/api/ai/core-chat/oauth/token")
      .set("Origin", "https://chatgpt.com");
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("keeps trusted-origin token API access", async () => {
    const res = await request(makeApp()).post("/api/ai/core-chat/oauth/token")
      .set("Origin", "https://aicore.cstlogistic.co.id");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://aicore.cstlogistic.co.id");
  });

  it("does not exempt cross-origin preflight requests", async () => {
    const res = await request(makeApp()).options("/api/ai/core-chat/oauth/authorize")
      .set("Origin", "https://chatgpt.com")
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("Pairing approval browser navigation CORS", () => {
  const navigation = {
    Origin: "null",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
  };
  beforeEach(() => vi.clearAllMocks());

  it("reaches the real approval authentication boundary without CORS access", async () => {
    const res = await request(makeApp()).post("/api/ai/core-chat/oauth/pair/approve")
      .set(navigation).type("form").send({ code: "12345678" });
    expect(res.status).toBe(401);
    expect(res.text).toContain("Session AI Core tidak ditemukan");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(getInternalUserById).not.toHaveBeenCalled();
    expect(approveMcpOauthPairing).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-site", { "Sec-Fetch-Site": "cross-site" }, "form"],
    ["JSON", {}, "json"],
    ["fetch", { "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" }, "form"],
    ["missing document destination", { "Sec-Fetch-Dest": "empty" }, "form"],
    ["missing same-origin relationship", { "Sec-Fetch-Site": "none" }, "form"],
  ])("does not exempt %s approval requests", async (_name, overrides, encoding) => {
    const res = await request(makeApp()).post("/api/ai/core-chat/oauth/pair/approve")
      .set({ ...navigation, ...overrides }).type(encoding).send({ code: "12345678" });
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(getInternalUserById).not.toHaveBeenCalled();
    expect(approveMcpOauthPairing).not.toHaveBeenCalled();
  });

  it("does not exempt approval preflight", async () => {
    const res = await request(makeApp()).options("/api/ai/core-chat/oauth/pair/approve")
      .set(navigation).set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(approveMcpOauthPairing).not.toHaveBeenCalled();
  });

  it("does not extend the exception to another path", async () => {
    const res = await request(makeApp()).post("/api/unrelated")
      .set(navigation).type("form").send({ code: "12345678" });
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(approveMcpOauthPairing).not.toHaveBeenCalled();
  });
});
