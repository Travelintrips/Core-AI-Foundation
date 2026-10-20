import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Script } from "node:vm";
import { createAiCoreMcpOAuthLoginRouter, OAUTH_LOGIN_PATH, OAUTH_LOGIN_SCRIPT_PATH } from "../ai-core-mcp-oauth-login.js";

describe("OAuth login routes under strict script CSP", () => {
  it("serves one external script and disables both native forms until binding", async () => {
    const resolver = vi.fn(async () => null);
    const app = express(); app.use(createAiCoreMcpOAuthLoginRouter(resolver));
    const response = await request(app).get(OAUTH_LOGIN_PATH);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.text.match(/<script\b/g)).toHaveLength(1);
    expect(response.text).toContain('<script src="' + OAUTH_LOGIN_SCRIPT_PATH + '" defer></script>');
    expect(response.text).toContain('<fieldset id="mcp-login-fields" disabled>');
    expect(response.text).toContain('<fieldset id="mcp-magic-fields" disabled>');
    expect(response.text).toContain('<noscript>');
    expect(response.text).toContain('method="post" action="/api/internal/auth/login"');
    expect(response.text).toContain('method="post" action="/api/internal/auth/request-magic-link"');
    expect(resolver).toHaveBeenCalledOnce();
  });

  it("serves a static JavaScript asset without consulting the user/session", async () => {
    const resolver = vi.fn(async () => { throw new Error("unexpected user lookup"); });
    const app = express(); app.use(createAiCoreMcpOAuthLoginRouter(resolver));
    const response = await request(app).get(OAUTH_LOGIN_SCRIPT_PATH);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/javascript/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(() => new Script(response.text)).not.toThrow();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("preserves the signed-session success page without rendering login controls", async () => {
    const app = express(); app.use(createAiCoreMcpOAuthLoginRouter(async () => ({ id: 1 })));
    const response = await request(app).get(OAUTH_LOGIN_PATH);
    expect(response.status).toBe(200);
    expect(response.text).toContain("Sesi AI Engine aktif");
    expect(response.text).toContain("/api/ai/core-chat/oauth/pair/enter");
    expect(response.text).not.toContain("<form");
    expect(response.text).not.toContain("<script");
  });

  it("does not own auth submission or permit non-GET access to the asset", async () => {
    const app = express(); app.use(createAiCoreMcpOAuthLoginRouter(async () => null));
    app.use((_req, res) => { res.status(401).json({ error: "guard retained" }); });
    expect((await request(app).post(OAUTH_LOGIN_SCRIPT_PATH)).status).toBe(401);
    expect((await request(app).post("/api/internal/auth/login")).status).toBe(401);
    expect((await request(app).post("/api/internal/auth/request-magic-link")).status).toBe(401);
  });
});

